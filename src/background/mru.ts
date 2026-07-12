const MAX_MRU = 8;
const STORAGE_KEY = "mru:stacks";

const stacks = new Map<number, number[]>();
let persistQueue = Promise.resolve();

/** Pure stack promote — exported for the self-check. */
export function promoteInStack(
  stack: number[],
  tabId: number,
  max = MAX_MRU
): void {
  const idx = stack.indexOf(tabId);
  if (idx === 0) return;
  if (idx > 0) stack.splice(idx, 1);
  stack.unshift(tabId);
  if (stack.length > max) stack.length = max;
}

function persist(): void {
  const obj: Record<string, number[]> = {};
  for (const [wid, stack] of stacks) {
    obj[String(wid)] = [...stack];
  }
  persistQueue = persistQueue
    .then(async () => {
      await chrome.storage.session.set({ [STORAGE_KEY]: obj });
    })
    .catch(() => {
      // Session storage is best-effort; the in-memory stack remains authoritative.
    });
}

async function restore(): Promise<void> {
  const data = await chrome.storage.session.get(STORAGE_KEY);
  const obj = data[STORAGE_KEY] as Record<string, number[]> | undefined;
  if (!obj || typeof obj !== "object") return;
  for (const [k, stack] of Object.entries(obj)) {
    if (!Array.isArray(stack)) continue;
    const windowId = Number(k);
    if (!Number.isFinite(windowId)) continue;
    const restored = stack.filter((id) => typeof id === "number");
    const current = stacks.get(windowId) ?? [];
    const merged = [
      ...current,
      ...restored.filter((id) => !current.includes(id)),
    ].slice(0, MAX_MRU);
    stacks.set(windowId, merged);
  }
}

export function onTabActivated(windowId: number, tabId: number): void {
  let stack = stacks.get(windowId);
  if (!stack) {
    stack = [];
    stacks.set(windowId, stack);
  }
  promoteInStack(stack, tabId);
  persist();
}

export function onTabRemoved(tabId: number): void {
  let changed = false;
  for (const stack of stacks.values()) {
    const idx = stack.indexOf(tabId);
    if (idx >= 0) {
      stack.splice(idx, 1);
      changed = true;
    }
  }
  if (changed) persist();
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
  if (!stack.includes(tabId)) {
    stack.unshift(tabId);
    persist();
  }
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
  if (stack.length) {
    stacks.set(windowId, stack);
    persist();
  }
}

export async function bootstrapWindows(): Promise<void> {
  await restore();
  const windows = await chrome.windows.getAll({ populate: true });
  const liveWindows = new Set<number>();
  for (const win of windows) {
    if (win.id == null || !win.tabs?.length) continue;
    liveWindows.add(win.id);
    const liveIds = new Set(
      win.tabs.filter((t) => t.id != null).map((t) => t.id!)
    );
    const existing = stacks.get(win.id);
    if (existing?.length) {
      const filtered = existing.filter((id) => liveIds.has(id));
      if (filtered.length) stacks.set(win.id, filtered);
      else seedFromWindow(win.id, win.tabs);
    } else {
      seedFromWindow(win.id, win.tabs);
    }
  }
  for (const wid of [...stacks.keys()]) {
    if (!liveWindows.has(wid)) stacks.delete(wid);
  }
  persist();
}
