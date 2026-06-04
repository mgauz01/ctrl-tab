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
