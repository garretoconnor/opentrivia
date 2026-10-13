import { readBuildOutput } from '@cloudflare/build-output-utils';
import { convertToWranglerConfig } from '@cloudflare/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export async function prepareDeployment(root = process.cwd()) {
  const { workers, rootConfig, containers } = await readBuildOutput(root);
  const built = workers.default;
  // This app builds one bundled Worker. Refuse unsupported output rather than
  // silently dropping another Worker, assets, containers, or extra modules.
  const manifest = built.config.manifest;
  if (Object.keys(workers).length !== 1 || Object.keys(containers ?? {}).length || built.assetsDir ||
    !built.bundleDir || !manifest || manifest.type !== 'complete' ||
    Object.keys(manifest.modules ?? {}).length !== 1 || manifest.modules[manifest.mainModule]?.type !== 'esm') {
    throw new Error('Expected one complete, bundled ESM Worker. Run npm run build:worker and check its output.');
  }
  const { buildContext, ...settings } = rootConfig;
  if (buildContext?.isPreview || buildContext?.mode) throw new Error('Production deployment requires a default production build.');
  const { manifest: ignoredManifest, ...worker } = built.config;
  const config = convertToWranglerConfig({ ...settings, worker, containers: [] });
  config.main = join(built.bundleDir, manifest.mainModule);
  config.no_bundle = true;
  // Repository configuration is authoritative. Preserve Dashboard variables
  // such as user-configured settings; Worker secrets are preserved by Wrangler.
  config.keep_vars = true;
  const configPath = join(root, '.cloudflare', 'deploy', 'wrangler.json');
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  return configPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--dry-run')) throw new Error('Only --dry-run is supported.');
    const configPath = await prepareDeployment();
    const result = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'),
      'deploy', '--config', configPath, '--strict=false', ...args], { stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
