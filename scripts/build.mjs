import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

const moduleFiles = (await readdir("modules")).filter((file) => file.endsWith(".js")).map((file) => `modules/${file}`);
// Local room support imports api.mjs, which also imports daily.mjs. Both must
// be served to browsers as well as copied for the Worker entrypoint.
const files = ["index.html", "admin.html", "admin.css", "admin.js", "admin.mjs", "ok-logo.svg", "favicon.svg", "styles.css", "studio.css", "app.js", "core.mjs", "api.mjs", "daily.mjs", "auth.mjs", "profiles.mjs", "accounts.css", ...moduleFiles];

await rm("dist", { recursive: true, force: true });
await mkdir("dist/modules", { recursive: true });
await mkdir("dist/server", { recursive: true });
await Promise.all([...files, "accounts.mjs", "better-auth-server.mjs"].map((file) => cp(file, `dist/${file}`)));

const assets = Object.fromEntries(await Promise.all(files.map(async (file) => [`/${file}`, await readFile(file, "utf8")])));
assets["/"] = assets["/index.html"];
assets["/admin"] = assets["/admin.html"];

const worker = `import { handleApi, TriviaRoom } from "../api.mjs";

export { TriviaRoom };

const ASSETS = ${JSON.stringify(assets)};
const TYPES = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8" };

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
