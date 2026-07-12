import { beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock } from "../helpers/chrome.js";

const windowTabs: chrome.tabs.Tab[] = [
  {
    id: 1,
    index: 0,
    windowId: 10,
    active: false,
    highlighted: false,
    selected: false,
    pinned: false,
    incognito: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
  },
  {
    id: 2,
    index: 1,
    windowId: 10,
    active: true,
    highlighted: true,
    selected: true,
    pinned: false,
    incognito: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
  },
  {
    id: 3,
    index: 2,
    windowId: 10,
    active: false,
    highlighted: false,
    selected: false,
    pinned: false,
    incognito: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
  },
];

describe("MRU stacks", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("promotes an existing tab without duplicating it", async () => {
    installChromeMock();
    const { promoteInStack } = await import("../../src/background/mru.js");
    const stack = [1, 2, 3];

    promoteInStack(stack, 2);

    expect(stack).toEqual([2, 1, 3]);
  });

  it("preserves activations that happen while persisted state is restoring", async () => {
    const mock = installChromeMock({
      tabs: windowTabs,
      windows: [
        {
          id: 10,
          focused: true,
          incognito: false,
          alwaysOnTop: false,
          type: "normal",
          tabs: windowTabs,
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
    const mru = await import("../../src/background/mru.js");

    const bootstrapping = mru.bootstrapWindows();
    mru.onTabActivated(10, 2);
    finishRestore?.({ "mru:stacks": { "10": [1, 3] } });
    await bootstrapping;

    expect(mru.getMruTabIds(10)).toEqual([2, 1, 3]);
  });

  it("serializes persistence so a slower earlier write cannot win", async () => {
    const mock = installChromeMock();
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let writes = 0;
    mock.chrome.storage.session.set.mockImplementation(async (items) => {
      writes += 1;
      if (writes === 1) await firstWriteBlocked;
      Object.assign(mock.storage, items);
    });
    const mru = await import("../../src/background/mru.js");

    mru.onTabActivated(10, 1);
    mru.onTabActivated(10, 2);
    await Promise.resolve();
    releaseFirstWrite?.();

    await vi.waitFor(() => {
      expect(mock.storage["mru:stacks"]).toEqual({ "10": [2, 1] });
    });
  });
});
