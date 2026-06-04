import * as mru from "./mru.js";
import * as thumbs from "./thumbnails.js";
import type { SwitcherPayload, SwitcherTab } from "../shared/types.js";
import type { BackgroundMessage } from "../shared/messages.js";
import { OVERLAY_HIDE, OVERLAY_SHOW, OVERLAY_STEP } from "../shared/messages.js";

const SWITCHER_LIMIT = 5;
const FALLBACK_PATH = "dist/fallback.html";

interface PopupRef {
  windowId: number;
  tabId: number;
  height: number;
}

const popups = new Map<number, PopupRef>();
// Parent windowId -> the tab that currently hosts the switcher UI (an
// injected page tab, or the popup's own tab). Presence means "open".
const openSwitchers = new Map<number, { tabId: number }>();
const EXTENSION_ORIGIN = chrome.runtime.getURL("");

// Mirrors overlay.css so the popup can open at its final size (no resize jump).
function estimatePopupContentHeight(width: number, count: number): number {
  const CARD_MAX = 239;
  const GAP = 19;
  const PAD_X = 48;
  const PAD_Y = 28;
  const TITLE_BLOCK = 36;
  const STRIP_MAX = 1180;
  const n = Math.max(count, 1);
  const stripW = Math.min(width - PAD_X, STRIP_MAX);
  const cardW = Math.min(CARD_MAX, (stripW - (n - 1) * GAP) / n);
  const previewH = (cardW * 10) / 16 + 6;
  const cardH = TITLE_BLOCK + previewH + 4;
  return Math.round(cardH + PAD_Y);
}

function findParentByPopupWindow(windowId: number): number | null {
  for (const [parentId, ref] of popups.entries()) {
    if (ref.windowId === windowId) return parentId;
  }
  return null;
}

function isInjectableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("file://")
  );
}

function isPopupTab(tabId: number): boolean {
  for (const ref of popups.values()) {
    if (ref.tabId === tabId) return true;
  }
  return false;
}

function isPopupWindow(windowId: number): boolean {
  for (const ref of popups.values()) {
    if (ref.windowId === windowId) return true;
  }
  return false;
}

function isSwitcherTab(tabId: number, url: string | undefined): boolean {
  return isPopupTab(tabId) || (url?.startsWith(EXTENSION_ORIGIN) ?? false);
}

function initialSelectedIndex(count: number, backwards: boolean): number {
  if (count < 2) return 0;
  return backwards ? count - 1 : 1;
}

async function resolveSwitcherTabs(windowId: number): Promise<SwitcherTab[]> {
  const ids = mru.getMruTabIds(windowId, SWITCHER_LIMIT);
  const tabs: SwitcherTab[] = [];
  for (const id of ids) {
    try {
      const tab = await chrome.tabs.get(id);
      if (tab.windowId !== windowId || tab.discarded) continue;
      if (isSwitcherTab(id, tab.url)) continue;
      const thumbDataUrl = await thumbs.getThumbnail(id);
      tabs.push({
        id,
        title: tab.title ?? "",
        url: tab.url ?? "",
        favIconUrl: tab.favIconUrl,
        thumbDataUrl,
      });
    } catch {
      // Tab closed
    }
  }
  return tabs;
}

let switcherTimeout: ReturnType<typeof setTimeout> | null = null;

function armSwitcherTimeout(windowId: number): void {
  if (switcherTimeout) clearTimeout(switcherTimeout);
  switcherTimeout = setTimeout(() => {
    void hideSwitcherInWindow(windowId);
  }, 30_000);
}

async function injectOverlay(tabId: number, payload: SwitcherPayload): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: OVERLAY_SHOW,
      payload,
    });
    return;
  } catch {
    /* not injected yet */
  }
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["dist/overlay.css"],
    });
  } catch {
    /* already inserted */
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["dist/overlay.js"],
  });
  await chrome.tabs.sendMessage(tabId, {
    type: OVERLAY_SHOW,
    payload,
  });
}

const CHROME_HEIGHT_ESTIMATE = 30;

async function computePopupBounds(
  parentWindowId: number,
  count: number
): Promise<{
  width: number;
  height: number;
  left: number;
  top: number;
}> {
  try {
    const parent = await chrome.windows.get(parentWindowId);
    const pw = parent.width ?? 1200;
    const ph = parent.height ?? 800;
    const px = parent.left ?? 0;
    const py = parent.top ?? 0;
    const width = Math.min(Math.max(pw - 120, 640), 1280);
    const height =
      estimatePopupContentHeight(width, count) + CHROME_HEIGHT_ESTIMATE;
    const left = px + Math.round((pw - width) / 2);
    const top = py + Math.max(ph - height - 72, 24);
    return { width, height, left, top };
  } catch {
    const width = 800;
    const height =
      estimatePopupContentHeight(width, count) + CHROME_HEIGHT_ESTIMATE;
    return { width, height, left: 80, top: 120 };
  }
}

