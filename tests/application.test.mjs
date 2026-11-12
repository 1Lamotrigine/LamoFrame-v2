import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
const dir = await mkdtemp(join(tmpdir(), "lamoframe-test-"));
process.env.STORAGE_DIR = dir;
const { handle } = await import("../lib/server.mjs");
const { database, query, one } = await import("../lib/db.mjs");
const { blankDocument, validateDocument } = await import("../lib/document.mjs");
class Client {
  jar = {};
  async request(path, { method = "GET", form, json, headers = {}, raw } = {}) {
    if (!this.jar.csrftoken) this.jar.csrftoken = "testcsrf";
    const h = {
      cookie: Object.entries(this.jar)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
      ...headers,
    };
    let body;
    if (method !== "GET") {
      h["x-csrftoken"] = this.jar.csrftoken;
      if (json !== undefined) {
        h["content-type"] = "application/json";
        body = JSON.stringify(json);
      } else if (raw) {
        body = raw;
      } else {
        body = new URLSearchParams(form || {});
        h["content-type"] = "application/x-www-form-urlencoded";
      }
    }
    const response = await handle(
      new Request(`http://localhost:3000${path}`, { method, headers: h, body }),
    );
    for (const c of response.headers.getSetCookie()) {
      const [name, value] = c.split(";")[0].split("=");
      this.jar[name] = value;
    }
    return response;
  }
  async signup(username) {
    const r = await this.request("/accounts/signup/", {
      method: "POST",
      form: {
        username,
        password1: "Secure-Example-739",
        password2: "Secure-Example-739",
      },
    });
    assert.equal(r.status, 303);
  }
  async project() {
    const r = await this.request("/projects/create/", {
      method: "POST",
      form: { title: "Тест" },
    });
    assert.equal(r.status, 303);
    return r.headers.get("location").match(/\d+/)[0];
  }
}
const owner = new Client(),
  editor = new Client(),
  viewer = new Client(),
  stranger = new Client();
