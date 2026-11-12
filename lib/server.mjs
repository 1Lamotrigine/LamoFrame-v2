import {
  mutateCRM,
  recordEvent,
  recordActivity,
  deleteRecord,
  completeDealDate,
} from "./crm-actions.mjs";
import { CRM_TEMPLATE, crmDocument, createCRM } from "./crm-template.mjs";
import {
  lifecycle,
  checkpoint,
  nextVersion,
  siteHTML,
} from "./project-lifecycle.mjs";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { query, one, transaction, storage } from "./db.mjs";
import { render, escape, control } from "./render.mjs";
import {
  token,
  cookies,
  cookie,
  userFor,
  createSession,
  hashPassword,
  verifyPassword,
  safeNext,
  csrfCheck,
  hashToken,
} from "./auth.mjs";
import {
  blankDocument,
  validateDocument,
  bindings,
  slug,
  replaceUrls,
} from "./document.mjs";
import {
  schema,
  applicationData,
  recordForm,
  validateRecord,
  kinds,
} from "./collections.mjs";
import { adminPage } from "./admin.mjs";
import { oauth } from "./oauth.mjs";
const fail = (status, message) => {
  throw Object.assign(Error(message), { status });
};
const found = (x) => x || fail(404, "Страница не найдена");
const redirect = (path) =>
  new Response(null, { status: 303, headers: { Location: path } });
const json = (v, status = 200) => Response.json(v, { status });
const projectView = (p) => ({ ...p, pk: p.id });
const roleLabel = (r) =>
  r === "editor" ? "Редактирование записей" : "Только просмотр";
