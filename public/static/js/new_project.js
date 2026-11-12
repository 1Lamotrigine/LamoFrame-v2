/** Выбор шаблона и превью карточек (тот же render.js). */

import { renderDocument } from "./render.js";

const dataNode = document.getElementById("templates-data");
const templates = dataNode ? JSON.parse(dataNode.textContent) : {};
const form = document.getElementById("createForm");
const templateInput = document.getElementById("templateInput");
const titleInput = document.getElementById("projectTitle");
const hint = document.getElementById("templateHint");
let titleTouched = false;

for (const frame of document.querySelectorAll(".template-frame")) {
  const id = frame.dataset.templateId;
  const doc = templates[id];
  if (!doc) continue;
  const wrap = frame.closest(".template-frame-wrap");
  const page = doc.pages?.find((item) => item.id === doc.activePageId) || doc.pages?.[0];
  const blocks = page?.frames || doc.frames || doc.sections || [];
  const total = Math.max(
    600,
    ...blocks.map((block) => (Number(block.y) || 0) + (Number(block.height || block.h) || 0)),
  );
  const designWidth = Number(doc.settings?.width) || 1200;
  try {
    frame.style.width = `${designWidth}px`;
    frame.style.height = `${total}px`;
    if (wrap) {
      const resize = () => { frame.style.transform = `scale(${wrap.clientWidth / designWidth})`; };
      resize();
      new ResizeObserver(resize).observe(wrap);
    }
    frame.addEventListener("load", () => frame.classList.add("is-ready"), { once: true });
    frame.srcdoc = renderDocument(doc, { scripts: false });
  } catch (error) {
    console.error(error);
  }
}

titleInput?.addEventListener("input", () => {
  titleTouched = true;
});

function selectCard(card) {
  for (const other of document.querySelectorAll(".template-card")) {
    other.classList.toggle("is-selected", other === card);
    other.setAttribute("aria-pressed", String(other === card));
  }
  templateInput.value = card.dataset.template || "";
  const demo=document.getElementById("crmDemoOption");if(demo)demo.hidden=templateInput.value!=="builtin-sales-crm";
  if (!titleTouched || !titleInput.value.trim()) {
    titleInput.value = card.dataset.title || "Новый сайт";
  }
  hint.textContent = card.dataset.template
    ? `Шаблон: ${card.dataset.title}. Всё можно изменить.`
    : "Чистый холст — начните с пустого фрейма.";
}

for (const card of document.querySelectorAll(".template-card")) {
  card.addEventListener("click", () => selectCard(card));
}

const first = document.querySelector(".blank-card");
if (first) selectCard(first);
else hint.textContent = "Начните с пустого холста";

form?.addEventListener("submit", () => {
  if (!titleInput.value.trim()) titleInput.value = "Новый сайт";
  const button = form.querySelector(".create-btn");
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  const button = form?.querySelector(".create-btn");
  if (button) {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
});

document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("sb-theme", next);
  } catch (error) {
    /* ignore */
  }
});
