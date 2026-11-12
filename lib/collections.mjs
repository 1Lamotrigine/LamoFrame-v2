import { query, one } from "./db.mjs";
import { control } from "./render.mjs";
export const kinds = {
  text: "Текст",
  number: "Число",
  date: "Дата",
  status: "Статус",
  relation: "Связь",
};
export async function schema(projectId, db) {
  const result = {};
  for (const c of await query(
    "SELECT * FROM collections WHERE project_id=$1 ORDER BY id",
    [projectId],
    db,
  )) {
    result[String(c.id)] = {
      name: c.name,
      fields: (
        await query(
          "SELECT * FROM fields WHERE collection_id=$1 ORDER BY id",
          [c.id],
          db,
        )
      ).map((f) => ({
        id: String(f.id),
        name: f.name,
        kind: f.kind,
        required: f.required,
        options: f.options,
        target: f.target_id ? String(f.target_id) : "",
      })),
    };
  }
  return result;
}
export async function labels(projectId, target, db) {
  if (!target) return [];
  const c = await one(
    "SELECT * FROM collections WHERE id=$1 AND project_id=$2",
    [target, projectId],
    db,
  );
  if (!c) return [];
  const f = await one(
    "SELECT id FROM fields WHERE collection_id=$1 AND kind='text' ORDER BY id LIMIT 1",
    [target],
    db,
  );
  return (
    await query(
      "SELECT * FROM records WHERE collection_id=$1 ORDER BY id",
      [target],
      db,
    )
  ).map((r) => [String(r.id), r.values[f?.id] || `Запись №${r.id}`]);
}
export async function applicationData(projectId, definitions, canEdit, db) {
  const result = {};
  for (const [id, c] of Object.entries(definitions)) {
    const rows = await query(
      "SELECT r.* FROM records r JOIN collections c ON c.id=r.collection_id WHERE c.project_id=$1 AND c.id=$2 ORDER BY r.id",
      [projectId, id],
      db,
    );
    const relations = {};
    for (const f of c.fields)
      if (f.kind === "relation")
        relations[f.id] = Object.fromEntries(
          await labels(projectId, f.target, db),
        );
    result[id] = {
      ...c,
      rows: rows.map((r) => ({
        id: String(r.id),
        revision: r.revision,
        rawValues: Object.fromEntries(
          c.fields.map((f) => [f.id, r.values[f.id] ?? null]),
        ),
        values: Object.fromEntries(
          c.fields.map((f) => [
            f.id,
            f.kind === "relation"
              ? relations[f.id][r.values[f.id]] || ""
              : (r.values[f.id] ?? null),
          ]),
        ),
      })),
      canEdit,
      createUrl: `/apps/${projectId}/records/${id}/new/`,
    };
  }
  return result;
}
export async function recordForm(
  projectId,
  definition,
  values = {},
  disabled = false,
  db,
) {
  let html = "";
  for (const f of definition.fields) {
    html += control(f.id, f.name, {
      type:
        f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text",
      value: values[f.id] ?? "",
      required: f.required,
      disabled,
      options:
        f.kind === "status"
          ? f.options.map((x) => [x, x])
          : f.kind === "relation"
            ? await labels(projectId, f.target, db)
            : undefined,
    });
  }
  return html;
}
export async function validateRecord(projectId, definition, form, db) {
  const values = {};
  for (const f of definition.fields) {
    const raw = String(form.get(f.id) ?? "").trim();
    if (!raw) {
      if (f.required) throw Error(`Заполните поле «${f.name}»`);
      values[f.id] = null;
      continue;
    }
    if (f.kind === "number") {
      if (!Number.isFinite(Number(raw))) throw Error("Введите число");
      values[f.id] = Number(raw);
    } else if (f.kind === "date") {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
        !Number.isFinite(Date.parse(raw)) ||
        new Date(raw).toISOString().slice(0, 10) !== raw
      )
        throw Error("Некорректная дата");
      values[f.id] = raw;
    } else if (f.kind === "status") {
      if (!f.options.includes(raw)) throw Error("Неизвестный статус");
      values[f.id] = raw;
    } else if (f.kind === "relation") {
      if (!(await labels(projectId, f.target, db)).some(([id]) => id === raw))
        throw Error("Связанная запись недоступна");
      values[f.id] = raw;
    } else {
      if (raw.length > 250) throw Error("Максимум 250 символов");
      values[f.id] = raw;
    }
  }
  return values;
}
