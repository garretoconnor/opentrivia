import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareDeployment } from '../scripts/deploy-prebuilt.mjs';

test('prebuilt deployment retains bindings and exports and uploads the existing bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opentrivia-deploy-'));
  try {
    await assert.rejects(prepareDeployment(root));
    const output = join(root, '.cloudflare/output/v0');
    const directory = join(output, 'workers/default');
    await mkdir(join(directory, 'bundle'), { recursive: true });
    await writeFile(join(directory, 'bundle/index.js'), 'export default { fetch() { return new Response("test"); } };');
    const worker = { name: 'test-worker', compatibilityDate: '2026-08-01',
      env: { AUTH_EMAIL: { type: 'send-email', allowedSenderAddresses: ['bot@okener.com'] }, AUTH_EMAIL_FROM: { type: 'text', value: 'bot@okener.com' }, DB: { type: 'd1', name: 'test-db', id: '5951b3b3-d55d-4e4f-ad61-c62840ba4e3c' },
        ROOMS: { type: 'durable-object', worker: 'test-worker', exportName: 'TriviaRoom' } },
      exports: { TriviaRoom: { type: 'durable-object', storage: 'sqlite' } },
      manifest: { type: 'complete', mainModule: 'index.js', modules: { 'index.js': { type: 'esm' } } } };
    await writeFile(join(directory, 'worker.config.json'), JSON.stringify(worker));
    await writeFile(join(output, 'config.json'), JSON.stringify({ accountId: 'test-account', buildContext: { isPreview: false } }));
    const before = await readFile(join(directory, 'bundle/index.js'), 'utf8');
    const configPath = await prepareDeployment(root);
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal(config.account_id, 'test-account');
    assert.equal(config.name, 'test-worker');
    assert.equal(config.main, join(directory, 'bundle/index.js'));
    assert.equal(config.no_bundle, true);
    assert.equal(config.keep_vars, true);
    assert.equal(config.build, undefined);
    assert.equal(config.d1_databases[0].database_id, worker.env.DB.id);
    assert.equal(config.durable_objects.bindings[0].class_name, 'TriviaRoom');
    assert.deepEqual(config.send_email, [{ name: 'AUTH_EMAIL', allowed_sender_addresses: ['bot@okener.com'] }]);
    assert.equal(config.vars.AUTH_EMAIL_FROM, 'bot@okener.com');
    assert.equal(config.exports.TriviaRoom.storage, 'sqlite');
    assert.equal(await readFile(config.main, 'utf8'), before);
    await writeFile(join(output, 'config.json'), JSON.stringify({ buildContext: { isPreview: true } }));
    await assert.rejects(prepareDeployment(root), /production build/);
    await writeFile(join(output, 'config.json'), JSON.stringify({ buildContext: { isPreview: false } }));
    worker.manifest.modules['extra.js'] = { type: 'esm' };
    await writeFile(join(directory, 'bundle/extra.js'), 'export const extra = 1;');
    await writeFile(join(directory, 'worker.config.json'), JSON.stringify(worker));
    await assert.rejects(prepareDeployment(root), /one complete, bundled ESM Worker/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
