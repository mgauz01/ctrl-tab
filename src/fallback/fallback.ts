import { mountSwitcher, measureContentHeight } from "../overlay/overlay.js";
import type { SwitcherPayload } from "../shared/types.js";
import { OVERLAY_SHOW } from "../shared/messages.js";

const VERTICAL_PADDING = 28;

function requestTightFit(windowId: number): void {
  requestAnimationFrame(() => {
    const content = measureContentHeight();
    if (content <= 0) return;
    const chromeHeight = Math.max(window.outerHeight - window.innerHeight, 0);
    const height = content + VERTICAL_PADDING + chromeHeight;
    void chrome.runtime.sendMessage({
      type: "RESIZE_POPUP",
      windowId,
      height,
    });
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === OVERLAY_SHOW && msg.payload) {
    const payload = msg.payload as SwitcherPayload;
    mountSwitcher(payload);
    requestTightFit(payload.windowId);
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
