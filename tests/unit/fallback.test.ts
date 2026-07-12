// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SwitcherPayload } from "../../src/shared/types.js";
import { installChromeMock } from "../helpers/chrome.js";

const payload: SwitcherPayload = {
  windowId: 10,
  selectedIndex: 0,
  tabs: [{ id: 1, title: "Current", url: "chrome://settings" }],
};

describe("fallback popup", () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.innerHTML = "<head></head><body></body>";
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      })
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 320,
      height: 120,
      top: 0,
      right: 320,
      bottom: 120,
      left: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(window, "outerHeight", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 760,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the payload and requests a tight popup height", async () => {
    const mock = installChromeMock();
    await import("../../src/fallback/fallback.js");

    await mock.events.runtimeMessage.emit(
      { type: "ctrl-tab:show", payload },
      {},
      vi.fn()
    );

    expect(document.querySelectorAll("#ctrl-tab-root")).toHaveLength(1);
    expect(mock.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "RESIZE_POPUP",
      windowId: 10,
      height: 188,
    });
  });
});
