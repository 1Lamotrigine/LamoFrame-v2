import nunjucks from "nunjucks";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";
export const urls = {
  dashboard: () => "/",
  new_project: () => "/new/",
  create_project: () => "/projects/create/",
  login: () => "/accounts/login/",
  signup: () => "/accounts/signup/",
  logout: () => "/accounts/logout/",
  google_login: () => "/accounts/google/login/",
  editor: (id) => `/editor/${id}/`,
  api_project: (id) => `/api/projects/${id}/`,
  upload_asset: (id) => `/api/projects/${id}/assets/`,
  export_project: (id) => `/projects/${id}/export/`,
  public_preview: (slug) => `/p/${slug}/`,
  public_raw: (slug) => `/p/${slug}/raw/`,
  app_manage: (id) => `/projects/${id}/application/`,
  app_publish: (id) => `/projects/${id}/application/publish/`,
  app_records: (id, c) => `/projects/${id}/application/collections/${c}/`,
  app_draft_record_new: (id, c) =>
    `/projects/${id}/application/collections/${c}/new/`,
  app_draft_record: (id, c, r) =>
    `/projects/${id}/application/collections/${c}/${r}/`,
  app_accept_invite: (t) => `/apps/invite/${t}/`,
  app_run: (id) => `/apps/${id}/`,
  app_data: (id) => `/apps/${id}/data/`,
  app_record_new: (id, c) => `/apps/${id}/records/${c}/new/`,
  app_record: (id, c, r) => `/apps/${id}/records/${c}/${r}/`,
};
const env = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(resolve("templates")),
  { autoescape: true, noCache: process.env.NODE_ENV !== "production" },
);
env.addGlobal(
  "truthy",
  (value) =>
    !!value && (typeof value !== "object" || Object.keys(value).length > 0),
);
env.addGlobal("url", (name, ...args) => {
  if (!urls[name]) throw Error(`Unknown route ${name}`);
  return urls[name](...args);
});
export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const safe = (s) => new nunjucks.runtime.SafeString(s);
env.addFilter("json_script", (value, id) =>
  safe(
    `<script type="application/json" id="${escape(id)}">${JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")}</script>`,
  ),
);
env.addFilter("escapejs", (v) =>
  safe(
    JSON.stringify(String(v ?? ""))
      .slice(1, -1)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026"),
  ),
);
env.addFilter("slice", (v, s) =>
  String(v || "").slice(
    ...s.split(":").map((x) => (x ? Number(x) : undefined)),
  ),
);
env.addFilter(
  "pluralize",
  (n, s) =>
    s.split(",")[
      n % 10 === 1 && n % 100 !== 11
        ? 0
        : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
          ? 1
          : 2
    ],
);
env.addFilter(
  "timesince",
  (v) => `${Math.max(0, Math.floor((Date.now() - new Date(v)) / 60000))} мин.`,
);
env.addFilter("date", (v) =>
  new Date(v).toLocaleString("ru-RU", { timeZone: "Asia/Aqtobe" }),
);
env.addFilter("default_if_none", (v, d) => (v == null ? d : v));
env.addFilter("urlencode", encodeURIComponent);
export function render(template, context = {}) {
  return env.render(template, {
    ASSET_VERSION: "next-3",
    MODULE_NAMES: readdirSync(resolve("public/static/js")),
    csrf_token: "",
    google_oauth_enabled:
      process.env.SHOW_GOOGLE_LOGIN === "true" &&
      !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    ...context,
  });
}
export function control(
  name,
  label,
  {
    type = "text",
    value = "",
    required = false,
    options,
    disabled = false,
  } = {},
) {
  const attrs = `name="${escape(name)}" id="f_${escape(name)}" class="input" ${required ? "required" : ""} ${disabled ? "disabled" : ""}`;
  return `<p><label for="f_${escape(name)}">${escape(label)}</label>${options ? `<select ${attrs}><option value="">Выберите значение</option>${options.map(([k, v]) => `<option value="${escape(k)}" ${String(k) === String(value) ? "selected" : ""}>${escape(v)}</option>`).join("")}</select>` : `<input ${attrs} type="${type}" value="${escape(type === "checkbox" ? "on" : value)}" ${type === "number" ? 'step="any"' : ""} ${type === "text" ? 'maxlength="250"' : ""}>`}</p>`;
}
