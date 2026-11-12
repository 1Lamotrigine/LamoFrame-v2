const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function shellConfig(doc) {
  const s = doc.settings?.sidebar || {};
  const min = Math.max(160, Math.min(280, Number(s.min) || 180));
  const max = Math.max(min, Math.min(440, Number(s.max) || 360));
  return {
    enabled: !!s.enabled,
    width: Math.max(min, Math.min(max, Number(s.width) || 240)),
    min,
    max,
    brand: String(s.brand || doc.meta?.title || "Рабочее пространство").slice(
      0,
      100,
    ),
    theme: ["light", "dark", "switchable"].includes(doc.settings?.theme)
      ? doc.settings.theme
      : "light",
    key: doc.settings?.siteKey || doc.meta?.title || "site",
    fluid: !!doc.settings?.fluidLayout,
  };
}
export function shellMarkup(
  doc,
  content,
  { pageHrefs, pageId, preferences = {} } = {},
) {
  const config = shellConfig(doc),
    pages = doc.pages || [];
  const theme =
    config.theme === "switchable"
      ? preferences.theme === "dark"
        ? "dark"
        : "light"
      : config.theme;
  const links = pages
    .map(
      (p, i) =>
        `<a class="lf-nav-link${pageId === p.id || (!pageId && i === 0) ? " is-active" : ""}" href="${esc(pageHrefs?.get(p.id) || "#page-" + p.slug)}" data-page-link="${esc(p.slug)}"><span class="lf-nav-icon" aria-hidden="true">${["◈", "♙", "▥", "✓", "⚙"][i % 5]}</span><span class="lf-nav-label">${esc(p.name)}</span></a>`,
    )
    .join("");
  const themeButton =
    config.theme === "switchable"
      ? '<button class="lf-theme-toggle" type="button" aria-label="Переключить тему сайта">◐ <span class="lf-nav-label">Сменить тему</span></button>'
      : "";
  return `<div class="lf-shell${config.enabled ? " has-sidebar" : ""}${config.fluid ? " is-fluid" : ""}" data-site-theme="${theme}" data-shell-config="${esc(JSON.stringify(config))}" style="--lf-sidebar-width:${config.width}px">
 ${config.enabled ? `<button class="lf-mobile-menu" type="button" aria-label="Открыть меню" aria-expanded="false">☰</button><button class="lf-mobile-shade" aria-label="Закрыть меню" hidden></button><aside class="lf-sidebar"><div class="lf-brand"><span class="lf-brand-mark">L</span><strong class="lf-nav-label">${esc(config.brand)}</strong></div><nav aria-label="Страницы сайта">${links}</nav><div class="lf-sidebar-bottom">${themeButton}<button class="lf-collapse" type="button" aria-label="Свернуть меню" aria-expanded="true">⇤ <span class="lf-nav-label">Свернуть меню</span></button></div><div class="lf-sidebar-grip" role="separator" aria-label="Ширина меню" aria-orientation="vertical" tabindex="0" aria-valuemin="${config.min}" aria-valuemax="${config.max}" aria-valuenow="${config.width}"></div></aside>` : themeButton ? `<div class="lf-floating-theme">${themeButton}</div>` : ""}
 <div class="lf-content">${content}</div></div>`;
}
export const SHELL_CSS = `
.lf-shell{--lf-bg:#f5f6fa;--lf-surface:#fff;--lf-ink:#182230;--lf-muted:#667085;--lf-border:#e4e7ec;--lf-accent:#4f46e5;--lf-soft:#eef2ff;min-height:100vh;background:var(--lf-bg);color:var(--lf-ink);font-family:Inter,system-ui,sans-serif}
.lf-shell[data-site-theme=dark]{--lf-bg:#11151e;--lf-surface:#1c2330;--lf-ink:#edf2fb;--lf-muted:#a6b2c5;--lf-border:#344054;--lf-accent:#a5a0ff;--lf-soft:#30334e;color-scheme:dark}
.lf-shell .lf-content{min-width:0}.lf-shell.has-sidebar .lf-content{margin-left:var(--lf-sidebar-width)}
.lf-sidebar{position:fixed;inset:0 auto 0 0;width:var(--lf-sidebar-width);background:var(--lf-surface);border-right:1px solid var(--lf-border);display:flex;flex-direction:column;z-index:90;padding:24px 14px;box-sizing:border-box}
.lf-brand{display:flex;align-items:center;gap:10px;padding:0 8px 30px;font-size:15px;min-width:0}.lf-brand strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lf-brand-mark{width:32px;height:32px;display:grid;place-items:center;background:#4f46e5;color:white;border-radius:10px;flex-shrink:0;font-weight:800}
.lf-sidebar nav{display:grid;gap:6px}.lf-nav-link{display:flex;gap:12px;align-items:center;padding:12px;border-radius:10px;color:var(--lf-muted);text-decoration:none;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden}.lf-nav-link:hover,.lf-nav-link.is-active{background:var(--lf-soft);color:var(--lf-accent)}.lf-nav-icon{width:20px;text-align:center;flex-shrink:0}.lf-sidebar-bottom{margin-top:auto;display:grid;gap:8px;padding-top:24px}
.lf-shell button,.lf-shell input,.lf-shell select,.lf-shell textarea{font:inherit}.lf-theme-toggle,.lf-collapse{border:1px solid var(--lf-border);color:var(--lf-ink);background:var(--lf-surface);border-radius:9px;padding:10px;cursor:pointer;text-align:left;font-size:13px;white-space:nowrap}.lf-sidebar-grip{position:absolute;right:-4px;top:0;bottom:0;width:8px;cursor:col-resize;touch-action:none}.lf-sidebar-grip:hover,.lf-sidebar-grip:focus-visible{background:#818cf8;outline:none}.lf-shell.is-collapsed{--lf-sidebar-width:72px!important}.lf-shell.is-collapsed .lf-sidebar .lf-nav-label{display:none}.lf-shell.is-collapsed .lf-sidebar{padding-inline:10px}.lf-shell.is-collapsed .lf-brand{padding-inline:8px}.lf-shell.is-collapsed .lf-sidebar-grip{display:none}.lf-floating-theme{position:fixed;top:12px;right:14px;z-index:99}
.lf-shell.is-fluid .sb-site{width:100%!important;max-width:none;margin:0!important;background:var(--lf-bg)!important}.lf-shell.is-fluid .sb-viewport{width:100%!important;height:auto!important;min-height:100vh;overflow:visible!important;padding:0!important}.lf-shell.is-fluid .sb-section{width:100%!important;min-width:0;transform:none!important;box-sizing:border-box;background:var(--lf-bg)!important;padding:30px!important;height:auto!important;min-height:500px}.lf-shell.is-fluid .sb-canvas{position:static!important;display:grid!important;grid-template-columns:repeat(12,minmax(0,1fr));gap:18px;width:100%!important;height:auto!important;transform:none!important;zoom:1!important;padding:0!important}.lf-shell.is-fluid .sb-canvas>.sb-el{position:relative!important;inset:auto!important;transform:none!important;grid-column:span 12;width:100%!important;height:auto!important;min-width:0;order:var(--lf-order,0);margin:0!important}.lf-shell.is-fluid .sb-el-metric{grid-column:span 3!important;min-height:148px}.lf-shell.is-fluid .sb-el-chart{grid-column:span 6!important;min-height:310px}.lf-shell.is-fluid .sb-el-record-form{justify-self:end;width:auto!important}.lf-shell.is-fluid .sb-el-heading{min-height:42px}.lf-shell.is-fluid .sb-el-text{min-height:24px}.lf-shell.is-fluid .sb-el-table,.lf-shell.is-fluid .sb-el-kanban{min-height:100px}
.lf-shell[data-site-theme=dark] .sb-text,.lf-shell[data-site-theme=dark] .sb-link{color:var(--lf-ink)!important}.lf-shell[data-site-theme=dark] .sb-section,.lf-shell[data-site-theme=dark] .sb-nested{background:var(--lf-bg)!important}.lf-shell[data-site-theme=dark] .sb-metric,.lf-shell[data-site-theme=dark] .sb-chart,.lf-shell[data-site-theme=dark] .sb-table,.lf-shell[data-site-theme=dark] .sb-calc{background:var(--lf-surface)!important;color:var(--lf-ink)!important;border-color:var(--lf-border)!important}.lf-shell[data-site-theme=dark] .sb-metric-label,.lf-shell[data-site-theme=dark] .sb-metric-hint,.lf-shell[data-site-theme=dark] .sb-chart-head span,.lf-shell[data-site-theme=dark] .sb-table-head span{color:var(--lf-muted)!important}.lf-shell[data-site-theme=dark] table th,.lf-shell[data-site-theme=dark] table td{background:var(--lf-surface)!important;color:var(--lf-ink)!important;border-color:var(--lf-border)!important}.lf-shell[data-site-theme=dark] .sb-metric-value{color:var(--lf-ink)!important}
.lf-shell[data-site-theme=dark] svg text{fill:var(--lf-muted)!important}.lf-mobile-menu,.lf-mobile-shade{display:none}
@media(max-width:1050px){.lf-shell.is-fluid .sb-el-metric{grid-column:span 6!important}.lf-shell.is-fluid .sb-el-chart{grid-column:span 12!important}}
@media(max-width:760px){.lf-shell.has-sidebar .lf-content{margin-left:0;padding-top:46px}.lf-shell .lf-sidebar{width:240px!important;transform:translateX(-100%);transition:transform .16s}.lf-shell.is-menu-open .lf-sidebar{transform:none}.lf-shell.is-menu-open .lf-sidebar .lf-nav-label{display:inline}.lf-mobile-menu{display:block;position:fixed;top:8px;left:12px;z-index:100;border:1px solid var(--lf-border);border-radius:8px;background:var(--lf-surface);color:var(--lf-ink);padding:8px 12px}.lf-shell.is-menu-open .lf-mobile-shade{display:block;position:fixed;inset:0;background:#0006;border:0;z-index:80}.lf-sidebar-grip,.lf-collapse{display:none}.lf-shell.is-fluid .sb-section{padding:18px!important}.lf-shell.is-fluid .sb-el-metric{grid-column:span 6!important}}
`;
// Serialized into standalone HTML / exported main.js. Do not add module dependencies here.
function shellRuntime(initial) {
  const shell = document.querySelector(".lf-shell");
  if (!shell) return;
  const config = JSON.parse(shell.dataset.shellConfig);
  const key = "lamoframe-site:" + config.key;
  let prefs = initial || {};
  try {
    prefs = { ...JSON.parse(localStorage.getItem(key) || "{}"), ...prefs };
  } catch {}
  function store(name, value) {
    prefs[name] = value;
    try {
      localStorage.setItem(key, JSON.stringify(prefs));
    } catch {}
    if (parent !== window)
      parent.postMessage(
        { type: "lamoframe-preference", key: config.key, name, value },
        "*",
      );
  }
  function theme(value) {
    shell.dataset.siteTheme = value === "dark" ? "dark" : "light";
    shell
      .querySelector(".lf-theme-toggle")
      ?.setAttribute("aria-pressed", String(value === "dark"));
  }
  if (config.theme === "switchable")
    theme(
      prefs.theme ||
        (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
    );
  else theme(config.theme);
  shell.querySelector(".lf-theme-toggle")?.addEventListener("click", () => {
    const v = shell.dataset.siteTheme === "dark" ? "light" : "dark";
    theme(v);
    store("theme", v);
  });
  let width = Math.max(
    config.min,
    Math.min(config.max, Number(prefs.width) || config.width),
  );
  const grip = shell.querySelector(".lf-sidebar-grip");
  const setWidth = (v) => {
    width = Math.max(config.min, Math.min(config.max, v));
    shell.style.setProperty("--lf-sidebar-width", width + "px");
    grip?.setAttribute("aria-valuenow", width);
    window.dispatchEvent(new Event("resize"));
  };
  setWidth(width);
  const collapse = (value) => {
    shell.classList.toggle("is-collapsed", !!value);
    shell
      .querySelector(".lf-collapse")
      ?.setAttribute("aria-expanded", String(!value));
    window.dispatchEvent(new Event("resize"));
  };
  collapse(prefs.collapsed);
  shell.querySelector(".lf-collapse")?.addEventListener("click", () => {
    const v = !shell.classList.contains("is-collapsed");
    collapse(v);
    store("collapsed", v);
  });
  let dragging = false;
  grip?.addEventListener("pointerdown", (e) => {
    dragging = true;
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip?.addEventListener("pointermove", (e) => {
    if (dragging) setWidth(e.clientX);
  });
  const finish = () => {
    if (dragging) {
      dragging = false;
      store("width", width);
    }
  };
  grip?.addEventListener("pointerup", finish);
  grip?.addEventListener("pointercancel", finish);
  grip?.addEventListener("lostpointercapture", finish);
  grip?.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      setWidth(
        e.key === "Home"
          ? config.min
          : e.key === "End"
            ? config.max
            : width + (e.key === "ArrowRight" ? 16 : -16),
      );
      store("width", width);
    }
  });
  const menu = shell.querySelector(".lf-mobile-menu"),
    shade = shell.querySelector(".lf-mobile-shade");
  const close = () => {
    shell.classList.remove("is-menu-open");
    menu?.setAttribute("aria-expanded", "false");
    if (shade) shade.hidden = true;
  };
  menu?.addEventListener("click", () => {
    const open = !shell.classList.contains("is-menu-open");
    shell.classList.toggle("is-menu-open", open);
    menu.setAttribute("aria-expanded", String(open));
    if (shade) shade.hidden = !open;
  });
  shade?.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  function active(event) {
    const slug =
      typeof event?.detail === "string"
        ? event.detail
        : location.hash.replace("#page-", "") ||
          shell.querySelector(".lf-nav-link")?.dataset.pageLink;
    shell
      .querySelectorAll(".lf-nav-link")
      .forEach((a) =>
        a.classList.toggle("is-active", a.dataset.pageLink === slug),
      );
  }
  if (
    [...shell.querySelectorAll(".lf-nav-link")].some((a) =>
      a.getAttribute("href").startsWith("#"),
    )
  ) {
    active();
    addEventListener("hashchange", active);
    addEventListener("lamoframe-page-shown", active);
  }
  shell
    .querySelectorAll(".lf-nav-link")
    .forEach((a) => a.addEventListener("click", close));
}
export function shellScript(preferences = {}) {
  return `(${shellRuntime.toString()})(${JSON.stringify(preferences).replace(/</g, "\\u003c")});`;
}

export function contentWidth(doc) {
  const c = shellConfig(doc);
  return Math.max(
    320,
    (Number(doc.settings?.width) || 1200) - (c.enabled ? c.width : 0),
  );
}
