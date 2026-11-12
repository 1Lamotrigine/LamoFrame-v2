import { connect } from "./connection.mjs";
import { INITIAL_SCHEMA } from "../lib/schema.mjs";
import { migrate } from "../lib/migrations.mjs";
import { assets } from "local:assets";
export const storage = "/storage";
let pending;
let activeTransaction;
export async function database() {
  if (!pending)
    pending = (async () => {
      if (!navigator.locks)
        throw Error(
          "Этот браузер не поддерживает безопасную работу с локальной базой. Откройте сайт в актуальном Chrome, Edge или Firefox.",
        );
      const db = await connect();
      await navigator.locks.request("lamoframe-browser-schema", async () => {
        await db.exec(INITIAL_SCHEMA);
        await migrate(db);
        await db.exec(
          `CREATE TABLE IF NOT EXISTS local_files(name TEXT PRIMARY KEY,content BYTEA NOT NULL);`,
        );
        if (!(await db.query("SELECT id FROM templates LIMIT 1")).rows.length) {
          await db.transaction(async (tx) => {
            for (const { pk, fields: f } of JSON.parse(
              assets["data/templates.json"],
            ))
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
      });
      return db;
    })().catch((e) => {
      pending = null;
      throw e;
    });
  return pending;
}
export async function query(sql, params = [], db) {
  return (
    await (db || activeTransaction || (await database())).query(sql, params)
  ).rows;
}
export async function one(sql, params = [], db) {
  return (await query(sql, params, db))[0];
}
export async function transaction(fn) {
  if (activeTransaction) return fn(activeTransaction);
  const db = await database();
  return db.transaction(async (tx) => {
    activeTransaction = tx;
    try {
      return await fn(tx);
    } finally {
      activeTransaction = null;
    }
  });
}
