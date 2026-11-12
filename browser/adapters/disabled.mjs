export function oauth() {
  return Response.redirect(location.origin + "/accounts/login/", 303);
}
export function adminPage() {
  return new Response(
    "В локальном режиме администрирование аккаунтов не используется.",
    { status: 404 },
  );
}
