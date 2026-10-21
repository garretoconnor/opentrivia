import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

// Public files retain their URLs; shared and local-room modules keep their
// source layout so relative imports work in both Node and the browser.
const publicFiles = (await readdir("public", { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => `${entry.parentPath}/${entry.name}`.replace(/^public\//, ""));
const browserModules = ["src/shared/core.mjs", "src/shared/answer-check.mjs",
  ...["api", "daily", "admin", "auth", "profiles"].map((name) => `src/server/${name}.mjs`)];
const files = [...publicFiles, ...browserModules];

await rm("dist", { recursive: true, force: true });
await mkdir("dist/server", { recursive: true });
await cp("public", "dist", { recursive: true });
await cp("src", "dist/src", { recursive: true });

const assets = Object.fromEntries(await Promise.all(files.map(async (file) => [
  `/${file}`, await readFile(publicFiles.includes(file) ? `public/${file}` : file, "utf8")
])));
assets["/"] = assets["/index.html"];
assets["/admin"] = assets["/admin.html"];

const worker = `import { handleApi, TriviaRoom } from "../src/server/api.mjs";

export { TriviaRoom };

const ASSETS = ${JSON.stringify(assets)};
const TYPES = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    const body = url.pathname.startsWith("/@") && /^[a-zA-Z0-9_]{3,30}$/.test(url.pathname.slice(2)) ? ASSETS["/"] : ASSETS[url.pathname];
    if (body === undefined) return new Response("Not found", { status: 404 });
    const extension = url.pathname.match(/\\.[^.]+$/)?.[0] ?? ".html";
    const headers = { "content-type": TYPES[extension] ?? "text/plain; charset=utf-8", "cache-control": extension === ".html" ? "no-cache" : "public, max-age=3600" };
    return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
  }
};
`;

await writeFile("dist/server/index.js", worker);
console.log(`Built ${files.length} browser assets and the deployment worker into dist/`);
