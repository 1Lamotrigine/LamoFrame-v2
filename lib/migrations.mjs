// Apply each schema change once, atomically, including on existing installations.
export async function migrate(db) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  const migrations = [
    [
      1,
      `
    CREATE TABLE site_publications (
      project_id INTEGER PRIMARY KEY REFERENCES projects ON DELETE CASCADE,
      title TEXT NOT NULL, html TEXT NOT NULL, source_version TEXT NOT NULL,
      published_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE project_versions (
      id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects ON DELETE CASCADE,
      title TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', data JSONB NOT NULL,
      source_version TEXT NOT NULL, automatic BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX project_versions_project ON project_versions(project_id, id DESC);
  `,
    ],
    [
      2,
      `
      ALTER TABLE records ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
      CREATE TABLE record_events (
        id SERIAL PRIMARY KEY, record_id INTEGER NOT NULL REFERENCES records ON DELETE CASCADE,
        actor_id INTEGER REFERENCES users ON DELETE SET NULL,
        kind TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX record_events_record ON record_events(record_id,id DESC);
    `,
    ],
  ];
  for (const [version, sql] of migrations) {
    await db.transaction(async (tx) => {
      if (
        !(
          await tx.query(
            "SELECT version FROM schema_migrations WHERE version=$1",
            [version],
          )
        ).rows.length
      ) {
        await tx.exec(sql);
        await tx.query("INSERT INTO schema_migrations(version) VALUES($1)", [
          version,
        ]);
      }
    });
  }
}
