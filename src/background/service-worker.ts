import * as mru from "./mru.js";
import * as thumbs from "./thumbnails.js";
import type { BackgroundMessage, SwitcherPayload, SwitcherTab } from "../shared/types.js";
import { OVERLAY_HIDE, OVERLAY_SHOW, OVERLAY_STEP } from "../shared/types.js";

const SWITCHER_LIMIT = 5;
const FALLBACK_PATH = "dist/fallback.html";
const POPUP_MIN_HEIGHT = 200;
const CHROME_HEIGHT_ESTIMATE = 30;
const POPUP_LOAD_TIMEOUT_MS = 10_000;
const CAPTURE_DEBOUNCE_MS = 400;

interface PopupRef {
  windowId: number;
  tabId: number;
  height: number;
}

const popups = new Map<number, PopupRef>();
const popupTabIds = new Set<number>();
const popupWindowIds = new Set<number>();
const openSwitchers = new Map<number, { tabId: number }>();
const openingSwitchers = new Set<number>();
const pendingSteps = new Map<number, number>();
const removedWindows = new Set<number>();
const switcherTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
const captureTimers = new Map<number, ReturnType<typeof setTimeout>>();
const EXTENSION_ORIGIN = chrome.runtime.getURL("");

function startMruBootstrap(): Promise<boolean> {
  return mru.bootstrapWindows().then(
    () => true,
    () => false
  );
}

let mruReady = startMruBootstrap();

async function ensureMruReady(): Promise<void> {
  if (await mruReady) return;
  mruReady = startMruBootstrap();
  await mruReady;
}

function trackPopup(ref: PopupRef): void {
  popupTabIds.add(ref.tabId);
  popupWindowIds.add(ref.windowId);
}

function untrackPopup(ref: PopupRef): void {
  popupTabIds.delete(ref.tabId);
  popupWindowIds.delete(ref.windowId);
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

function isSwitcherTab(tabId: number, url: string | undefined): boolean {
  return popupTabIds.has(tabId) || (url?.startsWith(EXTENSION_ORIGIN) ?? false);
}

function initialSelectedIndex(count: number, backwards: boolean): number {
  if (count < 2) return 0;
  return backwards ? count - 1 : 1;
}

function queueSwitcherStep(windowId: number, delta: number): void {
  pendingSteps.set(windowId, (pendingSteps.get(windowId) ?? 0) + delta);
}

async function resolveSwitcherTabs(windowId: number): Promise<SwitcherTab[]> {
  const ids = mru.getMruTabIds(windowId, SWITCHER_LIMIT);
  const thumbsById = await thumbs.getThumbnails(ids);

  const resolved = await Promise.all(
    ids.map(async (id): Promise<SwitcherTab | null> => {
      try {
        const tab = await chrome.tabs.get(id);
        if (tab.windowId !== windowId || tab.discarded) return null;
        if (isSwitcherTab(id, tab.url)) return null;
        return {
          id,
          title: tab.title ?? "",
          url: tab.url ?? "",
          favIconUrl: tab.favIconUrl,
          thumbDataUrl: thumbsById.get(id),
        };
      } catch {
        return null;
      }
    })
  );

  return resolved.filter((t): t is SwitcherTab => t != null);
}

function clearSwitcherTimeout(windowId: number): void {
  const t = switcherTimeouts.get(windowId);
  if (t) {
    clearTimeout(t);
    switcherTimeouts.delete(windowId);
  }
}

function armSwitcherTimeout(windowId: number): void {
  clearSwitcherTimeout(windowId);
  switcherTimeouts.set(
    windowId,
    setTimeout(() => {
      switcherTimeouts.delete(windowId);
      void hideSwitcherInWindow(windowId);
    }, 30_000)
  );
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

async function computePopupBounds(
  parentWindowId: number
): Promise<{
  width: number;
  height: number;
  left: number;
  top: number;
}> {
  const height = POPUP_MIN_HEIGHT + CHROME_HEIGHT_ESTIMATE;
  try {
    const parent = await chrome.windows.get(parentWindowId);
    const pw = parent.width ?? 1200;
    const ph = parent.height ?? 800;
    const px = parent.left ?? 0;
    const py = parent.top ?? 0;
    const width = Math.min(Math.max(pw - 120, 640), 1280);
    const left = px + Math.round((pw - width) / 2);
    const top = py + Math.max(ph - height - 72, 24);
    return { width, height, left, top };
  } catch {
    return { width: 800, height, left: 80, top: 120 };
  }
}

async function waitForPopupTab(tabId: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const timeout = setTimeout(() => {
      finish();
    }, POPUP_LOAD_TIMEOUT_MS);
    const listener = (updatedId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedId === tabId && info.status === "complete") {
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete") finish();
      })
      .catch(finish);
  });
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
      openSwitchers.set(windowId, { tabId: existing.tabId });
      return;
    } catch {
      await closePopup(windowId);
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
  if (removedWindows.has(windowId)) {
    try {
      await chrome.windows.remove(popup.id);
    } catch {
      /* popup already closed */
    }
    return;
  }
  const ref: PopupRef = {
    windowId: popup.id,
    tabId: popupTab.id,
    height: bounds.height,
  };
  popups.set(windowId, ref);
  trackPopup(ref);

  await waitForPopupTab(ref.tabId);
  if (removedWindows.has(windowId) || popups.get(windowId) !== ref) {
    try {
      await chrome.windows.remove(ref.windowId);
    } catch {
      /* popup already closed */
    }
    return;
  }

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
  removedWindows.delete(windowId);
  openingSwitchers.add(windowId);
  try {
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
    if (openSwitchers.has(windowId)) armSwitcherTimeout(windowId);
  } finally {
    openingSwitchers.delete(windowId);
    const pendingDelta = pendingSteps.get(windowId) ?? 0;
    pendingSteps.delete(windowId);
    if (pendingDelta !== 0 && openSwitchers.has(windowId)) {
      await stepSwitcher(windowId, pendingDelta);
    }
    removedWindows.delete(windowId);
  }
}

