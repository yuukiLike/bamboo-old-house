# 部署、预览与回退

项目通过 Vinext 静态导出，同一份 `dist/client` 产物可部署到 Cloudflare Pages 或 Workers。

| 配置 | 值 |
| --- | --- |
| 构建命令 | `pnpm run build` |
| 静态输出目录 | `dist/client` |
| 根目录 | 仓库根目录 |
| Node.js 要求 | `>=22.13.0`，与 `package.json` 一致 |
| pnpm | `11.14.0`，构建变量可设 `PNPM_VERSION=11.14.0` |

## 为什么使用 `wrangler.static.jsonc`

Vinext 会检测默认名称的 `wrangler.jsonc`、`wrangler.json` 等文件，将项目识别为 Cloudflare Workers 项目。为避免干扰 `output: 'export'` 的静态导出，提交 `33a9d0a` 专门把 `wrangler.jsonc` 改名为 `wrangler.static.jsonc`。

保留这个文件名，Worker 部署命令显式传入 `--config wrangler.static.jsonc`。其中 `assets.directory` 指向 `./dist/client`，`name` 必须与目标 Worker 名称一致。Pages 直接使用构建输出目录。

## Pages：按 `preview/*` 自动预览

创建 Pages 项目并连接 Git 仓库，框架预设选“无”，填写上面的构建命令与输出目录。在 **设置 → 构建和部署 → 分支控制** 中配置：

| 配置 | 推荐值 |
| --- | --- |
| 生产分支 | `main` |
| 预览分支 | 自定义分支 |
| 包括预览分支 | `preview/*` |
| 排除预览分支 | 留空 |

这组规则只自动构建 `preview/` 开头的预览分支；其他非生产分支跳过。保存后刷新确认配置保留，并用一次预览分支推送和一次普通分支推送验证实际触发情况。[Pages 分支控制](https://developers.cloudflare.com/pages/configuration/branch-build-controls/)

勾选“启用自动生产分支部署”时，推送 `main` 会直接发布到 Pages 生产环境。需要人工控制上线时，关闭该选项，再单独发起生产部署；关闭后不会自动生成 `main` 候选版本。

发布异常时，在 **部署 → 历史生产部署 → 回滚到此部署** 恢复旧版。预览部署不能作为这个回滚操作的目标。[Pages 回滚](https://developers.cloudflare.com/pages/configuration/rollbacks/)

## Workers：上传候选版本，人工发布

### 构建配置

全新 Worker 首次部署使用以下命令；它会创建并上线首个版本：

```sh
pnpm run build
pnpm exec wrangler deploy --config wrangler.static.jsonc
```

已有 Worker 采用下面的日常配置，在 **设置 → 构建** 中保存：

| 配置 | 值 |
| --- | --- |
| 生产分支 | `main` |
| 构建命令 | `pnpm run build` |
| 部署命令 | `npx wrangler versions upload --config wrangler.static.jsonc` |
| 非生产分支部署命令／版本命令（启用时） | `npx wrangler versions upload --config wrangler.static.jsonc` |

`versions upload` 只上传候选版本；只有后续发布操作才切换正式流量。修改仓库文件不会替你修改控制台的部署命令。[Workers 构建配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)

### 非生产分支的限制

Workers 当前公开的“非生产分支构建”开关覆盖所有非生产分支。**不能把 Pages 的 `preview/*` 配置直接套到 Workers。** [Workers 分支控制](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)

2026-09-20，维护者重复验证两次：对同一触发器使用相同 token 和账户，保存 `branch_includes: ["*"]` 成功，仅改为 `["preview/*"]` 则返回 `400 / 12002: Invalid request body`。

以后复测使用[分支过滤验证记录](./cloudflare-workers-branch-filter-verification.txt)，其中保留了五条单行 curl、对照条件与当时的响应。

仓库的 `scripts/configure-preview-branch.mjs` 不作为可用配置步骤；其模拟接口测试不能证明云端支持过滤。`migrate_to_previews` 用于迁移预览机制，不用于设置分支过滤。

如果必须让其他分支完全不启动构建，先关闭原生非生产分支构建，再另行配置带分支过滤的外部 CI。构建启动后判断分支并退出，仍然会产生一次构建。

### 验收、发布与回退

1. 在预览地址验证页面、时段、天气、视角与声音，确认 JS/CSS、模型和声音资源没有 404。预览地址以 Cloudflare 实际输出为准。
2. 合并到 `main` 后，验收该提交对应的候选版本，并记录 Git SHA、候选 version UUID 和当前正式 version UUID。
3. 在 **Deployments** 中选择已验收版本，通过 **Promote deployment / Deploy** 将其设为 100% 流量。发布时沿用已经验收的版本。
4. 异常时恢复已记录的旧正式版本；不要把“最近上传的版本”当作回退目标。

发布和回退均可使用以下命令，UUID 分别填入已验收的新版本或旧正式版本：

```sh
pnpm exec wrangler versions deploy '<目标版本UUID>@100%' \
  --config wrangler.static.jsonc --message '发布或回退原因'
```

只能在平台仍允许部署的历史版本范围内回退，因此应保留源码提交和版本记录。切换后检查正式页面与资源；已经打开的浏览器页面不会自动刷新。[版本发布](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/)

`public/_headers` 的预览 `noindex` 规则包含 Worker 名称 `bamboo-old-house`。更换 Worker 名称时也要更新该规则，并验证正式域名没有被加上 `noindex`。

## 可选的发布清单

普通 `pnpm run build` 不生成 `release.json`。需要追溯提交和产物时，可使用仓库已有脚本：

| 命令 | 行为 |
| --- | --- |
| `pnpm build:release` | 检查并构建，要求工作区干净，检查单文件大小，生成 `dist/client/release.json` |
| `pnpm deploy:preview` | 核对源码与产物摘要，使用 `wrangler.static.jsonc` 上传候选版本 |

只在目标分支包含这些脚本时使用；普通构建以 Cloudflare 的提交信息和版本 ID 核对来源。

## 当前验证状态

截至 2026-09-20，维护者已验证 Pages 生产部署、预览部署及 `preview/*` 分支过滤。Workers 的 `preview/*` 配置仍被上述 API 错误阻塞，已提交 [Workers Builds #15722](https://github.com/cloudflare/workers-sdk/issues/15722) 和 [文档说明 #33549](https://github.com/cloudflare/cloudflare-docs/issues/33549)。
