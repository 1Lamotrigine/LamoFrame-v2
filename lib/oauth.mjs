import { query, one, transaction } from "./db.mjs";
import { token, cookie, cookies, safeNext, hashToken } from "./auth.mjs";
export async function oauth(
  req,
  { form, page, loginResponse, redirect, fail },
) {
  const url = new URL(req.url),
    callback = url.pathname.includes("callback"),
    enabled = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;
  if (!enabled) return redirect("/accounts/login/");
  const callbackUrl = `${process.env.APP_URL || url.origin}/accounts/google/login/callback/`;
  if (!callback) {
    if (req.method !== "POST")
      fail(405, "Для входа используйте кнопку Google.");
    const state = token();
    await query(
      "INSERT INTO oauth_states(token,next_url,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
      [hashToken(state), safeNext(form?.get("next"))],
    );
    const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    target.search = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: callbackUrl,
      response_type: "code",
      scope: "openid email profile",
      state,
    }).toString();
    const res = redirect(target.href);
    res.headers.append(
      "Set-Cookie",
      cookie("oauth_state", state, { maxAge: 600 }),
    );
    return res;
  }
  if (req.method !== "GET") fail(405, "Метод не поддерживается");
  const state = url.searchParams.get("state");
  if (!state || state !== cookies(req).oauth_state)
    fail(400, "Не удалось проверить вход Google.");
  const saved = await one(
    "DELETE FROM oauth_states WHERE token=$1 AND expires_at>now() RETURNING *",
    [hashToken(state)],
  );
  if (!saved || !url.searchParams.get("code"))
    fail(400, "Вход Google отменён или ссылка истекла.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      code: url.searchParams.get("code"),
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) fail(400, "Не удалось войти через Google.");
  const tokens = await response.json();
  const infoResponse = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!infoResponse.ok) fail(400, "Не удалось получить профиль Google.");
  const info = await infoResponse.json();
  if (!info.sub || !info.email_verified || !info.email)
    fail(400, "Google не подтвердил email.");
  const user = await transaction(async (db) => {
    const existing = await one(
      "SELECT * FROM users WHERE google_id=$1",
      [info.sub],
      db,
    );
    if (existing) return existing;
    if (
      await one(
        "SELECT id FROM users WHERE lower(email)=lower($1)",
        [info.email],
        db,
      )
    )
      fail(409, "Этот email уже используется. Войдите с паролем.");
    let base =
      info.email
        .split("@")[0]
        .replace(/[^a-zA-Z0-9_.-]/g, "")
        .slice(0, 120) || "user";
    if (["admin", "root", "system", "support"].includes(base)) base += "-user";
    let username = base,
      n = 1;
    while (
      await one(
        "SELECT id FROM users WHERE lower(username)=lower($1)",
        [username],
        db,
      )
    )
      username = `${base}-${++n}`;
    return one(
      "INSERT INTO users(username,email,google_id) VALUES($1,$2,$3) RETURNING *",
      [username, info.email, info.sub],
      db,
    );
  });
  const res = await loginResponse(user, saved.next_url);
  res.headers.append("Set-Cookie", cookie("oauth_state", "", { maxAge: 0 }));
  return res;
}
