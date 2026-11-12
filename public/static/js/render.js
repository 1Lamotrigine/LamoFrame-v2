import {shellMarkup,shellScript,SHELL_CSS,contentWidth} from "./site-shell.js";
import {metricFromRecords,chartFromRecords,renderKanban,renderCRMSettings,CRM_CSS,CRM_SCRIPT} from "./crm-widgets.js";
/**
 * Единый рендерер документа: холст редактора, превью и экспорт.
 * Никакой другой модуль не собирает HTML страницы.
 */

const FONTS = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  inter: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function attr(value) {
  return escapeHtml(value);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Вернуть список фреймов документа, приводя старую схему «секций» к фреймам.
 * Нужно, чтобы дашборд, превью и экспорт умели читать и старые документы.
 */
export function normalizeFrames(doc) {
  if (Array.isArray(doc?.frames)) return doc.frames;
  const sections = Array.isArray(doc?.sections) ? doc.sections : [];
  const width = Math.max(320, num(doc?.settings?.width, 1200));
  let y = 0;
  return sections.map((section, index) => {
    const h = Math.max(40, num(section.height, 560));
    const frame = {
      id: section.id || `f_${index}`,
      name: section.name || `Фрейм ${index + 1}`,
      x: 0,
      y,
      w: width,
      h,
      bg: section.bg || "#ffffff",
      radius: 0,
      elements: Array.isArray(section.elements) ? section.elements : [],
    };
    y += h;
    return frame;
  });
}

/** CSS-значение из пользовательского ввода без возможности закрыть правило. */
function css(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value)
    .replace(/[;{}<>]/g, "")
    .replace(/[\r\n"]/g, " ")
    .replace(/'/g, "")
    .trim() || fallback;
}

function safeUrl(url, fallback = "") {
  const value = String(url || "").trim();
  if (!value) return fallback;
  if (/^(https?:|mailto:|tel:|data:image\/|#|\/|\.\.?\/)/i.test(value)) return value;
  return fallback;
}

export function fontStack(name) {
  return FONTS[name] || FONTS.system;
}

export function elementTypeLabel(type) {
  return {
    text: "Текст",
    heading: "Заголовок",
    button: "Кнопка",
    link: "Ссылка",
    image: "Изображение",
    shape: "Фигура",
    line: "Линия",
    embed: "Встраивание",
    nav: "Навигация",
    chart: "График",
    metric: "Метрика",
    table: "Таблица",
    "record-form": "Форма записи",
    calculator: "Калькулятор",
  }[type] || "Элемент";
}

export function emptyStateFor(type) {
  return {
    text: "Дважды кликните, чтобы править текст",
    heading: "Дважды кликните, чтобы править заголовок",
    button: "Текст кнопки",
    link: "Текст ссылки",
    image: "Изображение",
    shape: "",
    line: "",
    embed: "",
    nav: "",
    chart: "",
    metric: "",
    table: "",
    calculator: "",
  }[type] || "";
}

function wrapperStyle(el, order = null) {
  const style = el.style || {};
  const w = Math.max(1, num(el.w, 100));
  const h = Math.max(1, num(el.h, 100));
  return [
    `position:absolute`,
    `left:${num(el.x)}px`,
    `top:${num(el.y)}px`,
    `width:${w}px`,
    `height:${h}px`,
    `z-index:${num(el.z, 1)}`,
    `transform:rotate(${num(el.rotation)}deg)`,
    `opacity:${clamp(style.opacity, 0, 1, 1)}`,
    `--sb-order:${order === null ? Math.round(num(el.z, 1)) : order}`,
    `--sb-ratio:${(w / h).toFixed(4)}`,
    el.hidden ? "display:none" : "",
  ]
    .filter(Boolean)
    .join(";");
}

function typography(style) {
  return [
    `font-family:${fontStack(style.fontFamily)}`,
    `font-size:${clamp(style.fontSize, 6, 240, 16)}px`,
    `font-weight:${clamp(style.fontWeight, 100, 900, 400)}`,
    `line-height:${clamp(style.lineHeight, 0.6, 3, 1.4)}`,
    `letter-spacing:${clamp(style.letterSpacing, -10, 40, 0)}px`,
    `text-align:${["left", "center", "right", "justify"].includes(style.textAlign) ? style.textAlign : "left"}`,
    `color:${css(style.color, "#18181b")}`,
    style.fontStyle === "italic" ? "font-style:italic" : "",
    style.textDecoration === "underline" ? "text-decoration:underline" : "",
    style.textTransform ? `text-transform:${css(style.textTransform)}` : "",
  ]
    .filter(Boolean)
    .join(";");
}

function boxStyle(style) {
  return [
    `background:${css(style.fill, "transparent")}`,
    `border-radius:${clamp(style.borderRadius, 0, 999, 0)}px`,
    `border:${clamp(style.borderWidth, 0, 40, 0)}px solid ${css(style.borderColor, "transparent")}`,
    style.boxShadow ? `box-shadow:${css(style.boxShadow)}` : "",
  ]
    .filter(Boolean)
    .join(";");
}

function resolveHref(href, ctx) {
  const value = String(href || "").trim();
  if (!value) return "";
  if (value.startsWith("page:")) {
    const id = value.slice(5);
    if (ctx?.pageHrefs?.has(id)) return ctx.pageHrefs.get(id);
    const slug = ctx?.pageSlugs?.get(id);
    return slug ? `#page-${slug}` : "#";
  }
  // Внутренние якоря (#about) оставляем как есть — скрипт страниц их не
  // перехватывает, а браузер сам прокрутит к элементу с таким id.
  if (value.startsWith("#")) return safeAnchor(value);
  return safeUrl(value, "");
}

function safeAnchor(value) {
  const name = value.slice(1);
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return "";
  if (name.startsWith("page-")) return "";
  return `#${name}`;
}

function targetAttrs(el, ctx, fallback = "_self") {
  if (ctx?.editor) return "";
  const raw = el.props?.target ?? el.target;
  const target = raw === "_blank" || raw === "_self" ? raw : fallback;
  if (target !== "_blank") return "";
  return ' target="_blank" rel="noopener"';
}

function textContent(el) {
  const text = el.props?.text ?? "";
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function renderText(el, editor, ctx) {
  const tag = el.type === "heading" ? `h${Math.round(clamp(el.props?.level, 1, 3, 2))}` : "div";
  const placeholder = !String(el.props?.text || "").trim() && editor ? "sb-placeholder" : "";
  const overflow = el.style?.overflow === "visible" ? "visible" : "hidden";
  const justify = { top: "flex-start", middle: "center", bottom: "flex-end" }[el.style?.verticalAlign] || "flex-start";
  const vAlignCss = `display:flex;flex-direction:column;justify-content:${justify};`;
  const inner = `<${tag} class="sb-text ${placeholder}" style="${typography(el.style || {})};${vAlignCss}margin:0;width:100%;height:100%;overflow:${overflow};white-space:pre-wrap;overflow-wrap:break-word;">${textContent(el) || (editor ? "Текст" : "")}</${tag}>`;
  const href = resolveHref(el.props?.href, ctx);
  if (!href || editor) return inner;
  return `<a class="sb-text-link" href="${attr(href)}"${targetAttrs(el, ctx, "_self")} style="display:block;width:100%;height:100%;text-decoration:none;color:inherit;">${inner}</a>`;
}

function renderButton(el, editor, ctx) {
  const href = resolveHref(el.props?.href, ctx);
  const tag = href ? "a" : "span";
  const style = [
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "width:100%",
    "height:100%",
    "padding:0 12px",
    "text-align:center",
    "text-decoration:none",
    "box-sizing:border-box",
    "cursor:pointer",
    "overflow:hidden",
    typography(el.style || {}),
    boxStyle(el.style || {}),
  ].join(";");
  const hrefAttr = href ? ` href="${attr(href)}"${targetAttrs(el, ctx, "_self")}` : "";
  return `<${tag} class="sb-button"${hrefAttr} style="${style}">${escapeHtml(el.props?.text || "Кнопка")}</${tag}>`;
}

function renderLink(el, editor, ctx) {
  const href = resolveHref(el.props?.href, ctx);
  const style = [
    "display:flex",
    "align-items:center",
    "width:100%",
    "height:100%",
    "text-decoration:underline",
    "cursor:pointer",
    "overflow:hidden",
    typography(el.style || {}),
  ].join(";");
  const hrefAttr = href ? ` href="${attr(href)}"${targetAttrs(el, ctx, "_blank")}` : "";
  const tag = href ? "a" : "span";
  return `<${tag} class="sb-link"${hrefAttr} style="${style}">${textContent(el) || (editor ? "Ссылка" : "")}</${tag}>`;
}

function renderImage(el, editor, ctx) {
  const originalSrc = safeUrl(el.props?.src, "");
  const mapped = (originalSrc && ctx?.imageMap?.get(originalSrc)) || originalSrc;
  const src = ctx?.appOrigin && mapped.startsWith("/") && !mapped.startsWith("//")
    ? new URL(mapped, ctx.appOrigin).href
    : mapped;
  if (!src) {
    return `<div class="sb-image-empty" style="width:100%;height:100%;display:grid;place-items:center;background:${editor ? "#f4f4f5" : "transparent"};border-radius:${clamp(el.style?.borderRadius, 0, 999, 0)}px;color:#a1a1aa;font-size:12px;">${editor ? "Выберите изображение" : ""}</div>`;
  }
  return `<img class="sb-image" src="${attr(src)}" alt="${attr(el.props?.alt || el.name || "")}" draggable="false" style="width:100%;height:100%;object-fit:${["cover", "contain", "fill"].includes(el.style?.objectFit) ? el.style.objectFit : "cover"};border-radius:${clamp(el.style?.borderRadius, 0, 999, 0)}px;display:block;">`;
}

function renderShape(el) {
  const isEllipse = el.props?.shape === "ellipse";
  const style = [
    "width:100%",
    "height:100%",
    boxStyle(el.style || {}),
    isEllipse ? "border-radius:50%" : "",
  ]
    .filter(Boolean)
    .join(";");
  return `<div class="sb-shape" style="${style}"></div>`;
}

function renderLine(el) {
  const thickness = clamp(el.style?.strokeWidth, 1, 40, 2);
  const style = [
    "width:100%",
    `height:${thickness}px`,
    "position:absolute",
    "top:50%",
    "transform:translateY(-50%)",
    `background:${css(el.style?.fill, "#18181b")}`,
    `border-radius:${clamp(el.style?.borderRadius, 0, 999, 0)}px`,
  ].join(";");
  return `<div class="sb-line" style="${style}"></div>`;
}

function renderEmbed(el, editor) {
  const src = safeUrl(el.props?.src, "");
  if (!src) {
    return `<div class="sb-embed-empty" style="width:100%;height:100%;display:grid;place-items:center;background:${editor ? "#f4f4f5" : "transparent"};border-radius:8px;color:#a1a1aa;font-size:12px;">${editor ? "Укажите ссылку на встраиваемый контент" : ""}</div>`;
  }
  return `<iframe class="sb-embed-frame" src="${attr(src)}" title="${attr(el.name || "Встраивание")}" style="width:100%;height:100%;border:0;border-radius:${clamp(el.style?.borderRadius, 0, 999, 0)}px;" loading="lazy" sandbox="allow-scripts allow-popups"></iframe>`;
}


// ---------------------------------------------------------------------------
// Динамические блоки: навигация с бургером, графики, метрики, таблицы,
// калькуляторы. В редакторе они рисуются статично,
// а в превью/экспорте оживают благодаря INTERACTIVE_SCRIPT ниже.
// ---------------------------------------------------------------------------

const CHART_COLORS = ["#4F46E5", "#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6"];

function intlNumber(value, decimals = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  try {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(n);
  } catch (error) {
    return String(Math.round(n));
  }
}

function chartSettings(el) {
  const raw = el.props?.chart && typeof el.props.chart === "object" ? el.props.chart : {};
  const rows = Array.isArray(raw.data) ? raw.data : [];
  const data = rows
    .map((item) => {
      if (item && typeof item === "object") return { label: String(item.label ?? ""), value: Number(item.value) || 0 };
      return { label: String(item ?? ""), value: 0 };
    })
    .filter((item) => item.label || item.value);
  return {
    type: ["bar", "line", "area", "pie", "donut"].includes(raw.type) ? raw.type : "bar",
    title: raw.title || "Динамика",
    subtitle: raw.subtitle || "",
    data: data.length ? data : [{ label: "A", value: 32 }, { label: "B", value: 48 }, { label: "C", value: 61 }],
    color: raw.color || "#4F46E5",
    accent: raw.accent || "#C7D2FE",
    showValues: raw.showValues !== false,
    showLegend: raw.showLegend !== false,
    suffix: raw.suffix || "",
    decimals: Math.max(0, Math.min(4, Number(raw.decimals) || 0)),
  };
}

function chartSvg(config, editor = false) {
  const W = 640;
  const H = 320;
  const values = config.data;
  const max = Math.max(1, ...values.map((item) => Math.abs(item.value)));
  const niceMax = max <= 10 ? 10 : Math.ceil(max / 10) * 10;
  const colors = [config.color, ...CHART_COLORS.slice(1)];
  const parts = [];
  parts.push(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${attr(config.title)}" style="width:100%;height:auto;display:block;overflow:visible">`);
  if (config.type === "pie" || config.type === "donut") {
    const total = values.reduce((sum, item) => sum + Math.max(0, item.value), 0) || 1;
    const cx = 320;
    const cy = 158;
    const outer = 118;
    const inner = config.type === "donut" ? 64 : 0;
    let angle = -Math.PI / 2;
    values.forEach((item, index) => {
      const share = Math.max(0, item.value) / total;
      const next = angle + share * Math.PI * 2;
      const large = next - angle > Math.PI ? 1 : 0;
      const x1 = cx + outer * Math.cos(angle);
      const y1 = cy + outer * Math.sin(angle);
      const x2 = cx + outer * Math.cos(next);
      const y2 = cy + outer * Math.sin(next);
      let path = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${outer} ${outer} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
      if (inner) {
        const ix1 = cx + inner * Math.cos(next);
        const iy1 = cy + inner * Math.sin(next);
        const ix2 = cx + inner * Math.cos(angle);
        const iy2 = cy + inner * Math.sin(angle);
        path = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${outer} ${outer} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${ix1.toFixed(2)} ${iy1.toFixed(2)} A ${inner} ${inner} 0 ${large} 0 ${ix2.toFixed(2)} ${iy2.toFixed(2)} Z`;
      }
      parts.push(`<path class="sb-chart-slice" d="${path}" fill="${attr(colors[index % colors.length])}" stroke="#fff" stroke-width="2"/>`);
      if (share > 0.08) {
        const mid = (angle + next) / 2;
        const lx = cx + (inner ? (outer + inner) / 2 : outer * 0.62) * Math.cos(mid);
        const ly = cy + (inner ? (outer + inner) / 2 : outer * 0.62) * Math.sin(mid);
        parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="700" fill="#fff">${Math.round(share * 100)}%</text>`);
      }
      angle = next;
    });
    if (inner) {
      parts.push(`<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="12" fill="#71717A">Всего</text>`);
      parts.push(`<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="22" font-weight="800" fill="#18181B">${attr(intlNumber(total, config.decimals))}</text>`);
    }
    parts.push("</svg>");
    return parts.join("");
  }

  const pad = { left: 38, right: 16, top: 18, bottom: 34 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const y = (value) => pad.top + plotH - (Math.max(0, value) / niceMax) * plotH;
  // Сетка и подписи оси Y.
  for (let i = 0; i <= 4; i += 1) {
    const value = (niceMax / 4) * i;
    const yy = y(value);
    parts.push(`<line x1="${pad.left}" x2="${W - pad.right}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#EEF0F3" stroke-width="1"/>`);
    parts.push(`<text x="${pad.left - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#A1A1AA">${attr(intlNumber(value, 0))}</text>`);
  }

  const gap = values.length > 1 ? plotW / values.length : plotW;
  const barW = Math.max(8, Math.min(54, gap * 0.48));
  const pts = [];
  values.forEach((item, index) => {
    const x = pad.left + gap * index + gap / 2;
    const yy = y(item.value);
    const color = colors[index % colors.length];
    if (config.type === "bar") {
      const height = Math.max(2, pad.top + plotH - yy);
      parts.push(`<rect class="sb-chart-bar" x="${(x - barW / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${barW.toFixed(1)}" height="${height.toFixed(1)}" rx="6" fill="${attr(config.color)}" style="transform-box:fill-box;transform-origin:bottom center;transition:transform .7s cubic-bezier(.22,1,.36,1) ${index * 70}ms"/>`);
    } else {
      pts.push([x, yy]);
    }
    if (config.showValues) {
      parts.push(`<text x="${x.toFixed(1)}" y="${(yy - 9).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#52525B">${attr(intlNumber(item.value, config.decimals))}${attr(config.suffix)}</text>`);
    }
    parts.push(`<text x="${x.toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#71717A">${escapeHtml(item.label)}</text>`);
  });

  if (config.type === "line" || config.type === "area") {
    if (config.type === "area" && pts.length) {
      const d = `M ${pts[0][0].toFixed(1)} ${(pad.top + plotH).toFixed(1)} L ${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ")} L ${pts[pts.length - 1][0].toFixed(1)} ${(pad.top + plotH).toFixed(1)} Z`;
      parts.push(`<path class="sb-chart-area" d="${d}" fill="${attr(config.accent)}" opacity=".55"/>`);
    }
    const points = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    parts.push(`<polyline class="sb-chart-line" points="${points}" fill="none" stroke="${attr(config.color)}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" style="stroke-dasharray:1600;stroke-dashoffset:0;transition:stroke-dashoffset 1.1s ease"/>`);
    pts.forEach((p, index) => {
      parts.push(`<circle class="sb-chart-dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="5" fill="#fff" stroke="${attr(config.color)}" stroke-width="3" style="transition:opacity .25s ease ${index * 90}ms"/>`);
    });
  }
  parts.push("</svg>");
  return parts.join("");
}

function renderChart(el) {
  const config = chartSettings(el);
  const legend = config.showLegend
    ? `<div class="sb-chart-legend">${config.data.map((item, index) => `<span class="sb-chart-legend-item"><i style="background:${attr(index === 0 ? config.color : CHART_COLORS[index % CHART_COLORS.length])}"></i>${escapeHtml(item.label)} <b>${escapeHtml(intlNumber(item.value, config.decimals))}${escapeHtml(config.suffix)}</b></span>`).join("")}</div>`
    : "";
  return `<div class="sb-chart" data-sb-chart='${attr(JSON.stringify(config))}'>
    <div class="sb-chart-head">
      <div><strong>${escapeHtml(config.title)}</strong>${config.subtitle ? `<span>${escapeHtml(config.subtitle)}</span>` : ""}</div>
      <span class="sb-chart-kind">${({ bar: "Столбцы", line: "Линия", area: "Площадь", pie: "Круг", donut: "Кольцо" })[config.type]}</span>
    </div>
    <div class="sb-chart-body">${chartSvg(config)}</div>
    ${legend}
  </div>`;
}

function metricSettings(el) {
  const raw = el.props?.metric && typeof el.props.metric === "object" ? el.props.metric : {};
  const value = Number(String(raw.value ?? 0).replace(/[^\d.-]/g, ""));
  return {
    value: Number.isFinite(value) ? value : 0,
    prefix: raw.prefix || "",
    suffix: raw.suffix || "",
    label: raw.label || "показатель",
    hint: raw.hint || "",
    delta: raw.delta || "",
    decimals: Math.max(0, Math.min(4, Number(raw.decimals) || 0)),
    color: raw.color || "#4F46E5",
  };
}

function renderMetric(el) {
  const m = metricSettings(el);
  const deltaClass = String(m.delta).trim().startsWith("-") ? "is-down" : "is-up";
  return `<div class="sb-metric"${el.props?.binding?.collection?' data-live="true"':''} data-count="${attr(m.value)}" data-decimals="${attr(m.decimals)}" data-suffix="${attr(m.suffix)}" data-prefix="${attr(m.prefix)}" style="--sb-accent:${attr(m.color)}">
    <div class="sb-metric-top">
      <span class="sb-metric-label">${escapeHtml(m.label)}</span>
      ${m.delta ? `<span class="sb-metric-delta ${deltaClass}">${escapeHtml(m.delta)}</span>` : ""}
    </div>
    <div class="sb-metric-value"><span class="sb-metric-number">${escapeHtml(m.prefix + intlNumber(m.value, m.decimals))}</span><span class="sb-metric-suffix">${escapeHtml(m.suffix)}</span></div>
    ${m.hint ? `<div class="sb-metric-hint">${escapeHtml(m.hint)}</div>` : ""}
  </div>`;
}

const NAV_MOBILE_WIDTH = 768;
const NAV_MOBILE_QUERY = `(width < ${NAV_MOBILE_WIDTH}px)`;

function navSettings(el) {
  const raw = el.props?.nav && typeof el.props.nav === "object" ? el.props.nav : {};
  return {
    brand: raw.brand || "LamoFrame",
    brandHref: raw.brandHref || "",
    links: Array.isArray(raw.links) ? raw.links.filter((item) => item && (item.label || item.href)).slice(0, 8) : [],
    cta: raw.cta && typeof raw.cta === "object" ? raw.cta : null,
    sticky: Boolean(raw.sticky),
    tone: raw.tone === "dark" ? "dark" : "light",
  };
}

function renderNav(el, editor, ctx, frameWidth) {
  const nav = navSettings(el);
  const links = nav.links
    .map((item) => `<a class="sb-nav-link" href="${attr(resolveHref(item.href, ctx) || "#")}"${targetAttrs(item, ctx, "_self")}>${escapeHtml(item.label || "Ссылка")}</a>`)
    .join("");
  const cta = nav.cta
    ? `<a class="sb-nav-cta" href="${attr(resolveHref(nav.cta.href, ctx) || "#")}"${targetAttrs(nav.cta, ctx, "_self")}>${escapeHtml(nav.cta.label || "Связаться")}</a>`
    : "";
  const mobile = `<div class="sb-nav-mobile${nav.tone === "dark" ? " is-dark" : ""}"><span class="sb-nav-mobile-title">${escapeHtml(nav.brand)}</span><button class="sb-nav-close" type="button" aria-label="Закрыть меню">×</button>${links}${cta}</div>`;
  const editorClass = editor ? ` sb-nav-editor${frameWidth > 0 && frameWidth < NAV_MOBILE_WIDTH ? " is-compact" : ""}` : "";
  return `<nav class="sb-nav sb-nav-${nav.tone}${editorClass}${nav.sticky ? " is-sticky" : ""}" data-sb-nav aria-label="Главное меню">
    <a class="sb-nav-brand" href="${attr(resolveHref(nav.brandHref, ctx) || "#")}">${escapeHtml(nav.brand)}</a>
    <div class="sb-nav-links">${links}</div>
    <div class="sb-nav-actions">${cta}</div>
    <button class="sb-nav-toggle" type="button" aria-label="Открыть меню" aria-expanded="false"${editor ? " disabled" : ""}><span></span><span></span><span></span></button>
    ${mobile}
  </nav>`;
}

function tableSettings(el) {
  const raw = el.props?.table && typeof el.props.table === "object" ? el.props.table : {};
  const columns = (Array.isArray(raw.columns) ? raw.columns : [])
    .map((column) => (column && typeof column === "object" ? { label: String(column.label ?? ""), key: column.key } : { label: String(column ?? "") }))
    .filter((column) => column.label);
  const rows = (Array.isArray(raw.rows) ? raw.rows : []).map((row) => (Array.isArray(row) ? row : (raw.columns || []).map((column) => row?.[column?.key] ?? "")));
  return {
    title: raw.title || "Данные",
    subtitle: raw.subtitle || "",
    columns: columns.length ? columns : [{ label: "Колонка 1" }, { label: "Колонка 2" }, { label: "Колонка 3" }],
    rows,
    search: raw.search !== false,
    exportCsv: raw.exportCsv !== false,
    dense: Boolean(raw.dense),
  };
}

function statusClass(value) {
  const text = String(value || "").toLowerCase();
  if (/выигран|готов|выполн|оплач|active|done|успеш|заверш|в наличии/.test(text)) return "is-success";
  if (/работ|процесс|ожидан|pending|в пути|резерв|частич/.test(text)) return "is-warning";
  if (/отказ|cancel|ошиб|просроч|нет в наличии|архив/.test(text)) return "is-danger";
  return "is-info";
}

function renderTable(el, editor) {
  const config = tableSettings(el);
  const body = config.rows
    .map((row) => `<tr>${config.columns.map((column, index) => {
      const value = row[index] ?? "";
      return `<td>${/статус/i.test(column.label) ? `<span class="sb-status ${statusClass(value)}">${escapeHtml(value)}</span>` : escapeHtml(value)}</td>`;
    }).join("")}</tr>`)
    .join("");
  const toolbar = `<div class="sb-table-toolbar">
      ${config.search ? `<label class="sb-table-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg><input type="search" placeholder="Поиск по таблице…"${editor ? " disabled" : ""}></label>` : "<span></span>"}
      <div class="sb-table-actions"><span class="sb-table-count">${config.rows.length} записей</span>${config.exportCsv ? `<button class="sb-table-csv" type="button"${editor ? " disabled" : ""}>CSV</button>` : ""}</div>
    </div>`;
  return `<div class="sb-table${config.dense ? " is-dense" : ""}" data-sb-table='${attr(JSON.stringify(config))}'>
    <div class="sb-table-head"><strong>${escapeHtml(config.title)}</strong>${config.subtitle ? `<span>${escapeHtml(config.subtitle)}</span>` : ""}</div>
    ${toolbar}
    <div class="sb-table-scroll"><table>
      <thead><tr>${config.columns.map((column, index) => `<th data-index="${index}">${escapeHtml(column.label)}<span class="sb-sort">↕</span></th>`).join("")}</tr></thead>
      <tbody>${body || `<tr><td colspan="${config.columns.length}" class="sb-empty">Пока нет данных</td></tr>`}</tbody>
    </table></div>
  </div>`;
}

export function sampleApplicationData(schema) {
  return Object.fromEntries(Object.entries(schema || {}).map(([id, collection]) => [
    id, {
      ...collection,
      rows: [1, 2, 3].map((index) => ({
        id: String(index),
        values: Object.fromEntries(collection.fields.map((field) => [
          field.id,
          ({
            number: index * 100,
            date: `2026-01-0${index}`,
            status: field.options[(index - 1) % field.options.length] || "",
            relation: `Связанная запись ${index}`,
            text: `${field.name} ${index}`,
          })[field.kind] || "",
        ])),
      })),
      sample: true,
    },
  ]));
}

function getBoundCollection(el, ctx) {
  const id = el.props?.binding?.collection;
  return id && ctx?.appData && Object.hasOwn(ctx.appData, id) ? ctx.appData[id] : null;
}

function renderBoundTable(el, ctx) {
  const binding = el.props.binding;
  const collection = getBoundCollection(el, ctx);
  if (!collection) return '<div class="sb-table sb-table-head">Таблица связана с коллекцией приложения</div>';
  const requested = Array.isArray(binding.columns) ? binding.columns : [];
  const selected = requested.map((id) => collection.fields.find((field) => field.id === id)).filter(Boolean);
  const columns = selected.length ? selected : collection.fields;
  const filter = collection.fields.find((field) => field.id === binding.filterField);
  const filterValue = String(binding.filterValue ?? "").trim().toLocaleLowerCase("ru");
  const rows = collection.rows.filter((row) => !filter || !filterValue ||
    String(row.values[filter.id] ?? "").toLocaleLowerCase("ru") === filterValue);
  const sort = collection.fields.find((field) => field.id === binding.sortField);
  if (sort) {
    const direction = binding.sortDirection === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      const left = a.values[sort.id];
      const right = b.values[sort.id];
      if (left == null || right == null) return Number(left == null) - Number(right == null);
      const order = sort.kind === "number" ? Number(left) - Number(right) :
        String(left).localeCompare(String(right), "ru", { numeric: true });
      return order * direction;
    });
  }
  const actions = Boolean(ctx.appOrigin);
  const title = el.props.table?.title || collection.name;
  const statusField=collection.fields.find(f=>f.kind==='status');
  return `<div class="sb-table sb-bound-table">
    <div class="sb-table-head"><strong>${escapeHtml(title)}</strong><span>${collection.sample ? "Тестовые данные" : `Записей: ${rows.length}`}</span></div>
    <div class="lf-table-tools"><input type="search" data-crm-search placeholder="Поиск по записям…" aria-label="Поиск по записям">${statusField?`<select data-crm-filter="${attr(statusField.id)}" aria-label="Фильтр по статусу"><option value="">Все статусы</option>${statusField.options.map(v=>`<option>${escapeHtml(v)}</option>`).join('')}</select>`:''}<span class="lf-record-count">Записей: ${rows.length}</span>${actions&&collection.canEdit?`<button type="button" class="sb-record-action" data-app-collection="${attr(binding.collection)}">Добавить запись</button>`:''}</div>
    <div class="sb-table-scroll"><table>
      <thead><tr>${columns.map((column,i) => `<th scope="col"><button type="button" class="lf-table-sort" data-crm-sort="${i}" data-kind="${attr(column.kind)}">${escapeHtml(column.name)} ↕</button></th>`).join("")}${actions ? '<th scope="col">Запись</th>' : ""}</tr></thead>
      <tbody>${rows.map((row) => `<tr data-record-row data-values="${attr(JSON.stringify(row.values))}">${columns.map((column) => `<td>${escapeHtml(row.values[column.id])}</td>`).join("")}
        ${actions ? `<td><button class="sb-record-action" type="button" data-app-collection="${attr(binding.collection)}" data-app-record="${attr(row.id)}">${collection.canEdit ? "Редактировать" : "Открыть"}</button></td>` : ""}</tr>`).join("") ||
        `<tr><td colspan="${Math.max(1, columns.length + Number(actions))}" class="sb-empty">Записей пока нет</td></tr>`}</tbody>
    </table></div>
  </div>`;
}

function renderRecordForm(el, ctx) {
  const collection = getBoundCollection(el, ctx);
  const active = Boolean(ctx?.appOrigin && collection?.canEdit);
  if (ctx?.appOrigin && !active) return "";
  const label = el.props?.text || "Добавить запись";
  return `<button class="sb-record-action sb-record-form" type="button"${active ? ` data-app-collection="${attr(el.props.binding.collection)}"` : " disabled"}>${escapeHtml(label)}</button>`;
}

const APP_ACTION_SCRIPT = `
document.addEventListener('click', function(event) {
  var button = event.target.closest('[data-app-collection]');
  if (button) parent.postMessage({
    type: 'lamoframe-record',
    collection: button.dataset.appCollection,
    record: button.dataset.appRecord || '',
    page: button.closest('.sb-page')?.id || ''
  }, '*');
});
`;

function formulaValue(formula, values) {
  const source = String(formula || "").replace(/[×÷−]/g, (sign) => ({ "×": "*", "÷": "/", "−": "-" })[sign]);
  if (source.length > 2048) return 0;
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[A-Za-z_]\w*|\*\*|[^\s]/gi) || [];
  const functions = {
    min: Math.min,
    max: Math.max,
    round: Math.round,
    abs: Math.abs,
    sqrt: Math.sqrt,
    pow: Math.pow,
    avg: (...args) => args.reduce((sum, value) => sum + value, 0) / args.length,
  };
  const operators = {
    "+": [1, (a, b) => a + b],
    "-": [1, (a, b) => a - b],
    "*": [2, (a, b) => a * b],
    "/": [2, (a, b) => a / b],
    "%": [2, (a, b) => a % b],
    "**": [3, (a, b) => a ** b],
  };
  let position = 0;

  function expect(token) {
    if (tokens[position++] !== token) throw new Error("Некорректная формула");
  }

  function operand() {
    const token = tokens[position++];
    if (token === "+" || token === "-") return (token === "-" ? -1 : 1) * expression(3);
    if (token === "(") {
      const value = expression();
      expect(")");
      return value;
    }
    if (token && /^[\d.]/.test(token) && Number.isFinite(Number(token))) return Number(token);
    if (Object.hasOwn(functions, token) && tokens[position] === "(") {
      position += 1;
      const args = [expression()];
      while (tokens[position] === ",") {
        position += 1;
        args.push(expression());
      }
      expect(")");
      return functions[token](...args);
    }
    if (token && Object.hasOwn(values, token)) return Number(values[token]) || 0;
    throw new Error("Некорректная формула");
  }

  function expression(minimum = 1) {
    let value = operand();
    while (Object.hasOwn(operators, tokens[position])) {
      const operator = tokens[position];
      const [precedence, calculate] = operators[operator];
      if (precedence < minimum) break;
      position += 1;
      value = calculate(value, expression(precedence + (operator === "**" ? 0 : 1)));
    }
    return value;
  }

  try {
    const result = expression();
    return position === tokens.length && Number.isFinite(result) ? result : 0;
  } catch (error) {
    return 0;
  }
}

function calculatorSettings(el) {
  const raw = el.props?.calculator && typeof el.props.calculator === "object" ? el.props.calculator : {};
  const fields = (Array.isArray(raw.fields) ? raw.fields : [])
    .filter((field) => field && field.key)
    .map((field) => ({
      key: String(field.key).replace(/[^A-Za-z0-9_]/g, "_"),
      label: field.label || field.key,
      value: Number(field.value) || 0,
      min: Number(field.min) || 0,
      max: field.max === undefined ? undefined : Number(field.max),
      step: Number(field.step) || 1,
      unit: field.unit || "",
    }));
  return {
    title: raw.title || "Калькулятор",
    subtitle: raw.subtitle || "",
    fields,
    formula: raw.formula || "a + b",
    resultLabel: raw.resultLabel || "Результат",
    suffix: raw.suffix || "",
    decimals: Math.max(0, Math.min(4, Number(raw.decimals) || 0)),
    note: raw.note || "",
  };
}

function renderCalculator(el, editor) {
  const config = calculatorSettings(el);
  const values = Object.fromEntries(config.fields.map((field) => [field.key, field.value]));
  const result = formulaValue(config.formula, values);
  return `<div class="sb-calc" data-sb-calc='${attr(JSON.stringify(config))}'>
    <div class="sb-calc-head"><strong>${escapeHtml(config.title)}</strong>${config.subtitle ? `<span>${escapeHtml(config.subtitle)}</span>` : ""}</div>
    <div class="sb-calc-grid">
      ${config.fields.map((field) => `<label class="sb-calc-field"><span>${escapeHtml(field.label)}</span><div><input type="number" value="${attr(field.value)}" min="${attr(field.min)}"${field.max === undefined ? "" : ` max="${attr(field.max)}"`} step="${attr(field.step)}" data-calc-key="${attr(field.key)}"${editor ? " disabled" : ""}><em>${escapeHtml(field.unit)}</em></div></label>`).join("")}
    </div>
    <div class="sb-calc-result"><span>${escapeHtml(config.resultLabel)}</span><strong data-calc-result data-decimals="${attr(config.decimals)}">${escapeHtml(intlNumber(result, config.decimals))}${escapeHtml(config.suffix)}</strong></div>
    ${config.note ? `<div class="sb-calc-note">${escapeHtml(config.note)}</div>` : ""}
  </div>`;
}




/** Есть ли анимация у фрейма/секции или у любого его элемента. */
function frameHasAnimation(frame) {
  if (!frame) return false;
  if (frame.appear && frame.appear !== "none") return true;
  const elements = Array.isArray(frame.elements) ? frame.elements : [];
  return elements.some((el) => el?.props?.appear && el.props.appear !== "none");
}

/** data-атрибуты анимации появления для элементов и фреймов. */
function animationAttrs(source) {
  const appear = source?.appear;
  if (!appear || appear === "none") return "";
  return ` data-appear="${attr(appear)}" data-delay="${attr(clamp(source?.animationDelay, 0, 3000, 0))}" data-duration="${attr(clamp(source?.animationDuration, 200, 2400, 620))}"`;
}

function renderElement(el, editor, ctx, order = null, frameWidth = 0) {
  let inner = "";
  switch (el.type) {
    case "heading":
    case "text":
      inner = renderText(el, editor, ctx);
      break;
    case "button":
      inner = renderButton(el, editor, ctx);
      break;
    case "link":
      inner = renderLink(el, editor, ctx);
      break;
    case "image":
      inner = renderImage(el, editor, ctx);
      break;
    case "shape":
      inner = renderShape(el);
      break;
    case "line":
      inner = renderLine(el);
      break;
    case "embed":
      inner = renderEmbed(el, editor);
      break;
    case "nav":
      inner = renderNav(el, editor, ctx, frameWidth);
      break;
    case "chart":
      inner = renderChart(chartFromRecords(el,ctx));
      break;
    case "metric":
      inner = renderMetric(metricFromRecords(el,ctx));
      break;
    case "table":
      inner = el.props?.binding?.collection ? renderBoundTable(el, ctx) : renderTable(el, editor);
      break;
    case "record-form":
      inner = renderRecordForm(el, ctx);
      break;
    case "kanban": inner=renderKanban(el,ctx);break;
    case "crm-settings": inner=renderCRMSettings(el,ctx);break;
    case "crm-period": inner='<div class="lf-period"><span>Обзор вашей команды</span><label>Период <select data-crm-period><option value="0">Всё время</option><option value="30">Последние 30 дней</option><option value="7">Последние 7 дней</option></select></label></div>';break;
    case "calculator":
      inner = renderCalculator(el, editor);
      break;
    default:
      inner = "";
  }
  const dataAttrs = editor
    ? ` data-id="${attr(el.id)}" data-type="${attr(el.type)}"${el.locked ? ' data-locked="1"' : ""}`
    : "";
  const animation = animationAttrs(el.props);
  // Пользовательские якоря: id на обёртке, чтобы ссылки #anchor работали.
  const anchorName = String(el.props?.anchor || "").trim();
  const anchorAttr = !editor && /^[A-Za-z][A-Za-z0-9_-]*$/.test(anchorName) && !anchorName.startsWith("page-")
    ? ` id="${attr(anchorName)}"`
    : "";
  // Метаданные для адаптивного слоя на узких экранах (см. REFLOW_TABLET).
  const responsive =
    ` data-x="${Math.round(num(el.x))}"` +
    ` data-y="${Math.round(num(el.y))}"` +
    ` data-w="${Math.round(Math.max(1, num(el.w, 100)))}"` +
    ` data-h="${Math.round(Math.max(1, num(el.h, 100)))}"` +
    ` data-order="${num(el.z, 1)}"`;
  const centered =
    frameWidth > 0 &&
    Math.abs(num(el.x) + Math.max(1, num(el.w, 1)) / 2 - frameWidth / 2) <= frameWidth * 0.04;
  const selfAlign = centered ? "center" : "flex-start";
  return `<div class="sb-el sb-el-${attr(el.type)}${el.locked ? " is-locked" : ""}"${anchorAttr} style="--lf-order:${order??el.z??0};${wrapperStyle(el, order)};--sb-self:${selfAlign}"${dataAttrs}${responsive}${animation}>${inner}</div>`;
}

/** Все страницы документа в едином виде (поддержка старых схем). */
export function docPages(doc) {
  if (Array.isArray(doc?.pages) && doc.pages.length) {
    return doc.pages.map((page, index) => ({
      id: page.id || `p_${index}`,
      name: page.name || `Страница ${index + 1}`,
      slug: page.slug || `page-${index + 1}`,
      // Для страниц всегда берём сохранённый десктопный макет. Рантайм-кадры
      // (doc.frames) принадлежат текущему устройству редактора и не должны
      // подменять десктопную версию в экспорте/превью. Если сохранённого
      // макета нет (старый документ) — используем doc.frames как запасной.
      frames:
        (Array.isArray(page.frames) && page.frames.length
          ? page.frames
          : (page.id === doc.activePageId && Array.isArray(doc.frames)
            ? doc.frames
            : page.frames || []))
          .filter((frame) => frame.role !== "header" && frame.role !== "footer"),
      deviceFrames: page.devices || null,
    }));
  }
  return [{ id: "index", name: "Главная", slug: "index", frames: normalizeFrames(doc), deviceFrames: null }];
}

/** Контентные фреймы страницы для устройства. */
export function pageFramesForDevice(page, device) {
  if (device === "desktop") return page?.frames || [];
  return page?.deviceFrames?.[device]?.frames || [];
}

export function docComponents(doc, device = "desktop") {
  const components = doc?.components || {};
  const frames = Array.isArray(doc?.frames) ? doc.frames : [];
  const fallback = {
    header: components.header || frames.find((frame) => frame.role === "header") || null,
    footer: components.footer || frames.find((frame) => frame.role === "footer") || null,
  };
  if (device === "desktop") return fallback;
  const deviceComponents = components.devices?.[device] || {};
  // Старые документы могли не иметь device-компонентов: лучше показать
  // десктопную шапку/подвал, чем потерять их на планшете и телефоне.
  return {
    header: deviceComponents.header || fallback.header,
    footer: deviceComponents.footer || fallback.footer,
  };
}

export function isManualResponsive(doc) {
  return doc?.settings?.responsive?.auto === false;
}

export function deviceLayoutWidth(doc, device) {
  if (device === "desktop") return Math.max(320, num(doc?.settings?.width, 1200));
  return { tablet: 768, phone: 390 }[device] || 1200;
}

function contentFrames(doc) {
  const pages = docPages(doc);
  const page = pages.find((item) => item.id === doc?.activePageId) || pages[0];
  return page?.frames || [];
}

function isInside(frame, parent) {
  return (
    num(frame.x) >= num(parent.x) - 1 &&
    num(frame.y) >= num(parent.y) - 1 &&
    num(frame.x) + num(frame.w) <= num(parent.x) + num(parent.w) + 1 &&
    num(frame.y) + num(frame.h) <= num(parent.y) + num(parent.h) + 1
  );
}

/**
 * Собрать дерево вложенности по геометрии: фрейм, целиком лежащий внутри
 * другого, считается его дочерним. Родителем выбирается самый маленький
 * содержащий фрейм.
 */
export function buildFrameTree(frames) {
  const items = sortByPosition(frames).map((frame) => ({ frame, children: [], parent: null }));
  for (const item of items) {
    let best = null;
    let bestArea = Infinity;
    const ownArea = Math.max(1, num(item.frame.w) * num(item.frame.h));
    for (const other of items) {
      if (other === item) continue;
      if (!isInside(item.frame, other.frame)) continue;
      const area = Math.max(1, num(other.frame.w) * num(other.frame.h));
      if (area <= ownArea) continue;
      if (area < bestArea) {
        best = other;
        bestArea = area;
      }
    }
    item.parent = best;
  }
  const roots = [];
  for (const item of items) {
    if (item.parent) item.parent.children.push(item);
    else roots.push(item);
  }
  return { roots, items };
}

function sortByPosition(frames) {
  return [...(frames || [])].sort((a, b) => {
    const ay = num(a.y);
    const by = num(b.y);
    const rowTolerance = 8;
    if (Math.abs(ay - by) > rowTolerance) return ay - by;
    return num(a.x) - num(b.x);
  });
}

/**
 * Визуальный порядок элементов: сверху вниз, при близких Y — слева направо.
 * Используется в мобильной перестройке: колонка должна идти «как читается»,
 * а не в порядке z-index, который зависит от того, как элемент добавляли.
 */
function visualOrderMap(elements) {
  const list = [...(elements || [])].sort((a, b) => {
    const ay = num(a.y);
    const by = num(b.y);
    if (Math.abs(ay - by) > 24) return ay - by;
    return num(a.x) - num(b.x);
  });
  const map = new Map();
  list.forEach((el, index) => map.set(el.id, index + 1));
  return map;
}

function renderElements(frame, editor, ctx) {
  if (editor) {
    const order = visualOrderMap(frame.elements);
    return [...(frame.elements || [])]
      .sort((a, b) => num(a.z, 1) - num(b.z, 1))
      .map((el) => renderElement(el, editor, ctx, order.get(el.id) ?? num(el.z, 1), num(frame.w, 0)))
      .join("");
  }
  return renderElementBlocks(frame, ctx);
}

/** Прямоугольник inner целиком лежит внутри outer (±допуск). */
function rectContains(outer, inner, tol = 1) {
  const ox = num(outer.x);
  const oy = num(outer.y);
  const ow = Math.max(1, num(outer.w, 0));
  const oh = Math.max(1, num(outer.h, 0));
  const ix = num(inner.x);
  const iy = num(inner.y);
  const iw = Math.max(1, num(inner.w, 0));
  const ih = Math.max(1, num(inner.h, 0));
  return ix >= ox - tol && iy >= oy - tol && ix + iw <= ox + ow + tol && iy + ih <= oy + oh + tol;
}

/** Порядок чтения: сверху вниз, при близких Y — слева направо. */
function readingSort(a, b) {
  const ay = num(a.y);
  const by = num(b.y);
  if (Math.abs(ay - by) > 24) return ay - by;
  return num(a.x) - num(b.x);
}

/**
 * Разбить элементы на смысловые блоки для рефлоу.
 *
 * Фоновая фигура, целиком содержащая содержимое (карточка услуги и т.п.),
 * становится контейнером: её фон и дети переезжают в рефлоу вместе, а не
 * разваливаются на отдельные строки (иначе номера всех карточек шли бы
 * подряд, а заголовки — отдельной группой).
 *
 * В обычном (масштабируемом) режиме обёртка .sb-card имеет display:contents,
 * поэтому абсолютное позиционирование и вид макета не меняются.
 */
function elementBlocks(frame) {
  const elements = [...(frame.elements || [])];
  const frameArea = Math.max(1, num(frame.w, 1200) * num(frame.h, 800));
  const containers = elements
    .filter((el) => {
      if (el.type !== "shape") return false;
      const area = Math.max(1, num(el.w, 0) * num(el.h, 0));
      if (area > frameArea * 0.55) return false;
      return elements.some((other) => other !== el && other.type !== "shape" && rectContains(el, other));
    })
    .sort((a, b) => num(a.w) * num(a.h) - num(b.w) * num(b.h));

  const groups = containers.map((shape) => ({ shape, children: [] }));
  const inGroup = new Set(containers);
  for (const el of elements) {
    if (el.type === "shape") continue;
    const group = groups.find((item) => rectContains(item.shape, el));
    if (group) {
      group.children.push(el);
      inGroup.add(el);
    }
  }

  const blocks = [];
  for (const group of groups) {
    if (!group.children.length) {
      inGroup.delete(group.shape);
      continue;
    }
    const els = [group.shape, ...group.children].sort(readingSort);
    blocks.push({ anchor: group.shape, els, group });
  }
  for (const el of elements) {
    if (inGroup.has(el)) continue;
    blocks.push({ anchor: el, els: [el], group: null });
  }

  blocks.sort((a, b) => {
    const ay = num(a.anchor.y);
    const by = num(b.anchor.y);
    if (Math.abs(ay - by) > 24) return ay - by;
    return num(a.anchor.x) - num(b.anchor.x);
  });
  return blocks;
}

/** Отрисовать элементы фрейма блоками в порядке чтения. */
function renderElementBlocks(frame, ctx) {
  const frameWidth = num(frame.w, 0);
  return elementBlocks(frame)
    .map((block) => {
      if (!block.group) {
        return block.els.map((el) => renderElement(el, false, ctx, null, frameWidth)).join("");
      }
      const inner = block.els.map((el) => renderElement(el, false, ctx, null, frameWidth)).join("");
      return `<div class="sb-card">${inner}</div>`;
    })
    .join("");
}

function renderNestedFrame(item, parent, ctx) {
  const frame = item.frame;
  const bg = css(frame.bg, "#ffffff");
  const radius = clamp(frame.radius, 0, 999, 0);
  const width = Math.max(1, Math.round(num(frame.w, 100)));
  const height = Math.max(1, Math.round(num(frame.h, 100)));
  const left = Math.round(num(frame.x) - num(parent.x));
  const top = Math.round(num(frame.y) - num(parent.y));
  const pos =
    `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;` +
    `background:${bg};border-radius:${radius}px;overflow:hidden;`;
  const inner = renderElements(frame, false, ctx);
  const children = item.children.map((child) => renderNestedFrame(child, frame, ctx)).join("");
  return `<div class="sb-nested" data-frame-id="${attr(frame.id)}" style="${pos}"${animationAttrs(frame)}>${inner}${children}</div>`;
}

function renderSectionFrame(item, index, ctx) {
  const frame = item.frame;
  const bg = css(frame.bg, "#ffffff");
  const radius = clamp(frame.radius, 0, 999, 0);
  const height = Math.max(40, num(frame.h, 400));
  const inner = renderElements(frame, false, ctx);
  const children = item.children.map((child) => renderNestedFrame(child, frame, ctx)).join("");
  return `<section class="sb-section" id="section-${attr(frame.id)}" data-frame-id="${attr(frame.id)}" data-index="${index}" style="background:${bg};--sb-h:${height};${radius ? `border-radius:${radius}px;` : ""}"${animationAttrs(frame)}><div class="sb-canvas">${inner}${children}</div></section>`;
}

export function renderFrame(frame, editor = false, index = 0, ctx = {}) {
  const bg = css(frame.bg, "#ffffff");
  const radius = clamp(frame.radius, 0, 999, 0);
  const height = Math.max(40, num(frame.h, 400));
  const dataAttrs = editor ? ` data-frame-id="${attr(frame.id)}" data-index="${index}"` : "";
  const elements = renderElements(frame, editor, ctx);
  if (editor) {
    // Редактор: фрейм — свободно позиционированный артборд, элементы внутри
    // абсолютны и привязаны к его левому верхнему углу.
    const pos =
      `position:absolute;left:${Math.round(num(frame.x))}px;top:${Math.round(num(frame.y))}px;` +
      `width:${Math.max(1, Math.round(num(frame.w, 600)))}px;height:${height}px;` +
      `background:${bg};border-radius:${radius}px;overflow:hidden;`;
    return `<div class="sb-frame" id="frame-${attr(frame.id)}" style="${pos}"${dataAttrs}>${elements}</div>`;
  }
  // Превью/экспорт: фрейм становится секцией во всю ширину окна, внутри —
  // «канвас» шириной макета, который масштабируется коэффициентом --sb-k.
  const roleClass = frame.role === "footer" ? " sb-footer" : frame.role === "header" ? " sb-header" : "";
  const navHeader = frame.role === "header" && frame.elements?.length === 1 && frame.elements[0].type === "nav";
  return `<section class="sb-section${roleClass}${navHeader ? " sb-header-nav" : ""}" id="section-${attr(frame.id)}" style="background:${bg};--sb-h:${height};${radius ? `border-radius:${radius}px;` : ""}"${dataAttrs}${animationAttrs(frame)}><div class="sb-canvas">${elements}</div></section>`;
}

export function renderSections(doc, { editor = false, appData } = {}) {
  return (doc?.frames || []).map((frame, i) => renderFrame(frame, editor, i, { appData, imageMap: typeof window!=="undefined"&&window.LAMO_LOCAL?new Map(Object.entries(window.LAMO_MEDIA_URLS||{})):undefined })).join("");
}

/**
 * Фреймы для экспорта/превью: порядок идёт «как на холсте» — сверху вниз
 * по Y, а при одинаковой высоте — слева направо по X. Фреймы без элементов
 * не экспортируем: пустой фрейм дал бы пустую полосу на готовом сайте.
 *
 * Важно: в редакторе порядок НЕ трогаем (см. renderSections) — иначе панель
 * фреймов и слои самопроизвольно переставлялись бы.
 */
export function exportFrames(doc) {
  return sortByPosition(contentFrames(doc)).filter(
    (frame) => Array.isArray(frame.elements) && frame.elements.length > 0,
  );
}

/** Прямоугольник, охватывающий все фреймы (для размера рабочей области). */
export function framesBounds(doc) {
  const frames = doc?.frames || [];
  if (!frames.length) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const frame of frames) {
    minX = Math.min(minX, num(frame.x));
    minY = Math.min(minY, num(frame.y));
    maxX = Math.max(maxX, num(frame.x) + num(frame.w));
    maxY = Math.max(maxY, num(frame.y) + num(frame.h));
  }
  if(doc.settings?.sidebar?.enabled)minX=Math.min(minX,-((Number(doc.settings.sidebar.width)||240)+24));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const NAV_COMPACT = "--sb-nav-padding:8px 16px;--sb-nav-links-display:none;--sb-nav-toggle-display:flex";

export const NAV_CSS = `
.sb-nav{position:relative;display:flex;align-items:center;gap:24px;width:100%;height:100%;padding:var(--sb-nav-padding,8px 22px);box-sizing:border-box;border:1px solid #E4E4E7;border-radius:16px;background:#fff;color:#18181B;z-index:20}
.sb-nav.is-sticky{position:sticky;top:0;z-index:60}
.sb-nav-brand{font-weight:800;font-size:18px;letter-spacing:.02em;color:inherit;text-decoration:none;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}
.sb-nav-links{display:var(--sb-nav-links-display,flex);flex-wrap:wrap;align-items:center;gap:22px;margin-left:auto}
.sb-nav-link{font-size:14px;font-weight:600;color:#52525B;text-decoration:none;white-space:nowrap}
.sb-nav-link:hover{color:#18181B}
.sb-nav-actions{display:var(--sb-nav-links-display,flex);align-items:center}
.sb-nav-cta{display:inline-flex;align-items:center;justify-content:center;height:42px;padding:0 18px;border-radius:10px;background:#4F46E5;color:#fff;text-decoration:none;font-size:14px;font-weight:700;white-space:nowrap}
.sb-nav-dark{background:#0B1020;border-color:#27272A;color:#fff}
.sb-nav-dark .sb-nav-link{color:#D4D4D8}
.sb-nav-dark .sb-nav-link:hover{color:#fff}
.sb-nav-toggle{display:var(--sb-nav-toggle-display,none);flex:none;width:44px;height:42px;margin-left:auto;border:1px solid #E4E4E7;border-radius:11px;background:#fff;cursor:pointer;align-items:center;justify-content:center;flex-direction:column;gap:4px;padding:0}
.sb-nav-toggle span{display:block;width:18px;height:2px;border-radius:2px;background:#18181B;transition:transform .25s ease,opacity .2s ease}
.sb-nav-toggle[aria-expanded="true"] span:nth-child(1){transform:translateY(6px) rotate(45deg)}
.sb-nav-toggle[aria-expanded="true"] span:nth-child(2){opacity:0}
.sb-nav-toggle[aria-expanded="true"] span:nth-child(3){transform:translateY(-6px) rotate(-45deg)}
.sb-nav-mobile{display:none}
body > .sb-nav-mobile{
  position:fixed;
  inset:0;
  z-index:9998;
  display:none;
  flex-direction:column;
  gap:4px;
  padding:84px 22px 28px;
  background:#FFFFFF;
  color:#18181B;
  overflow:auto;
}
body > .sb-nav-mobile.is-open{display:flex;animation:sbMenuIn .22s ease both}
body > .sb-nav-mobile.is-dark{background:#0B1020;color:#FFFFFF}
.sb-nav-mobile-title{display:block;margin-bottom:14px;font-size:22px;font-weight:800;letter-spacing:.02em}
.sb-nav-close{position:absolute;top:18px;right:18px;width:44px;height:44px;border:1px solid #E4E4E7;border-radius:12px;background:#FAFAFA;color:#18181B;font-size:26px;line-height:1;cursor:pointer}
body > .sb-nav-mobile.is-dark .sb-nav-close{background:#18181B;border-color:#3F3F46;color:#fff}
body > .sb-nav-mobile .sb-nav-link{padding:14px 12px;border-radius:11px;font-size:17px;font-weight:600;color:#3F3F46}
body > .sb-nav-mobile .sb-nav-link:hover{background:#F4F4F5;color:#18181B}
body > .sb-nav-mobile.is-dark .sb-nav-link{color:#D4D4D8}
body > .sb-nav-mobile.is-dark .sb-nav-link:hover{background:#18181B;color:#fff}
body > .sb-nav-mobile .sb-nav-cta{margin-top:12px;min-height:48px;font-size:15px}
.sb-nav-dark .sb-nav-toggle{background:#18181B;border-color:#3F3F46}
.sb-nav-dark .sb-nav-toggle span{background:#fff}
.sb-nav-editor.is-compact{${NAV_COMPACT}}
@media ${NAV_MOBILE_QUERY}{
  .sb-nav:not(.sb-nav-editor){${NAV_COMPACT}}
}
@media (width < 1024px){
  .sb-section.sb-header-nav{height:auto}
  .sb-header-nav>.sb-canvas{width:100%;height:auto;max-width:760px;margin:0 auto;transform:none;padding:8px 16px}
  .sb-header-nav .sb-el-nav{position:static!important;width:100%!important;height:auto!important;transform:none!important}
  .sb-header-nav .sb-nav{height:auto;min-height:64px!important}
}
@keyframes sbMenuIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
`;

export const TABLE_CSS = `
.sb-table{display:flex;flex-direction:column;gap:12px;width:100%;height:100%;padding:20px;box-sizing:border-box;background:#fff;border:1px solid #E4E4E7;border-radius:18px;overflow:hidden;color:#18181B}
.sb-table-head strong{display:block;font-size:18px;font-weight:800}
.sb-table-head span{display:block;margin-top:3px;font-size:12px;color:#71717A}
.sb-table-toolbar{display:flex;align-items:center;gap:12px;justify-content:space-between}
.sb-table-search{display:flex;align-items:center;gap:8px;flex:1;max-width:360px;height:38px;padding:0 11px;border:1px solid #E4E4E7;border-radius:10px;background:#FAFAFA}
.sb-table-search svg{width:16px;height:16px;fill:none;stroke:#A1A1AA;stroke-width:1.8;flex:none}
.sb-table-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:13px;color:#18181B}
.sb-table-actions{display:flex;align-items:center;gap:10px}
.sb-table-count{font-size:12px;color:#A1A1AA}
.sb-table-csv{height:34px;padding:0 12px;border:1px solid #E4E4E7;border-radius:9px;background:#fff;font:inherit;font-size:12px;font-weight:700;cursor:pointer;color:#52525B}
.sb-table-csv:hover{border-color:#C7D2FE;color:#4338CA}
.sb-table-scroll{flex:1;min-height:0;overflow:auto;border:1px solid #F1F1F3;border-radius:12px}
.sb-table table{width:100%;border-collapse:collapse;font-size:13px}
.sb-table th{position:sticky;top:0;z-index:1;background:#FAFAFA;text-align:left;padding:11px 14px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#71717A;white-space:nowrap;cursor:pointer;user-select:none}
.sb-table td{padding:12px 14px;border-top:1px solid #F4F4F5;color:#3F3F46;white-space:nowrap}
.sb-table tr:hover td{background:#FAFAFF}
.sb-table .sb-sort{opacity:.35;margin-left:5px;font-size:10px}
.sb-table.is-dense td{padding:8px 12px}
.sb-bound-table th{cursor:default}
.sb-status{display:inline-flex;align-items:center;padding:4px 9px;border-radius:999px;font-size:11px;font-weight:700;line-height:1.4}
.sb-status.is-success{background:#ECFDF5;color:#047857}
.sb-status.is-warning{background:#FFFBEB;color:#B45309}
.sb-status.is-danger{background:#FEF2F2;color:#B91C1C}
.sb-status.is-info{background:#EFF6FF;color:#1D4ED8}
.sb-empty{text-align:center!important;color:#A1A1AA!important;padding:32px!important}
`;

const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0}
.sb-site h1,.sb-site h2,.sb-site h3,.sb-site p{margin:0}
.sb-site{line-height:1.4;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.sb-section{position:relative;overflow:hidden}
.sb-el{box-sizing:border-box}
.sb-text{white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word}
.sb-button{text-decoration:none}
.sb-image{display:block}
.sb-placeholder{color:#a1a1aa}
.sb-record-action{font:inherit;font-weight:600;color:#3730a3;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:7px 12px;cursor:pointer}
.sb-record-form{width:100%;height:100%;min-height:44px}
.sb-record-action:disabled{cursor:default}
.sb-viewport{width:100%;overflow:hidden}
.sb-site{position:relative;transform-origin:top left;margin:0 auto;overflow:hidden}
.sb-page[hidden]{display:none!important}
.sb-nested{box-sizing:border-box}
/* Подвал всегда прижат к низу окна: если контента меньше экрана, флекс
   растягивает блок страниц, а .sb-footer прижимается через margin-top:auto.
   Если контента больше экрана — подвал просто идёт следом за секциями. */
html,body{min-height:100%}
.sb-viewport{display:flex;flex-direction:column;min-height:100vh;min-height:100dvh}
.sb-site{display:flex;flex-direction:column;min-height:100vh;min-height:100dvh;flex:1 1 auto}
.sb-pages{display:flex;flex-direction:column;flex:1 0 auto}
.sb-footer{margin-top:auto}

/* ------------------------------------------------------------------ */
/* Динамические элементы                                               */
/* ------------------------------------------------------------------ */
${NAV_CSS}

.sb-chart{display:flex;flex-direction:column;gap:14px;width:100%;height:100%;padding:22px;box-sizing:border-box;background:#fff;border:1px solid #E4E4E7;border-radius:18px;overflow:hidden;color:#18181B}
.sb-chart-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.sb-chart-head strong{display:block;font-size:18px;font-weight:800}
.sb-chart-head span{display:block;margin-top:4px;font-size:13px;color:#71717A}
.sb-chart-kind{flex:none;padding:6px 10px;border-radius:999px;background:#EEF2FF;color:#4338CA;font-size:11px;font-weight:700}
.sb-chart-body{flex:1;min-height:0;display:flex;align-items:center}
.sb-chart-body svg{max-height:100%}
.sb-chart-legend{display:flex;flex-wrap:wrap;gap:8px 16px}
.sb-chart-legend-item{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:#52525B}
.sb-chart-legend-item i{width:9px;height:9px;border-radius:3px;display:inline-block}
.sb-chart-legend-item b{color:#18181B}
.sb-chart.is-ready:not(.is-in) .sb-chart-bar{transform:scaleY(0)!important}
.sb-chart.is-ready:not(.is-in) .sb-chart-line{stroke-dashoffset:1600!important}
.sb-chart.is-ready:not(.is-in) .sb-chart-dot,.sb-chart.is-ready:not(.is-in) .sb-chart-slice,.sb-chart.is-ready:not(.is-in) .sb-chart-area{opacity:0}
.sb-chart-slice{transition:opacity .5s ease}
.sb-chart-area{transition:opacity .7s ease}
.sb-chart-dot{transition:opacity .3s ease}

.sb-metric{display:flex;flex-direction:column;justify-content:space-between;gap:10px;width:100%;height:100%;padding:22px;box-sizing:border-box;background:#fff;border:1px solid #E4E4E7;border-radius:18px;overflow:hidden;color:#18181B}
.sb-metric-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.sb-metric-label{font-size:13px;font-weight:600;color:#71717A}
.sb-metric-delta{flex:none;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;background:#ECFDF5;color:#047857}
.sb-metric-delta.is-down{background:#FEF2F2;color:#B91C1C}
.sb-metric-value{display:flex;align-items:baseline;gap:4px;color:var(--sb-accent,#4F46E5)}
.sb-metric-number{font-size:44px;line-height:1;font-weight:800;letter-spacing:-.03em}
.sb-metric-suffix{font-size:20px;font-weight:800}
.sb-metric-hint{font-size:12px;color:#A1A1AA}

${TABLE_CSS}

.sb-calc{display:flex;flex-direction:column;gap:16px;width:100%;height:100%;padding:24px;box-sizing:border-box;background:#fff;border:1px solid #E4E4E7;border-radius:18px;overflow:auto;color:#18181B}
.sb-calc-head strong{display:block;font-size:19px;font-weight:800}
.sb-calc-head span{display:block;margin-top:4px;font-size:13px;color:#71717A}
.sb-calc-grid{display:grid;gap:12px}
.sb-calc-field{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:600;color:#52525B}
.sb-calc-field div{display:flex;align-items:center;height:42px;border:1px solid #E4E4E7;border-radius:10px;background:#FAFAFA;padding:0 12px;gap:8px}
.sb-calc-field input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:15px;font-weight:700;color:#18181B}
.sb-calc-field em{font-style:normal;font-size:12px;color:#A1A1AA}
.sb-calc-result{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-radius:14px;background:#EEF2FF;color:#3730A3}
.sb-calc-result span{font-size:13px;font-weight:700}
.sb-calc-result strong{font-size:28px;line-height:1;font-weight:800;letter-spacing:-.02em}
.sb-calc-note{font-size:11px;color:#A1A1AA}

@keyframes sbChartIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

@media (prefers-reduced-motion: reduce){
  [data-appear]{opacity:1!important;transform:none!important;filter:none!important;transition:none!important}
  .sb-chart-bar,.sb-chart-line,.sb-chart-dot,.sb-chart-slice,.sb-chart-area{transition:none!important;transform:none!important;opacity:1!important;stroke-dashoffset:0!important}
}
`;

/**
 * Адаптивный слой для превью, публичной страницы и экспорта.
 *
 * Модель. Каждая секция занимает всю ширину окна, поэтому фон никогда не
 * обрезается белыми полосами. Элементы живут в «канвасе» шириной макета
 * (--sb-w) и масштабируются коэффициентом --sb-k = ширина_окна / ширина_макета
 * (см. SCALE_SCRIPT).
 *
 * На планшете (≤1023.98px) и телефоне (≤767.98px) масштаб выключается и
 * канвас превращается в вертикальный поток: элементы переносятся друг под
 * друга, текст и объекты меняют размер через clamp() — это настоящий рефлоу,
 * а не сжатие всей страницы. Ниже телефона включаются свои, более компактные
 * значения (см. REFLOW_PHONE).
 *
 * В ручном режиме («Авто» выключено) перестройки нет: на каждое устройство
 * рендерится свой макет, а нужный показывается медиазапросами (MANUAL_MEDIA_CSS).
 */
const AUTO_REFLOW_WIDTH = 1023.98;
const AUTO_PHONE_WIDTH = 767.98;

/**
 * Ширина, ниже которой макет перестраивается в колонку (0 — не перестраивать).
 * В авторежиме — фиксированный мобильный breakpoint; в ручном режиме
 * перестройки нет: устройство выбирается через .sb-device (см. MANUAL_MEDIA_CSS).
 */
export function responsiveBreakpoint(doc) {
  return isManualResponsive(doc) ? 0 : AUTO_REFLOW_WIDTH;
}

/** CSS автоадаптива: масштабирование + рефлоу на планшете и телефоне. */
function responsiveCss(reflowAt) {
  const head = LAYOUT_CSS;
  const tabletAt = Number(reflowAt) || AUTO_REFLOW_WIDTH;
  if (!tabletAt || tabletAt <= 0) return head;
  return (
    `${head}` +
    `\n@media (max-width: ${tabletAt}px){\n${REFLOW_TABLET}\n}` +
    `\n@media (max-width: ${AUTO_PHONE_WIDTH}px){\n${REFLOW_PHONE}\n}`
  );
}

/**
 * Планшетный рефлоу (по умолчанию до 1023.98px). Канвас перестаёт быть
 * масштабированной копией макета: секции получают высоту по контенту, а
 * элементы выстраиваются в поток и переносятся в колонку. Ширина текста
 * ограничена, размеры задаются через clamp() — они меняются вместе с экраном.
 */
const REFLOW_TABLET = `
  .sb-viewport{overflow:visible}
  .sb-section{
    height:auto!important;
    overflow:visible;
  }
  .sb-canvas{
    width:100%!important;
    height:auto!important;
    max-width:760px;
    margin:0 auto;
    transform:none!important;
    display:flex;
    flex-direction:column;
    gap:22px;
    align-items:stretch;
    padding:46px 32px 52px;
    box-sizing:border-box;
  }
  .sb-el{
    position:static!important;
    left:auto!important;
    top:auto!important;
    right:auto!important;
    bottom:auto!important;
    width:100%!important;
    height:auto!important;
    max-width:100%;
    transform:none!important;
    opacity:1!important;
  }
  /* Карточка: фон-фигура тянется на весь блок, содержимое идёт потоком. */
  .sb-card{
    position:relative;
    display:flex;
    flex-direction:column;
    gap:10px;
    padding:26px 24px;
    border-radius:16px;
    overflow:hidden;
    box-sizing:border-box;
  }
  .sb-card > .sb-el-shape{
    display:block!important;
    position:absolute!important;
    left:0!important;
    top:0!important;
    right:0!important;
    bottom:0!important;
    width:100%!important;
    height:100%!important;
    transform:none!important;
    z-index:0!important;
  }
  .sb-card > .sb-el:not(.sb-el-shape){
    position:relative!important;
    z-index:1;
    width:100%!important;
    height:auto!important;
    margin:0;
  }
  .sb-el-heading,
  .sb-el-text{width:100%!important}
  .sb-el-heading .sb-text,
  .sb-el-text .sb-text{
    height:auto!important;
    width:100%!important;
    overflow:visible!important;
    min-height:1em;
  }
  .sb-el-heading .sb-text{font-size:clamp(34px,5vw,54px)!important;line-height:1.12!important}
  .sb-el-text .sb-text{font-size:clamp(16px,2.4vw,20px)!important;line-height:1.6!important}
  .sb-el-button{align-self:var(--sb-self,flex-start);width:auto!important;max-width:100%!important}
  .sb-el-button .sb-button{
    height:auto!important;
    width:auto!important;
    min-height:52px;
    padding:15px 30px!important;
    font-size:clamp(16px,2.2vw,18px)!important;
  }
  .sb-el-image{align-self:stretch}
  .sb-el-image .sb-image,
  .sb-el-image .sb-image-empty{
    height:auto!important;
    width:100%!important;
    aspect-ratio:var(--sb-ratio,16/10);
  }
  .sb-el-embed{align-self:stretch}
  .sb-el-embed iframe,
  .sb-el-embed .sb-embed-empty{
    height:auto!important;
    width:100%!important;
    aspect-ratio:16/9;
  }
  /* Декоративные фигуры не участвуют в потоке: иначе круги и фоны
     встают между заголовком и текстом. В рефлоу они только мешают. */
  .sb-el-shape{display:none!important}
  .sb-el-line{align-self:stretch;flex:none;min-height:2px}
  .sb-el-line .sb-line{
    position:static!important;
    transform:none!important;
    width:100%!important;
    height:2px!important;
    margin:8px 0;
  }
  .sb-nested{
    position:relative!important;
    left:auto!important;
    top:auto!important;
    width:100%!important;
    height:auto!important;
    overflow:visible!important;
    padding:20px 18px;
    margin:8px 0;
    border-radius:16px;
    order:99;
  }
  .sb-nested > .sb-el{
    position:static!important;
    width:100%!important;
    height:auto!important;
    margin:10px 0;
  }
  /* Динамические элементы в потоке: фиксированная высота макета больше не
     нужна, иначе график/таблица обрезались бы на телефоне. */
  .sb-el-nav,.sb-el-chart,.sb-el-metric,.sb-el-table,.sb-el-calculator{
    width:100%!important;
    height:auto!important;
  }
  .sb-el-nav .sb-nav,.sb-el-chart .sb-chart,.sb-el-metric .sb-metric,
  .sb-el-table .sb-table,.sb-el-calculator .sb-calc{
    width:100%!important;
    height:auto!important;
    min-height:0!important;
  }
  .sb-chart-body{min-height:220px}
  .sb-table-scroll{max-height:460px}
`;

/**
 * Телефонные значения поверх планшетного рефлоу (≤767.98px): уже поля,
 * меньше отступы и компактнее типографика. Применяются после REFLOW_TABLET,
 * поэтому переопределяют только то, что нужно.
 */
const REFLOW_PHONE = `
  .sb-canvas{
    max-width:none;
    gap:16px;
    padding:34px 20px 38px;
  }
  .sb-el-heading .sb-text{font-size:clamp(28px,8vw,44px)!important}
  .sb-el-text .sb-text{font-size:clamp(16px,4.4vw,19px)!important}
  .sb-el-button .sb-button{
    min-height:50px;
    padding:14px 26px!important;
    font-size:clamp(15px,4.2vw,17px)!important;
  }
  .sb-nested{padding:18px 16px;margin:10px 0;border-radius:14px}
`;

const SCALE_SCRIPT = `
(function(){
  var viewports=[].slice.call(document.querySelectorAll('.sb-viewport'));
  if(!viewports.length)return;
  var REFLOW=__REFLOW__;
  var MAX_DESIGN=1680;
  function layoutOne(viewport){
    if(!viewport.getClientRects().length)return;
    var design=Number(viewport.getAttribute('data-design-width'))||1200;
    var vw=viewport.closest('.lf-content')?.clientWidth||document.documentElement.clientWidth;
    if(viewport.closest('.lf-shell.is-fluid'))return;
    if(!vw)return;
    if(REFLOW>0&&matchMedia('(max-width: '+REFLOW+'px)').matches){
      viewport.style.removeProperty('--sb-k');
      viewport.style.removeProperty('--sb-offset');
      return;
    }
    // Не округляем коэффициент до сотых: иначе масштабированный канвас
    // (design * k) перестаёт совпадать с шириной окна и обрезается справа,
    // из-за чего макет визуально «съезжает» с центра. Округляем вниз до
    // 1e-6 — канвас никогда не превысит окно, а отступы слева/справа равны.
    var k=Math.floor((Math.min(vw,MAX_DESIGN)/design)*1e6)/1e6;
    var offset=Math.max(0,(vw-design*k)/2);
    viewport.style.setProperty('--sb-k',String(k));
    viewport.style.setProperty('--sb-offset',(Math.round(offset*1000)/1000)+'px');
  }
  function layout(){viewports.forEach(layoutOne);}
  window.addEventListener('resize',layout,{passive:true});
  window.addEventListener('orientationchange',layout,{passive:true});
  layout();
  if(document.fonts&&document.fonts.ready){document.fonts.ready.then(layout);}
  if(window.ResizeObserver){var ro=new ResizeObserver(layout);ro.observe(document.documentElement);document.querySelectorAll('.lf-content').forEach(n=>ro.observe(n));}
})();
`;

/** Скрипт масштабирования с реальным breakpoint выбранного режима. */
function scaleScript(reflowAt) {
  return SCALE_SCRIPT.replace("__REFLOW__", String(Math.max(0, Number(reflowAt) || 0)));
}

/** Базовая раскладка секций/канваса — нужна и в авто-, и в ручном режиме. */
const LAYOUT_CSS = `
.sb-viewport{background:var(--sb-body-bg,#ffffff);overflow-x:clip}
.sb-site{width:100%!important;max-width:none;background:transparent!important}
.sb-section{
  position:relative;
  width:100%;
  overflow:hidden;
  height:calc(var(--sb-h) * 1px * var(--sb-k,1));
}
.sb-canvas{
  position:relative;
  width:var(--sb-w,1200px);
  height:calc(var(--sb-h) * 1px);
  transform-origin:top left;
  transform:translateX(var(--sb-offset,0px)) scale(var(--sb-k,1));
  will-change:transform;
}
/* Группа «карточка» в обычном режиме не создаёт бокс — элементы остаются
   абсолютно позиционированными относительно канваса. В рефлоу становится
   flex-контейнером (см. REFLOW_TABLET). */
.sb-card{display:contents}
`;

/** Ручной режим: показываем макет нужного устройства по ширине окна. */
const MANUAL_MEDIA_CSS = `
.sb-device{display:none}
@media (min-width:1024px){.sb-device-desktop{display:block}}
@media (min-width:768px) and (max-width:1023.98px){.sb-device-tablet{display:block}}
@media (max-width:767.98px){.sb-device-phone{display:block}}
`;

const APPEAR_SCRIPT = `
(function(){
  var items=Array.prototype.slice.call(document.querySelectorAll('[data-appear]'));
  if(!items.length)return;
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var show=function(el){
    el.style.opacity='1';
    el.style.transform='none';
    el.style.filter='none';
    window.setTimeout(function(){el.style.willChange='auto';},900);
  };
  if(reduce){items.forEach(show);return;}
  var presets={
    fade:{transform:'none'},
    up:{transform:'translateY(32px)'},
    down:{transform:'translateY(-32px)'},
    left:{transform:'translateX(-36px)'},
    right:{transform:'translateX(36px)'},
    zoom:{transform:'scale(.9)'},
    blur:{transform:'none',filter:'blur(12px)'},
    rotate:{transform:'rotate(-6deg) scale(.96)'},
    flip:{transform:'perspective(900px) rotateX(48deg)'}
  };
  var pending=[];
  items.forEach(function(el){
    var kind=el.getAttribute('data-appear')||'up';
    var preset=presets[kind]||presets.up;
    var delay=Math.max(0,Number(el.getAttribute('data-delay'))||0);
    var duration=Math.max(200,Number(el.getAttribute('data-duration'))||620);
    el.style.opacity='0';
    el.style.transform=preset.transform||'none';
    el.style.filter=preset.filter||'none';
    el.style.willChange='opacity, transform, filter';
    el.style.transition='opacity '+duration+'ms cubic-bezier(.22,1,.36,1) '+delay+'ms, transform '+duration+'ms cubic-bezier(.22,1,.36,1) '+delay+'ms, filter '+duration+'ms ease '+delay+'ms';
    pending.push(el);
  });
  var poll=0,fallback=0,raf=0,ticks=0;
  function viewportHeight(){
    return window.innerHeight||document.documentElement.clientHeight||0;
  }
  function inViewport(el){
    var rect=el.getBoundingClientRect();
    var h=viewportHeight();
    if(!h)return true; // нулевая высота: не можем судить, показываем
    var w=window.innerWidth||document.documentElement.clientWidth||0;
    return rect.bottom>=-48 && rect.top<=h+48 && rect.right>=-48 && rect.left<=w+48;
  }
  function revealVisible(){
    if(!pending.length)return;
    pending=pending.filter(function(el){
      if(inViewport(el)){show(el);return false;}
      return true;
    });
  }
  function schedule(){
    if(raf)return;
    // Два кадра: браузер успевает применить стартовые стили, и переход
    // действительно анимируется, а не «прыгает» в конечное состояние.
    raf=window.requestAnimationFrame(function(){
      raf=window.requestAnimationFrame(function(){
        raf=0;
        revealVisible();
      });
    });
  }
  window.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('hashchange',schedule);
  window.addEventListener('load',schedule);
  if(window.ResizeObserver){try{new ResizeObserver(schedule).observe(document.documentElement);}catch(e){}}
  // Не полагаемся только на IntersectionObserver: в sandbox-iframe он
  // срабатывает не всегда, поэтому видимость считаем сами.
  schedule();
  window.setTimeout(schedule,60);
  window.setTimeout(schedule,300);
  // Последняя страховка: если браузер вообще не даёт ни событий, ни размеров
  // (крайне редкий sandbox), показываем оставшееся, чтобы контент не пропал.
  fallback=window.setInterval(function(){
    ticks+=1;
    window.dispatchEvent(new Event('resize'));
    schedule();
    if(ticks>=24||!pending.length){window.clearInterval(fallback);}
  },250);
  window.setTimeout(function(){
    if(pending.length){window.dispatchEvent(new Event('resize'));schedule();}
    if(ticks<24&&!pending.length&&fallback){window.clearInterval(fallback);}
  },6000);
})();
`;

const INTERACTIVE_SCRIPT = `
(function(){
  ${formulaValue.toString()}
  function qsa(sel,root){return Array.prototype.slice.call((root||document).querySelectorAll(sel));}
  function parse(node,attr){try{return JSON.parse(node.getAttribute(attr)||'{}');}catch(e){return {};}}
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
  function fmt(value,decimals){var n=Number(value);if(!isFinite(n))n=0;try{return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:decimals||0,minimumFractionDigits:decimals||0}).format(n);}catch(e){return String(Math.round(n));}}
  function download(name,text,type){
    try{
      var blob=new Blob([text],{type:type||'text/csv;charset=utf-8'});
      var url=URL.createObjectURL(blob);
      var a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
      setTimeout(function(){URL.revokeObjectURL(url);},1200);
    }catch(e){}
  }
  function whenVisible(node,cb){
    if(!('IntersectionObserver' in window)){cb();return;}
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(entry){if(entry.isIntersecting){cb(entry.target);io.unobserve(entry.target);}});
    },{threshold:.12});
    io.observe(node);
  }
  function statusClass(value){
    var text=String(value||'').toLowerCase();
    if(/выигран|готов|выполн|оплач|active|done|успеш|заверш|в наличии/.test(text))return 'is-success';
    if(/работ|процесс|ожидан|pending|в пути|резерв|частич/.test(text))return 'is-warning';
    if(/отказ|cancel|ошиб|просроч|нет в наличии|архив/.test(text))return 'is-danger';
    return 'is-info';
  }
  function csvCell(value){return '"'+String(value==null?'':value).replace(/"/g,'""')+'"';}

  // Панель вынесена из масштабируемого холста, чтобы занимать весь экран.
  var mobileNav=window.matchMedia('${NAV_MOBILE_QUERY}');
  var closeActiveNav=null;
  qsa('[data-sb-nav]').forEach(function(nav,index){
    var toggle=nav.querySelector('.sb-nav-toggle');
    var panel=nav.querySelector('.sb-nav-mobile');
    if(!toggle||!panel)return;
    var closeButton=panel.querySelector('.sb-nav-close');
    panel.id='sb-nav-panel-'+index;
    toggle.setAttribute('aria-controls',panel.id);
    document.body.appendChild(panel);
    var overflow='';
    function close(restoreFocus){
      if(closeActiveNav!==close)return;
      closeActiveNav=null;
      panel.classList.remove('is-open');
      toggle.setAttribute('aria-expanded','false');
      document.body.style.overflow=overflow;
      if(restoreFocus)toggle.focus();
    }
    toggle.addEventListener('click',function(){
      if(!mobileNav.matches)return;
      if(closeActiveNav===close){close(true);return;}
      if(closeActiveNav)closeActiveNav(false);
      closeActiveNav=close;
      overflow=document.body.style.overflow;
      document.body.style.overflow='hidden';
      panel.classList.add('is-open');
      toggle.setAttribute('aria-expanded','true');
      if(closeButton)closeButton.focus();
    });
    panel.addEventListener('click',function(event){
      if(event.target.closest('.sb-nav-close'))close(true);
      else if(event.target.closest('a'))close(false);
    });
    document.addEventListener('click',function(event){
      if(!nav.contains(event.target)&&!panel.contains(event.target))close(false);
    });
  });
  document.addEventListener('keydown',function(event){
    if(event.key==='Escape'&&closeActiveNav)closeActiveNav(true);
  });
  mobileNav.addEventListener('change',function(){
    if(!mobileNav.matches&&closeActiveNav)closeActiveNav(false);
  });

  // Появление графиков при прокрутке.
  qsa('[data-sb-chart]').forEach(function(node){
    node.classList.add('is-ready');
    whenVisible(node,function(){node.classList.add('is-in');});
  });

  // Счётчики метрик: мягкий count-up при попадании в экран.
  qsa('[data-count]').forEach(function(node){
    if(node.hasAttribute('data-live'))return;
    var target=Number(node.getAttribute('data-count'))||0;
    var decimals=Number(node.getAttribute('data-decimals'))||0;
    var prefix=node.getAttribute('data-prefix')||'';
    var suffix=node.getAttribute('data-suffix')||'';
    var label=node.querySelector('.sb-metric-number');
    if(!label)return;
    label.textContent=prefix+fmt(0,decimals);
    whenVisible(node,function(){
      var start=performance.now();
      function step(now){
        var t=Math.min(1,(now-start)/900);
        var eased=1-Math.pow(1-t,3);
        label.textContent=prefix+fmt(target*eased,decimals);
        if(t<1)requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  });

  // Таблицы: поиск, сортировка, CSV.
  qsa('[data-sb-table]').forEach(function(root){
    var cfg=parse(root,'data-sb-table');
    var rows=Array.isArray(cfg.rows)?cfg.rows.slice():[];
    var columns=Array.isArray(cfg.columns)?cfg.columns:[];
    var tbody=root.querySelector('tbody');
    var input=root.querySelector('.sb-table-search input');
    var count=root.querySelector('.sb-table-count');
    var csv=root.querySelector('.sb-table-csv');
    var sortIndex=-1,dir=1,query='';
    function cell(row,index){
      if(Array.isArray(row))return row[index]==null?'':row[index];
      var col=columns[index]||{};
      return row[col.key]==null?'':row[col.key];
    }
    function render(){
      var shown=rows.map(function(row,index){return {row:row,index:index};}).filter(function(item){
        if(!query)return true;
        return columns.some(function(col,i){return String(cell(item.row,i)).toLowerCase().indexOf(query)>=0;});
      });
      if(sortIndex>=0){
        shown.sort(function(a,b){
          var va=cell(a.row,sortIndex),vb=cell(b.row,sortIndex);
          var na=Number(String(va).replace(/[^0-9.-]/g,'')),nb=Number(String(vb).replace(/[^0-9.-]/g,''));
          if(String(va).replace(/[^0-9]/g,'')&&String(vb).replace(/[^0-9]/g,'')&&isFinite(na)&&isFinite(nb))return (na-nb)*dir;
          return String(va).localeCompare(String(vb),'ru',{numeric:true})*dir;
        });
      }
      tbody.innerHTML=shown.map(function(item){
        return '<tr>'+columns.map(function(col,i){var value=cell(item.row,i);return '<td>'+(/статус/i.test(col.label||'')?'<span class="sb-status '+statusClass(value)+'">'+esc(value)+'</span>':esc(value))+'</td>';}).join('')+'</tr>';
      }).join('')||'<tr><td colspan="'+columns.length+'" class="sb-empty">Ничего не найдено</td></tr>';
      if(count)count.textContent=shown.length+' записей';
    }
    if(input)input.addEventListener('input',function(){query=input.value.trim().toLowerCase();render();});
    qsa('th',root).forEach(function(th){
      th.addEventListener('click',function(){
        var index=Number(th.getAttribute('data-index'));
        if(!isFinite(index))return;
        if(sortIndex===index)dir=-dir;else{sortIndex=index;dir=1;}
        render();
      });
    });
    if(csv)csv.addEventListener('click',function(){
      var text=[columns.map(function(c){return csvCell(c.label);}).join(';')].concat(rows.map(function(row){return columns.map(function(col,i){return csvCell(cell(row,i));}).join(';');})).join('\\r\\n');
      download((cfg.title||'table')+'.csv','\\ufeff'+text);
    });
    render();
  });

  // Калькуляторы: безопасная арифметика без eval и доступа к window.
  qsa('[data-sb-calc]').forEach(function(root){
    var cfg=parse(root,'data-sb-calc');
    var inputs=qsa('[data-calc-key]',root);
    var result=root.querySelector('[data-calc-result]');
    if(!result)return;
    function compute(){
      var values=Object.create(null);
      inputs.forEach(function(input){values[input.getAttribute('data-calc-key')]=Number(input.value)||0;});
      var value=formulaValue(cfg.formula,values);
      result.textContent=fmt(value,Number(cfg.decimals)||0)+(cfg.suffix||'');
    }
    inputs.forEach(function(input){input.addEventListener('input',compute);});
    compute();
  });
})();
`;

const PAGES_SCRIPT = `
(function(){
  var pages=[].slice.call(document.querySelectorAll('.sb-page'));
  if(pages.length<2)return;
  function current(){
    var hash=location.hash.replace(/^#/,'');
    return hash.indexOf('page-')===0?hash.slice(5):'';
  }
  function show(slug){
    if(!slug||!pages.some(function(page){return page.getAttribute('data-page')===slug;}))return;
    var found=false;
    pages.forEach(function(page){
      var on=page.getAttribute('data-page')===slug;
      if(on)found=true;
      page.hidden=!on;
      page.classList.toggle('is-active',on);
    });
    // Неизвестный hash (например, внутренний якорь #features) не должен
    // сбрасывать пользователя на первую страницу.
    if(!found)return;
    var active=pages.filter(function(page){return !page.hidden;})[0];
    if(active&&active.getAttribute('data-title'))document.title=active.getAttribute('data-title');
    window.scrollTo(0,0);
  }
  document.addEventListener('click',function(event){
    var link=event.target.closest('a[href^="#page-"]');
    if(!link)return;var slug=link.getAttribute('href').slice(6);
    if(!pages.some(function(p){return p.getAttribute('data-page')===slug;}))return;
    event.preventDefault();show(slug);
    // Opaque sandbox Blob documents cannot navigate to their own Blob URL.
    // Switch the DOM locally; the host persists the selected page in its URL.
    try{history.replaceState(null,'','#page-'+slug);}catch(e){}
    window.dispatchEvent(new CustomEvent('lamoframe-page-shown',{detail:slug}));
    if(parent!==window)parent.postMessage({type:'lamoframe-navigation',page:'page-'+slug},'*');
    window.dispatchEvent(new Event('resize'));
  });
  window.addEventListener('hashchange',function(){show(current());});
  show(current());
})();
`;

export function renderDocument(doc, options = {}) {
  const { inlineImages = new Map(), editor = false, scripts = true, appData, appOrigin, preferences={}, role, periodDays=0 } = options;
  const settings = doc?.settings || {};
  const meta = doc?.meta || {};
  const width = contentWidth(doc);
  const bodyBg = css(settings.bg, "#ffffff");
  const pages = docPages(doc);
  const pageSlugs = new Map(pages.map((page) => [page.id, page.slug]));
  const ctx = { editor, pageSlugs, appData, appOrigin, role, periodDays, pageIds: new Map(pages.map((page) => [page.slug, page.id])) };
  const manual = !editor && isManualResponsive(doc);

  const allFrames = [];
  for (const page of pages) {
    allFrames.push(...pageFramesForDevice(page, "desktop"));
    if (manual) {
      allFrames.push(...pageFramesForDevice(page, "tablet"));
      allFrames.push(...pageFramesForDevice(page, "phone"));
    }
  }
  for (const device of manual ? ["desktop", "tablet", "phone"] : ["desktop"]) {
    const { header, footer } = docComponents(doc, device);
    if (header) allFrames.push(header);
    if (footer) allFrames.push(footer);
  }
  // Анимация может быть на фрейме/секции или на любом элементе, включая
  // вложенные элементы секций (frameHasContent/фильтры их не отбрасывают).
  const hasAppear = allFrames.some((frame) => frameHasAnimation(frame));
  const dynamicTypes = new Set(["nav", "chart", "metric", "table", "calculator"]);
  const hasDynamic = allFrames.some((frame) =>
    (frame.elements || []).some((el) => dynamicTypes.has(el.type)),
  );
  const multiPage = pages.length > 1;

  let pageHtml = "";
  let styleExtra = "";

  if (manual) {
    // Ручной режим: для каждой страницы рендерим отдельный макет под каждое
    // устройство, показываем нужный через медиазапросы (см. MANUAL_MEDIA_CSS).
    let sectionIndex = 0;
    pageHtml = pages
      .map((page) => {
        const devicesHtml = ["desktop", "tablet", "phone"]
          .map((device) => {
            const deviceWidth = deviceLayoutWidth(doc, device);
            const frames = fallbackDeviceFrames(doc, page, device);
            const tree = buildFrameTree(frames || []);
            const sections = tree.roots
              .map((item) => (hasTreeContent(item) ? renderSectionFrame(item, sectionIndex++, ctx) : ""))
              .join("");
            const { header, footer } = docComponents(doc, device);
            const head = header && frameHasContent(header) ? renderFrame(header, false, 0, ctx) : "";
            const foot = footer && frameHasContent(footer) ? renderFrame(footer, false, 0, ctx) : "";
            return `<div class="sb-device sb-device-${attr(device)}"><div class="sb-viewport" style="--sb-w:${deviceWidth}px" data-design-width="${deviceWidth}"><main class="sb-site" data-width="${deviceWidth}">${head}${sections}${foot}</main></div></div>`;
          })
          .join("");
        const hidden = pages.indexOf(page) === 0 ? "" : " hidden";
        return `<div class="sb-page" id="page-${attr(page.slug)}" data-page="${attr(page.slug)}" data-title="${attr(meta.title || "Сайт")}${page.name && pages.length > 1 ? ` — ${attr(page.name)}` : ""}"${hidden}>${devicesHtml}</div>`;
      })
      .join("");
    styleExtra = `${LAYOUT_CSS}${MANUAL_MEDIA_CSS}`;
  } else {
    let pageIndex = 0;
    pageHtml = pages
      .map((page) => {
        const tree = buildFrameTree(page.frames || []);
        const sections = tree.roots
          .map((item) => (hasTreeContent(item) ? renderSectionFrame(item, pageIndex++, ctx) : ""))
          .join("");
        const hidden = pages.indexOf(page) === 0 ? "" : " hidden";
        return `<div class="sb-page" id="page-${attr(page.slug)}" data-page="${attr(page.slug)}" data-title="${attr(meta.title || "Сайт")}${page.name && pages.length > 1 ? ` — ${attr(page.name)}` : ""}"${hidden}>${sections}</div>`;
      })
      .join("");
    styleExtra = editor ? "" : responsiveCss(responsiveBreakpoint(doc));
  }

  const { header, footer } = docComponents(doc, "desktop");
  const siteWrap = manual
    ? `<div class="sb-pages">${pageHtml}</div>`
    : `<div class="sb-viewport" style="--sb-w:${width}px" data-design-width="${width}"><main class="sb-site" data-width="${width}">${header && frameHasContent(header) ? renderFrame(header, false, 0, ctx) : ""}<div class="sb-pages">${pageHtml}</div>${footer && frameHasContent(footer) ? renderFrame(footer, false, 0, ctx) : ""}</main></div>`;

  const reflowAt = manual ? 0 : responsiveBreakpoint(doc);

  let html = `<!doctype html>
<html lang="${attr(meta.lang || "ru")}">
<head>
<meta charset="utf-8">
${appOrigin ? `<meta http-equiv="Content-Security-Policy" content="${attr(`default-src 'none'; img-src data: blob: ${appOrigin}; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`)}">` : ""}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title || "Сайт")}</title>
<meta name="description" content="${attr(meta.description || "")}">
<style>${BASE_CSS}
body{background:${bodyBg};}
:root{--sb-body-bg:${bodyBg};}
.sb-site{width:${width}px;background:${bodyBg};}
${styleExtra}
${SHELL_CSS}
${CRM_CSS}
</style>
</head>
<body>
${shellMarkup(doc,siteWrap,{preferences})}
${scripts ? `<script>${shellScript(preferences)}</script><script>${CRM_SCRIPT}</script>` : ""}
${scripts ? `<script>${scaleScript(reflowAt)}</script>` : ""}
${scripts && hasAppear ? `<script>${APPEAR_SCRIPT}</script>` : ""}
${scripts && hasDynamic ? `<script>${INTERACTIVE_SCRIPT}</script>` : ""}
${scripts && multiPage ? `<script>${PAGES_SCRIPT}</script>` : ""}
${scripts && appOrigin ? `<script>${APP_ACTION_SCRIPT};document.querySelectorAll("[data-crm-period]").forEach(n=>n.value="${[0,7,30].includes(periodDays)?periodDays:0}");</script>` : ""}
</body>
</html>`;
  if (inlineImages.size) {
    for (const [url, dataUri] of inlineImages) {
      if (!url || !dataUri) continue;
      html = html.split(`src="${attr(url)}"`).join(`src="${dataUri}"`);
    }
  }
  if(typeof window!=='undefined'&&window.LAMO_LOCAL)for(const [url,blob]of Object.entries(window.LAMO_MEDIA_URLS||{}))html=html.split(`src="${attr(url)}"`).join(`src="${blob}"`);
  return html;
}

/**
 * Фреймы для устройства. Если ручной макет ещё не создан в документе,
 * клонируем базовый десктопный макет с пропорциональным масштабом — ровно
 * так же, как это делает `ensureDeviceLayouts` в state.js, чтобы экспорт
 * и редактор совпадали.
 */
function fallbackDeviceFrames(doc, page, device) {
  if (device === "desktop") return page?.frames || [];
  const explicit = page?.deviceFrames?.[device]?.frames;
  if (explicit && explicit.length) return explicit;
  return scaleFrames(page?.frames || [], deviceLayoutWidth(doc, "desktop"), deviceLayoutWidth(doc, device));
}

const RENDER_SCALED_STYLE_KEYS = ["fontSize", "borderRadius", "borderWidth", "strokeWidth", "letterSpacing"];

function scaleFrames(frames, fromWidth, toWidth) {
  const ratio = fromWidth > 0 ? toWidth / fromWidth : 1;
  return (frames || []).map((frame) => {
    const copy = JSON.parse(JSON.stringify(frame));
    copy.x = Math.round(num(copy.x) * ratio);
    copy.y = Math.round(num(copy.y) * ratio);
    copy.w = Math.max(1, Math.round(num(copy.w) * ratio));
    copy.h = Math.max(1, Math.round(num(copy.h) * ratio));
    copy.radius = Math.max(0, Math.round(num(copy.radius) * ratio));
    delete copy.role;
    copy.elements = (copy.elements || []).map((el) => {
      const scaled = { ...el };
      scaled.x = Math.round(num(scaled.x) * ratio);
      scaled.y = Math.round(num(scaled.y) * ratio);
      scaled.w = Math.max(1, Math.round(num(scaled.w) * ratio));
      scaled.h = Math.max(1, Math.round(num(scaled.h) * ratio));
      if (scaled.style && typeof scaled.style === "object") {
        scaled.style = { ...scaled.style };
        for (const key of RENDER_SCALED_STYLE_KEYS) {
          if (scaled.style[key] !== undefined && scaled.style[key] !== null) {
            scaled.style[key] = Math.round(Number(scaled.style[key]) * ratio * 100) / 100;
          }
        }
      }
      return scaled;
    });
    return copy;
  });
}

/** Общий CSS для многофайлового экспорта (assets/css/style.css). */
export function buildStylesheet(doc) {
  const settings = doc?.settings || {};
  const width = contentWidth(doc);
  const bodyBg = css(settings.bg, "#ffffff");
  const adaptive = isManualResponsive(doc)
    ? `${LAYOUT_CSS}${MANUAL_MEDIA_CSS}`
    : responsiveCss(responsiveBreakpoint(doc));
  return `${BASE_CSS}
body{background:${bodyBg};}
:root{--sb-body-bg:${bodyBg};}
.sb-site{width:${width}px;background:${bodyBg};}
${adaptive}
${SHELL_CSS}
${CRM_CSS}`;
}

/** Общий JS для многофайлового экспорта (assets/js/main.js). */
export function buildMainScript(doc) {
  const reflowAt = isManualResponsive(doc) ? 0 : responsiveBreakpoint(doc);
  return `${shellScript()}\n${scaleScript(reflowAt)}\n${APPEAR_SCRIPT}\n${INTERACTIVE_SCRIPT}\n${CRM_SCRIPT}`;
}

/**
 * HTML одной страницы для многофайлового экспорта.
 * Ссылки на страницы уже преобразованы в имена файлов через pageHrefs.
 */
export function renderBundlePage(doc, page, { pageHrefs = new Map(), imageMap = new Map() } = {}) {
  const settings = doc?.settings || {};
  const meta = doc?.meta || {};
  const width = contentWidth(doc);
  const pages = docPages(doc);
  const manual = isManualResponsive(doc);
  const pageSlugs = new Map(pages.map((item) => [item.id, item.slug]));
  const ctx = { pageHrefs, pageSlugs, imageMap };
  const pageTitle = page?.name && pages.length > 1
    ? `${page.name} — ${meta.title || "Сайт"}`
    : (meta.title || "Сайт");
  const normalized = { ...page, deviceFrames: page?.deviceFrames || null };

  let body;
  if (manual) {
    let index = 0;
    const devicesHtml = ["desktop", "tablet", "phone"]
      .map((device) => {
        const deviceWidth = deviceLayoutWidth(doc, device);
        const frames = fallbackDeviceFrames(doc, normalized, device);
        const tree = buildFrameTree(frames || []);
        const sections = tree.roots
          .map((item) => (hasTreeContent(item) ? renderSectionFrame(item, index++, ctx) : ""))
          .join("");
        const { header, footer } = docComponents(doc, device);
        const head = header && frameHasContent(header) ? renderFrame(header, false, 0, ctx) : "";
        const foot = footer && frameHasContent(footer) ? renderFrame(footer, false, 0, ctx) : "";
        return `<div class="sb-device sb-device-${attr(device)}"><div class="sb-viewport" style="--sb-w:${deviceWidth}px" data-design-width="${deviceWidth}"><main class="sb-site" data-width="${deviceWidth}">${head}${sections}${foot}</main></div></div>`;
      })
      .join("");
    body = `<div class="sb-pages">${devicesHtml}</div>`;
  } else {
    const { header, footer } = docComponents(doc, "desktop");
    const tree = buildFrameTree(page?.frames || []);
    let index = 0;
    const sections = tree.roots
      .map((item) => (hasTreeContent(item) ? renderSectionFrame(item, index++, ctx) : ""))
      .join("");
    const headerHtml = header && frameHasContent(header) ? renderFrame(header, false, 0, ctx) : "";
    const footerHtml = footer && frameHasContent(footer) ? renderFrame(footer, false, 0, ctx) : "";
    body = `<div class="sb-viewport" style="--sb-w:${width}px" data-design-width="${width}"><main class="sb-site" data-width="${width}">${headerHtml}${sections}${footerHtml}</main></div>`;
  }

  return `<!doctype html>
<html lang="${attr(meta.lang || "ru")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${attr(meta.description || "")}">
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
${shellMarkup(doc,body,{pageHrefs,pageId:page.id})}
<script src="assets/js/main.js"></script>
</body>
</html>`;
}

function frameHasContent(frame) {
  if (!frame) return false;
  if ((frame.elements || []).length) return true;
  return false;
}

function hasTreeContent(item) {
  if (frameHasContent(item.frame)) return true;
  return item.children.some((child) => hasTreeContent(child));
}

function allDocumentFrames(doc) {
  const frames = [];
  for (const page of docPages(doc)) {
    frames.push(...(page.frames || []));
    if (isManualResponsive(doc)) {
      for (const device of ["tablet", "phone"]) {
        frames.push(...fallbackDeviceFrames(doc, page, device));
      }
    }
  }
  for (const device of isManualResponsive(doc) ? ["desktop", "tablet", "phone"] : ["desktop"]) {
    const { header, footer } = docComponents(doc, device);
    if (header) frames.push(header);
    if (footer) frames.push(footer);
  }
  return frames;
}

/** Собрать автономный HTML: все изображения становятся data URI. */
export async function renderStandalone(doc, options = {}) {
  const urls = new Set();
  for (const frame of allDocumentFrames(doc)) {
    for (const el of frame.elements || []) {
      if (el.type === "image" && el.props?.src && !String(el.props.src).startsWith("data:")) {
        urls.add(el.props.src);
      }
    }
  }
  const inlineImages = new Map();
  await Promise.all(
    [...urls].map(async (url) => {
      try {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) return;
        const blob = await response.blob();
        const dataUri = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        inlineImages.set(url, dataUri);
      } catch (error) {
        // Офлайн-экспорт не должен падать из-за одной картинки.
      }
    }),
  );
  return { html: renderDocument(doc, { ...options, inlineImages }), inlineImages };
}

export function collectImageUrls(doc) {
  const urls = new Set();
  for (const frame of allDocumentFrames(doc)) {
    for (const el of frame.elements || []) {
      if (el.type === "image" && el.props?.src && !String(el.props.src).startsWith("data:")) {
        urls.add(el.props.src);
      }
    }
  }
  return [...urls];
}
