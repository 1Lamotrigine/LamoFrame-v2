import { database, query } from "./db.mjs";
import { handle } from "./backend.mjs";
import { exportWorkspace, importWorkspace } from "./backup.mjs";
const nativeFetch = window.fetch.bind(window);
const assetURLs = new Map();
window.LAMO_LOCAL = true;
async function media() {
  const files = await query("SELECT name,content FROM local_files");
  const alive = new Set();
  for (const file of files) {
    const path = "/media/" + file.name;
    alive.add(path);
    if (!assetURLs.has(path)) {
      const ext = file.name.split(".").pop().toLowerCase();
      const type =
        {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
        }[ext] || "application/octet-stream";
      assetURLs.set(
        path,
        URL.createObjectURL(new Blob([file.content], { type })),
      );
    }
  }
  for (const [key, value] of assetURLs)
    if (!alive.has(key)) {
      URL.revokeObjectURL(value);
      assetURLs.delete(key);
    }
  window.LAMO_MEDIA_URLS = Object.fromEntries(assetURLs);
}
function localURL(url) {
  return (
    url.origin === location.origin &&
    (!/^\/(static|local)\//.test(url.pathname) ||
      /^\/local\/backup\/?$/.test(url.pathname)) &&
    !url.pathname.startsWith("/_next/")
  );
}
async function request(input, options = {}) {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    location.href,
  );
  if (!localURL(url)) return nativeFetch(input, options);
  const req = new Request(
    url,
    input instanceof Request
      ? {
          ...options,
          method: options.method || input.method,
          headers: options.headers || input.headers,
          body: ["GET", "HEAD"].includes(input.method)
            ? undefined
            : await input.arrayBuffer(),
        }
      : options,
  );
  req.headers.set(
    "x-local-profile",
    localStorage.getItem("lamoframe.profile") || "",
  );
  if (req.signal.aborted)
    throw new DOMException("Запрос отменён", "AbortError");
  return navigator.locks.request("lamoframe-browser-request", async () => {
    const response = await handle(req);
    if (response.headers.has("X-Local-Profile")) {
      const id = response.headers.get("X-Local-Profile");
      if (id) localStorage.setItem("lamoframe.profile", id);
      else localStorage.removeItem("lamoframe.profile");
    }
    if (req.method !== "GET") await media();
    return response;
  });
}
async function localFetch(input, options = {}) {
  let response = await request(input, options),
    redirected = false;
  let url = new URL(
    input instanceof Request ? input.url : String(input),
    location.href,
  ).href;
  for (
    let n = 0;
    response.status >= 300 && response.status < 400 && response.status !== 304;
    n++
  ) {
    if (n >= 8)
      throw Error("Не удалось открыть страницу: слишком много переходов.");
    redirected = true;
    url = new URL(response.headers.get("location"), url).href;
    response = await request(url, {
      headers: { Accept: options.headers?.Accept || "text/html" },
    });
  }
  Object.defineProperty(response, "redirected", { value: redirected });
  Object.defineProperty(response, "url", { value: url });
  return response;
}
function download(value, name) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function wire() {
  window.fetch = localFetch;
  document.addEventListener(
    "submit",
    async (event) => {
      const form = event.target;
      if (
        !(form instanceof HTMLFormElement) ||
        form.id === "localImportForm" ||
        form.method.toUpperCase() === "GET"
      )
        return;
      const target = new URL(form.action || location.href, location.href);
      if (!localURL(target)) return;
      event.preventDefault();
      const data = new FormData(form);
      if (event.submitter?.name)
        data.append(event.submitter.name, event.submitter.value);
      const controls = [...form.querySelectorAll("button")];
      controls.forEach((b) => (b.disabled = true));
      try {
        const response = await request(target.href, {
          method: "POST",
          body: data,
        });
        if (response.status >= 300 && response.status < 400) {
          location.assign(
            new URL(response.headers.get("location"), location.href).href,
          );
          return;
        }
        if (response.headers.get("content-type")?.includes("text/html"))
          renderHTML(await response.text());
        else {
          const payload = await response.json();
          alert(payload.error || "Действие выполнено.");
        }
      } catch (error) {
        alert(error.message || "Не удалось сохранить данные.");
      } finally {
        controls.forEach((b) => (b.disabled = false));
      }
    },
    true,
  );
  function backupControls() {
    document
      .querySelector("[data-local-export]")
      ?.addEventListener("click", async (event) => {
        event.target.disabled = true;
        try {
          const data = await navigator.locks.request(
            "lamoframe-browser-request",
            () => exportWorkspace(),
          );
          download(
            data,
            "lamoframe-workspace-" +
              new Date().toISOString().slice(0, 10) +
              ".json",
          );
        } catch (e) {
          document.getElementById("localBackupStatus").textContent = e.message;
        } finally {
          event.target.disabled = false;
        }
      });
    document
      .getElementById("localImportForm")
      ?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.target,
          status = document.getElementById("localBackupStatus"),
          file = form.elements.backup.files[0];
        if (!file || !form.elements.confirm.checked) return;
        if (file.size > 100 * 1024 * 1024) {
          status.textContent = "Файл больше 100 МБ.";
          return;
        }
        const button = form.querySelector("button");
        button.disabled = true;
        status.textContent = "Восстанавливаем мастерскую…";
        try {
          const data = JSON.parse(await file.text());
          await navigator.locks.request("lamoframe-browser-request", () =>
            importWorkspace(data),
          );
          localStorage.removeItem("lamoframe.profile");
          localStorage.setItem(
            "lamoframe.recoveryGeneration",
            crypto.randomUUID(),
          );
          location.assign("/accounts/login/");
        } catch (e) {
          status.textContent =
            "Копия не восстановлена: " +
            e.message +
            " Текущие данные сохранены.";
        } finally {
          button.disabled = false;
        }
      });
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", backupControls, {
      once: true,
    });
  else backupControls();
  window.addEventListener("storage", (event) => {
    if (
      ["lamoframe.profile", "lamoframe.recoveryGeneration"].includes(event.key)
    )
      location.replace("/");
  });
}
window.__LAMO_WIRE__ = wire;
function renderHTML(html) {
  // New documents re-use the same window only for form validation. Full navigations
  // create a fresh module realm, keeping the existing editor modules independent.
  const bridge = "<script>window.__LAMO_WIRE__();<\/script>";
  document.open();
  document.write(html.replace("<head>", "<head>" + bridge));
  document.close();
}
function fail(error) {
  document.body.innerHTML = "";
  const main = document.createElement("main");
  main.style.cssText =
    "font:16px system-ui;max-width:640px;margin:12vh auto;padding:24px";
  const title = document.createElement("h1");
  title.textContent = "Не удалось открыть мастерскую";
  const message = document.createElement("p");
  message.textContent =
    error.message ||
    "Проверьте, что браузер разрешает IndexedDB и Web Workers.";
  const button = document.createElement("button");
  button.textContent = "Повторить";
  button.onclick = () => location.reload();
  main.append(title, message, button);
  document.body.append(main);
  console.error(error);
}
try {
  await database();
  await media();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  const response = await request(location.href, {
    headers: { Accept: "text/html" },
  });
  if (response.status >= 300 && response.status < 400)
    location.replace(
      new URL(response.headers.get("location"), location.href).href,
    );
  else if (/\/raw\/$/.test(location.pathname)) {
    const frame = document.createElement("iframe");
    frame.setAttribute(
      "sandbox",
      "allow-scripts allow-popups allow-forms allow-downloads",
    );
    frame.title = "Локальное превью";
    frame.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;border:0";
    frame.srcdoc = await response.text();
    document.body.replaceChildren(frame);
  } else renderHTML(await response.text());
} catch (error) {
  fail(error);
}
