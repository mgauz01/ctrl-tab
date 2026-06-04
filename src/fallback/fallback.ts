import { mountSwitcher } from "../overlay/overlay.js";
import type { SwitcherPayload } from "../shared/types.js";
import { OVERLAY_SHOW } from "../shared/messages.js";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === OVERLAY_SHOW && msg.payload) {
    mountSwitcher(msg.payload as SwitcherPayload);
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
