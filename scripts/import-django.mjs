import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, dirname } from "node:path";
import { cp, mkdir, access } from "node:fs/promises";
import { database, query, one, transaction, storage } from "../lib/db.mjs";
const file = resolve(process.argv[2] || "../app/db.sqlite3");
const { stdout } = await promisify(execFile)(
  "python3",
  [resolve("scripts/export-sqlite.py"), file],
  { maxBuffer: 128 * 1024 * 1024 },
);
const source = JSON.parse(stdout);
// Import once into an empty target; never overwrite existing Next.js users or projects.
if (
  (await one("SELECT count(*)::int AS n FROM users")).n ||
  (await one("SELECT count(*)::int AS n FROM projects")).n
)
  throw Error(
    "Целевая база не пустая. Импорт отменён; существующие данные сохранены.",
  );
const media = resolve(dirname(file), "media");
try {
  await access(media);
  await mkdir(resolve(storage, "media"), { recursive: true });
  await cp(media, resolve(storage, "media"), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await transaction(async (db) => {
  await query("DELETE FROM templates", [], db);
  for (const t of source.builder_template)
    await query(
      "INSERT INTO templates(id,title,slug,description,preview,data,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [t.id, t.title, t.slug, t.description, t.preview, t.data, t.sort_order],
      db,
    );
  for (const u of source.auth_user)
    await query(
      "INSERT INTO users(id,username,email,password,is_staff) VALUES($1,$2,$3,$4,$5)",
      [u.id, u.username, u.email, u.password, !!u.is_staff],
      db,
    );
  for (const a of source.socialaccount_socialaccount)
    if (a.provider === "google")
      await query(
        "UPDATE users SET google_id=$1 WHERE id=$2",
        [a.uid, a.user_id],
        db,
      );
  for (const p of source.builder_project)
    await query(
      "INSERT INTO projects(id,owner_id,title,slug,data,exported_html,thumbnail,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        p.id,
        p.owner_id,
        p.title,
        p.slug,
        JSON.parse(p.data),
        p.exported_html,
        p.thumbnail,
        p.created_at,
        new Date(p.updated_at + "Z").toISOString(),
      ],
      db,
    );
  for (const a of source.builder_asset)
    await query(
      "INSERT INTO assets(id,project_id,name,size,file,created_at) VALUES($1,$2,$3,$4,$5,$6)",
      [a.id, a.project_id, a.name, a.size, a.file, a.created_at],
      db,
    );
  for (const c of source.builder_datacollection)
    await query(
      "INSERT INTO collections(id,project_id,name) VALUES($1,$2,$3)",
      [c.id, c.project_id, c.name],
      db,
    );
  for (const f of source.builder_collectionfield)
    await query(
      "INSERT INTO fields(id,collection_id,name,kind,required,options,target_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        f.id,
        f.collection_id,
        f.name,
        f.kind,
        !!f.required,
        f.options,
        f.target_id,
      ],
      db,
    );
  for (const r of source.builder_datarecord)
    await query(
      "INSERT INTO records(id,collection_id,values,updated_at) VALUES($1,$2,$3,$4)",
      [r.id, r.collection_id, r.values, r.updated_at],
      db,
    );
  for (const p of source.builder_apppublication)
    await query(
      "INSERT INTO publications(project_id,snapshot,published_at) VALUES($1,$2,$3)",
      [p.project_id, p.snapshot, p.published_at],
      db,
    );
  for (const m of source.builder_appmember)
    await query(
      "INSERT INTO members(id,project_id,user_id,role) VALUES($1,$2,$3,$4)",
      [m.id, m.project_id, m.user_id, m.role],
      db,
    );
  for (const i of source.builder_appinvite)
    await query(
      "INSERT INTO invites(token,project_id,role,expires_at,used_at) VALUES($1,$2,$3,$4,$5)",
      [
        i.token.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"),
        i.project_id,
        i.role,
        i.expires_at,
        i.used_at,
      ],
      db,
    );
  for (const table of [
    "templates",
    "users",
    "projects",
    "assets",
    "collections",
    "fields",
    "records",
    "members",
  ])
    await db.exec(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT max(id) FROM ${table}),0)+1, false)`,
    );
});
console.log(
  "Импорт завершён:",
  source.auth_user.length,
  "пользователей,",
  source.builder_project.length,
  "проектов. Пароли PBKDF2 сохранены; потребуется повторный вход.",
);
await (await database()).close();
