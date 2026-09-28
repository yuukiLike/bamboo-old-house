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

async function writeLocalizedPages(directory: string) {
  for (const [file, language] of [
    ['index.html', 'en'], ['cn.html', 'zh-CN'], ['en.html', 'en'], ['ja.html', 'ja'],
  ]) {
    await writeFile(join(directory, file), `<html lang="${language}"><body>Bamboo</body></html>`);
  }
  await writeFile(join(directory, '404.html'), '<h1>Not found</h1>');
}

await test('release requires an HTML entry point and accepts assets up to 25 MiB', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'bamboo-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(inspectAssets(directory), /Missing.*index.html/);
  await writeLocalizedPages(directory);
  await writeFile(join(directory, 'model.glb'), '');
  await truncate(join(directory, 'model.glb'), maxAssetBytes);
  assert.equal((await inspectAssets(directory)).files, 6);
  await truncate(join(directory, 'model.glb'), maxAssetBytes + 1);
  await assert.rejects(inspectAssets(directory), /25 MiB.*model.glb/);
});

await test('release rejects omitted locales, wrong language markup, and a missing 404 page', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'bamboo-localized-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeLocalizedPages(directory);
  await writeFile(join(directory, 'index.html'), '<html lang="zh-CN"></html>');
  await assert.rejects(inspectAssets(directory), /Wrong HTML language in index.html/);
  await writeFile(join(directory, 'index.html'), '<html lang="en"></html>');
  await rm(join(directory, 'cn.html'));
  await assert.rejects(inspectAssets(directory), /Missing localized page: cn.html/);
  await writeFile(join(directory, 'cn.html'), '<html lang="en"></html>');
  await assert.rejects(inspectAssets(directory), /Wrong HTML language in cn.html/);
  await writeFile(join(directory, 'cn.html'), '<html lang="zh-CN"></html>');
  await rm(join(directory, 'en.html'));
  await assert.rejects(inspectAssets(directory), /Missing localized page: en.html/);
  await writeFile(join(directory, 'en.html'), '<html lang="zh-CN"></html>');
  await assert.rejects(inspectAssets(directory), /Wrong HTML language in en.html/);
  await writeFile(join(directory, 'en.html'), '<html lang="en"></html>');
  await rm(join(directory, '404.html'));
  await assert.rejects(inspectAssets(directory), /Missing 404.html/);
});

await test('upload rejects a changed commit, branch, or asset after preparation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'bamboo-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeLocalizedPages(directory);
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
  await writeFile(join(directory, 'index.html'), '<html lang="en"><h1>Changed</h1></html>');
  const changedAssets = await inspectAssets(directory);
  assert.throws(
    () => verifyRelease(manifest, source, changedAssets),
    /assets changed/,
  );
});
