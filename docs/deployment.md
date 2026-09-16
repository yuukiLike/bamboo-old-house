# 预览、正式发布与回退

当前使用 Cloudflare Worker `bamboo-old-house`，静态目录为 `dist/client`。Cloudflare 控制台由仓库维护者配置和操作；本次仓库改动不会自动修改控制台设置。

## 日常流程

```text
本地开发 → 功能分支预览 → PR 检查、合并 main
                              ↓
                    main 候选版本预览与验收
                              ↓
                    人工提升同一版本至 100%
                              ↓
                    必要时回退至历史正式版本
```

使用同一个 Worker 的版本预览即可，不需要先购买测试域名或新建 dev/pre Worker。`main` 是正式候选来源；推送 `main` 也只上传版本，不直接切换正式流量。这一点必须通过下面的控制台设置实现。

## 首次配置：先停止自动上线，再接入新命令

### 1. 记录当前正式版本

打开 **Workers & Pages → bamboo-old-house**：

- 在 **Settings → Domains & Routes** 记录正在使用的正式域名和 `workers.dev` 地址。
- 在 **Deployments** 记录当前正式部署 ID、version UUID 和时间。首次上线前的回退目标就是这个明确版本，不是上传列表中的“上一个”。
- 确认 Git 仓库为 `yuukiLike/bamboo-old-house`，production branch 为 `main`。
- 查看是否还有其他平台或 workflow 在发布同一个正式入口。仓库保留的 `netlify.toml` 不能证明 Netlify 仍在使用；不要再接一套自动上线流程。

本次尚未读取和修改控制台的实际路由、分支配置，正式地址与当前 UUID 留待这一步记录。

### 2. 在旧 main 上也能执行的过渡设置

在 **Settings → Build** 中，将 **Deploy command** 和 **Non-production branch deploy command** 都改成下面的命令：

```sh
npx --yes wrangler@4.132.0 versions upload --config wrangler.static.jsonc
```

先保留当前能成功运行的 Build command。过渡命令兼容尚未包含新 package scripts 的 `main`，只上传版本。确认保存成功后再合并实现分支。不要在旧 `main` 上提前改成尚不存在的 `pnpm deploy:preview`。

在 **Branch control** 开启非生产分支构建。选择包含需要预览的功能分支、排除 `docs/*`；如果界面提供自定义规则，可包括 `feat/*`、`fix/*`、`chore/*`、`codex/*`。首次验证需要包括 `chore/preview-release`。

在 **Settings → Domains & Routes** 开启 **Preview URLs**；仓库也通过 `preview_urls: true` 保留此设置。不要切换已有正式域名。

> 仅修改仓库里的 Wrangler 文件不会修改 Workers Builds 的部署命令。若控制台仍是 `wrangler deploy`，推送正式分支仍可能立即上线。

### 3. 实现合并进 main 后，使用最终设置

| 位置 / 字段 | 填写内容 |
| --- | --- |
| Production branch | `main` |
| Root directory | 仓库根目录，界面通常表示为 `/` 或留空 |
| Build command | `pnpm install --frozen-lockfile && pnpm build:release` |
| Deploy command | `pnpm deploy:preview` |
| Non-production branch deploy command | `pnpm deploy:preview` |
| Non-production branch builds | 开启；选择需要预览的功能分支，排除问题集合 `docs/*` |
| Build variable: `NODE_VERSION` | `24` |
| Build variable: `PNPM_VERSION` | `11.14.0` |
| Build variable: `SKIP_DEPENDENCY_INSTALL` | `true`，安装已写进 Build command |

构建变量填写在 **Build variables and secrets**，不是应用运行时的 Variables & Secrets。沿用现有 Workers Builds 连接和构建 token，不需要新增 GitHub Actions secret，也不要把个人 OAuth token 复制进仓库。

可先只构建已经包含这些脚本的 `chore/preview-release` 验证最终命令，再合并 main。此期间旧分支没有新脚本，构建失败应等待合并或更新分支，不要临时改回自动上线命令。

