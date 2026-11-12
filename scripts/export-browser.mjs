// One-time conversion from the previous server-side PGlite installation.
// This output is private data and must never be copied into public/ or Git.
import { database, query, transaction, storage } from "../lib/db.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
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
];
try {
  const backup = await transaction(async (db) => {
    const data = {};
    for (const name of tables)
      data[name] = await query("SELECT * FROM " + name, [], db);
    data.users = data.users.map(({ password, google_id, ...row }) => ({
      ...row,
      password: "",
      google_id: null,
      is_staff: false,
    }));
    const names = new Set([
      ...data.assets.map((a) => a.file),
      ...data.projects.map((p) => p.thumbnail).filter(Boolean),
    ]);
    data.local_files = [];
    for (const name of names)
      data.local_files.push({
        name,
        content: (await readFile(resolve(storage, "media", name))).toString(
          "base64",
        ),
      });
    return {
      format: "lamoframe-workspace",
      version: 1,
      createdAt: new Date().toISOString(),
      data,
    };
  });
  const output = resolve(
    process.argv[2] || resolve(storage, "browser-workspace.json"),
  );
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify(backup));
  console.log("Создана копия для импорта в браузер:", output);
  console.log(
    "Профилей:",
    backup.data.users.length,
    "проектов:",
    backup.data.projects.length,
  );
} finally {
  await (await database()).close();
}
