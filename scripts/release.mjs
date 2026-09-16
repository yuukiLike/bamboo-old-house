import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const assetsDirectory = resolve(root, 'dist/client');
const manifestName = 'release.json';
export const maxAssetBytes = 25 * 1024 * 1024;

// Include paths and content hashes so a stale or changed build cannot be uploaded.
export async function inspectAssets(directory) {
  const files = [];
  async function visit(relative = '') {
    for (const entry of await readdir(resolve(directory, relative), {
      withFileTypes: true,
    })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Unsupported asset: ${path}`);
      if (path === manifestName) continue;
      const bytes = (await stat(resolve(directory, path))).size;
      if (bytes > maxAssetBytes) {
        throw new Error(
          `Asset exceeds Cloudflare's 25 MiB limit: ${path} (${bytes} bytes)`,
        );
      }
      const hash = createHash('sha256')
        .update(await readFile(resolve(directory, path)))
        .digest('hex');
      files.push({ path, bytes, sha256: hash });
    }
  }
  await visit();
  if (!files.some((file) => file.path === 'index.html')) {
    throw new Error(
      'Missing dist/client/index.html; run pnpm build:release first.',
    );
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    files: files.length,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
  };
}

function readSource() {
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (git('status', '--porcelain', '--untracked-files=all')) {
    throw new Error(
      'Commit or stash source changes before preparing/uploading a release.',
    );
  }
  const commit = git('rev-parse', 'HEAD');
  if (
    process.env.WORKERS_CI_COMMIT_SHA &&
    process.env.WORKERS_CI_COMMIT_SHA !== commit
  ) {
    throw new Error(
      'Workers Builds commit does not match the checked-out Git commit.',
    );
  }
  const branch =
    process.env.WORKERS_CI_BRANCH || git('branch', '--show-current');
  if (!branch)
    throw new Error('Cannot identify source branch. Use a branch checkout.');
  return { commit, branch };
}

export function verifyRelease(manifest, source, assets) {
  if (manifest.commit !== source.commit || manifest.branch !== source.branch) {
    throw new Error('Release source changed; run pnpm build:release again.');
  }
  if (manifest.assets?.sha256 !== assets.sha256) {
    throw new Error('Built assets changed; run pnpm build:release again.');
  }
}

async function main() {
  const command = process.argv[2];
  if (!['inspect', 'prepare', 'upload'].includes(command)) {
    throw new Error('Usage: node scripts/release.mjs inspect|prepare|upload');
  }
  const assets = await inspectAssets(assetsDirectory);
  if (command === 'inspect') {
    console.log(JSON.stringify(assets, null, 2));
    return;
  }
  const source = readSource();
  const manifestPath = resolve(assetsDirectory, manifestName);
  if (command === 'prepare') {
    const manifest = {
      ...source,
      builtAt: new Date().toISOString(),
      buildId: process.env.WORKERS_CI_BUILD_UUID || null,
      assets,
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `Prepared ${source.branch} @ ${source.commit}; ${assets.files} assets.`,
    );
    return;
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  verifyRelease(manifest, source, assets);
  // Upload creates a version and preview URL. It never deploys production traffic.
  execFileSync(
    resolve(root, 'node_modules/.bin/wrangler'),
    [
      'versions',
      'upload',
      '--config',
      'wrangler.static.jsonc',
      '--tag',
      source.commit,
      '--message',
      `${source.branch}; build=${manifest.buildId || 'local'}`,
    ],
    { cwd: root, stdio: 'inherit' },
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