async function openPopupSwitcher(
  windowId: number,
  payload: SwitcherPayload
): Promise<void> {
  const existing = popups.get(windowId);
  if (existing != null) {
    try {
      await chrome.windows.update(existing.windowId, { focused: true });
      await chrome.tabs.sendMessage(existing.tabId, {
        type: OVERLAY_SHOW,
        payload,
      });
      return;
    } catch {
      popups.delete(windowId);
    }
  }

  const bounds = await computePopupBounds(windowId, payload.tabs.length);
  const popup = await chrome.windows.create({
    url: chrome.runtime.getURL(FALLBACK_PATH),
    type: "popup",
    focused: true,
    width: bounds.width,
    height: bounds.height,
    left: bounds.left,
    top: bounds.top,
  });

  const popupTab = popup?.tabs?.[0];
  if (popup?.id == null || popupTab?.id == null) return;
  const ref: PopupRef = {
    windowId: popup.id,
    tabId: popupTab.id,
    height: bounds.height,
  };
  popups.set(windowId, ref);

  await new Promise<void>((resolve) => {
    const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (tabId === ref.tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });

  try {
    await chrome.tabs.sendMessage(ref.tabId, {
      type: OVERLAY_SHOW,
      payload,
    });
    openSwitchers.set(windowId, { tabId: ref.tabId });
  } catch {
    /* popup closed before ready */
  }
}

async function stepSwitcher(windowId: number, delta: number): Promise<void> {
  const state = openSwitchers.get(windowId);
  if (!state) return;
  try {
    await chrome.tabs.sendMessage(state.tabId, { type: OVERLAY_STEP, delta });
    armSwitcherTimeout(windowId);
  } catch {
    openSwitchers.delete(windowId);
  }
}

async function resizePopup(parentWindowId: number, height: number): Promise<void> {
  const ref = popups.get(parentWindowId);
  if (!ref) return;
  const h = Math.max(120, Math.round(height));
  // Skip imperceptible corrections so the popup never visibly resizes.
  if (Math.abs(h - ref.height) < 8) return;
  ref.height = h;
  try {
    const parent = await chrome.windows.get(parentWindowId);
    const py = parent.top ?? 0;
    const ph = parent.height ?? 800;
    const top = py + Math.max(ph - h - 72, 24);
    await chrome.windows.update(ref.windowId, { height: h, top });
  } catch {
    try {
      await chrome.windows.update(ref.windowId, { height: h });
    } catch {
      /* popup gone */
    }
  }
}

async function showSwitcher(windowId: number, backwards = false): Promise<void> {
  const tabs = await resolveSwitcherTabs(windowId);
  if (tabs.length === 0) return;

  const payload: SwitcherPayload = {
    tabs,
    selectedIndex: initialSelectedIndex(tabs.length, backwards),
    windowId,
  };

  const [active] = await chrome.tabs.query({ active: true, windowId });
  if (active?.id != null && isInjectableUrl(active.url)) {
    try {
      await injectOverlay(active.id, payload);
      openSwitchers.set(windowId, { tabId: active.id });
      armSwitcherTimeout(windowId);
      return;
    } catch {
      /* fall through */
    }
  }
  await openPopupSwitcher(windowId, payload);
  armSwitcherTimeout(windowId);
}

async function closePopup(windowId: number): Promise<void> {
  const ref = popups.get(windowId);
  if (ref == null) return;
  popups.delete(windowId);
  try {
    await chrome.windows.remove(ref.windowId);
  } catch {
    /* already closed */
  }
}

async function hideSwitcherInWindow(windowId: number): Promise<void> {
  if (switcherTimeout) {
    clearTimeout(switcherTimeout);
    switcherTimeout = null;
  }
  openSwitchers.delete(windowId);
  await closePopup(windowId);
  const tabs = await chrome.tabs.query({ windowId });
  for (const t of tabs) {
    if (t.id == null) continue;
    if (!isInjectableUrl(t.url)) continue;
    try {
      await chrome.tabs.sendMessage(t.id, { type: OVERLAY_HIDE });
    } catch {
      /* no overlay */
    }
  }
}

async function commitTab(windowId: number, tabId: number): Promise<void> {
  await hideSwitcherInWindow(windowId);
  try {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
    mru.promoteTab(windowId, tabId);
  } catch {
    /* tab gone */
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  const delta =
    command === "open-switcher" ? 1 : command === "open-switcher-back" ? -1 : 0;
  if (delta === 0) return;

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.windowId == null) return;

  // If the focused window is one of our popups, route stepping to the
  // switcher that belongs to its parent window.
  const popupParent = findParentByPopupWindow(active.windowId);
  if (popupParent != null && openSwitchers.has(popupParent)) {
    await stepSwitcher(popupParent, delta);
    return;
  }

  if (openSwitchers.has(active.windowId)) {
    await stepSwitcher(active.windowId, delta);
    return;
  }

  await showSwitcher(active.windowId, delta < 0);
});

chrome.runtime.onMessage.addListener(
  (msg: BackgroundMessage, _sender, sendResponse) => {
    if (msg.type === "COMMIT") {
      void commitTab(msg.windowId, msg.tabId).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === "CANCEL") {
      void hideSwitcherInWindow(msg.windowId).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === "RESIZE_POPUP") {
      void resizePopup(msg.windowId, msg.height).then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  }
);

chrome.tabs.onActivated.addListener((info) => {
  const { tabId, windowId } = info;
  if (isPopupTab(tabId) || isPopupWindow(windowId)) return;
  mru.onTabActivated(windowId, tabId);
  setTimeout(() => {
    void thumbs.captureTabThumbnail(windowId, tabId);
  }, 200);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (isPopupTab(tabId)) return;
  mru.onTabRemoved(tabId);
  void thumbs.removeThumbnail(tabId);
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  if (isPopupTab(tabId)) return;
  mru.onTabDetached(tabId, detachInfo.oldWindowId);
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  if (isPopupTab(tabId)) return;
  mru.onTabAttached(tabId, attachInfo.newWindowId);
});

chrome.windows.onRemoved.addListener((closedWindowId) => {
  for (const [parentId, ref] of popups.entries()) {
    if (ref.windowId === closedWindowId) popups.delete(parentId);
  }
});

void mru.bootstrapWindows();
