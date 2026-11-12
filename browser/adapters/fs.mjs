import { assets, modules } from "local:assets";
import { query, one } from "../db.mjs";
export function readdirSync() {
  return modules;
}
export async function mkdir() {}
export async function readFile(path, encoding) {
  const key = String(path).replace(/^\//, "");
  if (Object.hasOwn(assets, key))
    return encoding ? assets[key] : Buffer.from(assets[key]);
  const name = String(path).replace(/^\/storage\/media\//, "");
  const row = await one("SELECT content FROM local_files WHERE name=$1", [
    name,
  ]);
  if (!row) throw Object.assign(Error("Файл не найден"), { code: "ENOENT" });
  return encoding
    ? Buffer.from(row.content).toString(encoding)
    : Buffer.from(row.content);
}
export async function writeFile(path, bytes) {
  const name = String(path).replace(/^\/storage\/media\//, "");
  if (name === String(path)) throw Error("Недопустимый путь файла");
  await query(
    "INSERT INTO local_files(name,content) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET content=EXCLUDED.content",
    [name, bytes],
  );
}
export async function rm(path, { recursive = false } = {}) {
  const name = String(path).replace(/^\/storage\/media\//, "");
  if (recursive)
    await query(
      "DELETE FROM local_files WHERE name=$1 OR starts_with(name,$2)",
      [name, name + "/"],
    );
  else await query("DELETE FROM local_files WHERE name=$1", [name]);
}
