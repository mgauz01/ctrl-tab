const MAX_MRU = 32;

const stacks = new Map<number, number[]>();

export function onTabActivated(windowId: number, tabId: number): void {
  let stack = stacks.get(windowId);
  if (!stack) {
    stack = [];
    stacks.set(windowId, stack);
  }
  const idx = stack.indexOf(tabId);
  if (idx === 0) return;
  if (idx > 0) stack.splice(idx, 1);
  stack.unshift(tabId);
  if (stack.length > MAX_MRU) stack.length = MAX_MRU;
}

export function onTabRemoved(tabId: number): void {
  for (const stack of stacks.values()) {
    const idx = stack.indexOf(tabId);
    if (idx >= 0) stack.splice(idx, 1);
  }
}

export function onTabDetached(tabId: number, _oldWindowId: number): void {
  onTabRemoved(tabId);
}

export function onTabAttached(tabId: number, newWindowId: number): void {
  let stack = stacks.get(newWindowId);
  if (!stack) {
    stack = [];
    stacks.set(newWindowId, stack);
  }
  if (!stack.includes(tabId)) stack.unshift(tabId);
}

export function promoteTab(windowId: number, tabId: number): void {
  onTabActivated(windowId, tabId);
}

export function getMruTabIds(windowId: number, limit = 5): number[] {
  const stack = stacks.get(windowId) ?? [];
  return stack.slice(0, limit);
}

export function seedFromWindow(
  windowId: number,
  tabs: chrome.tabs.Tab[]
): void {
  const active = tabs.find((t) => t.active);
  const rest = tabs
    .filter((t) => t.id != null && t.id !== active?.id)
    .map((t) => t.id!)
    .reverse();
  const stack = active?.id != null ? [active.id, ...rest] : rest;
  if (stack.length) stacks.set(windowId, stack);
}

export async function bootstrapWindows(): Promise<void> {
  const windows = await chrome.windows.getAll({ populate: true });
  for (const win of windows) {
    if (win.id == null || !win.tabs) continue;
    if (win.tabs.length) seedFromWindow(win.id, win.tabs);
  }
}
