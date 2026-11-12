import { randomUUID } from "node:crypto";
export const uid = (prefix) => `${prefix}_${randomUUID().slice(0, 8)}`;
export const slug = (title) =>
  `${
    title
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 150) || "project"
  }-${randomUUID().slice(0, 8)}`.toLowerCase();
export function blankDocument(title = "Новый сайт") {
  return {
    version: 3,
    meta: { title, description: "", lang: "ru" },
    settings: {
      width: 1200,
      bg: "#ffffff",
      font: "system",
      responsive: { auto: true, device: "desktop" },
    },
    activePageId: "p_home",
    pages: [
      {
        id: "p_home",
        name: "Главная",
        slug: "index",
        frames: [
          {
            id: uid("f"),
            name: "Фрейм 1",
            x: 0,
            y: 0,
            w: 1200,
            h: 720,
            bg: "#ffffff",
            radius: 0,
            locked: false,
            hidden: false,
            elements: [],
          },
        ],
      },
    ],
    components: { header: null, footer: null },
  };
}
export function validateDocument(data) {
  if (
    !data ||
    Array.isArray(data) ||
    !Number.isInteger(data.version) ||
    ![1, 2, 3].includes(data.version)
  )
    throw Error("Неизвестная версия документа");
  if (!["pages", "frames", "sections"].some((k) => k in data))
    throw Error("В документе нет фреймов");
  const arr = (o, k) => {
    if (o[k] == null) return [];
    if (!Array.isArray(o[k])) throw Error("Некорректная структура документа");
    return o[k];
  };
  const obj = (o, k) => {
    if (o[k] == null) return {};
    if (typeof o[k] !== "object" || Array.isArray(o[k]))
      throw Error("Некорректная структура документа");
    return o[k];
  };
  const isObj = (o) => o && typeof o === "object" && !Array.isArray(o);
  const pages = arr(data, "pages");
  if (pages.length > 50) throw Error("Максимум 50 страниц");
  let frames = [...arr(data, "frames"), ...arr(data, "sections")];
  for (const page of pages) {
    if (!isObj(page)) throw Error("Некорректная страница");
    frames.push(...arr(page, "frames"));
    for (const device of Object.values(obj(page, "devices"))) {
      if (device != null) {
        if (!isObj(device)) throw Error("Некорректный макет");
        frames.push(...arr(device, "frames"));
      }
    }
  }
  const components = obj(data, "components");
  for (const layout of [
    components,
    ...Object.values(obj(components, "devices")),
  ]) {
    if (layout == null) continue;
    if (!isObj(layout)) throw Error("Некорректные компоненты");
    for (const role of ["header", "footer"])
      if (layout[role] != null) frames.push(layout[role]);
  }
  if (frames.length > 400) throw Error("Максимум 400 фреймов");
  let elements = 0;
  for (const frame of frames) {
    if (!isObj(frame)) throw Error("Некорректный фрейм");
    const list = arr(frame, "elements");
    if (list.some((x) => !isObj(x))) throw Error("Некорректный элемент");
    elements += list.length;
  }
  if (elements > 5000) throw Error("Максимум 5000 элементов");
  function walk(v, d = 0) {
    if (d > 40) throw Error("Слишком глубокая вложенность");
    if (typeof v === "number" && !Number.isFinite(v))
      throw Error("Некорректное число");
    if (v && typeof v === "object")
      Object.values(v).forEach((x) => walk(x, d + 1));
  }
  walk(data);
  if (Buffer.byteLength(JSON.stringify(data)) > 8 * 1024 * 1024)
    throw Error("Документ слишком большой");
}
export function bindings(doc) {
  const result = [];
  function walk(v) {
    if (v && typeof v === "object") {
      if (
        [
          "table",
          "record-form",
          "metric",
          "chart",
          "kanban",
          "crm-settings",
        ].includes(v.type) &&
        typeof v.props?.binding?.collection === "string" &&
        v.props.binding.collection
      )
        result.push(v.props.binding);
      Object.values(v).forEach(walk);
    }
  }
  walk(doc);
  return result;
}
export function replaceUrls(value, urls) {
  if (!value || typeof value !== "object") return;
  if (typeof value.src === "string" && urls[value.src])
    value.src = urls[value.src];
  Object.values(value).forEach((v) => replaceUrls(v, urls));
}
