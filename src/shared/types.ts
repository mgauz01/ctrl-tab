export interface SwitcherTab {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
  thumbDataUrl?: string;
}

export interface SwitcherPayload {
  tabs: SwitcherTab[];
  selectedIndex: number;
  windowId: number;
}

export type BackgroundMessage =
  | { type: "COMMIT"; tabId: number; windowId: number }
  | { type: "CANCEL"; windowId: number }
  | { type: "RESIZE_POPUP"; windowId: number; height: number };

export const OVERLAY_SHOW = "ctrl-tab:show" as const;
export const OVERLAY_HIDE = "ctrl-tab:hide" as const;
export const OVERLAY_STEP = "ctrl-tab:step" as const;
