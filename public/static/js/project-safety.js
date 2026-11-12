import {
  publication,
  projectVersions,
  createVersion,
  restoreVersion,
  deleteVersion,
  loadVersion,
} from "./api.js";
import { escapeHtml } from "./render.js";
import { inspectLayouts } from "./project-checks.js";
import { localDrafts, sameDraft } from "./local-drafts.js";
import { toast } from "./toast.js";
import {
  state,
  on,
  setSelection,
  setActiveFrame,
  switchPage,
  setEditingDevice,
} from "./state.js";

export function setupProjectSafety({
  snapshot,
  title,
  version,
  save,
  apply,
  download,
  projectId,
  userId,
  onReady,
}) {
  const dialog = document.getElementById("projectDialog"),
    body = document.getElementById("projectDialogBody");
  const local = localDrafts(userId, projectId);
  let recovering = true,
    storageWarning = false,
    backupTimer,
    backupQueue = Promise.resolve();
  let selectedRecovery = null;
  const notice = (message) => {
    const node = document.createElement("p");
    node.className = "dialog-notice";
    node.setAttribute("role", "status");
    node.textContent = message;
    body.append(node);
  };
  const open = (heading, html) => {
    document.getElementById("projectDialogTitle").textContent = heading;
    body.innerHTML = html;
    if (!dialog.open) dialog.showModal();
  };
  const button = (label, action, parent = body, primary = false) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = `btn ${primary ? "btn-primary" : "btn-outline"}`;
    node.textContent = label;
    node.addEventListener("click", async () => {
      node.disabled = true;
      try {
        await action();
      } catch (e) {
        notice(e.message || "Не удалось выполнить действие.");
      } finally {
        node.disabled = false;
      }
    });
    parent.append(node);
    return node;
  };
  const actions = () => {
    const node = document.createElement("div");
    node.className = "dialog-actions";
    body.append(node);
    return node;
  };
  const downloadJSON = (data, name) =>
    download(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      name,
    );
  const mine = () => ({
    data: snapshot(),
    title: title(),
    base_updated_at: version(),
  });
  function warnStorage() {
    if (!storageWarning) {
      storageWarning = true;
      toast(
        "Локальная резервная копия недоступна. При ошибке сохранения скачайте JSON проекта.",
        { type: "info", duration: 6000 },
      );
    }
  }
  function backup(immediate = false) {
    if (recovering) return;
    clearTimeout(backupTimer);
    const persist = () => {
      const value = mine();
      backupQueue = backupQueue
        .catch(() => {})
        .then(() => local.save(value))
        .catch(warnStorage);
    };
    if (immediate) persist();
    else backupTimer = setTimeout(persist, 200);
  }
  async function saved(expected) {
    clearTimeout(backupTimer);
    await backupQueue;
    if (expected && !sameDraft(mine(), expected)) return;
    try {
      await local.remove();
      if (selectedRecovery) {
        await local.removeIfUnchanged(selectedRecovery);
        selectedRecovery = null;
      }
    } catch {
      warnStorage();
    }
  }
  async function chooseRecovery() {
    try {
      const baseline = mine(),
        rows = await local.list();
      const candidates = [];
      for (const row of rows) {
        if (sameDraft(row, baseline)) await local.removeIfUnchanged(row);
        else candidates.push(row);
      }
      if (!candidates.length) {
        recovering = false;
        onReady();
        return;
      }
      open(
        "Найдена локальная копия",
        "<p>В этом браузере остались изменения, которые могли не сохраниться на сервере. Выберите копию для восстановления. Текущий серверный документ будет заменён только после вашего выбора.</p>",
      );
      const ready = () => {
        recovering = false;
        dialog.close();
        onReady();
      };
      // Closing keeps copies for the next visit and does not start autosave.
      const close = () => {
        recovering = false;
        onReady();
      };
      dialog.addEventListener("close", close, { once: true });
      for (const row of candidates) {
        const entry = document.createElement("section");
        entry.className = "version-row";
        entry.innerHTML = `<strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(new Date(row.savedAt).toLocaleString("ru-RU"))}${row.base_updated_at !== version() ? " · серверная версия изменилась" : ""}</small>`;
        body.append(entry);
        const list = document.createElement("div");
        list.className = "dialog-actions";
        entry.append(list);
        button(
          "Восстановить копию",
          async () => {
            selectedRecovery = row;
            recovering = false;
            apply(row.data, row.title, null, true);
            dialog.close();
            onReady();
          },
          list,
          true,
        );
        button(
          "Скачать JSON",
          () => downloadJSON(row, "lamoframe-recovery.json"),
          list,
        );
        button(
          "Удалить копию",
          async () => {
            await local.remove(row.id);
            entry.remove();
            if (!body.querySelector(".version-row")) ready();
          },
          list,
        );
      }
      button("Оставить серверную версию", ready, actions());
    } catch {
      recovering = false;
      warnStorage();
      onReady();
    }
  }
  function conflict() {
    open(
      "Конфликт сохранения",
      "<p>Проект изменён в другой вкладке. Автосохранение приостановлено, чтобы не затереть её изменения. Ваша копия остаётся в этом браузере.</p>",
    );
    const list = actions();
    button(
      "Скачать мою копию",
      () => downloadJSON(mine(), "lamoframe-conflict.json"),
      list,
      true,
    );
    button("Оставить изменения здесь", () => dialog.close(), list);
    notice(
      "Чтобы перейти к серверной версии, скачайте свою копию и обновите страницу. При следующем открытии можно выбрать локальное восстановление.",
    );
  }
  async function versions() {
    open("Версии проекта", "<p>Загрузка…</p>");
    button("Скачать исходник JSON", () =>
      downloadJSON(mine(), "lamoframe-project.json"),
    );
    try {
      const result = await projectVersions(projectId);
      body.innerHTML =
        '<p>Автоматические снимки сохраняются не чаще раза в минуту (последние 30). Можно сохранить до 50 именованных версий. Восстановление меняет только черновик холста и название; коллекции, записи и публикации сохраняются.</p><label for="versionLabel">Название версии</label><input id="versionLabel" class="input" maxlength="100" placeholder="Например, перед изменением главной">';
      const list = actions();
      button(
        "Сохранить версию",
        async () => {
          const label = document.getElementById("versionLabel").value.trim();
          if (!label) {
            notice("Введите название версии.");
            return;
          }
          if (!(await save({ force: true, manual: true })))
            throw Error("Сначала сохраните черновик.");
          await createVersion(projectId, label, version());
          await versions();
        },
        list,
        true,
      );
      button(
        "Скачать исходник JSON",
        () => downloadJSON(mine(), "lamoframe-project.json"),
        list,
      );
      if (!result.versions.length)
        notice("Версий пока нет. Первая появится после изменения проекта.");
      for (const v of result.versions) {
        const row = document.createElement("section");
        row.className = "version-row";
        row.innerHTML = `<strong>${escapeHtml(v.label || (v.automatic ? "Автоматическая копия" : "Версия"))}</strong><small>${escapeHtml(v.title)} · ${escapeHtml(new Date(v.created_at).toLocaleString("ru-RU"))}</small>`;
        body.append(row);
        const buttons = document.createElement("div");
        buttons.className = "dialog-actions";
        row.append(buttons);
        button(
          "Восстановить",
          async () => {
            open(
              "Восстановить версию?",
              `<p>Черновик будет заменён на «${escapeHtml(v.label || v.title)}». Перед заменой сервер сохранит резервную версию. Опубликованный сайт не изменится.</p>`,
            );
            const controls = actions();
            button(
              "Восстановить черновик",
              async () => {
                if (!(await save({ force: true })))
                  throw Error(
                    "Не удалось сохранить текущую работу. Скачайте JSON перед восстановлением.",
                  );
                const restored = await restoreVersion(
                  projectId,
                  v.id,
                  version(),
                );
                await saved();
                apply(
                  restored.data,
                  restored.title,
                  restored.updated_at,
                  false,
                );
                dialog.close();
                toast("Версия восстановлена. Публикация не изменена.", {
                  type: "success",
                });
              },
              controls,
              true,
            );
            button("Назад", versions, controls);
          },
          buttons,
        );
        button(
          "Скачать JSON",
          async () =>
            downloadJSON(
              await loadVersion(projectId, v.id),
              `lamoframe-version-${v.id}.json`,
            ),
          buttons,
        );
        button(
          "Удалить версию",
          async () => {
            await deleteVersion(projectId, v.id);
            await versions();
          },
          buttons,
        );
      }
    } catch (e) {
      body.textContent = e.message;
      button("Скачать исходник JSON", () =>
        downloadJSON(mine(), "lamoframe-project.json"),
      );
    }
  }
  async function publish() {
    open("Публикация сайта", "<p>Загрузка…</p>");
    try {
      const { publication: published } = await publication(projectId);
      body.innerHTML =
        "<p>Публикация создаёт отдельный снимок сохранённого сайта. Последующее редактирование остаётся в черновике. </p>";
      if(window.LAMO_LOCAL)notice('Это локальный снимок. Ссылка работает только в этом браузере. Чтобы поделиться обычным сайтом, скачайте ZIP или HTML.');
      if (published) {
        notice(
          `Опубликовано ${new Date(published.published_at).toLocaleString("ru-RU")}${published.source_version !== version() ? " · в черновике есть новая версия" : ""}`,
        );
        const link = document.createElement("a");
        link.href = window.BUILDER.publicUrl;
        link.target = "_blank";
        link.rel = "noopener";
        link.className = "text-link";
        link.textContent = "Открыть опубликованный сайт";
        body.append(link);
      } else
        notice(
          "Сайт не опубликован. Экспорт ZIP и сохранение черновика не открывают общий доступ.",
        );
      const list = actions();
      button(
        published ? "Обновить публикацию" : "Опубликовать сайт",
        async () => {
          if (!(await save({ force: true })))
            throw Error("Сначала сохраните черновик.");
          await publication(projectId, "POST", version());
          await publish();
          toast("Сайт опубликован", { type: "success" });
        },
        list,
        true,
      );
      if (published)
        button(
          "Снять с публикации",
          async () => {
            await publication(projectId, "DELETE");
            await publish();
            toast("Публичный доступ отключён", { type: "success" });
          },
          list,
        );
    } catch (e) {
      body.textContent = e.message;
    }
  }
  function checks() {
    const issues = inspectLayouts(snapshot());
    open(
      "Проверка макетов",
      "<p>Проверяются границы элементов, пустые изображения и ссылки. Декоративные элементы могут выходить за секцию намеренно. Автоматический адаптив дополнительно проверьте в превью на телефоне и планшете.</p>",
    );
    notice(
      issues.length
        ? `Найдено замечаний: ${issues.length}`
        : "Замечаний по геометрии и пустым элементам нет.",
    );
    for (const item of issues) {
      button(`${item.page} · ${item.device}: ${item.message}`, () => {
        switchPage(item.pageId);
        if (!state.doc.settings?.responsive?.auto)
          setEditingDevice(item.device);
        setActiveFrame(item.frameId);
        setSelection([item.elementId]);
        dialog.close();
        requestAnimationFrame(() => {
          for (const node of document.querySelectorAll(".layout-overflow"))
            node.classList.remove("layout-overflow");
          const element = [
            ...document.querySelectorAll(".sb-el[data-id]"),
          ].find((node) => node.dataset.id === item.elementId);
          element?.classList.add("layout-overflow");
          element?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
      }).classList.add("check-item");
    }
  }
  document
    .getElementById("closeProjectDialog")
    .addEventListener("click", () => dialog.close());
  document.getElementById("versionsBtn").addEventListener("click", versions);
  document.getElementById("publishSiteBtn")?.addEventListener("click", publish);
  document.getElementById("checkLayoutsBtn").addEventListener("click", checks);
  document
    .getElementById("projectTitle")
    .addEventListener("input", () => backup());
  window.addEventListener("pagehide", () => {
    if (state.dirty || state.saveState !== "saved") backup(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (state.dirty || state.saveState !== "saved"))
      backup(true);
  });
  chooseRecovery();
  return { backup, saved, conflict, isRecovering: () => recovering };
}
