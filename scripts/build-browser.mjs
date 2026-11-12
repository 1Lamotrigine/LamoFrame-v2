import { build } from "esbuild";
import { readFile, readdir, mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = process.cwd(),
  output = resolve("public/local");
await mkdir(output, { recursive: true });
const assets = {};
async function readTree(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = dir + "/" + entry.name;
    if (entry.isDirectory()) await readTree(path);
    else if (/\.(html|json)$/.test(path))
      assets[path] = await readFile(path, "utf8");
  }
}
await readTree("templates");
await readTree("data");
// Node-only template route and local browser renderer share markup, but local
// publication must embed its sandbox document instead of starting another app.
assets["templates/public_preview.html"] = assets[
  "templates/public_preview.html"
].replace(
  'src="{{ url("public_raw", project.slug) }}"',
  'srcdoc="{{ project.exported_html }}"',
);
const modules = (await readdir("public/static/js")).filter((name) =>
  name.endsWith(".js"),
);
const aliases = {
  "node:fs/promises": "browser/adapters/fs.mjs",
  "node:fs": "browser/adapters/fs.mjs",
  "node:path": "browser/adapters/path.mjs",
  "node:crypto": "browser/adapters/crypto.mjs",
  sharp: "browser/adapters/sharp.mjs",
};
const plugin = {
  name: "local-backend",
  setup(b) {
    b.onResolve({ filter: /^local:assets$/ }, () => ({
      path: "assets",
      namespace: "local",
    }));
    b.onLoad({ filter: /.*/, namespace: "local" }, () => ({
      contents:
        "export const assets=" +
        JSON.stringify(assets) +
        ";export const modules=" +
        JSON.stringify(modules) +
        ";",
      loader: "js",
    }));
    b.onResolve({ filter: /^(node:|sharp$)/ }, (args) =>
      aliases[args.path] ? { path: resolve(root, aliases[args.path]) } : null,
    );
    b.onResolve({ filter: /\/db\.mjs$/ }, (args) =>
      args.importer.includes("/lib/")
        ? { path: resolve("browser/db.mjs") }
        : null,
    );
    b.onResolve({ filter: /^\.\/render\.mjs$/ }, (args) =>
      args.importer.includes("/lib/")
        ? { path: resolve("browser/render.mjs") }
        : null,
    );
    b.onResolve({ filter: /^\.\/auth\.mjs$/ }, (args) =>
      args.importer.includes("/lib/")
        ? { path: resolve("browser/adapters/auth.mjs") }
        : null,
    );
    b.onResolve({ filter: /^\.\/(oauth|admin)\.mjs$/ }, () => ({
      path: resolve("browser/adapters/disabled.mjs"),
    }));
  },
};
const common = {
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  logLevel: "info",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [plugin],
  inject: [resolve("browser/buffer.mjs")],
};
await build({
  ...common,
  entryPoints: ["browser/bootstrap.mjs"],
  outfile: resolve(output, "bootstrap.js"),
});
await build({
  ...common,
  plugins: [
    {
      name: "browser-only-worker",
      setup(b) {
        b.onResolve({ filter: /^(fs|fs\/promises|path|url)$/ }, () => ({
          path: "node-stub",
          namespace: "worker-stub",
        }));
        b.onLoad({ filter: /.*/, namespace: "worker-stub" }, () => ({
          contents: "export default {};",
          loader: "js",
        }));
      },
    },
  ],
  external: ["node:*"],
  entryPoints: ["browser/pglite-worker.mjs"],
  outfile: resolve(output, "pglite-worker.js"),
});
for (const name of ["pglite.wasm", "initdb.wasm", "pglite.data"])
  await copyFile(
    resolve("node_modules/@electric-sql/pglite/dist", name),
    resolve(output, name),
  );
