import assert from 'node:assert/strict';
import test from 'node:test';
import { configurePreviewBranch } from '../scripts/configure-preview-branch.mjs';

const production = {
  trigger_uuid: 'production-trigger',
  branch_includes: ['main'],
  branch_excludes: [],
  build_command: 'pnpm run build',
  deploy_command: 'npx wrangler versions upload',
};
const preview = {
  ...production,
  trigger_uuid: 'preview-trigger',
  branch_includes: ['*'],
  branch_excludes: ['main'],
};

function cloudflare(
  initial = [production, preview],
  options: { reject?: boolean; changeProduction?: boolean } = {},
) {
  let triggers = structuredClone(initial);
  const patches: { url: string; body: unknown }[] = [];
  const request: typeof fetch = async (url, init) => {
    assert.ok(typeof url === 'string');
    assert.ok(init);
    if (init.method === 'PATCH') {
      assert.ok(typeof init.body === 'string');
      const body = JSON.parse(init.body);
      patches.push({ url, body });
      if (options.reject)
        return Response.json({ success: false }, { status: 403 });
      triggers = triggers.map((item) =>
        item.trigger_uuid === 'preview-trigger' ? { ...item, ...body } : item,
      );
      if (options.changeProduction)
        triggers[0].deploy_command = 'unexpected change';
      return Response.json({ success: true, result: triggers[1] });
    }
    return Response.json({
      success: true,
      result: url.endsWith('/workers/scripts')
        ? [{ id: 'bamboo-old-house', tag: 'worker-tag' }]
        : triggers,
    });
  };
  return { request, patches };
}

await test('preview filter dry run never writes, and apply patches only the preview trigger rules', async () => {
  const api = cloudflare();
  const token = 'test-token';
  assert.equal(
    (await configurePreviewBranch({ token, request: api.request })).applied,
    false,
  );
  assert.equal(api.patches.length, 0);
  const result = await configurePreviewBranch({
    token,
    apply: true,
    request: api.request,
  });
  assert.equal(result.applied, true);
  assert.deepEqual(api.patches, [
    {
      url: 'https://api.cloudflare.com/client/v4/accounts/59189ac1604f92c5cd02c2c0398a8190/builds/triggers/preview-trigger',
      body: { branch_includes: ['preview/*'], branch_excludes: ['main'] },
    },
  ]);
  await configurePreviewBranch({ token, apply: true, request: api.request });
  assert.equal(
    api.patches.length,
    1,
    'reapplying an existing rule must not write',
  );
});

await test('preview filter upgrades the previous fixed-branch rule without changing production', async () => {
  const api = cloudflare([
    production,
    { ...preview, branch_includes: ['preview'] },
  ]);
  const result = await configurePreviewBranch({
    token: 'test-token',
    apply: true,
    request: api.request,
  });
  assert.equal(result.applied, true);
  assert.deepEqual(result.before.branch_includes, ['preview']);
  assert.deepEqual(result.after.branch_includes, ['preview/*']);
  assert.equal(api.patches.length, 1);
});

await test('preview filter refuses missing credentials or unexpected trigger layouts before mutation', async () => {
  const api = cloudflare([production]);
  await assert.rejects(
    configurePreviewBranch({ token: '', request: api.request }),
    /CLOUDFLARE_API_TOKEN/,
  );
  await assert.rejects(
    configurePreviewBranch({
      token: 'test-token',
      apply: true,
      request: api.request,
    }),
    /不一致/,
  );
  assert.equal(api.patches.length, 0);
});

await test('preview filter reports API failure and production changes instead of claiming success', async () => {
  for (const options of [{ reject: true }, { changeProduction: true }]) {
    const api = cloudflare([production, preview], options);
    await assert.rejects(
      configurePreviewBranch({
        token: 'test-token',
        apply: true,
        request: api.request,
      }),
      /HTTP 403|回读与预期不一致/,
    );
  }
});
