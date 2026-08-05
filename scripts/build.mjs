import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const files = ["index.html", "styles.css", "app.js", "core.mjs"];

await rm("dist", { recursive: true, force: true });
await mkdir("dist/server", { recursive: true });
await Promise.all(files.map((file) => cp(file, `dist/${file}`)));
await cp("api.mjs", "dist/api.mjs");

const assets = Object.fromEntries(await Promise.all(files.map(async (file) => [`/${file}`, await readFile(file, "utf8")])));
assets["/"] = assets["/index.html"];

const worker = `import { handleApi, TriviaRoom } from "../api.mjs";

export { TriviaRoom };

const ASSETS = ${JSON.stringify(assets)};
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    const body = ASSETS[url.pathname];
    if (body === undefined) return new Response("Not found", { status: 404 });
    const extension = url.pathname.match(/\\.[^.]+$/)?.[0] ?? ".html";
    const headers = { "content-type": TYPES[extension] ?? "text/plain; charset=utf-8", "cache-control": extension === ".html" ? "no-cache" : "public, max-age=3600" };
    return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
  }
};
`;

await writeFile("dist/server/index.js", worker);
console.log(`Built ${files.length} browser assets and the deployment worker into dist/`);
