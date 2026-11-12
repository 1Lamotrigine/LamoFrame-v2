const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function boundRows(el, ctx, report = false) {
  const b = el.props?.binding || {},
    c = ctx?.appData?.[b.collection];
  const cutoff =
    Number(ctx?.periodDays) > 0
      ? new Date(Date.now() - Number(ctx.periodDays) * 86400000)
          .toISOString()
          .slice(0, 10)
      : null;
  const rows = (report ? c?.reportRows || c?.rows : c?.rows) || [];
  return {
    b,
    c,
    rows: rows.filter(
      (r) =>
        (!b.filterField ||
          !String(b.filterValue ?? "") ||
          String(r.values[b.filterField] ?? "") === String(b.filterValue)) &&
        !(
          Array.isArray(b.excludeValues) &&
          b.excludeValues.includes(r.values[b.statusField])
        ) &&
        (!report ||
          !cutoff ||
          !b.dateField ||
          (r.values[b.dateField] && r.values[b.dateField] >= cutoff)),
    ),
  };
}
export function metricFromRecords(el, ctx) {
  const { b, c, rows } = boundRows(el, ctx, true);
  if (!c) return el;
  const value =
    b.aggregate === "sum"
      ? rows.reduce(
          (n, r) =>
            n +
            (Number(r.rawValues?.[b.valueField] ?? r.values[b.valueField]) ||
              0),
          0,
        )
      : b.aggregate === "overdue"
        ? rows.filter(
            (r) =>
              r.values[b.dateField] &&
              r.values[b.dateField] < new Date().toISOString().slice(0, 10) &&
              r.values[b.statusField] !== "Выполнена",
          ).length
        : rows.length;
  return {
    ...el,
    props: {
      ...el.props,
      metric: {
        ...el.props.metric,
        value,
        delta: "",
        hint: c.sample ? "Предпросмотр · тестовые данные" : "По данным CRM",
      },
    },
  };
}
export function chartFromRecords(el, ctx) {
  const { b, c, rows } = boundRows(el, ctx, true);
  if (!c) return el;
  const field = c.fields.find((f) => f.id === b.groupField);
  const totals = new Map((field?.options || []).map((v) => [v, 0]));
  for (const r of rows) {
    const label = String(r.values[b.groupField] || "Без значения");
    totals.set(
      label,
      (totals.get(label) || 0) +
        (b.valueField
          ? Number(r.rawValues?.[b.valueField] ?? r.values[b.valueField]) || 0
          : 1),
    );
  }
  return {
    ...el,
    props: {
      ...el.props,
      chart: {
        ...el.props.chart,
        data: [...totals].map(([label, value]) => ({ label, value })),
        subtitle: c.sample ? "Тестовые данные" : "Актуальные записи CRM",
      },
    },
  };
}
export function renderKanban(el, ctx) {
  const { b, c, rows } = boundRows(el, ctx);
  if (!c)
    return '<div class="lf-crm-card">Выберите коллекцию и поле этапа для канбана.</div>';
  const stage = c.fields.find(
    (f) => f.id === b.stageField && f.kind === "status",
  );
  if (!stage)
    return '<div class="lf-crm-card">Выберите поле типа «Статус».</div>';
  const name = b.titleField || c.fields.find((f) => f.kind === "text")?.id;
  const can = !!ctx.appOrigin && c.canEdit;
  return `<div class="lf-kanban" data-kanban-collection="${esc(b.collection)}" data-kanban-field="${esc(stage.id)}">${[
    ...stage.options,
    ...(rows.some((r) => !stage.options.includes(r.values[stage.id]))
      ? ["Без этапа"]
      : []),
  ]
    .map((status, i) => {
      const cards = rows.filter(
        (r) => (r.values[stage.id] || "Без этапа") === status,
      );
      return `<section class="lf-kanban-column" data-stage="${esc(status)}"><h3><i style="background:${["#818cf8", "#38bdf8", "#fbbf24", "#34d399", "#f87171"][i % 5]}"></i>${esc(status)} <small>${cards.length}</small></h3><div class="lf-kanban-cards">${cards.map((r) => `<article class="lf-deal-card" ${can ? 'draggable="true"' : ""} data-record-id="${esc(r.id)}" data-revision="${r.revision || 1}"><button type="button" class="lf-record-link" ${ctx.appOrigin ? `data-app-collection="${esc(b.collection)}" data-app-record="${esc(r.id)}"` : ""}>${esc(r.values[name] || "Сделка №" + r.id)}</button><strong>${new Intl.NumberFormat("ru-RU").format(Number(r.values[b.valueField]) || 0)} ₸</strong>${b.clientField ? `<p>${esc(r.values[b.clientField])}</p>` : ""}${can ? `<label>Этап<select data-kanban-stage>${stage.options.map((v) => `<option ${v === status ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>` : ""}</article>`).join("") || '<p class="lf-empty">Нет сделок</p>'}</div></section>`;
    })
    .join("")}</div>`;
}
export function renderCRMSettings(el, ctx) {
  const { c } = boundRows(el, ctx);
  return `<div class="lf-crm-card"><h3>Ваше рабочее пространство</h3><p>Поля, страницы и этапы настраиваются владельцем в конструкторе. Записи и структура данных доступны в разделе «Данные и доступ».</p><p>Этапы: ${esc(c?.fields.find((f) => f.kind === "status")?.options.join(" → ") || "Настройте статусы")}</p>${ctx?.appOrigin && ctx.role === "owner" ? '<button type="button" class="sb-record-action" data-crm-manage>Открыть данные и доступ</button>' : "<p>Для изменения структуры CRM обратитесь к владельцу.</p>"}</div>`;
}
export const CRM_CSS = `
.lf-crm-card,.lf-deal-card{background:var(--lf-surface,#fff);color:var(--lf-ink,#182230);border:1px solid var(--lf-border,#e4e7ec);border-radius:14px;padding:20px}.lf-crm-card p{margin:14px 0;line-height:1.6}.lf-kanban{display:flex;gap:14px;overflow-x:auto;padding:4px 0 16px;align-items:stretch;width:100%}.lf-kanban-column{flex:1 0 208px;min-width:0;background:var(--lf-bg,#f4f5f8);border-radius:14px;padding:12px;border:1px solid var(--lf-border,#e4e7ec)}.lf-kanban-column h3{font-size:13px;display:flex;gap:8px;align-items:center;margin:0 0 16px}.lf-kanban-column h3 i{width:8px;height:8px;border-radius:50%}.lf-kanban-column h3 small{margin-left:auto;color:var(--lf-muted,#667085)}.lf-kanban-cards{display:grid;gap:12px;min-height:150px}.lf-deal-card{padding:14px;box-shadow:0 2px 4px #10182806;display:flex;flex-direction:column;gap:12px}.lf-deal-card strong{font-size:18px}.lf-deal-card p,.lf-deal-card label{font-size:12px;color:var(--lf-muted,#667085)}.lf-deal-card select{display:block;margin-top:6px;max-width:100%;background:var(--lf-surface,#fff);color:var(--lf-ink,#182230);border:1px solid var(--lf-border,#e4e7ec);border-radius:6px;padding:6px;width:100%}.lf-record-link{background:none;border:0;padding:0;text-align:left;color:var(--lf-accent,#4f46e5);cursor:pointer;font-weight:600}.lf-empty{color:var(--lf-muted,#667085);font-size:13px}.lf-kanban-column.is-drag-over{outline:2px dashed #818cf8}.lf-table-tools{display:flex;gap:10px;flex-wrap:wrap;padding:12px 18px;border-bottom:1px solid var(--lf-border,#e4e7ec)}.lf-table-tools input,.lf-table-tools select,.lf-period select{border:1px solid var(--lf-border,#e4e7ec);background:var(--lf-surface,#fff);color:var(--lf-ink,#182230);border-radius:8px;padding:8px 12px;max-width:100%}.lf-period{display:flex;gap:12px;align-items:center;justify-content:space-between;color:var(--lf-muted,#667085);font-size:13px}.lf-table-sort{border:0;background:none;color:inherit;text-align:left;font:inherit;cursor:pointer;padding:0}.lf-record-count{font-variant-numeric:tabular-nums}
`;
function crmRuntime() {
  const post = (data) => {
    const hash = document.querySelector(".sb-page:not([hidden])")?.id || "";
    parent.postMessage({ ...data, page: hash }, "*");
  };
  document.addEventListener("change", (e) => {
    if (e.target.matches("[data-kanban-stage]")) {
      const board = e.target.closest("[data-kanban-collection]"),
        card = e.target.closest("[data-record-id]");
      post({
        type: "lamoframe-mutate",
        collection: board.dataset.kanbanCollection,
        record: card.dataset.recordId,
        revision: Number(card.dataset.revision),
        values: { [board.dataset.kanbanField]: e.target.value },
      });
      e.target.disabled = true;
    }
    if (e.target.matches("[data-crm-period]"))
      post({ type: "lamoframe-period", days: Number(e.target.value) });
    if (e.target.matches("[data-crm-filter]"))
      filter(e.target.closest(".sb-bound-table"));
  });
  document.addEventListener("input", (e) => {
    if (e.target.matches("[data-crm-search]"))
      filter(e.target.closest(".sb-bound-table"));
  });
  function filter(table) {
    const term = (
        table.querySelector("[data-crm-search]")?.value || ""
      ).toLowerCase(),
      select = table.querySelector("[data-crm-filter]");
    let count = 0;
    table.querySelectorAll("tbody tr[data-record-row]").forEach((row) => {
      const status = select?.value || "",
        field = select?.dataset.crmFilter;
      const matched = !term || row.textContent.toLowerCase().includes(term);
      let values = {};
      try {
        values = JSON.parse(row.dataset.values);
      } catch {}
      row.hidden = !(
        matched &&
        (!status || String(values[field] || "") === status)
      );
      if (!row.hidden) count++;
    });
    const label = table.querySelector(".lf-record-count");
    if (label) label.textContent = "Показано: " + count;
  }
  document.addEventListener("click", (e) => {
    const th = e.target.closest("[data-crm-sort]");
    if (th) {
      const table = th.closest("table"),
        index = Number(th.dataset.crmSort),
        direction = th.dataset.direction === "asc" ? -1 : 1;
      table
        .querySelectorAll("[data-crm-sort]")
        .forEach((b) => delete b.dataset.direction);
      th.dataset.direction = direction === 1 ? "asc" : "desc";
      th.setAttribute(
        "aria-label",
        "Сортировка " + (direction === 1 ? "по возрастанию" : "по убыванию"),
      );
      const rows = [...table.querySelectorAll("tbody tr[data-record-row]")];
      rows.sort((a, b) => {
        const left = a.children[index].textContent,
          right = b.children[index].textContent;
        return (
          (th.dataset.kind === "number"
            ? Number(left) - Number(right)
            : left.localeCompare(right, "ru", { numeric: true })) * direction
        );
      });
      rows.forEach((row) => table.tBodies[0].append(row));
    }
    if (e.target.closest("[data-crm-manage]"))
      post({ type: "lamoframe-manage" });
  });
  let dragged = null;
  document.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".lf-deal-card[draggable]");
    if (!card) return;
    dragged = card;
    e.dataTransfer.setData("text/plain", card.dataset.recordId);
    e.dataTransfer.effectAllowed = "move";
  });
  document.addEventListener("dragover", (e) => {
    const col = e.target.closest(".lf-kanban-column");
    if (col && dragged) {
      e.preventDefault();
      col.classList.add("is-drag-over");
    }
  });
  document.addEventListener("dragleave", (e) =>
    e.target.closest(".lf-kanban-column")?.classList.remove("is-drag-over"),
  );
  document.addEventListener("dragend", () => {
    dragged = null;
    document
      .querySelectorAll(".is-drag-over")
      .forEach((n) => n.classList.remove("is-drag-over"));
  });
  document.addEventListener("drop", (e) => {
    const col = e.target.closest(".lf-kanban-column");
    if (!col || !dragged) return;
    e.preventDefault();
    col.classList.remove("is-drag-over");
    const board = col.closest("[data-kanban-collection]");
    if (board !== dragged.closest("[data-kanban-collection]")) return;
    post({
      type: "lamoframe-mutate",
      collection: board.dataset.kanbanCollection,
      record: dragged.dataset.recordId,
      revision: Number(dragged.dataset.revision),
      values: { [board.dataset.kanbanField]: col.dataset.stage },
    });
    dragged = null;
  });
}
export const CRM_SCRIPT = `(${crmRuntime.toString()})();`;
