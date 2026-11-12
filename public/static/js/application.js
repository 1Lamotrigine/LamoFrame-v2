import { renderDocument } from "./render.js";
import { csrfToken } from "./api.js";
const frame = document.getElementById("applicationFrame"),
  status = document.getElementById("applicationStatus");
let payload,
  documentUrl,
  periodDays = 0,
  requestId = 0;
const preferenceKey = () =>
  payload.document.settings?.siteKey || payload.document.meta?.title || "site";
const prefs = () => {
  try {
    return JSON.parse(
      localStorage.getItem("lamoframe-site:" + preferenceKey()) || "{}",
    );
  } catch {
    return {};
  }
};
function showError(message) {
  status.hidden = false;
  status.textContent = message;
  status.setAttribute("role", "alert");
}
function draw(hash) {
  const html = renderDocument(payload.document, {
    appData: payload.collections,
    appOrigin: location.origin,
    role: payload.role,
    preferences: prefs(),
    periodDays,
  });
  const previous = documentUrl;
  documentUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  frame.src = documentUrl + (/^#page-[a-z0-9-]+$/.test(hash || "") ? hash : "");
  frame.hidden = false;
  frame.addEventListener(
    "load",
    () => {
      if (previous) URL.revokeObjectURL(previous);
    },
    { once: true },
  );
}
async function refresh(hash = location.hash) {
  const id = ++requestId;
  const response = await fetch(frame.dataset.url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || response.redirected)
    throw Error("Доступ к приложению недоступен. Войдите и обновите страницу.");
  const data = await response.json();
  if (id !== requestId) return;
  payload = data;
  draw(hash);
  status.hidden = true;
}
window.addEventListener("message", async (event) => {
  if (
    event.source !== frame?.contentWindow ||
    !payload ||
    !event.data ||
    typeof event.data !== "object"
  )
    return;
  const message = event.data;
  if (message.type === "lamoframe-preference") {
    if (message.key !== preferenceKey()) return;
    const name = message.name,
      value = message.value;
    if (!(
      (name === "theme" && ["light", "dark"].includes(value)) ||
      (name === "width" &&
        Number.isFinite(value) &&
        value >= 160 &&
        value <= 440) ||
      (name === "collapsed" && typeof value === "boolean")
    ))
      return;
    try {
      localStorage.setItem(
        "lamoframe-site:" + message.key,
        JSON.stringify({ ...prefs(), [name]: value }),
      );
    } catch {}
    return;
  }
  if (message.type === "lamoframe-navigation") {
    if (/^page-[a-z0-9-]+$/.test(message.page || ""))
      history.replaceState(null, "", "#" + message.page);
    return;
  }
  if (message.type === "lamoframe-period") {
    if (![0, 7, 30].includes(message.days)) return;
    periodDays = message.days;
    draw("#" + (message.page || ""));
    return;
  }
  if (message.type === "lamoframe-manage") {
    if (payload.role === "owner")
      location.assign(`/projects/${payload.projectId}/application/`);
    return;
  }
  if (!["lamoframe-record", "lamoframe-mutate"].includes(message.type)) return;
  const c = payload.collections[message.collection];
  if (!c) return;
  if (message.record && !c.rows.some((r) => r.id === message.record)) return;
  if (message.type === "lamoframe-record") {
    if (!message.record && !c.canEdit) return;
    const target = new URL(
      message.record
        ? c.createUrl.replace(/new\/$/, `${message.record}/`)
        : c.createUrl,
      location.origin,
    );
    if (/^page-[a-z0-9-]+$/.test(message.page || ""))
      target.searchParams.set("page", message.page);
    location.assign(target.href);
    return;
  }
  if (!c.canEdit) return;
  try {
    const response = await fetch(`/apps/${payload.projectId}/mutate/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": csrfToken(),
        Accept: "application/json",
      },
      body: JSON.stringify({
        collection: message.collection,
        record: message.record,
        revision: message.revision,
        values: message.values,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Не удалось изменить запись");
    await refresh("#" + (message.page || ""));
  } catch (error) {
    await refresh("#" + (message.page || "")).catch(() => {});
    showError(error.message);
  }
});
if (frame) {
  refresh().catch((error) => showError(error.message));
  window.addEventListener("pagehide", () => {
    if (documentUrl) URL.revokeObjectURL(documentUrl);
  });
  document
    .getElementById("refreshApplication")
    ?.addEventListener("click", () =>
      refresh().catch((error) => showError(error.message)),
    );
}
