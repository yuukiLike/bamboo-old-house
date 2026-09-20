# chore: 创建 Cloudflare 预览分支

| 字段 | 内容 |
| --- | --- |
| 本地编号 | LOCAL-004 |
| 状态 | Pages 已验证 `preview/*`；Workers 分支过滤失败，已提交上游 issue |
| GitHub issue | [#6：创建 Cloudflare 预览分支](https://github.com/yuukiLike/bamboo-old-house/issues/6) |
| 预览分支命名 | `preview/*`；集成分支为 `preview/integration`（原 `preview`） |

## 当前范围

目标是让 `preview/` 开头的分支自动构建预览，其他非生产分支跳过。维护者已在 Cloudflare Pages 验证这一行为；Workers 的同类配置仍被 API 错误阻塞。

根据维护者最新决定，GitHub issue #6 仅跟踪预览分支创建。正式发布与回退的操作文档保留为参考，不作为本 issue 的关闭条件。

## 构建与部署

- 构建命令为 `pnpm run build`，静态输出目录为 `dist/client`。
- Worker 部署使用 `wrangler.static.jsonc`；上传候选版本的命令为 `npx wrangler versions upload --config wrangler.static.jsonc`。
- Pages 与 Workers 的 `main` 部署行为分别按[部署说明](../deployment.md)配置；Pages 开启自动生产部署时，推送 `main` 会直接发布。

## 验证结果（2026-09-20）

- Pages：生产与预览部署、`preview/*` 分支过滤均已由维护者验证。
- Workers：维护者完整复测两遍。相同 token、账户和触发器 UUID 下，保存 `branch_includes: ["*"]` 成功；仅改为 `["preview/*"]` 返回 `400 / 12002: Invalid request body`。
- 上游跟踪：[Workers Builds #15722](https://github.com/cloudflare/workers-sdk/issues/15722)、[文档说明 #33549](https://github.com/cloudflare/cloudflare-docs/issues/33549)。

复测使用[五条单行 curl 验证记录](../cloudflare-workers-branch-filter-verification.txt)。

## 历史与后续验收

[GitHub issue #6](https://github.com/yuukiLike/bamboo-old-house/issues/6) 保留首次 Worker 预览、资源、交互和 noindex 的验收记录。旧生产版本短 ID `03f1fb5a` 是当时的记录，不能用于推断新建项目的生产版本。

Workers 过滤修复后，先确认配置回读成功，再推送预览分支与普通分支验证实际触发行为，并记录预览 URL、Git 提交与平台版本。

原固定 `preview` 分支已迁移为 `preview/integration`，避免与 `preview/xxx` 的 Git 引用路径冲突。
