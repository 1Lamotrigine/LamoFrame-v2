import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  pbkdf2 as pbkdf2Callback,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { one, query } from "./db.mjs";
const scrypt = promisify(scryptCallback),
  pbkdf2 = promisify(pbkdf2Callback);
export const token = () => randomBytes(32).toString("hex");
export const hashToken = (t) => createHash("sha256").update(t).digest("hex");
export function cookies(req) {
  return Object.fromEntries(
    (req.headers.get("cookie") || "")
      .split(";")
      .map((x) => x.trim().split(/=(.*)/s))
      .filter((x) => x[0]),
  );
}
export async function hashPassword(password) {
  const salt = token();
  return `scrypt$${salt}$${(await scrypt(password, salt, 64)).toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
  const [algorithm, saltOrIterations, hashOrSalt, hash] = encoded.split("$");
  let actual, expected;
  if (algorithm === "scrypt") {
    actual = await scrypt(password, saltOrIterations, 64);
    expected = Buffer.from(hashOrSalt, "hex");
  } else if (
    algorithm === "pbkdf2_sha256" &&
    Number(saltOrIterations) <= 2000000
  ) {
    actual = await pbkdf2(
      password,
      hashOrSalt,
      Number(saltOrIterations),
      32,
      "sha256",
    );
    expected = Buffer.from(hash, "base64");
  } else return false;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function userFor(req) {
  const t = cookies(req).session;
  if (!t) return null;
  return one(
    "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=$1 AND s.expires_at>now()",
    [hashToken(t)],
  );
}
export async function createSession(userId) {
  const t = token();
  await query(
    "INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,now()+interval '14 days')",
    [hashToken(t), userId],
  );
  return t;
}
export function cookie(
  name,
  value,
  { httpOnly = true, maxAge = 1209600 } = {},
) {
  return `${name}=${value}; Path=/; SameSite=Lax; Max-Age=${maxAge}${httpOnly ? "; HttpOnly" : ""}${process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false" ? "; Secure" : ""}`;
}
export function safeNext(value) {
  return typeof value === "string" &&
    /^\/(?![\/\\])/.test(value) &&
    !/[\\\r\n]/.test(value)
    ? value
    : "/";
}
export function csrfCheck(req, form) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (
    origin &&
    origin !== new URL(req.url).origin &&
    origin !== process.env.APP_URL &&
    origin !== `${new URL(req.url).protocol}//${req.headers.get("host")}`
  )
    throw Object.assign(Error("Недопустимый источник запроса"), {
      status: 403,
    });
  const expected = cookies(req).csrftoken,
    received =
      req.headers.get("x-csrftoken") || form?.get("csrfmiddlewaretoken");
  if (
    !expected ||
    typeof received !== "string" ||
    !received ||
    Buffer.byteLength(expected) !== Buffer.byteLength(String(received)) ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(received))
  )
    throw Object.assign(Error("Обновите страницу и повторите запрос (CSRF)."), {
      status: 403,
    });
}