async function owned(id, user, db) {
  return found(
    await one(
      "SELECT * FROM projects WHERE id=$1 AND owner_id=$2",
      [id, user.id],
      db,
    ),
  );
}
async function access(id, user) {
  const p = found(await one("SELECT * FROM projects WHERE id=$1", [id]));
  const role =
    p.owner_id === user.id
      ? "owner"
      : (
          await one(
            "SELECT role FROM members WHERE project_id=$1 AND user_id=$2",
            [id, user.id],
          )
        )?.role;
  found(role);
  return [p, role];
}
async function assets(id) {
  return (
    await query("SELECT * FROM assets WHERE project_id=$1 ORDER BY id DESC", [
      id,
    ])
  ).map((a) => ({ ...a, url: `/media/${a.file}` }));
}
async function bodyLimited(req, max) {
  let size = 0;
  const chunks = [];
  if (req.body) {
    for await (const chunk of req.body) {
      size += chunk.byteLength;
      if (size > max) fail(413, "Запрос слишком большой");
      chunks.push(Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks);
}
export async function handle(req) {
  let response;
  try {
    response = await dispatch(req);
  } catch (error) {
    const status =
      error.status ||
      (error.code === "23505" || error.code === "22P02" ? 400 : 500);
    if (status >= 500) console.error(error);
    const message = error.status
      ? error.message
      : error.code === "23505"
        ? "Такое название уже существует."
        : status === 400
          ? "Проверьте переданные данные."
          : "Не удалось выполнить действие. Повторите попытку позже.";
    const wantsJSON =
      new URL(req.url).pathname.startsWith("/api/") ||
      req.headers.get("accept")?.includes("application/json");
    response = wantsJSON
      ? json({ error: message }, status)
      : new Response(render("error.html", { status, message }), {
          status,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
  }
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  if (!response.headers.has("Cache-Control"))
    response.headers.set("Cache-Control", "no-store");
  return response;
}
async function dispatch(req) {
  const url = new URL(req.url),
    path = url.pathname.replace(/\/$/, "") || "/",
    method = req.method;
  const csrf = cookies(req).csrftoken || token();
  let form = null,
    payload = null;
  if (!["GET", "HEAD"].includes(method)) {
    const bytes = await bodyLimited(req, 22 * 1024 * 1024);
    if ((req.headers.get("content-type") || "").includes("application/json")) {
      try {
        payload = JSON.parse(bytes.toString() || "{}");
      } catch {
        fail(400, "Некорректный JSON");
      }
    } else {
      const parsed = new Request(req.url, {
        method: "POST",
        headers: {
          "content-type":
            req.headers.get("content-type") ||
            "application/x-www-form-urlencoded",
        },
        body: bytes,
      });
      form = await parsed.formData();
    }
    csrfCheck(req, form);
  }
  const user = await userFor(req);
  const page = (name, context = {}, status = 200) => {
    const res = new Response(
      render(name, { user, request: { user }, csrf_token: csrf, ...context }),
      { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
    res.headers.append(
      "Set-Cookie",
      cookie("csrftoken", csrf, { httpOnly: false }),
    );
    return res;
  };
  const requireMethod = (...methods) => {
    if (!methods.includes(method)) fail(405, "Метод не поддерживается");
  };
  const loginResponse = async (u, next) => {
    const res = redirect(safeNext(next));
    res.headers.append(
      "Set-Cookie",
      cookie("session", await createSession(u.id)),
    );
    res.headers.append(
      "Set-Cookie",
      cookie("csrftoken", token(), { httpOnly: false }),
    );
    return res;
  };
  if (path.startsWith("/media/")) {
    requireMethod("GET");
    const name = decodeURIComponent(path.slice(7));
    const full = resolve(storage, "media", name);
    if (!full.startsWith(resolve(storage, "media") + "/"))
      fail(404, "Файл не найден");
    try {
      return new Response(await readFile(full), {
        headers: {
          "Content-Type":
            {
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".webp": "image/webp",
              ".gif": "image/gif",
            }[extname(name)] || "application/octet-stream",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    } catch {
      fail(404, "Файл не найден");
    }
  }
  if (path.startsWith("/accounts/google/"))
    return oauth(req, { user, form, page, loginResponse, redirect, fail });
  if (["/accounts/signup", "/accounts/login"].includes(path)) {
    requireMethod("GET", "POST");
    if (user) return redirect("/");
    const signup = path.endsWith("signup");
    const next = safeNext(form?.get("next") || url.searchParams.get("next"));
    let errors = [];
    const username = String(form?.get("username") || "")
        .trim()
        .normalize("NFKC"),
      email = String(form?.get("email") || "").trim();
    if (method === "POST") {
      if (signup) {
        const password = String(form.get("password1") || "");
        if (!/^[\p{L}\p{N}@.+_\-]{1,150}$/u.test(username))
          errors.push("Введите корректный логин (до 150 символов).");
        if (email && (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)))
          errors.push("Введите корректный email.");
        if (
          password.length < 8 ||
          password.length > 1024 ||
          /^\d+$/.test(password) ||
          ["password", "password123", "qwerty123"].includes(
            password.toLowerCase(),
          ) ||
          password.toLowerCase().includes(username.toLowerCase())
        )
          errors.push("Используйте более сложный пароль: минимум 8 символов.");
        if (password !== form.get("password2"))
          errors.push("Пароли не совпадают.");
        if (
          await one("SELECT id FROM users WHERE lower(username)=lower($1)", [
            username,
          ])
        )
          errors.push("Такой логин уже занят.");
        if (
          email &&
          (await one("SELECT id FROM users WHERE lower(email)=lower($1)", [
            email,
          ]))
        )
          errors.push("На этот email уже зарегистрирован аккаунт.");
        if (!errors.length) {
          try {
            const u = await one(
              "INSERT INTO users(username,email,password) VALUES($1,$2,$3) RETURNING *",
              [username, email, await hashPassword(password)],
            );
            return loginResponse(u, next);
          } catch (e) {
            if (e.code === "23505") errors.push("Логин или email уже занят.");
            else throw e;
          }
        }
      } else {
        const u = await one("SELECT * FROM users WHERE username=$1", [
          username,
        ]);
        const password = String(form.get("password") || "");
        if (
          u &&
          password.length <= 1024 &&
          (await verifyPassword(password, u.password))
        )
          return loginResponse(u, next);
        errors.push("Неверный логин или пароль.");
      }
    }
    return page(`registration/${signup ? "signup" : "login"}.html`, {
      next,
      form: {
        errors: errors.length > 0,
        non_field_errors: errors,
        username: { value: username },
        email: { value: email },
      },
    });
  }
  if (path === "/accounts/logout") {
    requireMethod("POST");
    await query("DELETE FROM sessions WHERE token=$1", [
      hashToken(cookies(req).session || ""),
    ]);
    const res = redirect("/accounts/login/");
    res.headers.append("Set-Cookie", cookie("session", "", { maxAge: 0 }));
    return res;
  }
  const publicMatch = path.match(/^\/p\/([^/]+)(\/raw)?$/);
  if (publicMatch) {
    requireMethod("GET");
    const p = found(
      await one(
        "SELECT p.id,p.slug,s.title,s.html AS exported_html,s.published_at FROM projects p JOIN site_publications s ON s.project_id=p.id WHERE p.slug=$1",
        [decodeURIComponent(publicMatch[1])],
      ),
    );
    if (!publicMatch[2])
      return page("public_preview.html", { project: projectView(p) });
    const etag = `W/"site-${p.id}-${new Date(p.published_at).toISOString()}"`;
    const headers = {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      ETag: etag,
      "Content-Security-Policy":
        "sandbox allow-scripts allow-popups allow-forms allow-downloads; default-src 'none'; img-src * data: blob:; media-src * data: blob:; style-src 'unsafe-inline' *; font-src * data:; script-src 'unsafe-inline' 'unsafe-eval'; connect-src *; frame-src *",
    };
    if (
      p.exported_html &&
      (req.headers.get("if-none-match") || "")
        .split(",")
        .some(
          (t) =>
            t.trim() === "*" ||
            t.trim().replace(/^W\//, "") === etag.replace(/^W\//, ""),
        )
    )
      return new Response(null, { status: 304, headers });
    return new Response(
      p.exported_html ||
        '<!doctype html><meta charset="utf-8"><title>Страница не опубликована</title><p>Эта страница ещё не опубликована.</p>',
      { status: p.exported_html ? 200 : 404, headers },
    );
  }
  if (!user)
    return redirect(
      `/accounts/login/?next=${encodeURIComponent(url.pathname + url.search)}`,
    );
  if (path === "/") {
    requireMethod("GET");
    const q = (url.searchParams.get("q") || "").trim();
    const projects = await query(
      "SELECT p.*, EXISTS(SELECT 1 FROM site_publications s WHERE s.project_id=p.id) AS site_published FROM projects p WHERE owner_id=$1 AND (title ILIKE $2 OR slug ILIKE $2) ORDER BY updated_at DESC",
      [user.id, `%${q}%`],
    );
    const shared = await query(
      "SELECT p.project_id,p.snapshot->>'title' AS title FROM publications p JOIN members m ON m.project_id=p.project_id WHERE m.user_id=$1 ORDER BY p.published_at DESC",
      [user.id],
    );
    return page("dashboard.html", {
      projects: projects.map(projectView),
      query: q,
      project_data: Object.fromEntries(projects.map((p) => [p.id, p.data])),
      shared_apps: q ? [] : shared,
    });
  }
  if (path === "/new") {
    requireMethod("GET");
    const templates = (
      await query("SELECT * FROM templates ORDER BY sort_order,id")
    )
      .filter(
        (t) =>
          ![
            "crm",
            "erp",
            "builtin-crm",
            "builtin-erp",
            "app-crm",
            "app-erp",
          ].includes(t.slug),
      )
      .map((t) => ({ ...t, pk: t.id }));
    const builtin = JSON.parse(
      await readFile(resolve("data/business.json"), "utf8"),
    );
    return page("new_project.html", {
      templates,
      builtin_templates: [CRM_TEMPLATE, ...builtin.templates],
      template_data: {
        ...Object.fromEntries(templates.map((t) => [t.pk, t.data])),
        ...builtin.documents,
        [CRM_TEMPLATE.id]: crmDocument(),
      },
    });
  }
  if (path === "/projects/create") {
    requireMethod("POST");
    const template = String(form?.get("template") || "");
    if (template === CRM_TEMPLATE.id) {
      const id = await createCRM(
        user,
        String(form.get("title") || "CRM продаж")
          .trim()
          .slice(0, 200),
        form.get("demo_data") === "on",
      );
      return redirect(`/editor/${id}/`);
    }
    let title = String(form?.get("title") || "")
      .trim()
      .slice(0, 200);
    let data;
    if (template === "builtin-analytics")
      data = JSON.parse(await readFile(resolve("data/business.json"), "utf8"))
        .documents[template];
    else {
      const t = (await query("SELECT * FROM templates")).find(
        (t) =>
          String(t.id) === template &&
          ![
            "crm",
            "erp",
            "builtin-crm",
            "builtin-erp",
            "app-crm",
            "app-erp",
          ].includes(t.slug),
      );
      if (t) {
        data = t.data;
        title ||= t.title;
      }
    }
    title ||= data?.meta?.title || "Новый сайт";
    if (!data) data = blankDocument(title);
    try {
      validateDocument(data);
    } catch {
      data = blankDocument(title);
    }
    data.meta = { ...data.meta, title };
    data.settings = {
      ...data.settings,
      siteKey: data.settings?.siteKey || randomUUID(),
    };
    const p = await one(
      "INSERT INTO projects(owner_id,title,slug,data,updated_at) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [user.id, title, slug(title), data, new Date().toISOString()],
    );
    return redirect(`/editor/${p.id}/`);
  }
  let m = path.match(/^\/editor\/(\d+)$/);
  if (m) {
    requireMethod("GET");
    const p = await owned(m[1], user);
    return page("editor.html", {
      project: projectView(p),
      collection_schema: await schema(p.id),
    });
  }
  const lifecycleResponse = await lifecycle({
    path,
    method,
    payload,
    user,
    json,
    owned,
    requireMethod,
  });
  if (lifecycleResponse) return lifecycleResponse;
  m = path.match(/^\/api\/projects\/(\d+)(\/assets)?$/);
  if (m) {
    const p = await owned(m[1], user);
    if (m[2]) {
      requireMethod("POST");
      const file = form?.get("file");
      if (!file || typeof file.arrayBuffer !== "function")
        fail(400, "Файл не передан");
      if (file.size > 2 * 1024 * 1024) fail(400, "Файл больше 2 МБ");
      let buffer = Buffer.from(await file.arrayBuffer()),
        metadata;
      try {
        metadata = await sharp(buffer, {
          limitInputPixels: 40000000,
        }).metadata();
        await sharp(buffer, { limitInputPixels: 40000000 }).stats();
      } catch {
        fail(400, "Это не изображение");
      }
      const ext = { jpeg: "jpg", png: "png", webp: "webp", gif: "gif" }[
        metadata.format
      ];
      if (!ext) fail(400, "Поддерживаются JPEG, PNG, WebP и GIF");
      return transaction(async (db) => {
        await owned(p.id, user, db);
        if (
          (
            await one(
              "SELECT count(*)::int AS count FROM assets WHERE project_id=$1",
              [p.id],
              db,
            )
          ).count >= 200
        )
          fail(400, "Максимум 200 файлов");
        const name = `projects/${p.id}/${randomUUID()}.${ext}`;
        await mkdir(resolve(storage, "media", `projects/${p.id}`), {
          recursive: true,
        });
        await writeFile(resolve(storage, "media", name), buffer);
        try {
          const a = await one(
            "INSERT INTO assets(project_id,name,size,file) VALUES($1,$2,$3,$4) RETURNING *",
            [p.id, basename(file.name).slice(0, 255), file.size, name],
            db,
          );
          return json({
            id: a.id,
            name: a.name,
            size: a.size,
            url: `/media/${name}`,
          });
        } catch (e) {
          await rm(resolve(storage, "media", name), { force: true });
          throw e;
        }
      });
    }
    requireMethod("GET", "PUT");
    if (method === "GET")
      return json({
        id: p.id,
        title: p.title,
        slug: p.slug,
        data: p.data,
        updated_at: p.updated_at,
        assets: await assets(p.id),
      });
    if (!payload || Array.isArray(payload) || typeof payload !== "object")
      fail(400, "Ожидается объект");
    if (payload.data != null)
      try {
        validateDocument(payload.data);
      } catch (e) {
        fail(400, e.message);
      }
    const updated = await transaction(async (db) => {
      const current = await owned(p.id, user, db);
      // CAS and checkpoints share a transaction; a rejected save creates no version.
      const result = await one(
        "UPDATE projects SET data=COALESCE($1::jsonb,data),title=COALESCE($2,title),updated_at=$3 WHERE id=$4 AND owner_id=$5 AND ($6::text IS NULL OR updated_at=$6) RETURNING *",
        [
          payload.data ?? null,
          typeof payload.title === "string" && payload.title.trim()
            ? payload.title.trim().slice(0, 200)
            : null,
          nextVersion(current),
          p.id,
          user.id,
          typeof payload.base_updated_at === "string" && payload.base_updated_at
            ? payload.base_updated_at
            : null,
        ],
        db,
      );
      if (!result)
        fail(
          409,
          "Проект изменён в другой вкладке. Скачайте свою копию перед обновлением.",
        );
      await checkpoint(current, {}, db);
      return result;
    });
    return json({
      ok: true,
      updated_at: updated.updated_at,
      slug: p.slug,
      title: updated.title,
    });
  }
  m = path.match(/^\/projects\/(\d+)\/(export|duplicate|delete)$/);
  if (m) {
    const p = await owned(m[1], user);
    requireMethod(m[2] === "export" ? "GET" : "POST");
    if (m[2] === "export") {
      if (Object.keys(await schema(p.id)).length)
        fail(409, "Рабочее приложение запускается на сервере LamoFrame.");
      return new Response(await siteHTML(p), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="${p.slug}.html"`,
        },
      });
    }
    if (m[2] === "delete") {
      await query("DELETE FROM projects WHERE id=$1 AND owner_id=$2", [
        p.id,
        user.id,
      ]);
      await rm(resolve(storage, "media", "projects", String(p.id)), {
        recursive: true,
        force: true,
      });
      if (p.thumbnail)
        await rm(resolve(storage, "media", p.thumbnail), { force: true });
      return redirect("/");
    }
    const copied = [];
    try {
      return await transaction(async (db) => {
        const definition = await schema(p.id, db);
        const title = p.title.slice(0, 192) + " (копия)",
          doc = structuredClone(p.data);
        doc.meta = { ...doc.meta, title };
        doc.settings = { ...doc.settings, siteKey: randomUUID() };
        let html = Object.keys(definition).length ? "" : p.exported_html;
        const clone = await one(
          "INSERT INTO projects(owner_id,title,slug,data,updated_at) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [user.id, title, slug(title), doc, new Date().toISOString()],
          db,
        );
        const collectionMap = {},
          fieldMap = {};
        for (const [id, c] of Object.entries(definition))
          collectionMap[id] = (
            await one(
              "INSERT INTO collections(project_id,name) VALUES($1,$2) RETURNING id",
              [clone.id, c.name],
              db,
            )
          ).id;
        for (const [id, c] of Object.entries(definition))
          for (const f of c.fields)
            fieldMap[f.id] = String(
              (
                await one(
                  "INSERT INTO fields(collection_id,name,kind,required,options,target_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
                  [
                    collectionMap[id],
                    f.name,
                    f.kind,
                    f.required,
                    JSON.stringify(f.options),
                    collectionMap[f.target] || null,
                  ],
                  db,
                )
              ).id,
            );
        for (const b of bindings(doc)) {
          if (!collectionMap[b.collection]) {
            Object.keys(b).forEach((k) => delete b[k]);
            continue;
          }
          b.collection = String(collectionMap[b.collection]);
          for (const k of [
            "sortField",
            "filterField",
            "groupField",
            "valueField",
            "stageField",
            "titleField",
            "clientField",
            "dateField",
            "statusField",
          ])
            if (typeof b[k] === "string") b[k] = fieldMap[b[k]] || "";
          if (Array.isArray(b.columns))
            b.columns = b.columns.map((id) => fieldMap[id]).filter(Boolean);
        }
        const mapping = {};
        for (const a of await query(
          "SELECT * FROM assets WHERE project_id=$1",
          [p.id],
          db,
        )) {
          const name = `projects/${clone.id}/${randomUUID()}${extname(a.file)}`;
          await mkdir(resolve(storage, "media", `projects/${clone.id}`), {
            recursive: true,
          });
          const full = resolve(storage, "media", name);
          await writeFile(
            full,
            await readFile(resolve(storage, "media", a.file)),
          );
          copied.push(full);
          await query(
            "INSERT INTO assets(project_id,name,size,file) VALUES($1,$2,$3,$4)",
            [clone.id, a.name, a.size, name],
            db,
          );
          mapping[`/media/${a.file}`] = `/media/${name}`;
        }
        let thumbnail = "";
        if (p.thumbnail) {
          thumbnail = `projects/${clone.id}/thumbnail-${randomUUID()}${extname(p.thumbnail)}`;
          await mkdir(resolve(storage, "media", `projects/${clone.id}`), {
            recursive: true,
          });
          const full = resolve(storage, "media", thumbnail);
          await writeFile(
            full,
            await readFile(resolve(storage, "media", p.thumbnail)),
          );
          copied.push(full);
        }
        replaceUrls(doc, mapping);
        for (const [old, next] of Object.entries(mapping))
          html = html.replaceAll(escape(old), escape(next));
        await query(
          "UPDATE projects SET data=$1,exported_html=$2,thumbnail=$3 WHERE id=$4",
          [doc, html, thumbnail, clone.id],
          db,
        );
        return redirect(`/editor/${clone.id}/`);
      });
    } catch (e) {
      await Promise.all(copied.map((f) => rm(f, { force: true })));
      throw e;
    }
  }
  return applications({
    req,
    url,
    path,
    method,
    form,
    payload,
    user,
    page,
    requireMethod,
  });
}
async function applications({
  req,
  url,
  path,
  method,
  form,
  payload,
  user,
  page,
  requireMethod,
}) {
  let m = path.match(
    /^\/projects\/(\d+)\/application(?:\/(publish|collections)(?:\/(\d+)(?:\/(new|\d+))?)?)?$/,
  );
  if (m) {
    const p = await owned(m[1], user),
      project = projectView(p),
      id = p.id;
    if (!m[2]) {
      requireMethod("GET", "POST");
      let message = url.searchParams.get("message") || "";
      if (method === "POST") {
        try {
          await transaction(async (db) => {
            await owned(id, user, db);
            const action = form.get("action");
            if (action === "collection") {
              const name = String(form.get("name") || "").trim();
              if (!name || name.length > 100)
                fail(400, "Введите название коллекции (до 100 символов).");
              if (
                (
                  await one(
                    "SELECT count(*)::int AS n FROM collections WHERE project_id=$1",
                    [id],
                    db,
                  )
                ).n >= 15
              )
                fail(400, "Лимит коллекций: 15.");
              await query(
                "INSERT INTO collections(project_id,name) VALUES($1,$2)",
                [id, name],
                db,
              );
            } else if (action === "field") {
              const c = found(
                await one(
                  "SELECT * FROM collections WHERE project_id=$1 AND id=$2",
                  [id, form.get("collection")],
                  db,
                ),
              );
              const name = String(form.get("name") || "").trim(),
                kind = form.get("kind"),
                required = form.get("required") === "on";
              if (!name || name.length > 100 || !kinds[kind])
                fail(400, "Проверьте название и тип поля.");
              if (
                (
                  await one(
                    "SELECT count(*)::int AS n FROM fields WHERE collection_id=$1",
                    [c.id],
                    db,
                  )
                ).n >= 20
              )
                fail(400, "Лимит полей: 20.");
              const pub = await one(
                "SELECT * FROM publications WHERE project_id=$1",
                [id],
                db,
              );
              if (
                required &&
                (pub?.snapshot.collections[c.id] ||
                  (await one(
                    "SELECT id FROM records WHERE collection_id=$1 LIMIT 1",
                    [c.id],
                    db,
                  )))
              )
                fail(
                  400,
                  "В опубликованную коллекцию или коллекцию с записями можно добавлять только необязательные поля.",
                );
              const options =
                kind === "status"
                  ? [
                      ...new Set(
                        String(form.get("options") || "")
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      ),
                    ]
                  : [];
              if (kind === "status" && !options.length)
                fail(400, "Добавьте хотя бы один статус.");
              if (JSON.stringify(options).length > 1000)
                fail(400, "Слишком длинный список статусов.");
              const target =
                kind === "relation"
                  ? found(
                      await one(
                        "SELECT id FROM collections WHERE project_id=$1 AND id=$2",
                        [id, form.get("target") || 0],
                        db,
                      ),
                    ).id
                  : null;
              await query(
                "INSERT INTO fields(collection_id,name,kind,required,options,target_id) VALUES($1,$2,$3,$4,$5,$6)",
                [c.id, name, kind, required, JSON.stringify(options), target],
                db,
              );
            } else if (action === "field_options") {
              const field = found(
                await one(
                  "SELECT f.* FROM fields f JOIN collections c ON c.id=f.collection_id WHERE f.id=$1 AND c.project_id=$2 AND f.kind='status'",
                  [form.get("field"), id],
                  db,
                ),
              );
              const options = [
                ...new Set(
                  String(form.get("options") || "")
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                ),
              ];
              if (
                !options.length ||
                options.length > 20 ||
                options.some((v) => v.length > 100)
              )
                fail(
                  400,
                  "Укажите от 1 до 20 статусов длиной до 100 символов.",
                );
              const records = await query(
                "SELECT values FROM records WHERE collection_id=$1",
                [field.collection_id],
                db,
              );
              if (
                records.some(
                  (r) =>
                    r.values[field.id] && !options.includes(r.values[field.id]),
                )
              )
                fail(
                  400,
                  "Нельзя удалить статус, пока его используют записи. Сначала измените их этап.",
                );
              await query(
                "UPDATE fields SET options=$1 WHERE id=$2",
                [JSON.stringify(options), field.id],
                db,
              );
            } else if (action === "invite") {
              const role = form.get("role");
              if (!["editor", "viewer"].includes(role))
                fail(400, "Неизвестная роль");
              await query(
                "INSERT INTO invites(token,project_id,role,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
                [randomUUID(), id, role],
                db,
              );
            } else if (action === "revoke_invite")
              await query(
                "DELETE FROM invites WHERE token=$1 AND project_id=$2",
                [form.get("token"), id],
                db,
              );
            else if (action === "member_role") {
              const role = form.get("role");
              if (!["editor", "viewer"].includes(role))
                fail(400, "Неизвестная роль");
              found(
                await one(
                  "UPDATE members SET role=$1 WHERE id=$2 AND project_id=$3 RETURNING id",
                  [role, form.get("member"), id],
                  db,
                ),
              );
            } else if (action === "remove_member")
              found(
                await one(
                  "DELETE FROM members WHERE id=$1 AND project_id=$2 RETURNING id",
                  [form.get("member"), id],
                  db,
                ),
              );
            else fail(400, "Неизвестное действие");
          });
          return redirect(`/projects/${id}/application/`);
        } catch (e) {
          if (!e.status && e.code !== "23505") throw e;
          message =
            e.code === "23505" ? "Такое название уже существует." : e.message;
        }
      }
      const definitions = await schema(id);
      const collections = Object.entries(definitions).map(([cid, c]) => ({
        pk: cid,
        name: c.name,
        fields: {
          all: c.fields.map((f) => ({
            ...f,
            get_kind_display: kinds[f.kind],
            target: f.target ? definitions[f.target] : null,
          })),
        },
      }));
      const members = (
        await query(
          "SELECT m.*,u.username FROM members m JOIN users u ON u.id=m.user_id WHERE project_id=$1 ORDER BY m.id",
          [id],
        )
      ).map((m) => ({ ...m, pk: m.id, user: { username: m.username } }));
      const invites = (
        await query(
          "SELECT * FROM invites WHERE project_id=$1 AND used_at IS NULL AND expires_at>now() ORDER BY expires_at DESC",
          [id],
        )
      ).map((i) => ({ ...i, get_role_display: roleLabel(i.role) }));
      const publication = await one(
        "SELECT * FROM publications WHERE project_id=$1",
        [id],
      );
      return page("application/manage.html", {
        project,
        collections,
        members,
        invites,
        publication,
        messages: message ? [message] : [],
        roles: [
          ["editor", roleLabel("editor")],
          ["viewer", roleLabel("viewer")],
        ],
        collection_form: {
          as_p: control("name", "Название коллекции", { required: true }),
        },
        field_form: {
          as_p:
            control("name", "Название поля", { required: true }) +
            control("kind", "Тип поля", {
              required: true,
              options: Object.entries(kinds),
            }) +
            control("required", "Обязательное поле", { type: "checkbox" }) +
            control("options", "Статусы через запятую") +
            control("target", "Связанная коллекция", {
              options: collections.map((c) => [c.pk, c.name]),
            }),
        },
      });
    }
    if (m[2] === "publish") {
      requireMethod("POST");
      const message = await transaction(async (db) => {
        const current = await owned(id, user, db);
        if (form.get("version") !== current.updated_at)
          return "Черновик изменился. Проверьте сохранённую версию и повторите публикацию.";
        const definitions = await schema(id, db);
        const bound = [
          ...new Set(bindings(current.data).map((b) => b.collection)),
        ];
        if (
          !bound.length ||
          bound.some((key) => !definitions[key]?.fields.length)
        )
          return "Привяжите таблицу или форму к коллекции с полями и сохраните холст.";
        await query(
          "INSERT INTO publications(project_id,snapshot) VALUES($1,$2) ON CONFLICT(project_id) DO UPDATE SET snapshot=EXCLUDED.snapshot,published_at=now()",
          [
            id,
            {
              document: current.data,
              collections: Object.fromEntries(
                bound.map((k) => [k, definitions[k]]),
              ),
              title: current.title,
            },
          ],
          db,
        );
        return "Приложение опубликовано.";
      });
      return redirect(
        `/projects/${id}/application/?message=${encodeURIComponent(message)}`,
      );
    }
    if (m[2] === "collections" && m[3]) {
      const cid = m[3],
        c = found(
          await one("SELECT * FROM collections WHERE project_id=$1 AND id=$2", [
            id,
            cid,
          ]),
        ),
        definitions = await schema(id);
      if (m[4])
        return recordPage({
          project: p,
          actorId: user.id,
          role: "owner",
          definition: definitions[cid],
          collection: c,
          recordId: m[4] === "new" ? null : m[4],
          draft: true,
          method,
          form,
          page,
          requireMethod,
        });
      requireMethod("GET");
      const data = (
        await applicationData(id, { [cid]: definitions[cid] }, true)
      )[cid];
      return page("application/records.html", {
        project,
        collection: projectView(c),
        fields: data.fields,
        rows: data.rows.map((r) => ({
          id: r.id,
          cells: data.fields.map((f) => r.values[f.id]),
        })),
      });
    }
  }
  m = path.match(/^\/apps\/invite\/([a-f0-9-]+)$/i);
  if (m) {
    requireMethod("GET", "POST");
    const invite = found(
      await one(
        "SELECT i.*,p.title,p.owner_id FROM invites i JOIN projects p ON p.id=i.project_id WHERE token=$1 AND used_at IS NULL AND expires_at>now()",
        [m[1]],
      ),
    );
    if (method === "GET")
      return page("application/invite.html", {
        invite: {
          ...invite,
          project: { title: invite.title },
          get_role_display: roleLabel(invite.role),
        },
      });
    if (invite.owner_id === user.id)
      fail(403, "Владелец уже имеет доступ к приложению.");
    await transaction(async (db) => {
      const claimed = found(
        await one(
          "UPDATE invites SET used_at=now() WHERE token=$1 AND used_at IS NULL AND expires_at>now() RETURNING *",
          [m[1]],
          db,
        ),
      );
      await query(
        "INSERT INTO members(project_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO NOTHING",
        [claimed.project_id, user.id, claimed.role],
        db,
      );
    });
    return redirect(`/apps/${invite.project_id}/`);
  }
  const actionMatch = path.match(/^\/apps\/(\d+)\/mutate$/);
  if (actionMatch) {
    requireMethod("POST");
    const [project] = await access(actionMatch[1], user);
    return json(await mutateCRM(project, user, payload));
  }
  m = path.match(/^\/apps\/(\d+)(?:\/(data|records)(?:\/(\d+)\/(new|\d+))?)?$/);
  if (m) {
    const [p, role] = await access(m[1], user),
      publication = await one(
        "SELECT * FROM publications WHERE project_id=$1",
        [p.id],
      );
    if (!m[2]) {
      requireMethod("GET");
      return page("application/run.html", {
        project: projectView(p),
        role,
        publication,
      });
    }
    found(publication);
    if (m[2] === "data") {
      requireMethod("GET");
      return json({
        document: publication.snapshot.document,
        projectId: p.id,
        role,
        collections: await applicationData(
          p.id,
          publication.snapshot.collections,
          role !== "viewer",
        ),
      });
    }
    if (m[2] === "records" && m[3] && m[4]) {
      const c = found(
        await one("SELECT * FROM collections WHERE id=$1 AND project_id=$2", [
          m[3],
          p.id,
        ]),
      );
      return recordPage({
        project: p,
        actorId: user.id,
        returnPage: url.searchParams.get("page"),
        prefillField: url.searchParams.get("prefillField"),
        prefillRecord: url.searchParams.get("prefillRecord"),
        role,
        definition: found(publication.snapshot.collections[m[3]]),
        collection: c,
        recordId: m[4] === "new" ? null : m[4],
        draft: false,
        method,
        form,
        page,
        requireMethod,
        title: publication.snapshot.title,
      });
    }
  }
  if (path === "/admin" || path.startsWith("/admin/"))
    return adminPage({ path, method, form, user, page, redirect, fail });
  fail(404, "Страница не найдена");
}
async function recordPage({
  project,
  actorId,
  returnPage,
  prefillField,
  prefillRecord,
  role,
  definition,
  collection,
  recordId,
  draft,
  method,
  form,
  page,
  requireMethod,
  title,
}) {
  requireMethod("GET", "POST");
  if (!definition.fields.length) fail(404, "Добавьте поля в коллекцию.");
  const viewOnly = role === "viewer";
  if (viewOnly && (method === "POST" || !recordId))
    fail(403, "У вашей роли нет права менять записи.");
  let current = recordId
    ? found(
        await one("SELECT * FROM records WHERE id=$1 AND collection_id=$2", [
          recordId,
          collection.id,
        ]),
      )
    : null;
  const back = draft
    ? `/projects/${project.id}/application/collections/${collection.id}/`
    : `/apps/${project.id}/${/^page-[a-z0-9-]{1,100}$/.test(returnPage || "") ? "#" + returnPage : ""}`;
  let error = "";
  if (method === "POST") {
    try {
      await transaction(async (db) => {
        const def = draft
          ? (await schema(project.id, db))[collection.id]
          : definition;
        if (current && form.get("action") === "comment") {
          const body = String(form.get("comment") || "").trim();
          if (!body || body.length > 2000)
            fail(400, "Комментарий: от 1 до 2000 символов.");
          await recordEvent(db, current.id, actorId, "comment", body);
          return;
        }
        if (current && form.get("action") === "delete") {
          const latest = found(
            await one(
              "SELECT revision FROM records WHERE id=$1",
              [current.id],
              db,
            ),
          );
          if (Number(form.get("revision")) !== latest.revision)
            fail(409, "Запись изменена. Обновите карточку перед удалением.");
          await deleteRecord(db, project.id, collection.id, current.id);
          return;
        }
        const values = await validateRecord(project.id, def, form, db);
        if (current) {
          const latest = found(
            await one(
              "SELECT * FROM records WHERE id=$1 AND collection_id=$2",
              [current.id, collection.id],
              db,
            ),
          );
          if (
            form.get("revision") &&
            Number(form.get("revision")) !== latest.revision
          )
            fail(409, "Запись изменена другим участником. Обновите карточку.");
          const merged = { ...latest.values };
          for (const [key, value] of Object.entries(values))
            if (form.has(key)) merged[key] = value;
          completeDealDate(def, merged, Object.fromEntries(form));
          await query(
            "UPDATE records SET values=$1,updated_at=now(),revision=revision+1 WHERE id=$2",
            [merged, current.id],
            db,
          );
          await recordEvent(
            db,
            current.id,
            actorId,
            "updated",
            "Обновлена карточка записи",
          );
        } else {
          if (
            (
              await one(
                "SELECT count(*)::int AS n FROM records WHERE collection_id=$1",
                [collection.id],
                db,
              )
            ).n >= 200
          )
            fail(400, "Лимит записей: 200.");
          completeDealDate(def, values);
          const added = await one(
            "INSERT INTO records(collection_id,values) VALUES($1,$2) RETURNING id",
            [collection.id, values],
            db,
          );
          await recordEvent(db, added.id, actorId, "created", "Создана запись");
        }
      });
      return redirect(
        form.get("action") === "comment" && current
          ? draft
            ? `/projects/${project.id}/application/collections/${collection.id}/${current.id}/`
            : `/apps/${project.id}/records/${collection.id}/${current.id}/?page=${encodeURIComponent(returnPage || "")}`
          : back,
      );
    } catch (e) {
      if (e.code) throw e;
      error = e.message;
    }
  }
  const recordURL = (cid, rid) =>
    draft
      ? `/projects/${project.id}/application/collections/${cid}/${rid}/`
      : `/apps/${project.id}/records/${cid}/${rid}/`;
  const definitions = draft
    ? await schema(project.id)
    : (
        await one("SELECT snapshot FROM publications WHERE project_id=$1", [
          project.id,
        ])
      )?.snapshot.collections || {};
  const initialValues = {};
  if (
    !current &&
    method === "GET" &&
    prefillField &&
    /^\d+$/.test(prefillRecord || "")
  ) {
    const field = definition.fields.find(
      (f) => f.id === prefillField && f.kind === "relation",
    );
    if (
      field &&
      (await one(
        "SELECT r.id FROM records r JOIN collections c ON c.id=r.collection_id WHERE r.id=$1 AND c.id=$2 AND c.project_id=$3",
        [prefillRecord, field.target, project.id],
      ))
    )
      initialValues[prefillField] = prefillRecord;
  }
  const related = [];
  if (current) {
    for (const f of definition.fields.filter((f) => f.kind === "relation")) {
      const target = definitions[f.target];
      const rid = current.values[f.id];
      if (target && rid) {
        const row = await one(
          "SELECT * FROM records WHERE id=$1 AND collection_id=$2",
          [rid, f.target],
        );
        if (row)
          related.push({
            name: f.name,
            rows: [
              {
                url: recordURL(f.target, row.id),
                label:
                  row.values[
                    target.fields.find((x) => x.kind === "text")?.id
                  ] || "Запись №" + row.id,
              },
            ],
          });
      }
    }
    for (const [cid, c] of Object.entries(definitions))
      for (const f of c.fields.filter(
        (f) => f.kind === "relation" && f.target === String(collection.id),
      )) {
        const rows = await query(
          "SELECT * FROM records WHERE collection_id=$1 AND values->>$2=$3 ORDER BY id",
          [cid, f.id, String(current.id)],
        );
        if (rows.length || !viewOnly)
          related.push({
            name: c.name,
            createUrl: !viewOnly
              ? recordURL(cid, "new") +
                `?prefillField=${f.id}&prefillRecord=${current.id}`
              : "",
            rows: rows.map((row) => ({
              url: recordURL(cid, row.id),
              label:
                row.values[c.fields.find((x) => x.kind === "text")?.id] ||
                "Запись №" + row.id,
            })),
          });
      }
  }
  return page("application/record.html", {
    project: projectView(project),
    collection: projectView(collection),
    record: current,
    related,
    activity: current ? await recordActivity(current.id) : [],
    form: {
      as_p:
        (error
          ? `<p class="auth-error" role="alert">${escape(error)}</p>`
          : "") +
        (current
          ? `<input type="hidden" name="revision" value="${current.revision}">`
          : "") +
        (await recordForm(
          project.id,
          definition,
          form ? Object.fromEntries(form) : current?.values || initialValues,
          viewOnly,
        )),
    },
    draft,
    view_only: viewOnly,
    application_title: title || project.title,
    back_url: back,
  });
}
