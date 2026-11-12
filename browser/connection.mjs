export async function connect() {
  if (!window.SharedWorker)
    throw Error(
      "Для локальной базы нужен браузер с SharedWorker: актуальный Chrome, Edge или Firefox.",
    );
  const lease = "lamoframe-tab:" + crypto.randomUUID();
  await new Promise((resolve) => {
    navigator.locks.request(lease, () => {
      resolve();
      return new Promise(() => {});
    });
  });
  const worker = new SharedWorker("/local/pglite-worker.js", {
      type: "module",
      name: "lamoframe-local-db-v1",
    }),
    port = worker.port;
  let sequence = 0;
  const pending = new Map();
  port.onmessage = (event) => {
    const { id, result, error } = event.data;
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
    if (error)
      request.reject(Object.assign(Error(error.message), { code: error.code }));
    else request.resolve(result);
  };
  port.start();
  const failed = (event) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(
        Error(event.message || "Не удалось открыть локальную базу"),
      );
    }
    pending.clear();
  };
  worker.onerror = failed;
  port.onmessageerror = failed;
  function rpc(method, args = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          Error(
            "Локальная база не ответила. Повторите действие или обновите страницу.",
          ),
        );
      }, 30000);
      pending.set(id, { resolve, reject, timer });
      port.postMessage({ id, method, args });
    });
  }
  await rpc("init", { lease });
  const client = {
    query: (sql, params = []) => rpc("query", { sql, params }),
    exec: (sql) => rpc("exec", { sql }),
  };
  client.transaction = async (callback) => {
    await rpc("begin");
    try {
      const result = await callback(client);
      await rpc("commit");
      return result;
    } catch (error) {
      await rpc("rollback").catch(() => {});
      throw error;
    }
  };
  return client;
}
