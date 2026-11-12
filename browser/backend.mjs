import { handle as originalHandle } from "../lib/server.mjs";
import { query, one, database } from "./db.mjs";
import { render } from "./render.mjs";
const redirect = (path) =>
  new Response(null, { status: 303, headers: { Location: path } });
const html = (name, context = {}) =>
  new Response(render(name, context), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
export async function handle(req) {
  const path = new URL(req.url).pathname.replace(/\/$/, "") || "/";
  const current = await one("SELECT * FROM users WHERE id=$1", [
    Number(req.headers.get("x-local-profile")) || 0,
  ]);
  if (path === "/local/backup")
    return html("local-backup.html", { user: current });
  if (path === "/accounts/logout")
    return new Response(null, {
      status: 303,
      headers: { Location: "/accounts/login/", "X-Local-Profile": "" },
    });
  if (["/accounts/login", "/accounts/signup"].includes(path)) {
    let message = "";
    if (req.method === "POST") {
      const form = await req.formData();
      if (path.endsWith("signup")) {
        const name = String(form.get("username") || "").trim();
        if (!name || name.length > 100)
          message = "Введите имя длиной до 100 символов.";
        else
          try {
            const user = await one(
              "INSERT INTO users(username) VALUES($1) RETURNING id",
              [name],
            );
            return new Response(null, {
              status: 303,
              headers: { Location: "/", "X-Local-Profile": String(user.id) },
            });
          } catch (e) {
            if (e.code === "23505")
              message =
                "Такой локальный профиль уже существует. Выберите его ниже.";
            else throw e;
          }
      } else {
        const user = await one("SELECT id FROM users WHERE id=$1", [
          Number(form.get("profile")) || 0,
        ]);
        if (user)
          return new Response(null, {
            status: 303,
            headers: { Location: "/", "X-Local-Profile": String(user.id) },
          });
        message = "Выберите существующий профиль.";
      }
    }
    return html("local-profile.html", {
      profiles: await query("SELECT id,username FROM users ORDER BY id"),
      message,
    });
  }
  if (
    path.startsWith("/accounts/google") ||
    path.startsWith("/apps/invite") ||
    path.startsWith("/admin")
  )
    return html("error.html", {
      status: 404,
      message:
        "В локальной версии нет общих аккаунтов, приглашений и серверной админки.",
    });
  if (req.method === "POST" && /^\/projects\/\d+\/application$/.test(path)) {
    const form = await req.clone().formData();
    if (
      ["invite", "revoke_invite", "member_role", "remove_member"].includes(
        form.get("action"),
      )
    )
      return Response.json(
        { error: "Совместная работа в локальном режиме недоступна." },
        { status: 400 },
      );
  }
  return originalHandle(req);
}
