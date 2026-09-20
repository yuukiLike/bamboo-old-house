import assert from 'node:assert/strict';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  inspectAssets,
  maxAssetBytes,
  verifyRelease,
} from '../scripts/release.mjs';

await test('release requires an HTML entry point and accepts assets up to 25 MiB', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'bamboo-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(inspectAssets(directory), /Missing.*index.html/);
  await writeFile(join(directory, 'index.html'), '<h1>Bamboo</h1>');
  await writeFile(join(directory, 'model.glb'), '');
  await truncate(join(directory, 'model.glb'), maxAssetBytes);
  assert.equal((await inspectAssets(directory)).files, 2);
  await truncate(join(directory, 'model.glb'), maxAssetBytes + 1);
  await assert.rejects(inspectAssets(directory), /25 MiB.*model.glb/);
});

await test('upload rejects a changed commit, branch, or asset after preparation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'bamboo-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'index.html'), '<h1>Bamboo</h1>');
  const source = { commit: 'a'.repeat(40), branch: 'main' };
  const assets = await inspectAssets(directory);
  const manifest = { ...source, assets };
  assert.doesNotThrow(() => verifyRelease(manifest, source, assets));
  assert.throws(
    () =>
      verifyRelease(manifest, { ...source, commit: 'b'.repeat(40) }, assets),
    /source changed/,
  );
  assert.throws(
    () => verifyRelease(manifest, { ...source, branch: 'feature' }, assets),
    /source changed/,
  );
  await writeFile(join(directory, 'release.json'), JSON.stringify(manifest));
  assert.deepEqual(await inspectAssets(directory), assets);
  await writeFile(join(directory, 'index.html'), '<h1>Changed</h1>');
  const changedAssets = await inspectAssets(directory);
  assert.throws(
    () => verifyRelease(manifest, source, changedAssets),
    /assets changed/,
  );
});
