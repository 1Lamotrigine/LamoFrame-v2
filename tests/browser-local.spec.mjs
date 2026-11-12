import { test, expect } from "@playwright/test";
test.setTimeout(120000);
async function profile(page, name = "Учебная мастерская") {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("sb-tour-seen", "1");
    } catch {}
  });
  await page.goto("/accounts/signup/");
  await expect(
    page.getByRole("heading", { name: "Создать локальный профиль" }),
  ).toBeVisible({ timeout: 45000 });
  await page.locator("[name=username]").fill(name);
  await page
    .getByRole("button", { name: "Создать профиль", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Мои проекты", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}
async function create(page, crm = false) {
  await page.getByRole("link", { name: "Новый проект", exact: true }).click();
  await expect(page.locator("#createForm")).toBeVisible({ timeout: 30000 });
  if (crm) await page.locator('[data-template="builtin-sales-crm"]').click();
  await page
    .getByRole("button", { name: "Создать проект", exact: true })
    .click();
  await expect(page.locator("#editorShell")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 30000 },
  );
  return page.url().match(/editor\/(\d+)/)[1];
}
async function localJSON(page, path, options) {
  return page.evaluate(
    async ({ path, options }) => {
      const response = await fetch(path, options);
      return { status: response.status, data: await response.json() };
    },
    { path, options },
  );
}

test("browser PGlite creates a profile, saves projects and persists after reload without server writes", async ({
  page,
}) => {
  const networkWrites = [],
    errors = [];
  page.on("request", (r) => {
    if (!["GET", "HEAD"].includes(r.method())) networkWrites.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await profile(page);
  expect(await page.locator("input[type=password]").count()).toBe(0);
  const id = await create(page);
  await page.locator("#projectTitle").fill("Проект в браузере");
  await page.locator("#projectTitle").press("Tab");
  await expect
    .poll(
      async () => (await localJSON(page, `/api/projects/${id}/`)).data.title,
    )
    .toBe("Проект в браузере");
  await page.reload();
  await expect(page.locator("#editorShell")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 30000 },
  );
  await expect(page.locator("#projectTitle")).toHaveValue("Проект в браузере");
  await page.getByRole("link", { name: "Проекты", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Мои проекты", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("heading", { name: "Проект в браузере" }),
  ).toBeVisible();
  expect(networkWrites).toEqual([]);
  expect(errors).toEqual([]);
});

test("local CRM, IndexedDB images, working version and backup restore", async ({
  page,
}) => {
  await profile(page, "CRM на устройстве");
  const id = await create(page, true);
  await expect(page.locator("#siteThemeMode")).toHaveValue("switchable");
  await page
    .getByRole("link", { name: "Данные и доступ", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Локальная CRM", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  expect(
    await page.getByRole("button", { name: "Создать приглашение" }).count(),
  ).toBe(0);
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Открыть приложение", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("link", { name: "Открыть приложение", exact: true })
    .click();
  const app = page.frameLocator("#applicationFrame");
  await expect(app.locator(".lf-sidebar")).toBeVisible({ timeout: 30000 });
  await expect(app.locator(".sb-metric-number").first()).toHaveText("4");
  await app.getByRole("link", { name: "Сделки", exact: true }).click();
  const payload = (await localJSON(page, `/apps/${id}/data/`)).data;
  const cid = Object.keys(payload.collections).find(
    (k) => payload.collections[k].name === "Сделки",
  );
  const stage = payload.collections[cid].fields.find(
    (f) => f.name === "Этап",
  ).id;
  const rid = payload.collections[cid].rows[0].id;
  await app
    .locator(`.lf-deal-card[data-record-id="${rid}"] [data-kanban-stage]`)
    .selectOption("Выиграна");
  await expect
    .poll(async () => {
      const d = (await localJSON(page, `/apps/${id}/data/`)).data;
      return d.collections[cid].rows.find((r) => r.id === rid).values[stage];
    })
    .toBe("Выиграна");
  await page.goto(`/editor/${id}/`);
  await expect(page.locator("#editorShell")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 30000 },
  );
  // All uploaded bytes and profile data remain on this browser, including in backup.
  const upload = await page.evaluate(async (id) => {
    const f = new FormData();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 4;
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    f.append("file", blob, "local.png");
    const r = await fetch(`/api/projects/${id}/assets/`, {
      method: "POST",
      body: f,
    });
    return { status: r.status, data: await r.json() };
  }, id);
  expect(upload.status).toBe(200);
  const imageSave = await page.evaluate(
    async ({ id, url }) => {
      const p = await (await fetch(`/api/projects/${id}/`)).json();
      p.data.pages[0].frames[0].elements.push({
        id: "local-image",
        type: "image",
        name: "Локальное изображение",
        x: 30,
        y: 1100,
        w: 64,
        h: 64,
        z: 99,
        props: { src: url },
        style: {},
      });
      const r = await fetch(`/api/projects/${id}/`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: p.data, base_updated_at: p.updated_at }),
      });
      return r.status;
    },
    { id, url: upload.data.url },
  );
  expect(imageSave).toBe(200);
  await page.reload();
  await expect(page.locator("#editorShell")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 30000 },
  );
  await expect
    .poll(() =>
      page
        .locator(".sb-image")
        .first()
        .evaluate((img) => img.naturalWidth),
    )
    .toBe(4);

  await page.goto("/local/backup/");
  await expect(
    page.getByRole("heading", { name: "Резервная копия мастерской" }),
  ).toBeVisible({ timeout: 30000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать полную копию" }).click();
  const file = await download;
  const path = await file.path();
  const source = JSON.parse(
    await (await import("node:fs/promises")).readFile(path, "utf8"),
  );
  expect(source.format).toBe("lamoframe-workspace");
  expect(source.data.local_files).toHaveLength(1);
  expect(source.data.records.length).toBeGreaterThan(10);
  const broken = structuredClone(source);
  broken.data.projects[0].owner_id = 99999999;
  await page.locator("[name=backup]").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(broken)),
  });
  await page.locator("[name=confirm]").check();
  await page.getByRole("button", { name: "Восстановить из файла" }).click();
  await expect(page.locator("#localBackupStatus")).toContainText(
    "Текущие данные сохранены.",
  );
  expect((await localJSON(page, `/api/projects/${id}/`)).status).toBe(200);

  await page.locator("[name=backup]").setInputFiles(path);
  await page.locator("[name=confirm]").check();
  await page.getByRole("button", { name: "Восстановить из файла" }).click();
  await expect(
    page.getByRole("heading", { name: "Создать локальный профиль" }),
  ).toBeVisible({ timeout: 30000 });
  await page
    .getByRole("button", { name: "CRM на устройстве", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Мои проекты", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.goto(`/editor/${id}/`);
  await expect(page.locator("#editorShell")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 30000 },
  );
  const p = await localJSON(page, `/api/projects/${id}/`);
  expect(p.data.assets).toHaveLength(1);
  const img = await page.evaluate(async (url) => {
    const r = await fetch(url);
    return { status: r.status, size: (await r.blob()).size };
  }, upload.data.url);
  expect(img.status).toBe(200);
  expect(img.size).toBeGreaterThan(0);
});

