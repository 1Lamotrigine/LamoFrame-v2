import { database, query, transaction } from "./db.mjs";
import { validateDocument } from "../lib/document.mjs";
const tables = [
  "users",
  "templates",
  "projects",
  "assets",
  "collections",
  "fields",
  "records",
  "publications",
  "site_publications",
  "project_versions",
  "record_events",
  "local_files",
];
export async function exportWorkspace() {
  return transaction(async (db) => {
    const data = {};
    for (const name of tables) {
      data[name] = await query("SELECT * FROM " + name, [], db);
      if (name === "users")
        data[name] = data[name].map(({ password, google_id, ...row }) => ({
          ...row,
          password: "",
          google_id: null,
        }));
      if (name === "local_files")
        data[name] = data[name].map((row) => ({
          ...row,
          content: Buffer.from(row.content).toString("base64"),
        }));
    }
    return {
      format: "lamoframe-workspace",
      version: 1,
      createdAt: new Date().toISOString(),
      data,
    };
  });
}
export async function importWorkspace(backup) {
  if (
    !backup ||
    backup.format !== "lamoframe-workspace" ||
    backup.version !== 1 ||
    !backup.data ||
    tables.some((name) => !Array.isArray(backup.data[name]))
  )
    throw Error("Это не резервная копия мастерской LamoFrame.");
  if (tables.some((name) => backup.data[name].length > 200000))
    throw Error("Слишком большая резервная копия.");
  for (const p of backup.data.projects) validateDocument(p.data);
  return transaction(async (db) => {
    const columns = await query(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1)",
      [tables],
      db,
    );
    const allowed = Object.fromEntries(
      tables.map((name) => [
        name,
        new Set(
          columns
            .filter((c) => c.table_name === name)
            .map((c) => c.column_name),
        ),
      ]),
    );
    await db.exec(
      "DELETE FROM invites;DELETE FROM members;DELETE FROM sessions;DELETE FROM oauth_states;",
    );
    for (const name of [...tables].reverse())
      await db.exec("DELETE FROM " + name);
    for (const name of tables)
      for (const raw of backup.data[name]) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw Error("Повреждена запись резервной копии.");
        const row = { ...raw };
        if (name === "users") {
          row.password = "";
          row.google_id = null;
          row.is_staff = false;
        }
        if (name === "local_files") {
          if (
            typeof row.content !== "string" ||
            !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
              row.content,
            )
          )
            throw Error("Повреждено изображение в резервной копии.");
          row.content = Buffer.from(row.content, "base64");
        }
        const keys = Object.keys(row);
        if (!keys.length || keys.some((k) => !allowed[name].has(k)))
          throw Error("Неизвестное поле резервной копии.");
        const values = keys.map((k) =>
          ["data", "values", "options", "snapshot"].includes(k)
            ? JSON.stringify(row[k])
            : row[k],
        );
        await db.query(
          `INSERT INTO ${name}(${keys.map((k) => '"' + k + '"').join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
          values,
        );
      }
    for (const name of tables.filter(
      (t) => !["publications", "site_publications", "local_files"].includes(t),
    ))
      await db.exec(
        `SELECT setval(pg_get_serial_sequence('${name}','id'),COALESCE((SELECT max(id) FROM ${name}),0)+1,false)`,
      );
    return true;
  });
}
