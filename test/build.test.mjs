import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

test("deployed Worker serves the entire browser module graph", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), "opentrivia-build-"));
  try {
    for (const file of ["package.json", "scripts", "modules", "index.html", "admin.html", "admin.css", "admin.js", "admin.mjs", "ok-logo.svg", "favicon.svg", "styles.css", "studio.css", "app.js", "core.mjs", "api.mjs", "daily.mjs", "auth.mjs", "accounts.mjs", "accounts.css", "better-auth-server.mjs"]) {
      await cp(join(root, file), join(directory, file), { recursive: true });
    }
    execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: directory });
    const { default: worker } = await import(pathToFileURL(join(directory, "dist/server/index.js")));
    const origin = "https://opentrivia.example";
    const page = await worker.fetch(new Request(origin), {});
    assert.equal(page.status, 200);
    const html = await page.text();
    for (const asset of ["ok-logo.svg", "favicon.svg"]) {
      const response = await worker.fetch(new Request(new URL(asset, origin)), {});
      assert.equal(response.status, 200, `Brand asset must be served: ${asset}`);
      assert.match(response.headers.get("content-type"), /image\/svg\+xml/);
      assert.match(await response.text(), /<svg\b/);
    }
    const entry = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/);
    assert.ok(entry, "HTML includes a browser module entrypoint");
    const pending = [new URL(entry[1], origin).href];
    for (const path of ['/admin', '/admin.html']) {
      const response = await worker.fetch(new Request(origin + path), {});
      assert.equal(response.status, 200);
      const admin = await response.text();
      assert.match(admin, /Daily question bank/);
      pending.push(new URL(admin.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/)[1], origin).href);
    }
    const adminCss = await worker.fetch(new Request(origin + '/admin.css'), {});
    assert.equal(adminCss.status, 200);
    assert.match(adminCss.headers.get('content-type'), /text\/css/);
    const visited = new Set();
    while (pending.length) {
      const url = pending.pop();
      if (visited.has(url)) continue;
      visited.add(url);
      const response = await worker.fetch(new Request(url), {});
      assert.equal(response.status, 200, `Browser module must be served: ${url}`);
      assert.match(response.headers.get("content-type"), /javascript/, url);
      const source = await response.text();
      for (const match of source.matchAll(/\bimport\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g)) {
        assert.ok(match[1].startsWith("."), `Browser import must be relative: ${match[1]}`);
        pending.push(new URL(match[1], url).href);
      }
    }
    assert.ok(visited.size > 1, "Traversed the entrypoint's dependencies");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
