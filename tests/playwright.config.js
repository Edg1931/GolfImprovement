const { defineConfig, devices } = require('@playwright/test');
const executablePath = process.env.CHROMIUM_PATH || undefined;   // lets sandboxes use a preinstalled browser
module.exports = defineConfig({
  testDir: './e2e',
  timeout: 45000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:4173', serviceWorkers: 'block', launchOptions: { executablePath } },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 }, launchOptions: { executablePath } } },
    { name: 'phone', use: { ...devices['Pixel 7'], launchOptions: { executablePath } }, grep: /@phone/ },
  ],
  webServer: { command: 'node serve.js', port: 4173, reuseExistingServer: !process.env.CI },
});
