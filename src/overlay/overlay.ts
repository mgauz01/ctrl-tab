import type { SwitcherPayload } from "../shared/types.js";
import { OVERLAY_HIDE, OVERLAY_SHOW, OVERLAY_STEP } from "../shared/types.js";

const ROOT_ID = "ctrl-tab-root";

let selectedIndex = 0;
let payload: SwitcherPayload | null = null;
let keyHandlersAttached = false;

function step(delta: number): void {
  if (!payload) return;
  const n = payload.tabs.length;
  if (n === 0) return;
  selectedIndex = (selectedIndex + delta + n) % n;
  updateSelection();
}

function commitSelected(): void {
  if (!payload) return;
  const tab = payload.tabs[selectedIndex];
  if (tab) {
    void chrome.runtime.sendMessage({
      type: "COMMIT",
      tabId: tab.id,
      windowId: payload.windowId,
    });
  }
  removeOverlay();
}

function removeOverlay(): void {
  document.getElementById(ROOT_ID)?.remove();
  detachKeyHandlers();
  document.removeEventListener("visibilitychange", onVisibilityChange, true);
  window.removeEventListener("pagehide", onPageHide, true);
  payload = null;
}

function detachKeyHandlers(): void {
  if (!keyHandlersAttached) return;
  document.removeEventListener("keydown", onKeyDown, true);
  document.removeEventListener("keyup", onKeyUp, true);
  keyHandlersAttached = false;
}

function attachKeyHandlers(): void {
  if (keyHandlersAttached) return;
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  keyHandlersAttached = true;
}

function onKeyDown(e: KeyboardEvent): void {
  if (!payload) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    void chrome.runtime.sendMessage({
      type: "CANCEL",
      windowId: payload.windowId,
    });
    removeOverlay();
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    e.stopPropagation();
    step(e.shiftKey ? -1 : 1);
    return;
  }
  // Swallow the opener chord so the page never reacts to it. Actual
  // stepping is driven by the background command re-firing (OVERLAY_STEP),
  // which is reliable even when the page would otherwise eat the keypress.
  if ((e.key === "q" || e.key === "Q") && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function onKeyUp(e: KeyboardEvent): void {
  if (!payload) return;
  if (e.key === "Control" || e.key === "Meta") {
    e.preventDefault();
    e.stopPropagation();
    commitSelected();
  }
}

function updateSelection(): void {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  root.querySelectorAll(".ctrl-tab-card").forEach((card, i) => {
    const selected = i === selectedIndex;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-selected", selected ? "true" : "false");
  });
}

function renderPreview(tab: SwitcherPayload["tabs"][0]): HTMLElement {
  const preview = document.createElement("div");
  preview.className = "ctrl-tab-preview";
  if (tab.thumbDataUrl) {
    const img = document.createElement("img");
    img.src = tab.thumbDataUrl;
    img.alt = "";
    img.decoding = "async";
    preview.appendChild(img);
  } else {
    const ph = document.createElement("div");
    ph.className = "ctrl-tab-placeholder";
    if (tab.favIconUrl) {
      const fav = document.createElement("img");
      fav.src = tab.favIconUrl;
      fav.alt = "";
      ph.appendChild(fav);
    }
    const label = document.createElement("span");
    label.textContent = "No preview";
    ph.appendChild(label);
    preview.appendChild(ph);
  }
  return preview;
}

export function showSwitcher(data: SwitcherPayload): void {
  removeOverlay();
  payload = data;
  selectedIndex = data.selectedIndex;

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Recent tabs");

  const panel = document.createElement("div");
  panel.className = "ctrl-tab-panel";

  const hint = document.createElement("p");
  hint.className = "ctrl-tab-hint";
  hint.id = "ctrl-tab-hint";
  hint.textContent = "Release Ctrl to switch · click a tab · Esc to cancel";

  const strip = document.createElement("div");
  strip.className = "ctrl-tab-strip";
  strip.setAttribute("role", "listbox");
  strip.setAttribute("aria-orientation", "horizontal");
  strip.setAttribute("aria-describedby", "ctrl-tab-hint");

  data.tabs.forEach((tab, i) => {
    const card = document.createElement("div");
    card.className = "ctrl-tab-card" + (i === selectedIndex ? " is-selected" : "");
    card.setAttribute("role", "option");
    card.setAttribute("aria-selected", i === selectedIndex ? "true" : "false");
    card.tabIndex = -1;

    const title = document.createElement("p");
    title.className = "ctrl-tab-title";
    title.textContent = tab.title || tab.url || "Untitled";
    card.appendChild(title);
    card.appendChild(renderPreview(tab));

    card.addEventListener("pointerenter", () => {
      selectedIndex = i;
      updateSelection();
    });
    card.addEventListener("click", (e) => {
      e.preventDefault();
      selectedIndex = i;
      updateSelection();
      commitSelected();
    });

    strip.appendChild(card);
  });

  panel.appendChild(hint);
  panel.appendChild(strip);
  root.appendChild(panel);
  document.documentElement.appendChild(root);
  attachKeyHandlers();

  document.addEventListener("visibilitychange", onVisibilityChange, true);
  window.addEventListener("pagehide", onPageHide, true);
}

function onPageHide(): void {
  if (!payload) return;
  void chrome.runtime.sendMessage({
    type: "CANCEL",
    windowId: payload.windowId,
  });
  removeOverlay();
}

function onVisibilityChange(): void {
  if (!payload || !document.hidden) return;
  void chrome.runtime.sendMessage({
    type: "CANCEL",
    windowId: payload.windowId,
  });
  removeOverlay();
  document.removeEventListener("visibilitychange", onVisibilityChange, true);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === OVERLAY_SHOW && msg.payload) {
    showSwitcher(msg.payload as SwitcherPayload);
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === OVERLAY_STEP) {
    step(typeof msg.delta === "number" ? msg.delta : 1);
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === OVERLAY_HIDE) {
    removeOverlay();
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

export function measureContentHeight(): number {
  const panel = document.querySelector<HTMLElement>(".ctrl-tab-panel");
  if (!panel) return 0;
  return Math.ceil(panel.getBoundingClientRect().height);
}
