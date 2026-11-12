import { INITIAL_SCHEMA } from "./schema.mjs";
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
      await db.exec(INITIAL_SCHEMA);
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
