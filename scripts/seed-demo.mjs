import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { one, query, database } from "../lib/db.mjs";
import { hashPassword } from "../lib/auth.mjs";
import { slug } from "../lib/document.mjs";
async function create(username, email, password, staff = false) {
  let user = await one("SELECT * FROM users WHERE lower(username)=lower($1)", [
    username,
  ]);
  if (user) {
    console.log(`${username}: уже существует, пароль сохранён`);
    return user;
  }
  user = await one(
    "INSERT INTO users(username,email,password,is_staff) VALUES($1,$2,$3,$4) RETURNING *",
    [username, email, await hashPassword(password), staff],
  );
  console.log(`${username}: создан${staff ? "" : ` / ${password}`}`);
  return user;
}
const password =
  process.env.DEMO_PASSWORD || randomBytes(12).toString("base64url");
const demo = await create("demo", "demo@example.com", password);
if (!(await one("SELECT id FROM projects WHERE owner_id=$1", [demo.id]))) {
  const t = await one("SELECT * FROM templates WHERE slug='landing'");
  if (t) {
    const data = structuredClone(t.data);
    data.meta.title = "Аврора — лендинг";
    await query(
      "INSERT INTO projects(owner_id,title,slug,data,updated_at) VALUES($1,$2,$3,$4,$5)",
      [
        demo.id,
        data.meta.title,
        slug(data.meta.title),
        data,
        new Date().toISOString(),
      ],
    );
  }
}
if (process.env.ADMIN_PASSWORD)
  await create("admin", "admin@example.com", process.env.ADMIN_PASSWORD, true);
await (await database()).close();
