import { state, on, commit, configureSidebar } from "./state.js";
export function initSiteSettings() {
  const theme = document.getElementById("siteThemeMode"),
    enabled = document.getElementById("siteSidebarEnabled"),
    width = document.getElementById("siteSidebarWidth"),
    brand = document.getElementById("siteSidebarBrand"),
    fluid = document.getElementById("siteFluidLayout");
  function sync() {
    if (!state.doc) return;
    const s = state.doc.settings;
    theme.value = s.theme || "light";
    enabled.checked = !!s.sidebar?.enabled;
    width.value = s.sidebar?.width || 240;
    brand.value = s.sidebar?.brand || state.doc.meta.title;
    fluid.checked = !!s.fluidLayout;
    width.disabled = brand.disabled = !enabled.checked;
    document.getElementById("sidebarWidthLabel").textContent =
      width.value + " px";
  }
  theme.addEventListener("change", () =>
    commit(
      () => {
        state.doc.settings.theme = theme.value;
      },
      { label: "site-theme" },
    ),
  );
  enabled.addEventListener("change", () =>
    configureSidebar({ enabled: enabled.checked }),
  );
  width.addEventListener("change", () =>
    configureSidebar({ width: Number(width.value) }),
  );
  brand.addEventListener("change", () =>
    configureSidebar({ brand: brand.value.trim().slice(0, 100) }),
  );
  fluid.addEventListener("change", () =>
    commit(
      () => {
        state.doc.settings.fluidLayout = fluid.checked;
      },
      { label: "site-fluid-layout" },
    ),
  );
  document
    .querySelector("[data-add-sidebar]")
    ?.addEventListener("click", () => {
      configureSidebar({ enabled: true });
      document.getElementById("siteSettingsDetails").open = true;
      enabled.focus();
    });
  on("doc", ({ transient }) => {
    if (!transient) sync();
  });
  on("selection", sync);
  sync();
}
