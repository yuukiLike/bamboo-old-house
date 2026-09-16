# chore: 创建 Cloudflare 预览分支

| 字段 | 内容 |
| --- | --- |
| 本地编号 | LOCAL-004 |
| 状态 | 首次预览已验证；待维护者应用仅 preview/* 自动构建的分支规则 |
| GitHub issue | [#6：创建 Cloudflare 预览分支](https://github.com/yuukiLike/bamboo-old-house/issues/6) |
| 预览分支命名 | `preview/*`；集成分支为 `preview/integration`（原 `preview`） |

## 当前范围

允许所有以 `preview/` 开头的分支自动构建非生产预览，例如 `preview/photo-mode`、`preview/i18n`。其他功能分支、文档分支不触发 Cloudflare Builds；`main` 保留现有上传候选版本、人工上线的流程。

根据维护者最新决定，GitHub issue #6 仅跟踪预览分支创建。正式发布与回退的操作文档保留为参考，不作为本 issue 的关闭条件。

## 已确认的配置

- Cloudflare Worker 为 `bamboo-old-house`，连接仓库 `yuukiLike/bamboo-old-house`。
- 生产分支为 `main`，维护者已开启“非生产分支构建”。
- 此复选框默认覆盖所有非生产分支；仅创建名为 `preview` 的 Git 分支不会自动收紧触发范围。
- 构建命令为 `pnpm run build`。
- 中文界面的“部署命令”和“版本命令”均为 `npx wrangler versions upload --config wrangler.static.jsonc`。
- 维护者提供的上一生产版本短 ID 为 `03f1fb5a`；它不是 Git SHA，完整 version UUID 尚待从平台记录。

## 验收与状态

[GitHub issue #6](https://github.com/yuukiLike/bamboo-old-house/issues/6) 是验收进度和关闭状态的唯一跟踪入口。需要记录实际预览 URL、Git 提交与 Cloudflare 版本，验证页面、3D 资源、声音、预览 noindex，以及正式版本保持不变。新增验收：非生产 trigger 仅包含 `preview/*`；后续推送普通分支不产生构建，推送 `preview/` 开头的分支产生对应预览构建。

维护者按[部署文档](../deployment.md#预览分支规则一次性配置)运行一次配置脚本。脚本只修改现有非生产 trigger 的 `branch_includes` / `branch_excludes`，并回读检查 `main` 触发器与其他设置。云端规则尚未执行，不能据此宣称其他分支已经停止构建。

当前原生构建命令可以生成预览，无需先接入额外的发布脚本。Git 提交与预览版本的关联先通过 Cloudflare Builds 记录核对。

原固定 `preview` 分支迁移为 `preview/integration`，避免与 `preview/xxx` 的 Git 引用路径冲突。用户已应用旧单分支规则时，可重新执行同一脚本升级规则。
