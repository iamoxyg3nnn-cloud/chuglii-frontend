import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/tmp/e2e/node_modules/playwright");

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const browser = await chromium.launch({ headless: true });
const failures = [];

try {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    const pageErrors = [];
    const serverErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 500) {
        serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    // Keep the smoke test deterministic and independent of production data/auth.
    await page.route("**/api/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], recordings: [], performers: [], tags: [], total: 0 }),
      }),
    );

    const response = await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    assert.ok(response && response.ok(), `${viewport.name}: homepage response is successful`);

    // The site intentionally blocks the page behind its age-confirmation dialog.
    // Dismiss it in the isolated browser context to exercise the actual homepage.
    await page.getByRole("button", { name: /I am 18 or older.*Enter/i }).click();
    await page.getByRole("main").waitFor();
    await page.getByRole("search", { name: /search the recording archive/i }).waitFor();

    const search = page.getByRole("searchbox", { name: /search recordings/i });
    await search.fill("cinematic archive");
    await page.getByRole("button", { name: /search archive/i }).click();
    await page.waitForURL(/\/browse\?search=cinematic%20archive$/);
    assert.match(page.url(), /\/browse\?search=cinematic%20archive$/);

    assert.deepEqual(pageErrors, [], `${viewport.name}: no uncaught browser page errors`);
    assert.deepEqual(serverErrors, [], `${viewport.name}: no failed server responses`);
    console.log(`PASS ${viewport.name}: homepage rendered and search navigated to the expected query URL`);
    await page.close();
  }
} catch (error) {
  failures.push(error);
} finally {
  await browser.close();
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
}
