# chore: 创建 Cloudflare 预览分支

| 字段 | 内容 |
| --- | --- |
| 本地编号 | LOCAL-004 |
| 状态 | 实现已提交；待真实预览构建与验收 |
| GitHub issue | [#6：创建 Cloudflare 预览分支](https://github.com/yuukiLike/bamboo-old-house/issues/6) |
| 开发分支 | `chore/preview-release` |

## 当前范围

为 `chore/preview-release` 建立可访问的 Cloudflare 预览，验证非 `main` 分支推送后能够自动构建并生成预览地址，同时保持正式站版本不变。

根据维护者最新决定，GitHub issue #6 仅跟踪预览分支创建。正式发布与回退的操作文档保留为参考，不作为本 issue 的关闭条件。

## 已确认的配置

- Cloudflare Worker 为 `bamboo-old-house`，连接仓库 `yuukiLike/bamboo-old-house`。
- 生产分支为 `main`，维护者已开启“非生产分支构建”。
- 构建命令为 `pnpm run build`。
- 中文界面的“部署命令”和“版本命令”均为 `npx wrangler versions upload --config wrangler.static.jsonc`。
- 维护者提供的上一生产版本短 ID 为 `03f1fb5a`；它不是 Git SHA，完整 version UUID 尚待从平台记录。

## 验收与状态

[GitHub issue #6](https://github.com/yuukiLike/bamboo-old-house/issues/6) 是验收进度和关闭状态的唯一跟踪入口。需要记录实际预览 URL、Git 提交与 Cloudflare 版本，验证页面、3D 资源、声音、预览 noindex，以及正式版本保持不变。

当前原生构建命令可以生成预览，无需先接入额外的发布脚本。Git 提交与预览版本的关联先通过 Cloudflare Builds 记录核对。
