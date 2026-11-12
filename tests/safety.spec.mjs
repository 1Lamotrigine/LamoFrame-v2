import { test, expect } from "@playwright/test";
async function create(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (window === window.top) localStorage.setItem("sb-tour-seen", "1");
  });
  await page.goto("/accounts/signup/");
  await page
    .locator("[name=username]")
    .fill(`safety_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  await page.locator("[name=password1]").fill("Secure-Example-739");
  await page.locator("[name=password2]").fill("Secure-Example-739");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByRole("link", { name: "Новый проект", exact: true }).click();
  await page.locator("#projectTitle").fill("Исходный сайт");
  await page
    .getByRole("button", { name: "Создать проект", exact: true })
    .click();
  await expect(page.locator("#editorShell")).toHaveAttribute(
    "data-ready",
    "true",
  );
  const id = page.url().match(/editor\/(\d+)/)[1];
  return { id, errors };
}
async function title(page, name, id) {
  await page.locator("#projectTitle").fill(name);
  await page.locator("#projectTitle").press("Tab");
  await expect
    .poll(async () => {
      const r = await page.request.get(`/api/projects/${id}/`);
      return (await r.json()).title;
    })
    .toBe(name);
  await expect(page.locator("#saveText")).toHaveText("Сохранено");
}
test("named versions, isolated publication, revocation and layout checks", async ({
  page,
}) => {
  const { id, errors } = await create(page);
  await page.locator("#versionsBtn").click();
  await page.locator("#versionLabel").fill("До редизайна");
  await page
    .getByRole("button", { name: "Сохранить версию", exact: true })
    .click();
  await expect(
    page.locator(".version-row").filter({ hasText: "До редизайна" }),
  ).toBeVisible();
  await page.locator("#closeProjectDialog").click();
  await page.locator("#publishSiteBtn").click();
  await page
    .getByRole("button", { name: "Опубликовать сайт", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Открыть опубликованный сайт" }),
  ).toBeVisible();
  const link = await page
    .getByRole("link", { name: "Открыть опубликованный сайт" })
    .getAttribute("href");
  const before = await (await page.request.get(`${link}raw/`)).text();
  expect(before).toContain("<title>Исходный сайт</title>");
  await page.locator("#closeProjectDialog").click();
  await title(page, "Новый черновик", id);
  expect(await (await page.request.get(`${link}raw/`)).text()).toBe(before);
  await page.locator("#versionsBtn").click();
  await page
    .locator(".version-row")
    .filter({ hasText: "До редизайна" })
    .getByRole("button", { name: "Восстановить", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Восстановить черновик", exact: true })
    .click();
  await expect(page.locator("#projectTitle")).toHaveValue("Исходный сайт");
  await page.locator("#publishSiteBtn").click();
  await page
    .getByRole("button", { name: "Снять с публикации", exact: true })
    .click();
  await expect(
    page.getByText("Сайт не опубликован.", { exact: false }),
  ).toBeVisible();
  expect((await page.request.get(`${link}raw/`)).status()).toBe(404);
  await page.locator("#closeProjectDialog").click();
  await page.evaluate(async () => {
    const { commit, state } = await import("/static/js/state.js");
    commit(
      () =>
        state.doc.frames[0].elements.push({
          id: "outside-check",
          type: "text",
          name: "Слишком далеко",
          x: 1190,
          y: 10,
          w: 200,
          h: 40,
          props: { text: "Текст" },
          style: {},
        }),
      { label: "test" },
    );
  });
  await page.locator('[data-tab="adaptive"]').click();
  await page.locator("#checkLayoutsBtn").click();
  await expect(
    page.getByRole("button", { name: /Слишком далеко/ }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/layout-checks.png" });
  expect(errors).toEqual([]);
});

test("failed save recovers from IndexedDB after reload", async ({ page }) => {
  const { id, errors } = await create(page);
  const url = page.url();
  await page.route(`**/api/projects/${id}/`, (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue(),
  );
  await page.locator("#projectTitle").fill("Локальная работа");
  await page.locator("#projectTitle").press("Tab");
  await expect(page.locator("#saveText")).toHaveText("Ошибка · повторить");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { localDrafts } = await import("/static/js/local-drafts.js");
        return (
          await localDrafts(
            window.BUILDER.userId,
            window.BUILDER.projectId,
          ).list()
        ).some((x) => x.title === "Локальная работа");
      }),
    )
    .toBe(true);
  await page.route(`**/api/projects/${id}/versions/`, (route) => route.abort());
  await page.locator("#versionsBtn").click();
  const backupDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Скачать исходник JSON", exact: true })
    .click();
  expect((await backupDownload).suggestedFilename()).toBe(
    "lamoframe-project.json",
  );
  await page.locator("#closeProjectDialog").click();
  await page.unroute(`**/api/projects/${id}/`);
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Найдена локальная копия" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Восстановить копию", exact: true })
    .click();
  await expect
    .poll(async () => {
      const r = await page.request.get(`/api/projects/${id}/`);
      return (await r.json()).title;
    })
    .toBe("Локальная работа");
  await expect(page.locator("#saveText")).toHaveText("Сохранено");
  await page.reload();
  await expect(page.locator("#projectDialog")).not.toBeVisible();
  await expect(page.locator("#projectTitle")).toHaveValue("Локальная работа");
  expect(errors).toEqual([]);
});

test("another tab causes a recoverable save conflict without overwriting the server", async ({
  page,
  context,
}) => {
  const { id, errors } = await create(page);
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.locator("#editorShell")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await title(page, "Изменено в первой вкладке", id);
  await second.locator("#projectTitle").fill("Копия второй вкладки");
  await second.locator("#projectTitle").press("Tab");
  await expect(
    second.getByRole("heading", { name: "Конфликт сохранения" }),
  ).toBeVisible();
  expect(
    (await (await page.request.get(`/api/projects/${id}/`)).json()).title,
  ).toBe("Изменено в первой вкладке");
  const downloaded = second.waitForEvent("download");
  await second
    .getByRole("button", { name: "Скачать мою копию", exact: true })
    .click();
  expect((await downloaded).suggestedFilename()).toBe(
    "lamoframe-conflict.json",
  );
  expect(errors).toEqual([]);
  await second.close();
});
