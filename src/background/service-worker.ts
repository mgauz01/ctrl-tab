import * as mru from "./mru.js";
import * as thumbs from "./thumbnails.js";
import type { SwitcherPayload, SwitcherTab } from "../shared/types.js";
import type { BackgroundMessage } from "../shared/messages.js";
import { OVERLAY_HIDE, OVERLAY_SHOW } from "../shared/messages.js";

const SWITCHER_LIMIT = 5;
const FALLBACK_PATH = "dist/fallback.html";

interface PopupRef {
  windowId: number;
  tabId: number;
}

const popups = new Map<number, PopupRef>();
const EXTENSION_ORIGIN = chrome.runtime.getURL("");
const POPUP_HEIGHT = 400;

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

function initialSelectedIndex(count: number): number {
  return count >= 2 ? 1 : 0;
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

async function computePopupBounds(parentWindowId: number): Promise<{
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
    const left = px + Math.round((pw - width) / 2);
    const top = py + Math.max(ph - POPUP_HEIGHT - 72, 24);
    return { width, height: POPUP_HEIGHT, left, top };
  } catch {
    return { width: 800, height: POPUP_HEIGHT, left: 80, top: 120 };
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

  const bounds = await computePopupBounds(windowId);
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
  const ref: PopupRef = { windowId: popup.id, tabId: popupTab.id };
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
  } catch {
    /* popup closed before ready */
  }
}

async function showSwitcher(windowId: number): Promise<void> {
  const tabs = await resolveSwitcherTabs(windowId);
  if (tabs.length === 0) return;

  const payload: SwitcherPayload = {
    tabs,
    selectedIndex: initialSelectedIndex(tabs.length),
    windowId,
  };

  const [active] = await chrome.tabs.query({ active: true, windowId });
  if (active?.id != null && isInjectableUrl(active.url)) {
    try {
      await injectOverlay(active.id, payload);
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
  if (command !== "open-switcher") return;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.windowId == null) return;
  await showSwitcher(active.windowId);
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
