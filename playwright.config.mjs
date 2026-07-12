import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
});