[Cloudflare 的构建配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、[分支规则](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)、[运行时与构建变量](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)。

## 仓库命令与版本来源

| 命令 | 行为 |
| --- | --- |
| `pnpm build` | 普通本地生产构建，允许未提交修改 |
| `pnpm check` | 类型、lint、测试、竹子 LOD 数据一致性检查 |
| `pnpm build:release` | 检查通过后构建；要求 Git 工作区干净，检查单文件 25 MiB 上限，写入 `dist/client/release.json` |
| `pnpm deploy:preview` | 核对提交、分支及产物摘要，再运行 `wrangler versions upload`；输出版本 ID 和预览 URL |

`build:release` 在 Cloudflare 侧重复执行质量检查，因为 Workers Builds 不会等待 GitHub 的 `Checks`。GitHub CI 继续独立运行，并检查构建产物大小。

每个预览访问 `/release.json` 可以看到完整 commit SHA、分支、构建时间、Cloudflare build UUID（本地构建为 `null`）和静态产物的 SHA-256 摘要。版本详情里的 tag 是完整 Git SHA，message 记录分支和 build UUID。version UUID 在上传后由 Cloudflare 分配，记录在平台与验收记录里，不伪造进上传前的 manifest。

版本预览地址形式：

```text
https://<version-prefix>-bamboo-old-house.<你的账户子域>.workers.dev
```

使用 Cloudflare 实际返回的链接，不手工拼猜。性能测量记录固定版本 URL 和完整 UUID。若平台同时提供分支 alias，它会随新构建变化，不作为性能基线的唯一标识。[版本预览与 alias](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)

## 首次预览验收

1. 记下当前正式 version UUID，再触发实现分支构建。
2. 确认构建检查通过、日志实际执行 `versions upload`，记录新 UUID 和固定 preview URL。
3. 访问预览的 `/release.json`，核对 Cloudflare 构建页面的 commit SHA；分支、build UUID 也应一致。
4. 手机和桌面打开预览：首次加载、时段、天气、视角切换正常；主动操作后声音正常。Network 中模型、声音、JS/CSS 没有 404。
5. 检查预览响应有 `X-Robots-Tag: noindex`；正式域名和无版本前缀的正式 `workers.dev` 地址没有新增这条 header。
6. 回到 Deployments，确认正式 version UUID 未改变。将实际结果填入文末记录。

`public/_headers` 只匹配带前缀的 `*-bamboo-old-house.*.workers.dev`，同一产物提升为正式版本后不会对正式主机名设置 noindex。以后改 Worker 名称或增加自定义预览域名时，要相应更新规则。[静态资源响应头](https://developers.cloudflare.com/workers/static-assets/headers/)

预览默认可通过链接访问。`noindex` 仅用于搜索索引，不限制访问；需要私有预览时另行配置 Cloudflare Access。不要为不受信任的 fork 分支开启带部署凭据的构建，也不要未经审查就把外部 PR 代码推到有构建授权的分支。原生 Builds 的 token 仍有部署权限；人工上线是此流程的操作约定，不是账号权限隔离。

## 正式发布：使用已经验收的同一个版本

1. 选择来自 `main` 的候选版本，检查 `/release.json`、版本 tag、GitHub `Checks` 与 Cloudflare build 指向相同 SHA 且检查通过。PR 的提交和最终合并 SHA 可能不同，合并后需要验收 main 的候选版本。
2. 按上述方法验收这个候选版本，记录上一正式 UUID 与此次候选 UUID。
3. 在 **Deployments** 中选择已验收版本的 **Promote deployment / Deploy**，将该版本设为 **100%** 流量，并填写发布原因；核对界面显示的 UUID 后提交。
4. 再访问正式站及 `/release.json`，确认页面、资源、来源 SHA 和索引响应头；补充发布记录。

不要在发布时重新 build/upload。等价 CLI 如下，只有维护者明确要切换正式流量时才运行：

```sh
pnpm exec wrangler versions deploy '<已验收的版本UUID>@100%' \
  --config wrangler.static.jsonc --message '发布原因'
```

按序完成一次发布或回退，再开始下一次，避免两个操作互相覆盖。[版本提升](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/)

## 回退：明确选中曾经上线的版本

从部署历史和验收记录选定以前的正式 version UUID，再通过控制台把该版本恢复至 100%。CLI 同样可以用 `versions deploy '<历史正式UUID>@100%'`，填写回退原因。

不用“最近上传版本”推断回退目标，它可能是未经发布的功能预览。当前项目为静态站，同一版本包含页面、JS/CSS、模型与声音。回退后要重新加载并核对正式 `/release.json`；已打开的浏览器页面不会自动刷新。

Cloudflare 允许从最近 **100 个已上传版本**选择可部署版本，功能分支预览也会消耗这个窗口。版本 URL 与 UUID 不是永久归档。保留 Git tag/提交和发布记录；目标版本过旧时，从对应源码重新构建、上传、验收，再发布新 UUID。重新构建不等于恢复同一份二进制产物。[版本与部署](https://developers.cloudflare.com/workers/versions-and-deployments/)、[回退](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

## 验证记录

本次完成仓库实现与本地验证；Cloudflare 配置、上传、正式发布和回退由维护者执行。下面的云端项目尚未验收，不作为已完成记录。

本地已通过类型检查、lint、24 项测试、LOD 校验、生产构建和 Wrangler upload dry run。Wrangler 本地静态服务实际响应验证：带版本前缀的主机名返回 `noindex`，无版本前缀的正式主机名和自定义主机名不返回该 header；未提交源码时准备发布会被拒绝。以上不替代线上验收。

| 项目 | 结果 |
| --- | --- |
| 实际正式地址 | 待维护者填写 |
| 配置前正式 deployment / version UUID | 待维护者填写 |
| 两条 deploy command 与分支规则已保存 | 待验证 |
| 预览 commit SHA / build UUID / version UUID / 固定 URL | 待首次上传后填写 |
| 桌面、手机、模型、声音与无 404 | 待验证 |
| 预览 noindex、正式不受影响 | 待线上验证 |
| 上传前后正式 UUID 不变 | 待验证 |
| 发布：时间、原因、新旧 UUID、验收人 | 尚未执行 |
| 回退：时间、原因、明确目标 UUID、结果 | 尚未执行 |

关联：[LOCAL-004](issues/004-preview-release.md)、[3D 性能基线](issues/003-3d-performance-baseline.md)。
