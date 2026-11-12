import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
const run = promisify(execFile);
test("read-only SQLite import preserves IDs, JSON, media and prevents overwrite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lamoframe-import-"));
  try {
    const source = join(dir, "db.sqlite3"),
      storage = join(dir, "target");
    await run("python3", [
      "-c",
      `import sqlite3,sys,json
c=sqlite3.connect(sys.argv[1])
c.execute("CREATE TABLE auth_user(id INTEGER,username TEXT,email TEXT,password TEXT,is_staff INTEGER)")
c.execute("INSERT INTO auth_user VALUES(7,'migrated','migrated@example.com','pbkdf2_sha256$1000$salt$hash',1)")
c.execute("CREATE TABLE builder_project(id INTEGER,owner_id INTEGER,title TEXT,slug TEXT,data TEXT,exported_html TEXT,thumbnail TEXT,created_at TEXT,updated_at TEXT)")
c.execute("INSERT INTO builder_project VALUES(9,7,'Imported','imported',?, '<h1>Imported</h1>','','2026-01-01 00:00:00','2026-01-01 00:00:00')",(json.dumps({'version':3,'pages':[]}),))
c.commit()`,
      source,
    ]);
    await mkdir(join(dir, "media"), { recursive: true });
    await writeFile(join(dir, "media", "test.txt"), "original media");
    const env = { ...process.env, STORAGE_DIR: storage };
    await run(process.execPath, ["scripts/import-django.mjs", source], { env });
    const db = new PGlite(join(storage, "pglite"));
    const p = (await db.query("SELECT * FROM projects WHERE id=9")).rows[0];
    assert.equal(p.title, "Imported");
    assert.deepEqual(p.data, { version: 3, pages: [] });
    assert.equal(
      (await db.query("SELECT username,is_staff FROM users WHERE id=7")).rows[0]
        .is_staff,
      true,
    );
    assert.equal(
      (
        await db.query(
          "INSERT INTO users(username,password) VALUES('next','') RETURNING id",
        )
      ).rows[0].id,
      8,
    );
    await db.close();
    assert.equal(
      await readFile(join(storage, "media", "test.txt"), "utf8"),
      "original media",
    );
    await assert.rejects(
      run(process.execPath, ["scripts/import-django.mjs", source], { env }),
      /Целевая база не пустая/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("schema migration adds lifecycle tables without changing legacy projects", async () => {
  const { migrate } = await import("../lib/migrations.mjs");
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE TABLE users(id INTEGER PRIMARY KEY); CREATE TABLE records(id INTEGER PRIMARY KEY); CREATE TABLE projects(id INTEGER PRIMARY KEY,title TEXT NOT NULL,data JSONB NOT NULL,exported_html TEXT NOT NULL); INSERT INTO projects VALUES(17,'Legacy','{\"version\":3,\"pages\":[]}','<p>Old export</p>')",
    );
    await migrate(db);
    await migrate(db);
    const project = (await db.query("SELECT * FROM projects WHERE id=17"))
      .rows[0];
    assert.equal(project.title, "Legacy");
    assert.equal(project.exported_html, "<p>Old export</p>");
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM site_publications"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM schema_migrations"))
        .rows[0].n,
      2,
    );
  } finally {
    await db.close();
  }
});
