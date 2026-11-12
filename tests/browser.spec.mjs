import { test, expect } from "@playwright/test";
test("registration → template → canvas → autosave → reload → ZIP → collections", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (window === window.top) localStorage.setItem("sb-tour-seen", "1");
  });
  await page.goto("/accounts/signup/");
  await page.locator("[name=username]").fill(`browser_${Date.now()}`);
  await page.locator("[name=password1]").fill("Secure-Example-739");
  await page.locator("[name=password2]").fill("Secure-Example-739");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(
    page.getByRole("heading", { name: "Здесь появится ваш первый сайт" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Новый проект", exact: true }).click();
  await expect(page.locator(".template-card")).toHaveCount(6);
  await page.locator('[data-template="builtin-analytics"]').click();
  await page.locator("#projectTitle").fill("Браузерная проверка");
  await page
    .getByRole("button", { name: "Создать проект", exact: true })
    .click();
  await expect(page.locator("#canvasSections")).toBeVisible();
  await expect(page.locator("#exportBtn")).toBeVisible();
  await page.locator("#projectTitle").fill("Проверено в браузере");
  await page.locator("#projectTitle").press("Tab");
  await expect(page.locator("#saveText")).toHaveText("Сохранено", {
    timeout: 15000,
  });
  const url = page.url();
  const id = url.match(/editor\/(\d+)/)[1];
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/projects/${id}/`);
      return (await res.json()).title;
    })
    .toBe("Проверено в браузере");
  await page.reload();
  await expect(page.locator("#projectTitle")).toHaveValue(
    "Проверено в браузере",
  );
  const download = page.waitForEvent("download");
  await page.locator("#exportBtn").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.zip$/);
  await page.getByRole("link", { name: "Данные и доступ" }).click();
  await page
    .locator("form")
    .filter({ has: page.locator("[name=action][value=collection]") })
    .locator("[name=name]")
    .fill("Клиенты");
  await page.getByRole("button", { name: "Создать коллекцию" }).click();
  await expect(
    page.getByText("Клиенты", { exact: true }).first(),
  ).toBeVisible();
  const fieldForm = page
    .locator("form")
    .filter({ has: page.locator("[name=action][value=field]") });
  await fieldForm.locator("[name=name]").fill("Название");
  await fieldForm.locator("[name=kind]").selectOption("text");
  await fieldForm.locator("[name=required]").check();
  await fieldForm.getByRole("button", { name: "Добавить поле" }).click();
  await page.getByRole("link", { name: "Записи", exact: true }).click();
  await page.getByRole("link", { name: "Добавить запись" }).click();
  await page.locator("input[required]").fill("Клиент из браузера");
  await page.getByRole("button", { name: "Сохранить запись" }).click();
  await expect(
    page.getByRole("cell", { name: "Клиент из браузера" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "test-results/browser-records.png",
    fullPage: true,
  });
});
