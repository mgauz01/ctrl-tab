// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SwitcherPayload } from "../../src/shared/types.js";
import { installChromeMock } from "../helpers/chrome.js";

const payload: SwitcherPayload = {
  windowId: 10,
  selectedIndex: 1,
  tabs: [
    { id: 1, title: "Current", url: "https://current.test" },
    { id: 2, title: "Recent", url: "https://recent.test" },
    { id: 3, title: "Older", url: "https://older.test" },
  ],
};

describe("overlay UI", () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.innerHTML = "<head></head><body></body>";
  });

  it("renders tabs and cycles the selected card through runtime messages", async () => {
    const mock = installChromeMock();
    await import("../../src/overlay/overlay.js");

    await mock.events.runtimeMessage.emit(
      { type: "ctrl-tab:show", payload },
      {},
      vi.fn()
    );
    expect(document.querySelectorAll(".ctrl-tab-card")).toHaveLength(3);
    expect(document.getElementById("ctrl-tab-root")?.getAttribute("role")).toBe(
      "dialog"
    );
    expect(document.querySelector(".ctrl-tab-hint")?.textContent).toMatch(
      /Release Ctrl/
    );
    expect(
      document.querySelector(".ctrl-tab-card.is-selected")?.getAttribute(
        "aria-selected"
      )
    ).toBe("true");
    expect(
      document.querySelector(".ctrl-tab-card.is-selected .ctrl-tab-title")
        ?.textContent
    ).toBe("Recent");

    await mock.events.runtimeMessage.emit(
      { type: "ctrl-tab:step", delta: 1 },
      {},
      vi.fn()
    );
    expect(
      document.querySelector(".ctrl-tab-card.is-selected .ctrl-tab-title")
        ?.textContent
    ).toBe("Older");
  });

  it("commits the selected tab when Control is released", async () => {
    const mock = installChromeMock();
    const { showSwitcher } = await import("../../src/overlay/overlay.js");
    showSwitcher(payload);

    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));

    expect(mock.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "COMMIT",
      tabId: 2,
      windowId: 10,
    });
    expect(document.getElementById("ctrl-tab-root")).toBeNull();
  });

  it("commits a tab when its card is clicked", async () => {
    const mock = installChromeMock();
    const { showSwitcher } = await import("../../src/overlay/overlay.js");
    showSwitcher(payload);

    document.querySelectorAll(".ctrl-tab-card")[2]?.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );

    expect(mock.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "COMMIT",
      tabId: 3,
      windowId: 10,
    });
    expect(document.getElementById("ctrl-tab-root")).toBeNull();
  });

  it("cancels and removes the overlay on Escape", async () => {
    const mock = installChromeMock();
    const { showSwitcher } = await import("../../src/overlay/overlay.js");
    showSwitcher(payload);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(mock.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "CANCEL",
      windowId: 10,
    });
    expect(document.getElementById("ctrl-tab-root")).toBeNull();
  });
});
