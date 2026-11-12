import { query, one, transaction, storage } from "./db.mjs";
import { control, escape } from "./render.mjs";
import { validateDocument } from "./document.mjs";
import { hashPassword } from "./auth.mjs";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
export async function adminPage({
  path,
  method,
  form,
  user,
  page,
  redirect,
  fail,
}) {
  if (!user.is_staff) fail(403, "Доступно администратору.");
  if (!["GET", "POST"].includes(method)) fail(405, "Метод не поддерживается");
  const tables = {
    users: "Пользователи",
    projects: "Проекты",
    assets: "Изображения",
    templates: "Шаблоны",
  };
  const match = path.match(
    /^\/admin(?:\/(users|projects|assets|templates)(?:\/(new|\d+))?)?$/,
  );
  if (!match) fail(404, "Страница не найдена");
  const table = match[1],
    id = match[2],
    isNew = id === "new";
  let content = "<h1>Администрирование</h1>",
    message = "";
  const nav = Object.entries(tables)
    .map(
      ([key, title]) =>
        `<a class="btn btn-outline" href="/admin/${key}/">${title}</a>`,
    )
    .join(" ");
  if (!table)
    return page("admin.html", {
      content:
        content +
        `<p>Управление пользователями, проектами, файлами и шаблонами.</p>${nav}`,
    });
  let row =
    id && !isNew ? await one(`SELECT * FROM ${table} WHERE id=$1`, [id]) : {};
  if (!row) fail(404, "Объект не найден");
  if (method === "POST" && id) {
    try {
      if (form.get("action") === "delete") {
        if (table === "users" && Number(id) === user.id)
          fail(400, "Нельзя удалить свой аккаунт.");
        if (table === "assets") {
          await query("DELETE FROM assets WHERE id=$1", [id]);
          await rm(resolve(storage, "media", row.file), { force: true });
        } else if (table === "projects") {
          await query("DELETE FROM projects WHERE id=$1", [id]);
          await rm(resolve(storage, "media", "projects", id), {
            recursive: true,
            force: true,
          });
        } else await query(`DELETE FROM ${table} WHERE id=$1`, [id]);
        return redirect(`/admin/${table}/`);
      }
      const name = String(
        form.get(
          table === "users"
            ? "username"
            : table === "assets"
              ? "name"
              : "title",
        ) || "",
      ).trim();
      if (!name || name.length > 200) fail(400, "Введите название или логин.");
      if (table === "users") {
        const password = String(form.get("password") || "");
        if ((isNew || password) && password.length < 8)
          fail(400, "Пароль должен содержать минимум 8 символов.");
        const email = String(form.get("email") || "").trim(),
          staff = form.get("is_staff") === "on";
        if (Number(id) === user.id && !staff)
          fail(400, "Нельзя снять права администратора у себя.");
        if (isNew)
          await query(
            "INSERT INTO users(username,email,password,is_staff) VALUES($1,$2,$3,$4)",
            [name, email, await hashPassword(password), staff],
          );
        else {
          await query(
            "UPDATE users SET username=$1,email=$2,is_staff=$3 WHERE id=$4",
            [name, email, staff, id],
          );
          if (password) {
            await transaction(async (db) => {
              await query(
                "UPDATE users SET password=$1 WHERE id=$2",
                [await hashPassword(password), id],
                db,
              );
              await query("DELETE FROM sessions WHERE user_id=$1", [id], db);
            });
          }
        }
      } else if (table === "templates") {
        const data = JSON.parse(String(form.get("data") || "{}"));
        validateDocument(data);
        const slug = String(form.get("slug") || "").trim();
        if (!/^[a-z0-9_-]+$/i.test(slug))
          fail(400, "Введите slug латинскими буквами.");
        const args = [
          name,
          slug,
          String(form.get("description") || ""),
          data,
          Number(form.get("sort_order") || 0),
        ];
        if (!Number.isInteger(args[4]) || args[4] < 0)
          fail(400, "Некорректный порядок.");
        if (isNew)
          await query(
            "INSERT INTO templates(title,slug,description,data,sort_order) VALUES($1,$2,$3,$4,$5)",
            args,
          );
        else
          await query(
            "UPDATE templates SET title=$1,slug=$2,description=$3,data=$4,sort_order=$5 WHERE id=$6",
            [...args, id],
          );
      } else if (table === "projects") {
        if (isNew) fail(400, "Создайте проект в мастерской.");
        const data = JSON.parse(String(form.get("data")));
        validateDocument(data);
        const owner = await one("SELECT id FROM users WHERE id=$1", [
          form.get("owner_id"),
        ]);
        if (!owner) fail(400, "Владелец не найден.");
        await query(
          "UPDATE projects SET title=$1,owner_id=$2,data=$3,updated_at=$4 WHERE id=$5",
          [name, owner.id, data, new Date().toISOString(), id],
        );
      } else {
        if (isNew) fail(400, "Загрузите изображение в редакторе.");
        await query("UPDATE assets SET name=$1 WHERE id=$2", [name, id]);
      }
      return redirect(`/admin/${table}/`);
    } catch (e) {
      message =
        e.code === "23505" ? "Логин, email или slug уже занят." : e.message;
      row = { ...row, ...Object.fromEntries(form) };
    }
  }
  content = `<h1>${tables[table]}</h1><nav class="app-actions">${nav}</nav>`;
  if (!id) {
    const rows = await query(`SELECT * FROM ${table} ORDER BY id`);
    if (["users", "templates"].includes(table))
      content += `<p><a class="btn btn-primary" href="/admin/${table}/new/">Добавить</a></p>`;
    content +=
      "<ul>" +
      rows
        .map(
          (r) =>
            `<li><a class="text-link" href="/admin/${table}/${r.id}/">#${r.id} ${escape(r.title || r.username || r.name)}</a></li>`,
        )
        .join("") +
      "</ul>";
  } else {
    let fields = control(
      table === "users" ? "username" : table === "assets" ? "name" : "title",
      table === "users" ? "Логин" : "Название",
      { value: row.title || row.username || row.name || "", required: true },
    );
    if (table === "users")
      fields +=
        control("email", "Email", { type: "email", value: row.email }) +
        control("password", isNew ? "Пароль" : "Новый пароль (необязательно)", {
          type: "password",
          required: isNew,
        }) +
        `<p><label><input type="checkbox" name="is_staff" ${row.is_staff ? "checked" : ""}> Администратор</label></p>`;
    if (table === "templates")
      fields +=
        control("slug", "Slug", { value: row.slug, required: true }) +
        control("description", "Описание", { value: row.description }) +
        control("sort_order", "Порядок", {
          type: "number",
          value: row.sort_order || 0,
        });
    if (table === "projects")
      fields += control("owner_id", "ID владельца", {
        value: row.owner_id,
        type: "number",
        required: true,
      });
    if (["projects", "templates"].includes(table))
      fields += `<p><label for="data">Документ JSON</label><textarea class="input" style="width:100%;min-height:360px;font-family:monospace" name="data" id="data" required>${escape(typeof row.data === "string" ? row.data : JSON.stringify(row.data || { version: 3, pages: [] }, null, 2))}</textarea></p>`;
    content += `${message ? `<p class="auth-error">${escape(message)}</p>` : ""}<form method="post" class="app-form"><input type="hidden" name="csrfmiddlewaretoken" value="__ADMIN_CSRF__">${fields}<div class="app-actions"><button class="btn btn-primary">Сохранить</button>${!isNew ? '<button class="btn btn-outline" name="action" value="delete">Удалить</button>' : ""}</div></form>`;
  }
  // Page renders escaped application data above; substitute only the generated CSRF placeholder.
  return page("admin.html", { content });
}
