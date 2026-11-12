import { test } from "node:test";
import assert from "node:assert/strict";
import { browserShell } from "../lib/browser-shell.mjs";
test("deployment serves a browser shell without opening a server database", async () => {
  const old = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = "/not-a-writable-server-directory";
  try {
    const r = browserShell(
      new Request("https://lamoframe-v2.vercel.app/accounts/signup/"),
    );
    assert.equal(r.status, 200);
    assert.match(await r.text(), /\/local\/bootstrap\.js/);
    assert.equal(r.headers.get("cache-control"), "no-store");
  } finally {
    if (old === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = old;
  }
});
test("deployed server does not accept profile or project writes", async () => {
  for (const path of [
    "/accounts/signup/",
    "/api/projects/1/",
    "/apps/1/mutate/",
  ]) {
    const r = browserShell(
      new Request("https://lamoframe-v2.vercel.app" + path, {
        method: "POST",
        body: "{}",
      }),
    );
    assert.equal(r.status, 405);
    assert.match((await r.json()).error, /локальная версия/);
  }
});