async function closePopup(windowId: number): Promise<void> {
  const ref = popups.get(windowId);
  if (ref == null) return;
  untrackPopup(ref);
  popups.delete(windowId);
  try {
    await chrome.windows.remove(ref.windowId);
  } catch {
    /* already closed */
  }
}

async function hideOverlayHost(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isInjectableUrl(tab.url)) return;
    await chrome.tabs.sendMessage(tabId, { type: OVERLAY_HIDE });
  } catch {
    /* no overlay or tab gone */
  }
}

async function hideSwitcherInWindow(windowId: number): Promise<void> {
  clearSwitcherTimeout(windowId);
  const host = openSwitchers.get(windowId);
  openSwitchers.delete(windowId);
  await closePopup(windowId);
  if (host) await hideOverlayHost(host.tabId);
}

async function commitTab(windowId: number, tabId: number): Promise<void> {
  await hideSwitcherInWindow(windowId);
  try {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
    mru.onTabActivated(windowId, tabId);
  } catch {
    /* tab gone */
  }
}

function scheduleCapture(windowId: number, tabId: number): void {
  const prev = captureTimers.get(tabId);
  if (prev) clearTimeout(prev);
  captureTimers.set(
    tabId,
    setTimeout(() => {
      captureTimers.delete(tabId);
      void thumbs.captureTabThumbnail(windowId, tabId);
    }, CAPTURE_DEBOUNCE_MS)
  );
}

chrome.commands.onCommand.addListener(async (command) => {
  const delta =
    command === "open-switcher" ? 1 : command === "open-switcher-back" ? -1 : 0;
  if (delta === 0) return;

  await ensureMruReady();
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.windowId == null) return;

  const popupParent = findParentByPopupWindow(active.windowId);
  if (popupParent != null) {
    if (openSwitchers.has(popupParent)) {
      await stepSwitcher(popupParent, delta);
    } else if (openingSwitchers.has(popupParent)) {
      queueSwitcherStep(popupParent, delta);
    } else {
      await showSwitcher(popupParent, delta < 0);
    }
    return;
  }

  if (openSwitchers.has(active.windowId)) {
    await stepSwitcher(active.windowId, delta);
    return;
  }

  if (openingSwitchers.has(active.windowId)) {
    queueSwitcherStep(active.windowId, delta);
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
  if (popupTabIds.has(tabId) || popupWindowIds.has(windowId)) return;
  mru.onTabActivated(windowId, tabId);
  scheduleCapture(windowId, tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (popupTabIds.has(tabId) || popupWindowIds.has(tab.windowId)) return;
  if (!tab.active) return;
  if (changeInfo.status !== "complete" && changeInfo.url == null) return;
  scheduleCapture(tab.windowId, tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const t = captureTimers.get(tabId);
  if (t) {
    clearTimeout(t);
    captureTimers.delete(tabId);
  }
  if (popupTabIds.has(tabId)) return;
  mru.onTabRemoved(tabId);
  void thumbs.removeThumbnail(tabId);
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  if (popupTabIds.has(tabId)) return;
  mru.onTabDetached(tabId, detachInfo.oldWindowId);
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  if (popupTabIds.has(tabId)) return;
  mru.onTabAttached(tabId, attachInfo.newWindowId);
});

chrome.windows.onRemoved.addListener((closedWindowId) => {
  if (openingSwitchers.has(closedWindowId)) {
    removedWindows.add(closedWindowId);
  } else {
    removedWindows.delete(closedWindowId);
  }
  openingSwitchers.delete(closedWindowId);
  pendingSteps.delete(closedWindowId);
  clearSwitcherTimeout(closedWindowId);
  openSwitchers.delete(closedWindowId);
  if (popups.has(closedWindowId)) {
    void closePopup(closedWindowId);
  }

  for (const [parentId, ref] of popups.entries()) {
    if (ref.windowId === closedWindowId) {
      untrackPopup(ref);
      popups.delete(parentId);
      clearSwitcherTimeout(parentId);
      openSwitchers.delete(parentId);
    }
  }
});
