import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const server = process.env.TEST_START_SERVER
  ? spawn(process.env.BUN_EXECUTABLE || "bun", ["src/server/index.ts"], {
      env: {
        ...process.env,
        DB_PATH: process.env.TEST_DB_PATH || "data/qa.sqlite",
        PORT: "3000",
      },
      stdio: "inherit",
    })
  : null;
if (server) {
  await new Promise((resolve, reject) => {
    let tries = 0;
    const timer = setInterval(async () => {
      try {
        await fetch("http://127.0.0.1:3000/api/health");
        clearInterval(timer);
        resolve();
      } catch {
        if (++tries > 50) {
          clearInterval(timer);
          reject(new Error("Server unavailable"));
        }
      }
    }, 100);
  });
}
process.on("exit", () => server?.kill());
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE
    ? {
        executablePath: process.env.CHROMIUM_EXECUTABLE,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      }
    : {}),
});
mkdirSync("test-results", { recursive: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.TEST_ORIGIN || "http://localhost:3000";
await page.goto(base);
await page.locator("#workspace").fill("demo");
await page.locator("#email").fill("admin@example.test");
await page.locator("#password").fill(process.env.TEST_PASSWORD || "");
await page.getByRole("button", { name: "ดำเนินการ", exact: true }).click();
await page.getByRole("heading", { name: "ทีมวันนี้" }).waitFor();
await page.evaluate(() => document.fonts.ready);
assert.equal(
  await page.evaluate(() => document.fonts.check('16px "HRM Thai"', "ภาษาไทย")),
  true,
);
assert.equal(await page.locator(".stat").count(), 4);
await page.screenshot({
  path: "test-results/dashboard-desktop.png",
  fullPage: true,
});
await page
  .locator(".sidebar")
  .getByRole("button", { name: "บุคลากร", exact: true })
  .click();
await page.locator("tbody tr").first().waitFor();
assert.equal(await page.locator("tbody tr").count(), 5);
await page.screenshot({
  path: "test-results/employees-desktop.png",
  fullPage: true,
});
await page
  .getByRole("button", { name: "รายละเอียด", exact: true })
  .first()
  .click();
await page.getByRole("dialog").waitFor();
assert.equal(await page.locator(".profile-header").count(), 1);
await page.emulateMedia({ media: "print" });
assert.equal(await page.locator(".print-report").isVisible(), true);
await page.pdf({
  path: "test-results/employee-profile.pdf",
  format: "A4",
  printBackground: true,
});
await page.emulateMedia({ media: "screen" });
await page.getByRole("button", { name: "ปิด", exact: true }).click();
await page.getByRole("button", { name: "เพิ่มพนักงาน", exact: true }).click();
await page.locator("#field-first_name_th").fill("UI");
await page.locator("#field-last_name_th").fill("Test");
await page.locator("#field-salary_baht").fill("32000");
await page.locator("#field-employment_type").selectOption("FULL_TIME");
await page.locator("#field-employment_status").selectOption("ACTIVE");
await page.locator("#field-pay_type").selectOption("MONTHLY");
await page.getByRole("button", { name: "บันทึก", exact: true }).click();
await page.getByRole("dialog").waitFor({ state: "hidden" });
await page.locator("tbody tr").nth(5).waitFor();
assert.equal(await page.locator("tbody tr").count(), 6);
await page
  .locator("tbody tr")
  .last()
  .getByRole("button", { name: "delete", exact: true })
  .click();
assert.equal(await page.getByRole("dialog").count(), 1);
await page.locator("#confirm-reason").fill("Automated UI cleanup");
await page.getByRole("button", { name: "ยืนยัน", exact: true }).click();
await page.getByRole("dialog").waitFor({ state: "hidden" });
await page.waitForFunction(
  () => document.querySelectorAll("tbody tr").length === 5,
);
await page.setViewportSize({ width: 390, height: 844 });
assert.equal(await page.locator(".sidebar").isVisible(), false);
assert.equal(await page.locator(".bottom-nav").isVisible(), true);
assert.equal(await page.locator(".search").isVisible(), false);
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false,
);
await page.screenshot({
  path: "test-results/employees-mobile.png",
  fullPage: true,
});
await page
  .locator(".bottom-nav")
  .getByRole("button", { name: "เพิ่มเติม", exact: true })
  .click();
await page.getByRole("dialog").waitFor();
assert.ok((await page.locator(".more-menu button").count()) > 5);
await page.screenshot({ path: "test-results/mobile-menu.png", fullPage: true });
await page.getByRole("button", { name: "ปิด", exact: true }).click();
await page.getByRole("button", { name: "เปลี่ยนธีม", exact: true }).click();
assert.ok(
  await page.locator("html").evaluate((e) => e.classList.contains("dark")),
);
await page.screenshot({ path: "test-results/mobile-dark.png", fullPage: true });
await page.getByRole("button", { name: "EN", exact: true }).click();
assert.equal(await page.locator("html").getAttribute("lang"), "en");
assert.deepEqual(errors, []);
console.log(
  "Browser checks passed: login, data loading, employee create/delete dialog, print PDF, mobile navigation, no overflow, dark mode, English, no runtime errors.",
);
await browser.close();
server?.kill();
