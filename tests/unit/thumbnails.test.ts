import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMock } from "../helpers/chrome.js";

function activeTab(id: number, windowId: number): chrome.tabs.Tab {
  return {
    id,
    index: 0,
    windowId,
    active: true,
    highlighted: true,
    selected: true,
    pinned: false,
    incognito: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    status: "complete",
    url: `https://example.test/${id}`,
  };
}

describe("thumbnail storage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({
        width: 100,
        height: 60,
        close: vi.fn(),
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores a captured thumbnail and adds it to the LRU order", async () => {
    const tab = activeTab(1, 10);
    const mock = installChromeMock({ tabs: [tab] });
    const { captureTabThumbnail } = await import(
      "../../src/background/thumbnails.js"
    );

    await captureTabThumbnail(10, 1);

    expect(mock.storage["thumb:1"]).toBe("data:image/jpeg;base64,dGVzdA==");
    expect(mock.storage["thumb:order"]).toEqual([1]);
  });

  it("does not lose an LRU entry when captures finish concurrently", async () => {
    const first = activeTab(1, 10);
    const second = activeTab(2, 20);
    const mock = installChromeMock({ tabs: [first, second] });
    const storageGet = mock.chrome.storage.session.get.getMockImplementation();
    if (!storageGet) throw new Error("Missing storage.get implementation");
    let activeOrderReads = 0;
    let maxConcurrentOrderReads = 0;
    mock.chrome.storage.session.get.mockImplementation(async (keys) => {
      if (keys === "thumb:order") {
        activeOrderReads += 1;
        maxConcurrentOrderReads = Math.max(
          maxConcurrentOrderReads,
          activeOrderReads
        );
        const result = await storageGet(keys);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeOrderReads -= 1;
        return result;
      }
      return await storageGet(keys);
    });
    const { captureTabThumbnail } = await import(
      "../../src/background/thumbnails.js"
    );

    await Promise.all([
      captureTabThumbnail(10, 1),
      captureTabThumbnail(20, 2),
    ]);

    expect(
      [...(mock.storage["thumb:order"] as number[])].sort((a, b) => a - b)
    ).toEqual([1, 2]);
    expect(maxConcurrentOrderReads).toBe(1);
  });

  it("does not recreate a thumbnail after its tab was removed mid-capture", async () => {
    const tab = activeTab(1, 10);
    const mock = installChromeMock({ tabs: [tab] });
    let finishBitmap: ((bitmap: ImageBitmap) => void) | undefined;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(
        async () =>
          await new Promise<ImageBitmap>((resolve) => {
            finishBitmap = resolve;
          })
      )
    );
    const { captureTabThumbnail, removeThumbnail } = await import(
      "../../src/background/thumbnails.js"
    );

    const capture = captureTabThumbnail(10, 1);
    await vi.waitFor(() => expect(finishBitmap).toBeDefined());
    await removeThumbnail(1);
    finishBitmap?.({
      width: 100,
      height: 60,
      close: vi.fn(),
    } as unknown as ImageBitmap);
    await capture;

    expect(mock.storage["thumb:1"]).toBeUndefined();
    expect(mock.storage["thumb:order"]).toEqual([]);
  });
});
