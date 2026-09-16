import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const accountId = '59189ac1604f92c5cd02c2c0398a8190';
const workerName = 'bamboo-old-house';
const previewRules = {
  branch_includes: ['preview/*'],
  branch_excludes: ['main'],
};

// One-time Cloudflare account setup, never called by a build or deployment.
export async function configurePreviewBranch({
  token,
  apply = false,
  request = fetch,
}) {
  if (!token?.trim()) throw new Error('请先设置 CLOUDFLARE_API_TOKEN。');

  async function api(path, body) {
    const response = await request(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`,
      {
        method: body ? 'PATCH' : 'GET',
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Cloudflare HTTP ${response.status}；请检查账户与 API Token 权限。`,
      );
    }
    const data = await response.json();
    if (!data.success)
      throw new Error('Cloudflare 未确认操作成功；请检查 API Token 权限。');
    return data.result;
  }

  const workers = await api('/workers/scripts');
  const worker = workers.find((item) => item.id === workerName);
  if (!worker?.tag) throw new Error(`此账户中找不到 Worker ${workerName}。`);
  const triggersPath = `/builds/workers/${encodeURIComponent(worker.tag)}/triggers`;
  const triggers = (await api(triggersPath)).filter((item) => !item.deleted_on);
  const production = triggers.find(
    (item) =>
      isDeepStrictEqual(item.branch_includes, ['main']) &&
      isDeepStrictEqual(item.branch_excludes, []),
  );
  const preview = triggers.find(
    (item) =>
      (isDeepStrictEqual(item.branch_includes, ['*']) ||
        isDeepStrictEqual(item.branch_includes, ['preview']) ||
        isDeepStrictEqual(item.branch_includes, ['preview/*'])) &&
      isDeepStrictEqual(item.branch_excludes, ['main']),
  );
  if (
    triggers.length !== 2 ||
    !production?.trigger_uuid ||
    !preview?.trigger_uuid ||
    production.trigger_uuid === preview.trigger_uuid
  ) {
    throw new Error(
      '当前触发器与预期的 main / 非生产配置不一致；未修改任何设置。',
    );
  }

  const currentRules = {
    branch_includes: preview.branch_includes,
    branch_excludes: preview.branch_excludes,
  };
  const result = {
    worker: workerName,
    trigger: preview.trigger_uuid,
    before: currentRules,
    after: previewRules,
    changed: false,
    applied: false,
  };
  if (!apply) return result;

  if (!isDeepStrictEqual(currentRules, previewRules)) {
    await api(
      `/builds/triggers/${encodeURIComponent(preview.trigger_uuid)}`,
      previewRules,
    );
    result.changed = true;
  }

  // A successful PATCH alone is insufficient: read back the saved trigger pair.
  const saved = (await api(triggersPath)).filter((item) => !item.deleted_on);
  if (saved.length !== 2)
    throw new Error('配置后触发器数量发生变化，请在 Cloudflare 核对。');
  for (const previous of [production, preview]) {
    const actual = saved.find(
      (item) => item.trigger_uuid === previous.trigger_uuid,
    );
    const expected =
      previous === preview ? { ...previous, ...previewRules } : previous;
    // Server timestamps may change; all other trigger settings must be preserved.
    const settings = (item) => {
      if (!item) return null;
      const { modified_on: _modifiedOn, ...rest } = item;
      return rest;
    };
    if (!isDeepStrictEqual(settings(actual), settings(expected))) {
      throw new Error(
        '配置回读与预期不一致，请在 Cloudflare 核对；不要继续推送验证。',
      );
    }
  }
  result.applied = true;
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) {
    throw new Error(
      '用法：node scripts/configure-preview-branch.mjs [--apply]',
    );
  }
  const result = await configurePreviewBranch({
    token: process.env.CLOUDFLARE_API_TOKEN,
    apply: args[0] === '--apply',
  });
  console.log(JSON.stringify(result, null, 2));
  console.log(
    result.applied
      ? '已回读确认：非生产自动构建仅匹配 preview/*；main 触发器保持原样。'
      : '仅查看，尚未修改。添加 --apply 才会保存以上分支规则。',
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
