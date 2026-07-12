import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock } from "../helpers/chrome.js";

function makeTab(
  id: number,
  windowId: number,
  active: boolean,
  url: string
): chrome.tabs.Tab {
  return {
    id,
    index: id - 1,
    windowId,
    active,
    highlighted: active,
    selected: active,
    pinned: false,
    incognito: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    status: "complete",
    title: `Tab ${id}`,
    url,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

describe("service worker integration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes the thumbnail when an active tab finishes navigating", async () => {
    const active = makeTab(1, 10, true, "https://example.test/after-navigation");
    const mock = installChromeMock({
      tabs: [active],
      windows: [
        {
          id: 10,
          focused: true,
          incognito: false,
          alwaysOnTop: false,
          type: "normal",
          tabs: [active],
        },
      ],
    });
    await import("../../src/background/service-worker.js");
    await flushMicrotasks();

    await mock.events.tabUpdated.emit(1, { status: "complete" }, active);
    await vi.advanceTimersByTimeAsync(400);

    expect(mock.chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(10, {
      format: "jpeg",
      quality: 55,
    });
  });

  it("does not wait ten seconds when a newly-created popup tab is already loaded", async () => {
    const active = makeTab(1, 10, true, "chrome://settings");
    const recent = makeTab(2, 10, false, "https://example.test/recent");
    const popup = makeTab(
      9999,
      999,
      true,
      "chrome-extension://test/dist/fallback.html"
    );
    const mock = installChromeMock({
      tabs: [active, recent, popup],
      windows: [
        {
          id: 10,
          focused: true,
          incognito: false,
          alwaysOnTop: false,
          type: "normal",
          tabs: [active, recent],
        },
      ],
      storage: {
        "mru:stacks": { "10": [1, 2] },
      },
    });
    await import("../../src/background/service-worker.js");
    await flushMicrotasks();
    await mock.events.tabActivated.emit({ tabId: 2, windowId: 10 });
    await mock.events.tabActivated.emit({ tabId: 1, windowId: 10 });

    const opening = mock.events.command.emit("open-switcher", active);
    await vi.advanceTimersByTimeAsync(0);

    expect(mock.chrome.windows.create).toHaveBeenCalledOnce();
    expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      9999,
      expect.objectContaining({ type: "ctrl-tab:show" })
    );

    await vi.runAllTimersAsync();
    await opening;
  });

  it("closes a fallback popup when its parent window closes", async () => {
    const active = makeTab(1, 10, true, "chrome://settings");
    const recent = makeTab(2, 10, false, "https://example.test/recent");
    const popup = makeTab(
      9999,
      999,
      true,
      "chrome-extension://test/dist/fallback.html"
    );
    const mock = installChromeMock({
      tabs: [active, recent, popup],
      windows: [
        {
          id: 10,
          focused: true,
          incognito: false,
          alwaysOnTop: false,
          type: "normal",
          tabs: [active, recent],
        },
      ],
      storage: {
        "mru:stacks": { "10": [1, 2] },
      },
    });
    await import("../../src/background/service-worker.js");
    await flushMicrotasks();
    await mock.events.tabActivated.emit({ tabId: 2, windowId: 10 });
    await mock.events.tabActivated.emit({ tabId: 1, windowId: 10 });

    const opening = mock.events.command.emit("open-switcher", active);
    await vi.advanceTimersByTimeAsync(0);
    await opening;
    await mock.events.windowRemoved.emit(10);
    await flushMicrotasks();

    expect(mock.chrome.windows.remove).toHaveBeenCalledWith(999);
  });

  it("waits for MRU restoration before handling the first cold-start command", async () => {
    const active = makeTab(1, 10, true, "chrome://settings");
    const recent = makeTab(2, 10, false, "https://example.test/recent");
    const popup = makeTab(
      9999,
      999,
      true,
      "chrome-extension://test/dist/fallback.html"
    );
    const mock = installChromeMock({
      tabs: [active, recent, popup],
      windows: [
        {
          id: 10,
          focused: true,
          incognito: false,
          alwaysOnTop: false,
          type: "normal",
          tabs: [active, recent],
        },
      ],
    });
    let finishRestore: ((value: Record<string, unknown>) => void) | undefined;
    mock.chrome.storage.session.get.mockImplementationOnce(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          finishRestore = resolve;
        })
    );
    await import("../../src/background/service-worker.js");

    const opening = mock.events.command.emit("open-switcher", active);
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.chrome.windows.create).not.toHaveBeenCalled();

    finishRestore?.({ "mru:stacks": { "10": [1, 2] } });
    await vi.advanceTimersByTimeAsync(0);
    await opening;

    expect(mock.chrome.windows.create).toHaveBeenCalledOnce();
  });

  it("closes a popup created after its parent closed during popup creation", async () => {
    const active = makeTab(1, 10, true, "chrome://settings");
    const recent = makeTab(2, 10, false, "https://example.test/recent");
    const popup = makeTab(
      9999,
      999,
      true,
      "chrome-extension://test/dist/fallback.html"
    );
    const mock = installChromeMock({
      tabs: [active, recent, popup],
      windows: [
        {
          id: 10,
          focused: true,
          incognito: false,
          alwaysOnTop: false,
          type: "normal",
          tabs: [active, recent],
        },
      ],
      storage: {
        "mru:stacks": { "10": [1, 2] },
      },
    });
    let finishCreate: ((value: chrome.windows.Window) => void) | undefined;
    mock.chrome.windows.create.mockImplementationOnce(
      () =>
        new Promise<chrome.windows.Window>((resolve) => {
          finishCreate = resolve;
        })
    );
    await import("../../src/background/service-worker.js");
    await flushMicrotasks();
    await mock.events.tabActivated.emit({ tabId: 2, windowId: 10 });
    await mock.events.tabActivated.emit({ tabId: 1, windowId: 10 });

    const opening = mock.events.command.emit("open-switcher", active);
    await vi.advanceTimersByTimeAsync(0);
    await mock.events.windowRemoved.emit(10);
    finishCreate?.({
      id: 999,
      focused: true,
      incognito: false,
      alwaysOnTop: false,
      type: "popup",
      tabs: [popup],
    });
    await vi.advanceTimersByTimeAsync(0);
    await opening;

    expect(mock.chrome.windows.remove).toHaveBeenCalledWith(999);
    expect(mock.chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      9999,
      expect.objectContaining({ type: "ctrl-tab:show" })
    );
  });

  it("queues cycle commands received while the fallback popup is loading", async () => {
    const active = makeTab(1, 10, true, "chrome://settings");
    const recent = makeTab(2, 10, false, "https://example.test/recent");
    const popup = makeTab(
      9999,
      999,
      true,
      "chrome-extension://test/dist/fallback.html"
    );
    const mock = installChromeMock({
      tabs: [active, recent, popup],
      windows: [
        {
          id: 10,
          focused: true,
          incognito: false,
          alwaysOnTop: false,
          type: "normal",
          tabs: [active, recent],
        },
      ],
      storage: {
        "mru:stacks": { "10": [1, 2] },
      },
    });
    let finishPopupLoad: ((value: chrome.tabs.Tab) => void) | undefined;
    const getTab = mock.chrome.tabs.get.getMockImplementation();
    mock.chrome.tabs.get.mockImplementation(async (tabId: number) => {
      if (tabId === 9999) {
        return await new Promise<chrome.tabs.Tab>((resolve) => {
          finishPopupLoad = resolve;
        });
      }
      if (!getTab) throw new Error("Missing tabs.get implementation");
      return await getTab(tabId);
    });
    await import("../../src/background/service-worker.js");
    await flushMicrotasks();
    await mock.events.tabActivated.emit({ tabId: 2, windowId: 10 });
    await mock.events.tabActivated.emit({ tabId: 1, windowId: 10 });

    const opening = mock.events.command.emit("open-switcher", active);
    await vi.advanceTimersByTimeAsync(0);
    const cycling = mock.events.command.emit("open-switcher", active);
    await vi.advanceTimersByTimeAsync(0);
    finishPopupLoad?.(popup);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([opening, cycling]);

    expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(9999, {
      type: "ctrl-tab:step",
      delta: 1,
    });
  });

  it("does not restore switcher state after the parent closes during popup loading", async () => {
    const active = makeTab(1, 10, true, "chrome://settings");
    const recent = makeTab(2, 10, false, "https://example.test/recent");
    const popup = makeTab(
      9999,
      999,
      true,
      "chrome-extension://test/dist/fallback.html"
    );
    const mock = installChromeMock({
      tabs: [active, recent, popup],
      windows: [
        {
          id: 10,
          focused: true,
          incognito: false,
          alwaysOnTop: false,
          type: "normal",
          tabs: [active, recent],
        },
      ],
      storage: {
        "mru:stacks": { "10": [1, 2] },
      },
    });
    let finishPopupLoad: ((value: chrome.tabs.Tab) => void) | undefined;
    const getTab = mock.chrome.tabs.get.getMockImplementation();
    mock.chrome.tabs.get.mockImplementation(async (tabId: number) => {
      if (tabId === 9999) {
        return await new Promise<chrome.tabs.Tab>((resolve) => {
          finishPopupLoad = resolve;
        });
      }
      if (!getTab) throw new Error("Missing tabs.get implementation");
      return await getTab(tabId);
    });
    await import("../../src/background/service-worker.js");
    await flushMicrotasks();
    await mock.events.tabActivated.emit({ tabId: 2, windowId: 10 });
    await mock.events.tabActivated.emit({ tabId: 1, windowId: 10 });

    const opening = mock.events.command.emit("open-switcher", active);
    await vi.advanceTimersByTimeAsync(0);
    await mock.events.windowRemoved.emit(10);
    finishPopupLoad?.(popup);
    await vi.advanceTimersByTimeAsync(0);
    await opening;

    expect(mock.chrome.windows.remove).toHaveBeenCalledWith(999);
    expect(mock.chrome.tabs.sendMessage).not.toHaveBeenCalledWith(
      9999,
      expect.objectContaining({ type: "ctrl-tab:show" })
    );
  });

  it("closes an unresponsive existing popup before creating a replacement", async () => {
    const active = makeTab(1, 10, true, "chrome://settings");
    const recent = makeTab(2, 10, false, "https://example.test/recent");
    const popup = makeTab(
      9999,
      999,
      true,
      "chrome-extension://test/dist/fallback.html"
    );
    const mock = installChromeMock({
      tabs: [active, recent, popup],
      windows: [
        {
          id: 10,
          focused: true,
          incognito: false,
          alwaysOnTop: false,
          type: "normal",
          tabs: [active, recent],
        },
      ],
      storage: {
        "mru:stacks": { "10": [1, 2] },
      },
    });
    await import("../../src/background/service-worker.js");
    await flushMicrotasks();
    await mock.events.tabActivated.emit({ tabId: 2, windowId: 10 });
    await mock.events.tabActivated.emit({ tabId: 1, windowId: 10 });

    await mock.events.command.emit("open-switcher", active);
    mock.chrome.tabs.sendMessage.mockRejectedValueOnce(
      new Error("Popup listener unavailable")
    );
    await mock.events.command.emit("open-switcher", popup);
    mock.chrome.tabs.sendMessage.mockRejectedValueOnce(
      new Error("Popup listener still unavailable")
    );
    await mock.events.command.emit("open-switcher", popup);

    expect(mock.chrome.windows.remove).toHaveBeenCalledWith(999);
    expect(mock.chrome.windows.create).toHaveBeenCalledTimes(2);
  });

  it("restores step routing when an existing popup recovers", async () => {
    const active = makeTab(1, 10, true, "chrome://settings");
    const recent = makeTab(2, 10, false, "https://example.test/recent");
    const popup = makeTab(
      9999,
      999,
      true,
      "chrome-extension://test/dist/fallback.html"
    );
    const mock = installChromeMock({
      tabs: [active, recent, popup],
      windows: [
        {
          id: 10,
          focused: true,
          incognito: false,
          alwaysOnTop: false,
          type: "normal",
          tabs: [active, recent],
        },
      ],
      storage: {
        "mru:stacks": { "10": [1, 2] },
      },
    });
    await import("../../src/background/service-worker.js");
    await flushMicrotasks();
    await mock.events.tabActivated.emit({ tabId: 2, windowId: 10 });
    await mock.events.tabActivated.emit({ tabId: 1, windowId: 10 });

    await mock.events.command.emit("open-switcher", active);
    mock.chrome.tabs.sendMessage.mockRejectedValueOnce(
      new Error("Transient step failure")
    );
    await mock.events.command.emit("open-switcher", popup);
    await mock.events.command.emit("open-switcher", popup);
    mock.chrome.tabs.sendMessage.mockClear();

    await mock.events.command.emit("open-switcher", popup);

    expect(mock.chrome.tabs.sendMessage).toHaveBeenCalledWith(9999, {
      type: "ctrl-tab:step",
      delta: 1,
    });
  });

  it("retries MRU bootstrap after a transient startup failure", async () => {
    const active = makeTab(1, 10, true, "chrome://settings");
    const recent = makeTab(2, 10, false, "https://example.test/recent");
    const popup = makeTab(
      9999,
      999,
      true,
      "chrome-extension://test/dist/fallback.html"
    );
    const mock = installChromeMock({
      tabs: [active, recent, popup],
      windows: [
        {
          id: 10,
          focused: true,
          incognito: false,
          alwaysOnTop: false,
          type: "normal",
          tabs: [active, recent],
        },
      ],
      storage: {
        "mru:stacks": { "10": [1, 2] },
      },
    });
    mock.chrome.storage.session.get.mockRejectedValueOnce(
      new Error("Session storage temporarily unavailable")
    );
    await import("../../src/background/service-worker.js");

    await mock.events.command.emit("open-switcher", active);

    expect(mock.chrome.storage.session.get).toHaveBeenCalledTimes(3);
    expect(mock.chrome.windows.create).toHaveBeenCalledOnce();
  });
});
