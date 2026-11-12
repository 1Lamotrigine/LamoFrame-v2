/** Account/project scoped recovery copies. Each page has its own key: tabs never overwrite each other. */
let connection;
function database() {
  if (!connection)
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open("lamoframe-recovery", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("drafts", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  return connection;
}
async function run(mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", mode);
    const request = action(tx.objectStore("drafts"));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || Error("Локальное хранилище недоступно"));
  });
}
export function localDrafts(userId, projectId) {
  const generation=typeof localStorage!=="undefined"?(localStorage.getItem("lamoframe.recoveryGeneration")||"initial"):"initial";
  const scope = `${generation}:${userId}:${projectId}:`;
  const id = scope + crypto.randomUUID();
  return {
    save: (value) =>
      run("readwrite", (store) =>
        store.put({ ...value, id, scope, savedAt: Date.now() }),
      ),
    remove: (key = id) => run("readwrite", (store) => store.delete(key)),
    removeIfUnchanged: async (expected) => {
      const db = await database();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("drafts", "readwrite"),
          store = tx.objectStore("drafts");
        const request = store.get(expected.id);
        request.onsuccess = () => {
          const current = request.result;
          if (
            current &&
            current.savedAt === expected.savedAt &&
            sameDraft(current, expected)
          )
            store.delete(expected.id);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
    list: async () =>
      (await run("readonly", (store) => store.getAll()))
        .filter((row) => row.scope === scope)
        .sort((a, b) => b.savedAt - a.savedAt),
  };
}

export function sameDraft(a, b) {
  const stable = (value) =>
    value && typeof value === "object"
      ? Array.isArray(value)
        ? value.map(stable)
        : Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, stable(value[key])]),
          )
      : value;
  return (
    a.title === b.title &&
    JSON.stringify(stable(a.data)) === JSON.stringify(stable(b.data))
  );
}
