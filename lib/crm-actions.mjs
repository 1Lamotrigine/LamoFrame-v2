import { one, query, transaction } from "./db.mjs";
import { validateRecord } from "./collections.mjs";
const fail = (s, m) => {
  throw Object.assign(Error(m), { status: s });
};
export async function recordEvent(db, recordId, actorId, kind, body = "") {
  await query(
    "INSERT INTO record_events(record_id,actor_id,kind,body) VALUES($1,$2,$3,$4)",
    [recordId, actorId, kind, body],
    db,
  );
}
export async function mutateCRM(project, user, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    fail(400, "Ожидается объект");
  return transaction(async (db) => {
    const p = await one(
      "SELECT * FROM projects WHERE id=$1 FOR UPDATE",
      [project.id],
      db,
    );
    if (!p) fail(404, "Проект не найден");
    const role =
      p.owner_id === user.id
        ? "owner"
        : (
            await one(
              "SELECT role FROM members WHERE project_id=$1 AND user_id=$2",
              [p.id, user.id],
              db,
            )
          )?.role;
    if (!role) fail(404, "Проект не найден");
    if (role === "viewer") fail(403, "У вашей роли нет права менять записи.");
    const publication = await one(
      "SELECT snapshot FROM publications WHERE project_id=$1",
      [p.id],
      db,
    );
    const key = String(payload.collection || ""),
      schema = publication?.snapshot.collections[key];
    if (!schema?.fields.length) fail(404, "Коллекция не опубликована");
    const current = await one(
      "SELECT r.* FROM records r JOIN collections c ON c.id=r.collection_id WHERE r.id=$1 AND r.collection_id=$2 AND c.project_id=$3",
      [payload.record || 0, key, p.id],
      db,
    );
    if (!current) fail(404, "Запись не найдена");
    if (payload.action === "comment") {
      const body = String(payload.body || "").trim();
      if (!body || body.length > 2000)
        fail(400, "Комментарий должен содержать от 1 до 2000 символов.");
      await recordEvent(db, current.id, user.id, "comment", body);
      return { ok: true };
    }
    if (
      !Number.isInteger(payload.revision) ||
      payload.revision !== current.revision
    )
      fail(409, "Запись изменена другим участником. Обновите карточку.");
    if (payload.action === "delete") {
      const incoming = await query(
        "SELECT f.* FROM fields f JOIN collections c ON c.id=f.collection_id WHERE f.target_id=$1 AND c.project_id=$2",
        [key, p.id],
        db,
      );
      for (const field of incoming)
        if (
          await one(
            "SELECT id FROM records WHERE collection_id=$1 AND values->>$2=$3 LIMIT 1",
            [field.collection_id, String(field.id), String(current.id)],
            db,
          )
        )
          fail(
            409,
            "На запись есть ссылки в других коллекциях. Сначала измените связанные сделки или задачи.",
          );
      await query("DELETE FROM records WHERE id=$1", [current.id], db);
      return { ok: true, deleted: true };
    }
    if (payload.action && payload.action !== "update")
      fail(400, "Неизвестное действие");
    const changes = payload.values;
    if (!changes || typeof changes !== "object" || Array.isArray(changes))
      fail(400, "Передайте изменённые поля");
    const allowed = new Set(schema.fields.map((f) => f.id));
    if (Object.keys(changes).some((k) => !allowed.has(k)))
      fail(400, "Поле не входит в опубликованную схему");
    const values = { ...current.values, ...changes };
    const form = new Map(Object.entries(values));
    let validated;
    try {
      validated = await validateRecord(p.id, schema, form, db);
    } catch (e) {
      fail(400, e.message);
    }
    const merged = { ...current.values, ...validated };
    completeDealDate(schema, merged, changes);
    const updated = await one(
      "UPDATE records SET values=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND revision=$3 RETURNING revision",
      [merged, current.id, payload.revision],
      db,
    );
    if (!updated) fail(409, "Запись изменена другим участником");
    const names = schema.fields
      .filter((f) => Object.hasOwn(changes, f.id))
      .map((f) => f.name);
    await recordEvent(
      db,
      current.id,
      user.id,
      "updated",
      "Изменены поля: " + names.join(", "),
    );
    return { ok: true, revision: updated.revision };
  });
}
export async function recordActivity(recordId) {
  return query(
    "SELECT e.id,e.kind,e.body,e.created_at,u.username FROM record_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.record_id=$1 ORDER BY e.id DESC LIMIT 50",
    [recordId],
  );
}

export async function deleteRecord(db, projectId, collectionId, recordId) {
  const incoming = await query(
    "SELECT f.* FROM fields f JOIN collections c ON c.id=f.collection_id WHERE f.target_id=$1 AND c.project_id=$2",
    [collectionId, projectId],
    db,
  );
  for (const field of incoming)
    if (
      await one(
        "SELECT id FROM records WHERE collection_id=$1 AND values->>$2=$3 LIMIT 1",
        [field.collection_id, String(field.id), String(recordId)],
        db,
      )
    )
      fail(
        409,
        "На запись есть ссылки. Сначала измените связанные сделки или задачи.",
      );
  await query(
    "DELETE FROM records WHERE id=$1 AND collection_id=$2",
    [recordId, collectionId],
    db,
  );
}

export function completeDealDate(schema, values, changes = values) {
  const stage = schema.fields.find(
      (f) => f.kind === "status" && f.name === "Этап",
    ),
    closed = schema.fields.find(
      (f) => f.kind === "date" && f.name === "Дата закрытия",
    );
  if (stage && closed && Object.hasOwn(changes, stage.id))
    values[closed.id] = ["Выиграна", "Проиграна"].includes(values[stage.id])
      ? values[closed.id] || new Date().toISOString().slice(0, 10)
      : null;
}
