import { test, expect } from "@playwright/test";
async function signup(page) {
  await page.addInitScript(() => {
    try {
      if (window === window.top) localStorage.setItem("sb-tour-seen", "1");
    } catch {}
  });
  await page.goto("/accounts/signup/");
  await page.locator("[name=username]").fill("crm_" + Date.now());
  for (const name of ["password1", "password2"])
    await page.locator(`[name=${name}]`).fill("Secure-Example-739");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
}

test("CRM template: live analytics, sidebar, themes, kanban and related cards", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signup(page);
  await page.getByRole("link", { name: "Новый проект", exact: true }).click();
  await page.locator('[data-template="builtin-sales-crm"]').click();
  await expect(page.locator("#crmDemoOption")).toBeVisible();
  await page
    .getByRole("button", { name: "Создать проект", exact: true })
    .click();
  await expect(page.locator("#editorShell")).toHaveAttribute(
    "data-ready",
    "true",
  );
  const id = page.url().match(/editor\/(\d+)/)[1];
  await expect(page.locator("#siteThemeMode")).toHaveValue("switchable");
  await expect(page.locator(".editor-site-sidebar")).toContainText("Клиенты");
  await page.locator("#siteSidebarWidth").fill("260");
  await page.locator("#siteSidebarWidth").press("Tab");
  await expect
    .poll(async () => {
      const r = await page.request.get(`/api/projects/${id}/`);
      return (await r.json()).data.settings.sidebar.width;
    })
    .toBe(260);
  await page
    .getByRole("link", { name: "Данные и доступ", exact: true })
    .click();
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await page
    .getByRole("link", { name: "Открыть приложение", exact: true })
    .click();
  const app = page.frameLocator("#applicationFrame");
  await expect(app.locator(".lf-sidebar")).toBeVisible();
  await expect(app.locator(".sb-metric-number").first()).toHaveText("4");
  await expect(app.locator(".lf-nav-link")).toHaveCount(5);
  await page.screenshot({
    path: "test-results/crm-overview.png",
    fullPage: true,
  });
  const original = await app
    .locator(".lf-shell")
    .getAttribute("data-site-theme");
  await app.getByRole("button", { name: "Переключить тему сайта" }).click();
  await expect(app.locator(".lf-shell")).toHaveAttribute(
    "data-site-theme",
    original === "dark" ? "light" : "dark",
  );
  const grip = app.getByRole("separator", { name: "Ширина меню" });
  const box = await grip.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(300, box.y + 100, { steps: 5 });
  await page.mouse.up();
  await expect(grip).toHaveAttribute("aria-valuenow", "300");
  await grip.focus();
  await grip.press("ArrowLeft");
  await grip.press("ArrowLeft");
  await grip.press("Home");
  // Restore the author default before testing the keyboard increment.
  for (let i = 0; i < 5; i++) await grip.press("ArrowRight");
  await grip.focus();
  await grip.press("ArrowRight");
  await expect(grip).toHaveAttribute("aria-valuenow", "276");
  await app.getByRole("link", { name: "Сделки", exact: true }).click();
  await expect(app.locator(".lf-kanban-column")).toHaveCount(5);
  await expect
    .poll(() => page.evaluate(() => location.hash))
    .toBe("#page-deals");
  const before = await (await page.request.get(`/apps/${id}/data/`)).json();
  const dealsId = Object.keys(before.collections).find(
    (k) => before.collections[k].name === "Сделки",
  );
  const field = before.collections[dealsId].fields.find(
    (f) => f.name === "Этап",
  ).id;
  const rid = before.collections[dealsId].rows[0].id;
  const card = app.locator(`.lf-deal-card[data-record-id="${rid}"]`);
  await card.locator("[data-kanban-stage]").selectOption("Выиграна");
  await expect
    .poll(async () => {
      const data = await (await page.request.get(`/apps/${id}/data/`)).json();
      return data.collections[dealsId].rows.find((r) => r.id === rid).values[
        field
      ];
    })
    .toBe("Выиграна");
  await expect(
    app.locator(
      `.lf-kanban-column[data-stage="Выиграна"] .lf-deal-card[data-record-id="${rid}"]`,
    ),
  ).toBeVisible();
  await expect(app.locator(".lf-shell")).toHaveAttribute(
    "data-site-theme",
    original === "dark" ? "light" : "dark",
  );
  await expect(
    app.getByRole("separator", { name: "Ширина меню" }),
  ).toHaveAttribute("aria-valuenow", "276");
  await app.getByRole("link", { name: "Обзор", exact: true }).click();
  await expect(app.locator(".sb-metric-number").nth(2)).toHaveText(/336.?000/);
  await app.locator("[data-crm-period]").selectOption("7");
  await expect(app.locator("[data-crm-period]")).toHaveValue("7");
  await app.getByRole("link", { name: "Клиенты", exact: true }).click();
  const table = app.locator(".sb-page:not([hidden]) .sb-bound-table");
  await table.locator("[data-crm-search]").fill("Аврора");
  await expect(table.locator("tbody tr[data-record-row]:visible")).toHaveCount(
    1,
  );
  await table
    .getByRole("button", { name: "Редактировать", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Комментарии и история" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Сделки", exact: true }),
  ).toBeVisible();
  await page.locator("[name=comment]").fill("Перезвонить завтра");
  await page.getByRole("button", { name: "Добавить комментарий" }).click();
  await expect(
    page.getByText("Перезвонить завтра", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "В приложение", exact: true }).click();
  await expect(app.locator(".lf-sidebar")).toBeVisible();
  await page.reload();
  await expect(app.locator(".lf-shell")).toHaveAttribute(
    "data-site-theme",
    original === "dark" ? "light" : "dark",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(app.getByRole("button", { name: "Открыть меню" })).toBeVisible();
  await app.getByRole("button", { name: "Открыть меню" }).click();
  await expect(
    app.getByRole("link", { name: "Задачи", exact: true }),
  ).toBeVisible();
  await app.getByRole("link", { name: "Задачи", exact: true }).click();
  await expect(app.locator(".lf-shell")).not.toHaveClass(/is-menu-open/);
  await expect
    .poll(async () => {
      const box = await app.locator(".lf-sidebar").boundingBox();
      return Math.round(box.x + box.width);
    })
    .toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/crm-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("ordinary site: shared menu and switchable theme survive standalone and ZIP exports", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signup(page);
  await page.getByRole("link", { name: "Новый проект", exact: true }).click();
  await page
    .getByRole("button", { name: "Создать проект", exact: true })
    .click();
  await expect(page.locator("#editorShell")).toHaveAttribute(
    "data-ready",
    "true",
  );
  const id = page.url().match(/editor\/(\d+)/)[1];
  await page.locator("[data-add-sidebar]").click();
  await expect(page.locator("#siteSidebarEnabled")).toBeChecked();
  await page.locator("#siteThemeMode").selectOption("switchable");
  await page.locator("[data-add=heading]").click();
  await expect
    .poll(async () => {
      const r = await page.request.get(`/api/projects/${id}/`);
      return (await r.json()).data.settings.theme;
    })
    .toBe("switchable");
  await page.locator("#publishSiteBtn").click();
  await page
    .getByRole("button", { name: "Опубликовать сайт", exact: true })
    .click();
  const href = await page
    .getByRole("link", { name: "Открыть опубликованный сайт" })
    .getAttribute("href");
  await page.goto(href + "raw/");
  await expect(page.locator(".lf-sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Переключить тему сайта" }).click();
  await expect(page.locator(".lf-shell")).toHaveAttribute(
    "data-site-theme",
    "dark",
  );
  await page.goto(`/editor/${id}/`);
  await expect(page.locator("#editorShell")).toHaveAttribute(
    "data-ready",
    "true",
  );
  const exported = await page.evaluate(async () => {
    const { state, serializeDoc } = await import("/static/js/state.js");
    const { buildProjectBundle } = await import("/static/js/bundle.js");
    const b = await buildProjectBundle(serializeDoc(state.doc));
    return Object.fromEntries(
      b.files
        .filter((f) => typeof f.data === "string")
        .map((f) => [f.path, f.data]),
    );
  });
  await page.route("**/export-check/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      "/export-check/",
      "",
    );
    const type = path.endsWith(".js")
      ? "text/javascript"
      : path.endsWith(".css")
        ? "text/css"
        : "text/html";
    return route.fulfill({
      contentType: type,
      body: exported[path] || "",
      status: exported[path] ? 200 : 404,
    });
  });
  await page.goto("/export-check/index.html");
  await expect(page.locator(".lf-sidebar")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Переключить тему сайта" }),
  ).toBeVisible();
  await page.getByRole("separator", { name: "Ширина меню" }).focus();
  await page
    .getByRole("separator", { name: "Ширина меню" })
    .press("ArrowRight");
  await expect(
    page.getByRole("separator", { name: "Ширина меню" }),
  ).toHaveAttribute("aria-valuenow", "256");
  expect(errors).toEqual([]);
});
