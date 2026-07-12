import { vi } from "vitest";

type Listener<Args extends unknown[]> = (...args: Args) => unknown;

export class MockEvent<Args extends unknown[]> {
  private readonly listeners = new Set<Listener<Args>>();

  addListener = (listener: Listener<Args>): void => {
    this.listeners.add(listener);
  };

  removeListener = (listener: Listener<Args>): void => {
    this.listeners.delete(listener);
  };

  hasListener = (listener: Listener<Args>): boolean => this.listeners.has(listener);

  hasListeners = (): boolean => this.listeners.size > 0;

  listenerCount = (): number => this.listeners.size;

  async emit(...args: Args): Promise<void> {
    await Promise.all([...this.listeners].map(async (listener) => listener(...args)));
  }
}

interface ChromeMockOptions {
  tabs?: chrome.tabs.Tab[];
  windows?: chrome.windows.Window[];
  storage?: Record<string, unknown>;
}

export function installChromeMock(options: ChromeMockOptions = {}) {
  const storage = { ...(options.storage ?? {}) };
  const tabs = [...(options.tabs ?? [])];
  const windows = [...(options.windows ?? [])];

  const command = new MockEvent<[string, chrome.tabs.Tab | undefined]>();
  const runtimeMessage = new MockEvent<
    [unknown, chrome.runtime.MessageSender, (response?: unknown) => void]
  >();
  const tabActivated = new MockEvent<[chrome.tabs.TabActiveInfo]>();
  const tabRemoved = new MockEvent<[number, chrome.tabs.TabRemoveInfo]>();
  const tabDetached = new MockEvent<[number, chrome.tabs.TabDetachInfo]>();
  const tabAttached = new MockEvent<[number, chrome.tabs.TabAttachInfo]>();
  const tabUpdated = new MockEvent<
    [number, chrome.tabs.TabChangeInfo, chrome.tabs.Tab]
  >();
  const windowRemoved = new MockEvent<[number]>();

  const storageGet = vi.fn(
    async (
      keys?: string | string[] | Record<string, unknown> | null
    ): Promise<Record<string, unknown>> => {
      if (keys == null) return { ...storage };
      if (typeof keys === "string") {
        return keys in storage ? { [keys]: storage[keys] } : {};
      }
      if (Array.isArray(keys)) {
        return Object.fromEntries(
          keys.filter((key) => key in storage).map((key) => [key, storage[key]])
        );
      }
      return Object.fromEntries(
        Object.entries(keys).map(([key, fallback]) => [
          key,
          key in storage ? storage[key] : fallback,
        ])
      );
    }
  );

  const storageSet = vi.fn(async (items: Record<string, unknown>): Promise<void> => {
    Object.assign(storage, items);
  });

  const storageRemove = vi.fn(
    async (keys: string | string[]): Promise<void> => {
      for (const key of typeof keys === "string" ? [keys] : keys) {
        delete storage[key];
      }
    }
  );

  const tabsQuery = vi.fn(
    async (query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> =>
      tabs.filter((tab) => {
        if (query.active != null && tab.active !== query.active) return false;
        if (query.windowId != null && tab.windowId !== query.windowId) return false;
        if (query.currentWindow) {
          const focusedWindowId = windows.find((win) => win.focused)?.id;
          if (focusedWindowId != null && tab.windowId !== focusedWindowId) {
            return false;
          }
        }
        return true;
      })
  );

  const tabsGet = vi.fn(async (tabId: number): Promise<chrome.tabs.Tab> => {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (!tab) throw new Error(`No tab with id ${tabId}`);
    return tab;
  });

  const windowsGet = vi.fn(
    async (windowId: number): Promise<chrome.windows.Window> => {
      const win = windows.find((candidate) => candidate.id === windowId);
      if (!win) throw new Error(`No window with id ${windowId}`);
      return win;
    }
  );

  const windowsGetAll = vi.fn(
    async (): Promise<chrome.windows.Window[]> => windows
  );

  const windowsCreate = vi.fn(
    async (): Promise<chrome.windows.Window> => {
      for (const win of windows) win.focused = false;
      const popupTab: chrome.tabs.Tab = {
        id: 9999,
        index: 0,
        windowId: 999,
        active: true,
        highlighted: true,
        selected: true,
        pinned: false,
        incognito: false,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
        status: "complete",
        url: "chrome-extension://test/dist/fallback.html",
      };
      const popup: chrome.windows.Window = {
        id: 999,
        focused: true,
        incognito: false,
        alwaysOnTop: false,
        type: "popup",
        tabs: [popupTab],
      };
      windows.push(popup);
      if (!tabs.some((tab) => tab.id === popupTab.id)) tabs.push(popupTab);
      return popup;
    }
  );

  const chromeMock = {
    commands: {
      onCommand: command,
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onMessage: runtimeMessage,
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
    scripting: {
      insertCSS: vi.fn(async () => undefined),
      executeScript: vi.fn(async () => []),
    },
    storage: {
      session: {
        get: storageGet,
        set: storageSet,
        remove: storageRemove,
      },
    },
    tabs: {
      query: tabsQuery,
      get: tabsGet,
      update: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => ({ ok: true })),
      captureVisibleTab: vi.fn(async () => "data:image/jpeg;base64,dGVzdA=="),
      onActivated: tabActivated,
      onRemoved: tabRemoved,
      onDetached: tabDetached,
      onAttached: tabAttached,
      onUpdated: tabUpdated,
    },
    windows: {
      get: windowsGet,
      getAll: windowsGetAll,
      create: windowsCreate,
      update: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      onRemoved: windowRemoved,
    },
  };

  globalThis.chrome = chromeMock as unknown as typeof chrome;

  return {
    chrome: chromeMock,
    events: {
      command,
      runtimeMessage,
      tabActivated,
      tabRemoved,
      tabDetached,
      tabAttached,
      tabUpdated,
      windowRemoved,
    },
    storage,
    tabs,
    windows,
  };
}