let pid, cid, fid, recordId;
test("anonymous authentication and CSRF", async () => {
  const r = await handle(new Request("http://localhost:3000/"));
  assert.equal(r.status, 303);
  const denied = await handle(
    new Request("http://localhost:3000/accounts/signup/", {
      method: "POST",
      body: new URLSearchParams({ username: "a" }),
    }),
  );
  assert.equal(denied.status, 403);
  await owner.signup("owner");
  await editor.signup("editor");
  await viewer.signup("viewer");
  await stranger.signup("stranger");
  const login = new Client();
  const bad = await login.request("/accounts/login/", {
    method: "POST",
    form: { username: "owner", password: "wrong" },
  });
  assert.match(await bad.text(), /Неверный логин/);
  const good = await login.request("/accounts/login/", {
    method: "POST",
    form: {
      username: "owner",
      password: "Secure-Example-739",
      next: "https://evil.example/",
    },
  });
  assert.equal(good.headers.get("location"), "/");
  const duplicate = await stranger.request("/accounts/signup/", {
    method: "GET",
  });
  assert.equal(duplicate.status, 303);
});
test("dashboard, templates, creation and editor HTML", async () => {
  for (const path of ["/", "/new/"]) {
    const r = await owner.request(path);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /LamoFrame/);
  }
  pid = await owner.project();
  const r = await owner.request(`/editor/${pid}/`);
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(html, /project-data/);
  assert.doesNotMatch(html, /\{%/);
  assert.equal((await stranger.request(`/api/projects/${pid}/`)).status, 404);
});
test("document validation and atomic stale save rejection", async () => {
  const p = await (await owner.request(`/api/projects/${pid}/`)).json();
  const data = p.data;
  data.meta.title = "Сохранено";
  const r = await owner.request(`/api/projects/${pid}/`, {
    method: "PUT",
    json: {
      data,
      html: "<!doctype html><title>Test</title>",
      base_updated_at: p.updated_at,
    },
  });
  assert.equal(r.status, 200);
  assert.equal(
    (
      await owner.request(`/api/projects/${pid}/`, {
        method: "PUT",
        json: { data, base_updated_at: p.updated_at },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await owner.request(`/api/projects/${pid}/`, {
        method: "PUT",
        json: { data: { version: 4, pages: [] } },
      })
    ).status,
    400,
  );
  const malformed = blankDocument();
  malformed.pages[0].frames = "bad";
  assert.throws(() => validateDocument(malformed));
  const publicPage = await (
    await owner.request(`/api/projects/${pid}/`)
  ).json();
  assert.equal((await owner.request(`/p/${publicPage.slug}/raw/`)).status, 404);
  assert.equal(
    (
      await owner.request(`/api/projects/${pid}/publication/`, {
        method: "POST",
        json: { base_updated_at: publicPage.updated_at },
      })
    ).status,
    200,
  );
  const raw = await owner.request(`/p/${publicPage.slug}/raw/`);
  assert.equal(raw.status, 200);
  assert.match(raw.headers.get("content-security-policy"), /sandbox/);
  assert.equal(
    (
      await owner.request(`/p/${publicPage.slug}/raw/`, {
        headers: { "if-none-match": raw.headers.get("etag") },
      })
    ).status,
    304,
  );
});
test("image validation, duplication and independent media lifetime", async () => {
  const buffer = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  const fd = new FormData();
  fd.append("file", new Blob([buffer], { type: "image/png" }), "file.fake");
  const res = await owner.request(`/api/projects/${pid}/assets/`, {
    method: "POST",
    raw: fd,
  });
  assert.equal(res.status, 200);
  const a = await res.json();
  assert.match(a.url, /\.png$/);
  const p = await (await owner.request(`/api/projects/${pid}/`)).json();
  p.data.pages[0].frames[0].elements.push({
    id: "image",
    type: "image",
    props: { src: a.url },
  });
  await owner.request(`/api/projects/${pid}/`, {
    method: "PUT",
    json: { data: p.data },
  });
  const dup = await owner.request(`/projects/${pid}/duplicate/`, {
    method: "POST",
  });
  assert.equal(dup.status, 303);
  const id = dup.headers.get("location").match(/\d+/)[0];
  const clone = await (await owner.request(`/api/projects/${id}/`)).json();
  assert.notEqual(clone.assets[0].url, a.url);
  assert.equal(
    clone.data.pages[0].frames[0].elements[0].props.src,
    clone.assets[0].url,
  );
  await owner.request(`/projects/${id}/delete/`, { method: "POST" });
  assert.equal((await owner.request(a.url)).status, 200);
  assert.equal((await owner.request(clone.assets[0].url)).status, 404);
  const invalid = new FormData();
  invalid.append("file", new Blob(["not image"]), "x.png");
  assert.equal(
    (
      await owner.request(`/api/projects/${pid}/assets/`, {
        method: "POST",
        raw: invalid,
      })
    ).status,
    400,
  );
});
test("collections, fields, records, binding and publication", async () => {
  const manage = `/projects/${pid}/application/`;
  assert.equal(
    (
      await owner.request(manage, {
        method: "POST",
        form: { action: "collection", name: "Клиенты" },
      })
    ).status,
    303,
  );
  cid = String(
    (await one("SELECT id FROM collections WHERE project_id=$1", [pid])).id,
  );
  await owner.request(manage, {
    method: "POST",
    form: {
      action: "field",
      collection: cid,
      name: "Название",
      kind: "text",
      required: "on",
    },
  });
  fid = String(
    (await one("SELECT id FROM fields WHERE collection_id=$1", [cid])).id,
  );
  const r = await owner.request(
    `/projects/${pid}/application/collections/${cid}/new/`,
    { method: "POST", form: { [fid]: "Первый клиент" } },
  );
  assert.equal(r.status, 303);
  recordId = String(
    (await one("SELECT id FROM records WHERE collection_id=$1", [cid])).id,
  );
  const p = await (await owner.request(`/api/projects/${pid}/`)).json();
  p.data.pages[0].frames[0].elements.push({
    type: "table",
    props: { binding: { collection: cid, columns: [fid] } },
  });
  const save = await (
    await owner.request(`/api/projects/${pid}/`, {
      method: "PUT",
      json: { data: p.data },
    })
  ).json();
  const publish = await owner.request(`/projects/${pid}/application/publish/`, {
    method: "POST",
    form: { version: save.updated_at },
  });
  assert.equal(publish.status, 303);
  assert.ok(await one("SELECT * FROM publications WHERE project_id=$1", [pid]));
  const run = await owner.request(`/apps/${pid}/`);
  assert.match(await run.text(), /applicationFrame/);
  assert.equal((await owner.request(`/projects/${pid}/export/`)).status, 409);
});
async function invite(client, role) {
  await owner.request(`/projects/${pid}/application/`, {
    method: "POST",
    form: { action: "invite", role },
  });
  const i = await one(
    "SELECT * FROM invites WHERE project_id=$1 AND role=$2 AND used_at IS NULL",
    [pid, role],
  );
  assert.equal(
    (await client.request(`/apps/invite/${i.token}/`, { method: "POST" }))
      .status,
    303,
  );
  assert.equal(
    (await client.request(`/apps/invite/${i.token}/`, { method: "POST" }))
      .status,
    404,
  );
}
test("single-use invitations, roles and shared applications", async () => {
  await invite(editor, "editor");
  await invite(viewer, "viewer");
  assert.equal((await stranger.request(`/apps/${pid}/data/`)).status, 404);
  const data = await (await viewer.request(`/apps/${pid}/data/`)).json();
  assert.equal(data.collections[cid].canEdit, false);
  assert.equal(data.collections[cid].rows[0].values[fid], "Первый клиент");
  assert.equal(
    (
      await viewer.request(`/apps/${pid}/records/${cid}/${recordId}/`, {
        method: "POST",
        form: { [fid]: "blocked" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await editor.request(`/apps/${pid}/records/${cid}/${recordId}/`, {
        method: "POST",
        form: { [fid]: "Обновлено" },
      })
    ).status,
    303,
  );
  assert.equal((await editor.request(`/editor/${pid}/`)).status, 404);
  assert.match(await (await editor.request("/")).text(), /Приложения команды/);
});
test("publication isolation and schema cloning without data or permissions", async () => {
  const p = await (await owner.request(`/api/projects/${pid}/`)).json();
  p.data.meta.title = "Изменённый черновик";
  await owner.request(`/api/projects/${pid}/`, {
    method: "PUT",
    json: { data: p.data },
  });
  const published = await (await owner.request(`/apps/${pid}/data/`)).json();
  assert.notEqual(published.document.meta.title, p.data.meta.title);
  const res = await owner.request(`/projects/${pid}/duplicate/`, {
    method: "POST",
  });
  const id = res.headers.get("location").match(/\d+/)[0];
  const clone = await (await owner.request(`/api/projects/${id}/`)).json();
  const c = await one("SELECT id FROM collections WHERE project_id=$1", [id]);
  assert.ok(c);
  assert.equal(
    (
      await one(
        "SELECT count(*)::int AS n FROM records WHERE collection_id=$1",
        [c.id],
      )
    ).n,
    0,
  );
  assert.equal(
    (
      await one("SELECT count(*)::int AS n FROM members WHERE project_id=$1", [
        id,
      ])
    ).n,
    0,
  );
  assert.equal(
    (
      await one(
        "SELECT count(*)::int AS n FROM publications WHERE project_id=$1",
        [id],
      )
    ).n,
    0,
  );
  assert.equal(
    clone.data.pages[0].frames[0].elements.find((e) => e.type === "table").props
      .binding.collection,
    String(c.id),
  );
});
test("status, relation and date validation", async () => {
  const { validateRecord } = await import("../lib/collections.mjs");
  const def = {
    fields: [
      {
        id: "status",
        name: "Статус",
        kind: "status",
        required: true,
        options: ["Новый"],
      },
      {
        id: "relation",
        name: "Клиент",
        kind: "relation",
        required: true,
        target: cid,
      },
      { id: "date", name: "Дата", kind: "date", required: false },
    ],
  };
  await assert.rejects(
    validateRecord(
      pid,
      def,
      new URLSearchParams({ status: "foreign", relation: recordId }),
    ),
  );
  await assert.rejects(
    validateRecord(
      pid,
      def,
      new URLSearchParams({ status: "Новый", relation: "999999" }),
    ),
  );
  await assert.rejects(
    validateRecord(
      pid,
      def,
      new URLSearchParams({
        status: "Новый",
        relation: recordId,
        date: "2026-02-31",
      }),
    ),
  );
  assert.equal(
    (
      await validateRecord(
        pid,
        def,
        new URLSearchParams({
          status: "Новый",
          relation: recordId,
          date: "2026-11-11",
        }),
      )
    ).date,
    "2026-11-11",
  );
});
after(async () => {
  await (await database()).close();
  await rm(dir, { recursive: true, force: true });
});

test("admin templates and users are protected and editable", async () => {
  assert.equal((await stranger.request("/admin/")).status, 403);
  await query("UPDATE users SET is_staff=true WHERE username='owner'");
  for (const path of [
    "/admin/",
    "/admin/templates/",
    "/admin/users/",
    "/admin/projects/",
    "/admin/assets/",
  ]) {
    const r = await owner.request(path);
    assert.equal(r.status, 200);
    assert.match(
      await r.text(),
      /Администрирование|Шаблоны|Пользователи|Проекты|Изображения/,
    );
  }
  const create = await owner.request("/admin/templates/new/", {
    method: "POST",
    form: {
      title: "Шаблон теста",
      slug: "test-template",
      description: "Тест",
      data: JSON.stringify(blankDocument()),
      sort_order: "10",
    },
  });
  assert.equal(create.status, 303);
  assert.match(await (await owner.request("/new/")).text(), /Шаблон теста/);
  const t = await one("SELECT * FROM templates WHERE slug='test-template'");
  assert.equal(
    (
      await owner.request(`/admin/templates/${t.id}/`, {
        method: "POST",
        form: { action: "delete" },
      })
    ).status,
    303,
  );
  assert.equal(
    await one("SELECT * FROM templates WHERE id=$1", [t.id]),
    undefined,
  );
});

test("Django PBKDF2 passwords and JSON script escaping", async () => {
  const { pbkdf2Sync } = await import("node:crypto");
  const { verifyPassword } = await import("../lib/auth.mjs");
  const hash = pbkdf2Sync(
    "existing-password",
    "salt",
    1000,
    32,
    "sha256",
  ).toString("base64");
  assert.equal(
    await verifyPassword(
      "existing-password",
      `pbkdf2_sha256$1000$salt$${hash}`,
    ),
    true,
  );
  assert.equal(
    await verifyPassword("wrong", `pbkdf2_sha256$1000$salt$${hash}`),
    false,
  );
  const { render } = await import("../lib/render.mjs");
  const html = render("dashboard.html", {
    user: { username: "<script>" },
    project_data: { test: "</script><script>alert(1)</script>" },
    projects: [],
  });
  assert.match(html, /Здесь появится ваш первый сайт/);
  assert.doesNotMatch(html, /<script>alert\(1\)/);
  assert.match(html, /\\u003c/);
  const editorHTML = render("editor.html", {
    user: { username: "owner" },
    project: { pk: 1, title: "</script>", data: {}, updated_at: "now" },
    collection_schema: {},
  });
  assert.match(editorHTML, /id="exportBtn"/);
  assert.doesNotMatch(editorHTML, /projectTitle: "<\/script>/);
});

test("draft saves ignore export HTML, public snapshots stay frozen and unpublish revokes access", async () => {
  const id = await owner.project();
  let p = await (await owner.request(`/api/projects/${id}/`)).json();
  p.data.meta.title = "Published";
  const save = await owner.request(`/api/projects/${id}/`, {
    method: "PUT",
    json: {
      data: p.data,
      title: "Published",
      base_updated_at: p.updated_at,
      html: "X".repeat(13 * 1024 * 1024),
    },
  });
  assert.equal(save.status, 200);
  assert.equal(
    (await one("SELECT exported_html FROM projects WHERE id=$1", [id]))
      .exported_html,
    "",
  );
  p = await (await owner.request(`/api/projects/${id}/`)).json();
  assert.equal((await owner.request(`/p/${p.slug}/raw/`)).status, 404);
  assert.equal(
    (
      await stranger.request(`/api/projects/${id}/publication/`, {
        method: "POST",
        json: { base_updated_at: p.updated_at },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await owner.request(`/api/projects/${id}/publication/`, {
        method: "POST",
        json: { base_updated_at: "stale" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await owner.request(`/api/projects/${id}/publication/`, {
        method: "POST",
        json: { base_updated_at: p.updated_at },
      })
    ).status,
    200,
  );
  const before = await (await stranger.request(`/p/${p.slug}/raw/`)).text();
  assert.match(before, /<title>Published<\/title>/);
  p.data.meta.title = "Draft only";
  await owner.request(`/api/projects/${id}/`, {
    method: "PUT",
    json: { data: p.data, title: "Draft only", base_updated_at: p.updated_at },
  });
  assert.equal(
    await (await stranger.request(`/p/${p.slug}/raw/`)).text(),
    before,
  );
  assert.match(
    await (await owner.request(`/projects/${id}/export/`)).text(),
    /<title>Draft only<\/title>/,
  );
  assert.equal(
    (
      await owner.request(`/api/projects/${id}/publication/`, {
        method: "DELETE",
      })
    ).status,
    200,
  );
  assert.equal((await stranger.request(`/p/${p.slug}/raw/`)).status, 404);
});

test("versions preserve drafts, restore atomically and isolate project ownership", async () => {
  const id = await owner.project();
  let p = await (await owner.request(`/api/projects/${id}/`)).json();
  const created = await (
    await owner.request(`/api/projects/${id}/versions/`, {
      method: "POST",
      json: { label: "Начальная версия", base_updated_at: p.updated_at },
    })
  ).json();
  assert.ok(created.id);
  p.data.meta.title = "Changed";
  let save = await (
    await owner.request(`/api/projects/${id}/`, {
      method: "PUT",
      json: { data: p.data, title: "Changed", base_updated_at: p.updated_at },
    })
  ).json();
  const list = await (
    await owner.request(`/api/projects/${id}/versions/`)
  ).json();
  assert.ok(list.versions.some((v) => v.label === "Начальная версия"));
  assert.ok(list.versions.some((v) => v.automatic));
  const other = await stranger.project();
  assert.equal(
    (await stranger.request(`/api/projects/${other}/versions/${created.id}/`))
      .status,
    404,
  );
  assert.equal(
    (await stranger.request(`/api/projects/${id}/versions/`)).status,
    404,
  );
  assert.equal(
    (
      await owner.request(
        `/api/projects/${id}/versions/${created.id}/restore/`,
        { method: "POST", json: { base_updated_at: p.updated_at } },
      )
    ).status,
    409,
  );
  const restored = await (
    await owner.request(`/api/projects/${id}/versions/${created.id}/restore/`, {
      method: "POST",
      json: { base_updated_at: save.updated_at },
    })
  ).json();
  assert.equal(restored.title, "Тест");
  assert.notEqual(restored.updated_at, save.updated_at);
  const backup = await one(
    "SELECT * FROM project_versions WHERE project_id=$1 AND label='Перед восстановлением'",
    [id],
  );
  assert.equal(backup.title, "Changed");
  assert.equal(
    (
      await owner.request(`/api/projects/${id}/versions/${created.id}/`, {
        method: "DELETE",
      })
    ).status,
    200,
  );
  assert.equal(
    (await owner.request(`/api/projects/${id}/versions/${created.id}/`)).status,
    404,
  );
  const db = await database();
  const { migrate } = await import("../lib/migrations.mjs");
  await migrate(db);
  await migrate(db);
  assert.equal(
    (await one("SELECT count(*)::int AS n FROM schema_migrations")).n,
    2,
  );
});

test("geometry diagnostics and backup comparisons handle rotated elements and reordered JSON", async () => {
  const { inspectLayouts } =
    await import("../public/static/js/project-checks.js");
  const { sameDraft } = await import("../public/static/js/local-drafts.js");
  const doc = blankDocument();
  doc.pages[0].frames[0].elements = [
    {
      id: "overflow",
      type: "text",
      name: "За границей",
      x: 1190,
      y: 20,
      w: 100,
      h: 20,
    },
    { id: "hidden", type: "image", hidden: true, props: {} },
    { id: "image", type: "image", x: 0, y: 0, w: 10, h: 10, props: {} },
  ];
  const issues = inspectLayouts(doc);
  assert.equal(issues.length, 2);
  assert.equal(issues[0].elementId, "overflow");
  assert.equal(issues[1].elementId, "image");
  assert.ok(
    sameDraft(
      { title: "A", data: { a: 1, b: { c: 2, d: 3 } } },
      { title: "A", data: { b: { d: 3, c: 2 }, a: 1 } },
    ),
  );
  assert.equal(
    sameDraft({ title: "A", data: { a: 1 } }, { title: "A", data: { a: 2 } }),
    false,
  );
});

test("CRM template creates five pages, valid bound schemas, optional demo data and live reports", async () => {
  const { schema } = await import("../lib/collections.mjs");
  const { bindings } = await import("../lib/document.mjs");
  const { metricFromRecords, chartFromRecords } =
    await import("../public/static/js/crm-widgets.js");
  const res = await owner.request("/projects/create/", {
    method: "POST",
    form: {
      template: "builtin-sales-crm",
      title: "Отдел продаж",
      demo_data: "on",
    },
  });
  assert.equal(res.status, 303);
  const id = res.headers.get("location").match(/\d+/)[0];
  const project = await one("SELECT * FROM projects WHERE id=$1", [id]);
  assert.equal(project.data.pages.length, 5);
  assert.equal(project.data.settings.sidebar.width, 240);
  assert.equal(project.data.settings.theme, "switchable");
  const definitions = await schema(id);
  assert.equal(Object.keys(definitions).length, 4);
  for (const b of bindings(project.data)) {
    assert.ok(definitions[b.collection]);
    for (const k of [
      "stageField",
      "valueField",
      "groupField",
      "clientField",
      "dateField",
      "statusField",
    ])
      if (b[k])
        assert.ok(
          definitions[b.collection].fields.some((f) => f.id === b[k]),
          k,
        );
  }
  const publish = await owner.request(`/projects/${id}/application/publish/`, {
    method: "POST",
    form: { version: project.updated_at },
  });
  assert.equal(publish.status, 303);
  const payload = await (await owner.request(`/apps/${id}/data/`)).json();
  assert.equal(payload.projectId, project.id);
  assert.equal(payload.role, "owner");
  const metrics = project.data.pages[0].frames[0].elements.filter(
    (e) => e.type === "metric",
  );
  const values = metrics.map(
    (e) =>
      metricFromRecords(e, { appData: payload.collections }).props.metric.value,
  );
  assert.deepEqual(values, [4, 840000, 96000, 1]);
  const chart = project.data.pages[0].frames[0].elements.find(
    (e) => e.type === "chart",
  );
  const data = chartFromRecords(chart, { appData: payload.collections }).props
    .chart.data;
  assert.equal(
    data.reduce((n, v) => n + v.value, 0),
    5,
  );
  const empty = await owner.request("/projects/create/", {
    method: "POST",
    form: { template: "builtin-sales-crm", title: "Пустая CRM" },
  });
  const emptyId = empty.headers.get("location").match(/\d+/)[0];
  assert.equal(
    (
      await one(
        "SELECT count(*)::int AS n FROM records r JOIN collections c ON c.id=r.collection_id WHERE c.project_id=$1",
        [emptyId],
      )
    ).n,
    0,
  );
});

test("CRM mutations validate permissions, concurrent edits, stages and references, and record activity", async () => {
  const project = await one(
    "SELECT * FROM projects WHERE title='Отдел продаж'",
  );
  const pub = await one("SELECT * FROM publications WHERE project_id=$1", [
    project.id,
  ]);
  const defs = pub.snapshot.collections;
  const [cid, c] = Object.entries(defs).find(([, c]) => c.name === "Сделки");
  let record = await one(
    "SELECT * FROM records WHERE collection_id=$1 ORDER BY id LIMIT 1",
    [cid],
  );
  const stage = c.fields.find((f) => f.name === "Этап").id,
    closed = c.fields.find((f) => f.name === "Дата закрытия").id;
  const endpoint = `/apps/${project.id}/mutate/`;
  assert.equal(
    (
      await stranger.request(endpoint, {
        method: "POST",
        json: {
          collection: cid,
          record: record.id,
          revision: record.revision,
          values: { [stage]: "Выиграна" },
        },
      })
    ).status,
    404,
  );
  const viewerId = (await one("SELECT id FROM users WHERE username='viewer'"))
    .id;
  await query("INSERT INTO members(project_id,user_id,role) VALUES($1,$2,$3)", [
    project.id,
    viewerId,
    "viewer",
  ]);
  assert.equal(
    (
      await viewer.request(endpoint, {
        method: "POST",
        json: {
          collection: cid,
          record: record.id,
          revision: record.revision,
          values: { [stage]: "Выиграна" },
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await owner.request(endpoint, {
        method: "POST",
        json: {
          collection: cid,
          record: record.id,
          revision: record.revision,
          values: { [stage]: "Чужой статус" },
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await owner.request(endpoint, {
        method: "POST",
        json: {
          collection: cid,
          record: record.id,
          revision: record.revision,
          values: { [stage]: "Выиграна" },
        },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await owner.request(endpoint, {
        method: "POST",
        json: {
          collection: cid,
          record: record.id,
          revision: record.revision,
          values: { [stage]: "Новая" },
        },
      })
    ).status,
    409,
  );
  record = await one("SELECT * FROM records WHERE id=$1", [record.id]);
  assert.equal(record.values[stage], "Выиграна");
  assert.ok(record.values[closed]);
  const event = await one(
    "SELECT * FROM record_events WHERE record_id=$1 AND kind='updated'",
    [record.id],
  );
  assert.match(event.body, /Этап/);
  const card = `/apps/${project.id}/records/${cid}/${record.id}/?page=page-deals`;
  const html = await (await owner.request(card)).text();
  assert.match(html, /Комментарии и история/);
  assert.match(html, /Клиент/);
  assert.match(html, /Добавить связанную запись/);
  const comment = await owner.request(card, {
    method: "POST",
    form: { action: "comment", comment: "Договор согласован" },
  });
  assert.equal(comment.status, 303);
  assert.match(comment.headers.get("location"), /records/);
  assert.equal(
    (
      await one(
        "SELECT body FROM record_events WHERE record_id=$1 AND kind='comment'",
        [record.id],
      )
    ).body,
    "Договор согласован",
  );
  const clientField = c.fields.find((f) => f.name === "Клиент");
  const client = await one("SELECT * FROM records WHERE id=$1", [
    record.values[clientField.id],
  ]);
  assert.equal(
    (
      await owner.request(endpoint, {
        method: "POST",
        json: {
          action: "delete",
          collection: clientField.target,
          record: client.id,
          revision: client.revision,
        },
      })
    ).status,
    409,
  );
  const options = await owner.request(`/projects/${project.id}/application/`, {
    method: "POST",
    form: {
      action: "field_options",
      field: stage,
      options: "Новая, Переговоры, Предложение, Выиграна, Проиграна, Ожидание",
    },
  });
  assert.equal(options.status, 303);
  assert.ok(
    (
      await one("SELECT options FROM fields WHERE id=$1", [stage])
    ).options.includes("Ожидание"),
  );
});

test("shared sidebar reserves all page widths and exports with theme controls", async () => {
  const { init, state, configureSidebar, addFrame } =
    await import("../public/static/js/state.js");
  const {
    renderDocument,
    renderBundlePage,
    buildMainScript,
    buildStylesheet,
    docPages,
  } = await import("../public/static/js/render.js");
  const doc = blankDocument("Меню");
  doc.pages.push({
    ...structuredClone(doc.pages[0]),
    id: "p_other",
    slug: "other",
    name: "Другая",
  });
  init(doc);
  configureSidebar({ enabled: true, width: 240 });
  assert.equal(state.doc.pages[0].frames[0].w, 960);
  assert.equal(state.doc.pages[1].frames[0].w, 960);
  assert.equal(addFrame().w, 960);
  configureSidebar({ width: 300 });
  assert.equal(state.doc.pages[1].frames[0].w, 900);
  configureSidebar({ enabled: false });
  assert.equal(state.doc.pages[1].frames[0].w, 1200);
  state.doc.settings.sidebar.enabled = true;
  state.doc.settings.theme = "switchable";
  const html = renderDocument(state.doc);
  assert.match(html, /lf-sidebar-grip/);
  assert.match(html, /Переключить тему сайта/);
  assert.match(html, /#page-other/);
  const page = docPages(state.doc)[0];
  const bundled = renderBundlePage(state.doc, page, {
    pageHrefs: new Map([
      ["p_home", "index.html"],
      ["p_other", "other.html"],
    ]),
  });
  assert.match(bundled, /href="other.html"/);
  assert.match(buildMainScript(state.doc), /pointermove/);
  assert.match(buildStylesheet(state.doc), /data-site-theme=dark/);
});

test("CRM duplication remaps analytical and kanban bindings and numeric zero remains valid", async () => {
  const source = await one("SELECT * FROM projects WHERE title='Отдел продаж'");
  const res = await owner.request(`/projects/${source.id}/duplicate/`, {
    method: "POST",
  });
  assert.equal(res.status, 303);
  const id = res.headers.get("location").match(/\d+/)[0];
  const clone = await one("SELECT * FROM projects WHERE id=$1", [id]);
  assert.notEqual(clone.data.settings.siteKey, source.data.settings.siteKey);
  const { schema, validateRecord } = await import("../lib/collections.mjs");
  const definitions = await schema(id);
  const { bindings } = await import("../lib/document.mjs");
  for (const b of bindings(clone.data)) {
    assert.ok(definitions[b.collection]);
    for (const key of [
      "groupField",
      "stageField",
      "valueField",
      "titleField",
      "dateField",
      "clientField",
      "statusField",
    ])
      if (b[key])
        assert.ok(
          definitions[b.collection].fields.some((f) => f.id === b[key]),
          key,
        );
  }
  assert.equal(
    (
      await one(
        "SELECT count(*)::int AS n FROM records r JOIN collections c ON c.id=r.collection_id WHERE c.project_id=$1",
        [id],
      )
    ).n,
    0,
  );
  assert.equal(
    (
      await one(
        "SELECT count(*)::int AS n FROM publications WHERE project_id=$1",
        [id],
      )
    ).n,
    0,
  );
  assert.equal(
    (
      await validateRecord(
        id,
        {
          fields: [
            { id: "zero", name: "Сумма", kind: "number", required: true },
          ],
        },
        new Map([["zero", 0]]),
      )
    ).zero,
    0,
  );
});
