import { migrate } from "./migrations.mjs";
import { PGlite } from "@electric-sql/pglite";
import { resolve } from "node:path";
import { readFile, mkdir } from "node:fs/promises";
export const storage = resolve(
  /* turbopackIgnore: true */ process.env.STORAGE_DIR || "./storage",
);
export async function database() {
  if (!globalThis.lamoDB)
    globalThis.lamoDB = (async () => {
      await mkdir(storage, { recursive: true });
      const db = new PGlite(resolve(storage, "pglite"));
      await db.exec(`
      CREATE TABLE IF NOT EXISTS templates (id SERIAL PRIMARY KEY, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '', data JSONB NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', password TEXT NOT NULL DEFAULT '', google_id TEXT UNIQUE, is_staff BOOLEAN NOT NULL DEFAULT FALSE);
      CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(lower(username));
      CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(lower(email)) WHERE email <> '';
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id SERIAL PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, title TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, data JSONB NOT NULL, exported_html TEXT NOT NULL DEFAULT '', thumbnail TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects ON DELETE CASCADE, name TEXT NOT NULL, size INTEGER NOT NULL, file TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE IF NOT EXISTS collections (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects ON DELETE CASCADE, name TEXT NOT NULL, UNIQUE(project_id,name));
      CREATE TABLE IF NOT EXISTS fields (id SERIAL PRIMARY KEY, collection_id INTEGER NOT NULL REFERENCES collections ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('text','number','date','status','relation')), required BOOLEAN NOT NULL DEFAULT FALSE, options JSONB NOT NULL DEFAULT '[]', target_id INTEGER REFERENCES collections ON DELETE SET NULL, UNIQUE(collection_id,name));
      CREATE TABLE IF NOT EXISTS records (id SERIAL PRIMARY KEY, collection_id INTEGER NOT NULL REFERENCES collections ON DELETE CASCADE, values JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE IF NOT EXISTS publications (project_id INTEGER PRIMARY KEY REFERENCES projects ON DELETE CASCADE, snapshot JSONB NOT NULL, published_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE IF NOT EXISTS members (id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('editor','viewer')), UNIQUE(project_id,user_id));
      CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('editor','viewer')), expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS oauth_states (token TEXT PRIMARY KEY, next_url TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
    `);
      await migrate(db);
      if (!(await db.query("SELECT id FROM templates LIMIT 1")).rows.length) {
        const fixtures = JSON.parse(
          await readFile(resolve("data/templates.json"), "utf8"),
        );
        await db.transaction(async (tx) => {
          for (const { pk, fields: f } of fixtures)
            await tx.query(
              "INSERT INTO templates(id,title,slug,description,preview,data,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
              [
                pk,
                f.title,
                f.slug,
                f.description || "",
                f.preview || "",
                f.data,
                f.sort_order || 0,
              ],
            );
          await tx.exec(
            "SELECT setval(pg_get_serial_sequence('templates','id'),COALESCE((SELECT max(id) FROM templates),0)+1,false)",
          );
        });
      }
      return db;
    })().catch((error) => {
      delete globalThis.lamoDB;
      throw error;
    });
  return globalThis.lamoDB;
}
export async function query(sql, params = [], db) {
  return (await (db || (await database())).query(sql, params)).rows;
}
export async function one(sql, params = [], db) {
  return (await query(sql, params, db))[0];
}
export function transaction(fn) {
  return database().then((db) => db.transaction(fn));
}
