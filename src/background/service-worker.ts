import * as mru from "./mru.js";
import * as thumbs from "./thumbnails.js";
import type { SwitcherPayload, SwitcherTab } from "../shared/types.js";
import type { BackgroundMessage } from "../shared/messages.js";
import { OVERLAY_HIDE, OVERLAY_SHOW } from "../shared/messages.js";

const SWITCHER_LIMIT = 5;
const FALLBACK_PATH = "dist/fallback.html";

const fallbackTabs = new Map<number, number>();

function isInjectableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("file://")
  );
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

async function openFallbackSwitcher(
  windowId: number,
  payload: SwitcherPayload
): Promise<void> {
  const existing = fallbackTabs.get(windowId);
  if (existing != null) {
    try {
      await chrome.tabs.update(existing, { active: true });
      await chrome.tabs.sendMessage(existing, {
        type: OVERLAY_SHOW,
        payload,
      });
      return;
    } catch {
      fallbackTabs.delete(windowId);
    }
  }
  const tab = await chrome.tabs.create({
    windowId,
    url: chrome.runtime.getURL(FALLBACK_PATH),
    active: true,
  });
  if (tab.id != null) {
    fallbackTabs.set(windowId, tab.id);
    await new Promise<void>((resolve) => {
      const listener = (
        tabId: number,
        info: chrome.tabs.TabChangeInfo
      ) => {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    await chrome.tabs.sendMessage(tab.id, {
      type: OVERLAY_SHOW,
      payload,
    });
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
  await openFallbackSwitcher(windowId, payload);
  armSwitcherTimeout(windowId);
}

async function hideSwitcherInWindow(windowId: number): Promise<void> {
  if (switcherTimeout) {
    clearTimeout(switcherTimeout);
    switcherTimeout = null;
  }
  const fb = fallbackTabs.get(windowId);
  if (fb != null) {
    try {
      await chrome.tabs.sendMessage(fb, { type: OVERLAY_HIDE });
    } catch {
      /* ignore */
    }
    try {
      await chrome.tabs.remove(fb);
    } catch {
      /* ignore */
    }
    fallbackTabs.delete(windowId);
  }
  const tabs = await chrome.tabs.query({ windowId });
  for (const t of tabs) {
    if (t.id == null || t.id === fb) continue;
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
  mru.onTabActivated(windowId, tabId);
  setTimeout(() => {
    void thumbs.captureTabThumbnail(windowId, tabId);
  }, 200);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  mru.onTabRemoved(tabId);
  void thumbs.removeThumbnail(tabId);
  for (const [winId, fbId] of fallbackTabs.entries()) {
    if (fbId === tabId) fallbackTabs.delete(winId);
  }
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  mru.onTabDetached(tabId, detachInfo.oldWindowId);
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  mru.onTabAttached(tabId, attachInfo.newWindowId);
});

void mru.bootstrapWindows();