test("tabs share one browser database, recover aborted transactions and remain separate from other browsers", async ({
  page,
  context,
  browser,
}) => {
  await profile(page, "Несколько вкладок");
  const id = await create(page);
  const second = await context.newPage();
  await second.goto(`/editor/${id}/`);
  await expect(second.locator("#editorShell")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 30000 },
  );
  await page.close();
  await second.locator("#projectTitle").fill("Сохранено во второй вкладке");
  await second.locator("#projectTitle").press("Tab");
  await expect
    .poll(
      async () => (await localJSON(second, `/api/projects/${id}/`)).data.title,
      { timeout: 20000 },
    )
    .toBe("Сохранено во второй вкладке");
  await second.reload();
  await expect(second.locator("#projectTitle")).toHaveValue(
    "Сохранено во второй вкладке",
    { timeout: 30000 },
  );
  // A tab interrupted in an interactive transaction must not block the others.
  const aborted = await context.newPage();
  await aborted.goto(new URL("/accounts/login/", second.url()).href);
  await expect(
    aborted.getByRole("heading", { name: "Создать локальный профиль" }),
  ).toBeVisible({ timeout: 30000 });
  await aborted.evaluate(async (id) => {
    const lease = "lamoframe-test:" + crypto.randomUUID();
    await new Promise((resolve) =>
      navigator.locks.request(lease, () => {
        resolve();
        return new Promise(() => {});
      }),
    );
    const worker = new SharedWorker("/local/pglite-worker.js", {
      type: "module",
      name: "lamoframe-local-db-v1",
    });
    window.abortTestWorker = worker;
    worker.port.start();
    let seq = 0;
    const rpc = (method, args = {}) =>
      new Promise((resolve, reject) => {
        const n = ++seq;
        const listener = (event) => {
          if (event.data.id !== n) return;
          worker.port.removeEventListener("message", listener);
          event.data.error
            ? reject(Error(event.data.error.message))
            : resolve(event.data.result);
        };
        worker.port.addEventListener("message", listener);
        worker.port.postMessage({ id: n, method, args });
      });
    await rpc("init", { lease });
    await rpc("begin");
    await rpc("query", {
      sql: "UPDATE projects SET title=$1 WHERE id=$2",
      params: ["Незавершённая транзакция", Number(id)],
    });
  }, id);
  await aborted.close();
  await expect
    .poll(
      async () => (await localJSON(second, `/api/projects/${id}/`)).data.title,
      { timeout: 15000 },
    )
    .toBe("Сохранено во второй вкладке");
  const isolated = await browser.newContext();
  const other = await isolated.newPage();
  await other.goto(new URL("/accounts/login/", second.url()).href);
  await expect(
    other.getByRole("heading", { name: "Создать локальный профиль" }),
  ).toBeVisible({ timeout: 30000 });
  expect(
    await other
      .getByRole("button", { name: "Несколько вкладок", exact: true })
      .count(),
  ).toBe(0);
  await isolated.close();
  await second.close();
});

