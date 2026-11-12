import { randomUUID } from "node:crypto";
import { blankDocument, slug } from "./document.mjs";
import { query, one, transaction } from "./db.mjs";
export const CRM_TEMPLATE = {
  id: "builtin-sales-crm",
  title: "CRM продаж",
  description:
    "Клиенты, сделки, канбан, задачи и живая аналитика. Пять связанных страниц.",
  badge: "Приложение",
};
export const CRM_SCHEMA = {
  team: {
    name: "Сотрудники",
    fields: {
      name: { name: "Имя", kind: "text", required: true },
      email: { name: "Email", kind: "text" },
    },
  },
  clients: {
    name: "Клиенты",
    fields: {
      name: { name: "Имя", kind: "text", required: true },
      company: { name: "Компания", kind: "text" },
      phone: { name: "Телефон", kind: "text" },
      email: { name: "Email", kind: "text" },
      status: {
        name: "Статус",
        kind: "status",
        options: ["Новый", "Активный", "Архив"],
      },
      created: { name: "Дата создания", kind: "date" },
    },
  },
  deals: {
    name: "Сделки",
    fields: {
      name: { name: "Сделка", kind: "text", required: true },
      client: {
        name: "Клиент",
        kind: "relation",
        target: "clients",
        required: true,
      },
      amount: { name: "Сумма, ₸", kind: "number", required: true },
      stage: {
        name: "Этап",
        kind: "status",
        required: true,
        options: [
          "Новая",
          "Переговоры",
          "Предложение",
          "Выиграна",
          "Проиграна",
        ],
      },
      assignee: { name: "Ответственный", kind: "relation", target: "team" },
      created: { name: "Дата создания", kind: "date" },
      closed: { name: "Дата закрытия", kind: "date" },
    },
  },
  tasks: {
    name: "Задачи",
    fields: {
      name: { name: "Задача", kind: "text", required: true },
      client: { name: "Клиент", kind: "relation", target: "clients" },
      deal: { name: "Сделка", kind: "relation", target: "deals" },
      due: { name: "Срок", kind: "date", required: true },
      status: {
        name: "Статус",
        kind: "status",
        required: true,
        options: ["Запланирована", "В работе", "Выполнена"],
      },
      assignee: { name: "Исполнитель", kind: "relation", target: "team" },
    },
  },
};
const bind = (collection, values = {}) => ({ collection, ...values });
export function crmDocument(title = "CRM продаж") {
  const doc = blankDocument(title);
  doc.settings = {
    ...doc.settings,
    bg: "#f5f6fa",
    theme: "switchable",
    fluidLayout: true,
    siteKey: randomUUID(),
    sidebar: { enabled: true, width: 240, min: 180, max: 360, brand: title },
  };
  function el(type, name, x, y, w, h, props = {}, style = {}) {
    return {
      id: "e_" + randomUUID().slice(0, 8),
      type,
      name,
      x,
      y,
      w,
      h,
      z: 1,
      rotation: 0,
      locked: false,
      hidden: false,
      props,
      style,
    };
  }
  function page(name, slug, elements) {
    const heading = el(
      "heading",
      name,
      30,
      26,
      840,
      46,
      { text: name, level: 1 },
      { fontSize: 30, fontWeight: 700, color: "#182230", lineHeight: 1.2 },
    );
    return {
      id: "p_" + slug,
      name,
      slug,
      frames: [
        {
          id: "f_" + randomUUID().slice(0, 8),
          name,
          x: 0,
          y: 0,
          w: 960,
          h: Math.max(760, ...elements.map((e) => e.y + e.h + 30)),
          bg: "#f5f6fa",
          radius: 0,
          locked: false,
          hidden: false,
          elements: [heading, ...elements].map((e, i) => ({ ...e, z: i + 1 })),
        },
      ],
    };
  }
  const metric = (label, i, collection, options) =>
    el("metric", label, 30 + i * 230, 130, 212, 150, {
      metric: {
        label,
        value: 0,
        suffix: options.aggregate === "sum" ? " ₸" : "",
      },
      binding: bind(collection, options),
    });
  const table = (name, collection, y = 116, h = 490) =>
    el("table", name, 30, y, 900, h, {
      table: { title: name },
      binding: bind(collection),
    });
  const add = (label, collection) =>
    el("record-form", label, 700, 26, 230, 44, {
      text: label,
      binding: bind(collection),
    });
  doc.pages = [
    page("Обзор", "overview", [
      el("crm-period", "Период", 30, 82, 900, 36, {}),
      metric("Клиенты", 0, "clients", {
        aggregate: "count",
        dateField: "clients.created",
      }),
      metric("Открытые сделки", 1, "deals", {
        aggregate: "sum",
        valueField: "deals.amount",
        statusField: "deals.stage",
        excludeValues: ["Выиграна", "Проиграна"],
        dateField: "deals.created",
      }),
      metric("Выручка", 2, "deals", {
        aggregate: "sum",
        valueField: "deals.amount",
        filterField: "deals.stage",
        filterValue: "Выиграна",
        dateField: "deals.closed",
      }),
      metric("Просроченные задачи", 3, "tasks", {
        aggregate: "overdue",
        dateField: "tasks.due",
        statusField: "tasks.status",
      }),
      el("chart", "Сделки по этапам", 30, 310, 440, 320, {
        chart: {
          type: "bar",
          title: "Воронка продаж",
          color: "#6366f1",
          showValues: true,
          showLegend: false,
        },
        binding: bind("deals", {
          groupField: "deals.stage",
          dateField: "deals.created",
        }),
      }),
      el("chart", "Сумма по этапам", 490, 310, 440, 320, {
        chart: {
          type: "donut",
          title: "Потенциал продаж",
          color: "#6366f1",
          showLegend: true,
          suffix: " ₸",
        },
        binding: bind("deals", {
          groupField: "deals.stage",
          valueField: "deals.amount",
          dateField: "deals.created",
        }),
      }),
      table("Ближайшие задачи", "tasks", 660, 370),
    ]),
    page("Клиенты", "clients", [
      add("Добавить клиента", "clients"),
      table("Клиенты", "clients"),
    ]),
    page("Сделки", "deals", [
      add("Новая сделка", "deals"),
      el("kanban", "Воронка сделок", 30, 108, 900, 470, {
        binding: bind("deals", {
          stageField: "deals.stage",
          titleField: "deals.name",
          clientField: "deals.client",
          valueField: "deals.amount",
        }),
      }),
      table("Все сделки", "deals", 620, 400),
    ]),
    page("Задачи", "tasks", [
      add("Поставить задачу", "tasks"),
      table("Задачи команды", "tasks"),
    ]),
    page("Настройки CRM", "settings", [
      el("crm-settings", "Управление CRM", 30, 106, 900, 210, {
        binding: bind("deals"),
      }),
      table("Сотрудники", "team", 350, 330),
    ]),
  ];
  doc.activePageId = doc.pages[0].id;
  return doc;
}
export function remapBindings(doc, collections, fields) {
  const keys = [
    "sortField",
    "filterField",
    "groupField",
    "valueField",
    "stageField",
    "titleField",
    "clientField",
    "dateField",
    "statusField",
  ];
  function walk(v) {
    if (!v || typeof v !== "object") return;
    const b = v.props?.binding;
    if (b) {
      if (collections[b.collection])
        b.collection = String(collections[b.collection]);
      for (const k of keys)
        if (typeof b[k] === "string") b[k] = fields[b[k]] || "";
      if (Array.isArray(b.columns))
        b.columns = b.columns.map((k) => fields[k]).filter(Boolean);
    }
    Object.values(v).forEach(walk);
  }
  walk(doc);
  return doc;
}
export function previewCRMSchema() {
  return Object.fromEntries(
    Object.entries(CRM_SCHEMA).map(([key, c]) => [
      key,
      {
        name: c.name,
        fields: Object.entries(c.fields).map(([f, v]) => ({
          ...v,
          id: key + "." + f,
          options: v.options || [],
          target: v.target || "",
        })),
      },
    ]),
  );
}
export async function createCRM(owner, title, withDemo) {
  return transaction(async (db) => {
    const doc = crmDocument(title || "CRM продаж");
    const p = await one(
      "INSERT INTO projects(owner_id,title,slug,data,updated_at) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [
        owner.id,
        doc.meta.title,
        slug(doc.meta.title),
        doc,
        new Date().toISOString(),
      ],
      db,
    );
    const collections = {},
      fields = {};
    for (const [key, c] of Object.entries(CRM_SCHEMA))
      collections[key] = (
        await one(
          "INSERT INTO collections(project_id,name) VALUES($1,$2) RETURNING id",
          [p.id, c.name],
          db,
        )
      ).id;
    for (const [key, c] of Object.entries(CRM_SCHEMA))
      for (const [f, v] of Object.entries(c.fields))
        fields[key + "." + f] = String(
          (
            await one(
              "INSERT INTO fields(collection_id,name,kind,required,options,target_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
              [
                collections[key],
                v.name,
                v.kind,
                !!v.required,
                JSON.stringify(v.options || []),
                collections[v.target] || null,
              ],
              db,
            )
          ).id,
        );
    remapBindings(doc, collections, fields);
    await query("UPDATE projects SET data=$1 WHERE id=$2", [doc, p.id], db);
    if (withDemo) {
      const date = (days = 0) =>
        new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      const insert = async (key, values) =>
        (
          await one(
            "INSERT INTO records(collection_id,values) VALUES($1,$2) RETURNING id",
            [
              collections[key],
              Object.fromEntries(
                Object.entries(values).map(([k, v]) => [
                  fields[key + "." + k],
                  v,
                ]),
              ),
            ],
            db,
          )
        ).id;
      const assignee = await insert("team", {
        name: owner.username,
        email: owner.email || "",
      });
      const other = await insert("team", {
        name: "Анна Соколова",
        email: "anna@example.test",
      });
      const clients = [];
      for (const [name, company] of [
        ["Алексей Иванов", "Аврора"],
        ["Мария Ким", "ТехноПарк"],
        ["Данияр Алиев", "North Studio"],
        ["Елена Петрова", "Ритейл Плюс"],
      ])
        clients.push(
          await insert("clients", {
            name,
            company,
            email:
              company.toLowerCase().replace(/[^a-z]/g, "") + "@example.test",
            phone: "+7 700 000 00 00",
            status: "Активный",
            created: date(-10),
          }),
        );
      const deals = [];
      for (const [i, stage] of CRM_SCHEMA.deals.fields.stage.options.entries())
        deals.push(
          await insert("deals", {
            name: [
              "Сайт компании",
              "Поддержка магазина",
              "CRM отдела продаж",
              "Лендинг курса",
              "Обновление каталога",
            ][i],
            client: String(clients[i % 4]),
            amount: [240000, 180000, 420000, 96000, 72000][i],
            stage,
            assignee: String(i % 2 ? other : assignee),
            created: date(-7),
            closed:
              stage === "Выиграна" || stage === "Проиграна" ? date(-2) : null,
          }),
        );
      await insert("tasks", {
        name: "Позвонить клиенту",
        client: String(clients[0]),
        deal: String(deals[0]),
        due: date(-1),
        status: "В работе",
        assignee: String(assignee),
      });
      await insert("tasks", {
        name: "Отправить предложение",
        client: String(clients[1]),
        deal: String(deals[1]),
        due: date(2),
        status: "Запланирована",
        assignee: String(other),
      });
      await insert("tasks", {
        name: "Подготовить договор",
        client: String(clients[2]),
        deal: String(deals[2]),
        due: date(4),
        status: "Запланирована",
        assignee: String(assignee),
      });
    }
    return p.id;
  });
}
