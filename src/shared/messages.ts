export type BackgroundMessage =
  | { type: "COMMIT"; tabId: number; windowId: number }
  | { type: "CANCEL"; windowId: number }
  | { type: "RESIZE_POPUP"; windowId: number; height: number };

export const OVERLAY_SHOW = "ctrl-tab:show" as const;
export const OVERLAY_HIDE = "ctrl-tab:hide" as const;
export const OVERLAY_STEP = "ctrl-tab:step" as const;
