import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { one, query, transaction, storage } from "./db.mjs";
import {
  renderDocument,
  collectImageUrls,
} from "../public/static/js/render.js";
const problem = (status, message) => {
  throw Object.assign(Error(message), { status });
};
export const nextVersion = (p) =>
  new Date(Math.max(Date.now(), Date.parse(p.updated_at) + 1)).toISOString();
export async function checkpoint(
  p,
  { label = "", automatic = true, force = false } = {},
  db,
) {
  if (automatic && !force) {
    const last = await one(
      "SELECT * FROM project_versions WHERE project_id=$1 AND automatic=true ORDER BY id DESC LIMIT 1",
      [p.id],
      db,
    );
    if (
      last &&
      (last.source_version === p.updated_at ||
        Date.now() - new Date(last.created_at).getTime() < 60000)
    )
      return;
  }
  if (
    !automatic &&
    (
      await one(
        "SELECT count(*)::int AS n FROM project_versions WHERE project_id=$1 AND automatic=false",
        [p.id],
        db,
      )
    ).n >= 50
  )
    problem(400, "Сохранено 50 именованных версий. Удалите ненужную версию.");
  const v = await one(
    "INSERT INTO project_versions(project_id,title,label,data,source_version,automatic) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
    [p.id, p.title, label, p.data, p.updated_at, automatic],
    db,
  );
  await query(
    "DELETE FROM project_versions WHERE project_id=$1 AND automatic=true AND id NOT IN (SELECT id FROM project_versions WHERE project_id=$1 AND automatic=true ORDER BY id DESC LIMIT 30)",
    [p.id],
    db,
  );
  return v;
}
export async function siteHTML(p) {
  const inlineImages = new Map();
  const assets = await query("SELECT file FROM assets WHERE project_id=$1", [
    p.id,
  ]);
  const allowed = new Set(assets.map((a) => `/media/${a.file}`));
  for (const url of collectImageUrls(p.data)) {
    if (!allowed.has(url)) continue;
    const file = url.slice("/media/".length),
      ext = file.split(".").pop().toLowerCase();
    const mime = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
    }[ext];
    if (mime) {
      try {
        inlineImages.set(
          url,
          `data:${mime};base64,${(await readFile(resolve(storage, "media", file))).toString("base64")}`,
        );
      } catch {
        problem(
          409,
          "Не найдено изображение проекта. Загрузите его повторно перед публикацией.",
        );
      }
    }
  }
  const doc = structuredClone(p.data);
  doc.meta = { ...doc.meta, title: p.title };
  const html = renderDocument(doc, { inlineImages });
  if (Buffer.byteLength(html) > 12 * 1024 * 1024)
    problem(
      413,
      "HTML больше 12 МБ. Уменьшите изображения. Черновик сохранён независимо от публикации.",
    );
  return html;
}
export async function lifecycle({
  path,
  method,
  payload,
  user,
  json,
  owned,
  requireMethod,
}) {
  const m = path.match(
    /^\/api\/projects\/(\d+)\/(publication|versions)(?:\/(\d+)(\/restore)?)?$/,
  );
  if (!m) return null;
  const p = await owned(m[1], user);
  if (m[2] === "publication") {
    if (m[3]) problem(404, "Страница не найдена");
    requireMethod("GET", "POST", "DELETE");
    if (method === "GET")
      return json({
        publication:
          (await one(
            "SELECT title,source_version,published_at FROM site_publications WHERE project_id=$1",
            [p.id],
          )) || null,
      });
    if (method === "DELETE") {
      await query("DELETE FROM site_publications WHERE project_id=$1", [p.id]);
      return json({ ok: true });
    }
    if (
      await one("SELECT id FROM collections WHERE project_id=$1 LIMIT 1", [
        p.id,
      ])
    )
      problem(
        409,
        "Публикация приложения доступна в разделе «Данные и доступ».",
      );
    if (payload?.base_updated_at !== p.updated_at)
      problem(409, "Черновик изменился. Сохраните и повторите публикацию.");
    const html = await siteHTML(p);
    return transaction(async (db) => {
      const current = await one(
        "SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [p.id, user.id],
        db,
      );
      if (!current || current.updated_at !== p.updated_at)
        problem(
          409,
          "Черновик изменился во время публикации. Повторите действие.",
        );
      if (
        await one(
          "SELECT id FROM collections WHERE project_id=$1 LIMIT 1",
          [p.id],
          db,
        )
      )
        problem(
          409,
          "В проект добавлены коллекции. Опубликуйте его как приложение.",
        );
      await query(
        "INSERT INTO site_publications(project_id,title,html,source_version) VALUES($1,$2,$3,$4) ON CONFLICT(project_id) DO UPDATE SET title=EXCLUDED.title,html=EXCLUDED.html,source_version=EXCLUDED.source_version,published_at=now()",
        [p.id, p.title, html, p.updated_at],
        db,
      );
      return json({
        ok: true,
        url: `/p/${p.slug}/`,
        source_version: p.updated_at,
      });
    });
  }
  requireMethod("GET", "POST", "DELETE");
  if (!m[3]) {
    if (method === "GET")
      return json({
        versions: await query(
          "SELECT id,title,label,automatic,source_version,created_at FROM project_versions WHERE project_id=$1 ORDER BY id DESC",
          [p.id],
        ),
      });
    requireMethod("POST");
    const label = String(payload?.label || "").trim();
    if (!label || label.length > 100)
      problem(400, "Введите название версии (до 100 символов).");
    return transaction(async (db) => {
      const current = await one(
        "SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [p.id, user.id],
        db,
      );
      if (!current) problem(404, "Проект не найден");
      if (payload?.base_updated_at !== current.updated_at)
        problem(
          409,
          "Черновик изменился. Сохраните его перед созданием версии.",
        );
      return json({
        ok: true,
        ...(await checkpoint(current, { label, automatic: false }, db)),
      });
    });
  }
  if (m[4]) {
    requireMethod("POST");
    return transaction(async (db) => {
      const current = await one(
        "SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [p.id, user.id],
        db,
      );
      if (!current) problem(404, "Проект не найден");
      if (payload?.base_updated_at !== current.updated_at)
        problem(
          409,
          "Проект изменён в другой вкладке. Скачайте свою копию перед обновлением.",
        );
      const version = await one(
        "SELECT * FROM project_versions WHERE id=$1 AND project_id=$2",
        [m[3], p.id],
        db,
      );
      if (!version) problem(404, "Версия не найдена");
      // Preserve a safety copy before replacing the draft. Public snapshots are unchanged.
      await checkpoint(
        current,
        { label: "Перед восстановлением", force: true },
        db,
      );
      const updated = await one(
        "UPDATE projects SET data=$1,title=$2,exported_html='',updated_at=$3 WHERE id=$4 RETURNING *",
        [version.data, version.title, nextVersion(current), p.id],
        db,
      );
      return json({
        ok: true,
        data: updated.data,
        title: updated.title,
        updated_at: updated.updated_at,
      });
    });
  }
  if (method === "DELETE") {
    await query("DELETE FROM project_versions WHERE id=$1 AND project_id=$2", [
      m[3],
      p.id,
    ]);
    return json({ ok: true });
  }
  requireMethod("GET");
  const v = await one(
    "SELECT * FROM project_versions WHERE id=$1 AND project_id=$2",
    [m[3], p.id],
  );
  if (!v) problem(404, "Версия не найдена");
  return json(v);
}
