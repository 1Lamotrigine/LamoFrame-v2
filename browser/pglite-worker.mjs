import { PGlite } from "@electric-sql/pglite";
// A SharedWorker owns one IndexedDB-backed database while any tab remains open.
// Interactive transactions pin the connection to one port; other ports queue.
let databasePromise,
  owner = null,
  running = false;
const queue = [],
  clients = new Map();
function database() {
  return (databasePromise ||= (async () => {
    const [pgliteWasmModule, initdbWasmModule, fsBundle] = await Promise.all([
      WebAssembly.compileStreaming(fetch("/local/pglite.wasm")),
      WebAssembly.compileStreaming(fetch("/local/initdb.wasm")),
      fetch("/local/pglite.data").then((r) => {
        if (!r.ok) throw Error("Не удалось загрузить PGlite");
        return r.blob();
      }),
    ]);
    return new PGlite({
      dataDir: "idb://lamoframe-browser-v1",
      pgliteWasmModule,
      initdbWasmModule,
      fsBundle,
    });
  })());
}
function reply(job, result, error) {
  try {
    job.port.postMessage({
      id: job.id,
      result,
      error: error ? { message: error.message, code: error.code } : undefined,
    });
  } catch {}
}
async function disconnect(port) {
  if (owner === port) {
    try {
      await (await database()).exec("ROLLBACK");
    } finally {
      owner = null;
    }
  }
  clients.delete(port);
  for (let i = queue.length - 1; i >= 0; i--)
    if (queue[i].port === port) queue.splice(i, 1);
  port.close();
}
async function drain() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const index = queue.findIndex((job) => !owner || job.port === owner);
      if (index < 0) break;
      const job = queue.splice(index, 1)[0];
      try {
        const db = await database();
        let result;
        if (job.method === "init") {
          if (!clients.has(job.port)) {
            clients.set(job.port, job.args.lease);
            // The browser releases this lease even when a tab crashes. Roll back any
            // unfinished transaction so another tab is never left waiting for it.
            navigator.locks.request(job.args.lease, () => {
              queue.push({ port: job.port, method: "disconnect" });
              drain();
            });
          }
          result = true;
        } else if (job.method === "begin") {
          await db.exec("BEGIN");
          owner = job.port;
          result = true;
        } else if (job.method === "commit") {
          await db.exec("COMMIT");
          owner = null;
          result = true;
        } else if (job.method === "rollback") {
          await db.exec("ROLLBACK");
          owner = null;
          result = true;
        } else if (job.method === "disconnect") {
          await disconnect(job.port);
          continue;
        } else if (job.method === "query")
          result = await db.query(job.args.sql, job.args.params || []);
        else if (job.method === "exec") result = await db.exec(job.args.sql);
        else throw Error("Неизвестная операция локальной базы");
        reply(job, result);
      } catch (error) {
        reply(job, null, error);
      }
    }
  } finally {
    running = false;
  }
}
self.onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = (message) => {
    const job = message.data;
    if (!job || typeof job.method !== "string") return;
    queue.push({ ...job, port });
    drain();
  };
  port.start();
};
