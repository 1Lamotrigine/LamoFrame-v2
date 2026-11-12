// The deployed server serves only the application shell and static assets.
// User profiles, forms, SQL and images are handled locally after this page loads.
const shell = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LamoFrame</title><link rel="icon" href="data:,"><style>body{font:16px system-ui;background:#f5f6fa;color:#182230;margin:0}.local-loading{max-width:560px;margin:18vh auto;padding:28px}p{line-height:1.6;color:#667085}</style></head><body><main class="local-loading"><h1>LamoFrame</h1><p role="status">Открываем вашу локальную мастерскую… При первом запуске загружается PGlite, это может занять немного времени.</p><noscript>Для работы конструктора включите JavaScript.</noscript></main><script type="module" src="/local/bootstrap.js?v=1"></script></body></html>`;
export function browserShell(req) {
  if (req.method !== "GET" && req.method !== "HEAD")
    return Response.json(
      {
        error:
          "Это локальная версия LamoFrame. Обновите страницу: данные обрабатываются в браузере.",
      },
      { status: 405, headers: { Allow: "GET, HEAD" } },
    );
  return new Response(req.method === "HEAD" ? null : shell, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
