/** Тонкая обёртка над fetch + CSRF. */

export function csrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : window.BUILDER?.csrfToken || "";
}

async function request(url, options = {}) {
  const { timeout = 60000, signal: externalSignal, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  let response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(fetchOptions.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        "X-CSRFToken": csrfToken(),
        ...(fetchOptions.headers || {}),
      },
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Сервер не отвечает. Попробуйте ещё раз.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  let payload = null;
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    payload = await response.json().catch(() => null);
  }
  if (response.redirected && payload === null) {
    throw new Error("Сессия завершилась. Войдите в аккаунт в другой вкладке и повторите действие.");
  }
  if (!response.ok) {
    const message = payload?.error || `Ошибка ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export function loadProject(id) {
  return request(`/api/projects/${id}/`);
}

export function saveProject(id, { data, title, baseUpdatedAt }) {
  return request(`/api/projects/${id}/`, {
    method: "PUT",
    body: JSON.stringify({ data, title, base_updated_at: baseUpdatedAt }),
  });
}

export function uploadAsset(id, file) {
  const form = new FormData();
  form.append("file", file);
  return request(`/api/projects/${id}/assets/`, { method: "POST", body: form });
}

export function projectAction(id, action) {
  return request(`/projects/${id}/${action}/`, { method: "POST", body: "{}" });
}

export function exportUrl(id) {
  return `/projects/${id}/export/`;
}

export function publicUrl(slug) {
  return `/p/${slug}/`;
}

export function publication(id, method = 'GET', baseUpdatedAt) {
  return request(`/api/projects/${id}/publication/`, {
    method,
    ...(method === 'POST' ? { body: JSON.stringify({ base_updated_at: baseUpdatedAt }) } : {}),
  });
}
export function projectVersions(id) { return request(`/api/projects/${id}/versions/`); }
export function createVersion(id, label, baseUpdatedAt) {
  return request(`/api/projects/${id}/versions/`, { method: 'POST', body: JSON.stringify({label,base_updated_at:baseUpdatedAt}) });
}
export function restoreVersion(id, version, baseUpdatedAt) {
  return request(`/api/projects/${id}/versions/${version}/restore/`, { method: 'POST', body: JSON.stringify({base_updated_at:baseUpdatedAt}) });
}
export function deleteVersion(id, version) { return request(`/api/projects/${id}/versions/${version}/`,{method:'DELETE'}); }
export function loadVersion(id, version) { return request(`/api/projects/${id}/versions/${version}/`); }
