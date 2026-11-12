import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.mjs",
  workers: 1,
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3100",
    viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {},
  },
  webServer: process.env.TEST_BASE_URL
    ? undefined
    : {
        command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
        url: "http://127.0.0.1:3100/accounts/login/",
        reuseExistingServer: false,
        env: {
          STORAGE_DIR: `/tmp/lamoframe-e2e-${Date.now()}`,
          COOKIE_SECURE: "false",
        },
      },
});
