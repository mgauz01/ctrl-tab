import { chromium, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("built overlay renders, cycles, and commits the selected tab", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const listeners = [];
    const sentMessages = [];

    window.__runtimeMessages = sentMessages;
    window.__deliverExtensionMessage = async (message) =>
      await new Promise((resolve) => {
        for (const listener of listeners) {
          listener(message, {}, resolve);
        }
      });

    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        runtime: {
          onMessage: {
            addListener(listener) {
              listeners.push(listener);
            },
          },
          async sendMessage(message) {
            sentMessages.push(message);
            return { ok: true };
          },
        },
      },
    });
  });
  await page.goto("about:blank");
  await page.setContent("<!doctype html><html><body><main>Host page</main></body></html>");
  await page.addStyleTag({ path: path.join(projectRoot, "dist/overlay.css") });
  await page.addScriptTag({
    path: path.join(projectRoot, "dist/overlay.js"),
    type: "module",
  });

  await page.evaluate(async () => {
    await window.__deliverExtensionMessage({
      type: "ctrl-tab:show",
      payload: {
        windowId: 10,
        selectedIndex: 1,
        tabs: [
          { id: 1, title: "Current", url: "https://current.test" },
          { id: 2, title: "Recent", url: "https://recent.test" },
          { id: 3, title: "Older", url: "https://older.test" },
        ],
      },
    });
  });

  await expect(page.locator("#ctrl-tab-root")).toBeVisible();
  await expect(page.locator(".ctrl-tab-hint")).toContainText("Release Ctrl");
  await expect(page.locator(".ctrl-tab-card")).toHaveCount(3);
  await expect(page.locator(".ctrl-tab-card.is-selected .ctrl-tab-title")).toHaveText(
    "Recent"
  );

  await page.keyboard.press("Tab");
  await expect(page.locator(".ctrl-tab-card.is-selected .ctrl-tab-title")).toHaveText(
    "Older"
  );

  await page.keyboard.down("Control");
  await page.keyboard.up("Control");
  await expect(page.locator("#ctrl-tab-root")).toHaveCount(0);
  await expect
    .poll(async () => await page.evaluate(() => window.__runtimeMessages))
    .toContainEqual({ type: "COMMIT", tabId: 3, windowId: 10 });
});

test("unpacked extension starts its service worker and exposes the fallback page", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "ctrl-tab-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${projectRoot}`,
      `--load-extension=${projectRoot}`,
    ],
  });

  try {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const manifest = await worker.evaluate(() => chrome.runtime.getManifest());

    expect(manifest.manifest_version).toBe(3);
    expect(Object.keys(manifest.commands ?? {})).toEqual([
      "open-switcher",
      "open-switcher-back",
    ]);

    const extensionPage = await context.newPage();
    await extensionPage.goto(
      `chrome-extension://${extensionId}/dist/fallback.html`
    );
    await expect(extensionPage).toHaveTitle("Ctrl+Q Switcher");
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