test('ordinary site still exports ZIP and opens its local snapshot in a sandbox',async({page})=>{
 await profile(page,'Локальный сайт');const id=await create(page);
 await page.locator('[data-add=heading]').click();await expect(page.locator('#saveText')).toHaveText('Сохранено',{timeout:15000});
 await page.locator('#siteThemeMode').selectOption('switchable');await page.locator('[data-add-sidebar]').click();
 await page.locator('#publishSiteBtn').click();await page.getByRole('button',{name:'Опубликовать сайт',exact:true}).click();await expect(page.getByText('Это локальный снимок.',{exact:false})).toBeVisible();
 const href=await page.getByRole('link',{name:'Открыть опубликованный сайт'}).getAttribute('href');await page.locator('#closeProjectDialog').click();const download=page.waitForEvent('download');await page.locator('#exportBtn').click();expect((await download).suggestedFilename()).toMatch(/\.zip$/);
 await page.goto(href);await expect(page.frameLocator('.public-stage iframe').getByRole('heading',{name:'Новый заголовок'})).toBeVisible({timeout:30000});await expect(page.getByText('локальное превью · доступно только в этом браузере',{exact:true})).toBeVisible();
 await page.goto(href+'raw/');await expect(page.frameLocator('iframe[title="Локальное превью"]').getByRole('heading',{name:'Новый заголовок'})).toBeVisible({timeout:30000});expect(await page.locator('iframe').getAttribute('sandbox')).not.toContain('allow-same-origin');
});
