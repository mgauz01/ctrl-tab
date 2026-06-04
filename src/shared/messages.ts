import type { SwitcherPayload } from "./types.js";

export type OverlayMessage =
  | { type: "SHOW_SWITCHER"; payload: SwitcherPayload }
  | { type: "HIDE_SWITCHER" };

export type BackgroundMessage =
  | { type: "COMMIT"; tabId: number; windowId: number }
  | { type: "CANCEL"; windowId: number };

export const OVERLAY_SHOW = "ctrl-tab:show" as const;
export const OVERLAY_HIDE = "ctrl-tab:hide" as const;
