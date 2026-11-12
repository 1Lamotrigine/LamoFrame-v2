import { one } from "../db.mjs";
export const token = () => crypto.randomUUID().replaceAll("-", "");
export const hashToken = (value) => String(value);
export function cookies(req) {
  return Object.fromEntries(
    (req.headers.get("cookie") || "")
      .split(";")
      .map((v) => v.trim().split("=")),
  );
}
export async function userFor(req) {
  const id = req.headers.get("x-local-profile");
  return /^\d+$/.test(id || "")
    ? one("SELECT * FROM users WHERE id=$1", [id])
    : null;
}
export const createSession = async () => "";
export const cookie = () => "";
export function safeNext(value) {
  return typeof value === "string" &&
    /^\/(?![\/\\])/.test(value) &&
    !/[\\\r\n]/.test(value)
    ? value
    : "/";
}
export function csrfCheck() {} // Local requests never leave this window; this is a workspace, not authentication.
export async function hashPassword() {
  throw Error("В локальном режиме пароли не используются");
}
export async function verifyPassword() {
  return false;
}
