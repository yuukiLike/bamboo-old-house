# 预览、正式发布与回退

当前使用 Cloudflare Worker `bamboo-old-house`，静态目录为 `dist/client`。Cloudflare 控制台由仓库维护者配置和操作；本次仓库改动不会自动修改控制台设置。

## 日常流程

```text
功能分支开发 → 需要联调时合并到 preview → 自动生成预览
      ↓
PR 检查、合并 main → 上传正式候选 → 人工验收、上线
```

使用同一个 Worker 的版本预览即可。`main` 是正式候选来源；推送 `main` 也只上传版本，不直接切换正式流量。

**2026-09-16 状态：预览上传和 noindex 已验证；“仅 preview 自动构建”的云端过滤尚待维护者执行。** 下表是应用过滤后的行为，不能把创建 Git 分支当作过滤已经生效。

| 操作 | Cloudflare 自动行为 |
| --- | --- |
| 本地 commit，没有 push | 不触发 |
| push `preview` | 构建并上传预览版本 |
| push `main` | 保留现有流程：构建并上传候选，人工上线 |
| push 其他分支，例如 `feat/*`、`fix/*`、`docs/*`、`chore/*`、`codex/*` | 不触发构建 |

## 仅 preview 分支自动预览：一次性配置

控制台已有“非生产分支构建”复选框，但维护者当前界面没有分支白名单入口。使用官方 Builds API 修改现有非生产 trigger，无需新建 Worker 或接入另一套 CI。不要在构建命令里判断分支后退出：那仍然已经触发了一次构建。

### 1. 创建个人 API Token

打开 [个人 API Tokens](https://dash.cloudflare.com/profile/api-tokens)，选择创建自定义 Token：

- `Account → Workers Builds Configuration → Edit`。
- `Account → Workers Scripts → Read`，用于定位此 Worker。
- Account Resources 只选择当前 `bamboo-old-house` 所在账户。

必须从个人资料页创建 user-scoped Token。不要使用账户级 Token，也无需替换当前构建所用的 Token。API 参考中前一项权限标记为 `Workers CI Write`。[官方权限说明](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/#before-you-start)

### 2. 在项目终端执行

代码已位于 `preview` 分支。在 macOS 默认 zsh 终端，进入项目目录后逐行运行：

```sh
read -rs 'CLOUDFLARE_API_TOKEN?粘贴 Cloudflare API Token，然后按回车：'
export CLOUDFLARE_API_TOKEN
node scripts/configure-preview-branch.mjs --apply
unset CLOUDFLARE_API_TOKEN
```

第一行等待输入，粘贴的 Token 不显示在屏幕上；不要把 Token 填进命令本身、仓库文件或聊天。脚本使用项目账户与 Worker 名，自动查询 trigger UUID，并只保存以下规则：

```json
{
  "branch_includes": ["preview"],
  "branch_excludes": ["main"]
}
```

脚本会回读规则，并核对 `main` trigger 与其他设置。看到 **“已回读确认：非生产自动构建仅匹配 preview；main 触发器保持原样。”** 才表示配置成功。遇到错误时保留错误信息核查，不能当作已完成。去掉 `--apply` 可以只查看拟修改的规则。

这是一次性设置，后续推送无需重复运行。之后若通过控制台重建或调整 Git 构建连接，再用脚本检查规则。此规则控制后续 Git 自动触发；历史构建、已有排队任务、人工重试不会因此被删除或禁止。[分支过滤 API](https://developers.cloudflare.com/api/resources/workers_builds/subresources/triggers/methods/update/)

### 3. 验证与日常使用

1. 后续向普通功能分支推送提交，确认 Cloudflare Builds 没有为该提交新增构建。
2. 需要预览时，将要联调的代码合并进 `preview` 并推送，确认生成新构建和预览地址。
3. 合并进 `preview` 只用于联调。功能完成后，仍从原功能分支向 `main` 提 PR；不要把尚未准备上线的其他功能一起带入 `main`。

```sh
git switch preview
git pull --ff-only origin preview
git merge <需要预览的功能分支>
git push origin preview
```

`preview` 是共享分支，不要强制推送覆盖他人提交。预览 URL 以 Cloudflare 实际构建输出为准。GitHub 检查工作流仍按自己的规则执行，表格只描述 Cloudflare Builds。

## 首次配置：先停止自动上线，再接入新命令

### 1. 记录当前正式版本

打开 **Workers & Pages → bamboo-old-house**：

- 在 **Settings → Domains & Routes** 记录正在使用的正式域名和 `workers.dev` 地址。
- 在 **Deployments** 记录当前正式部署 ID、version UUID 和时间。首次上线前的回退目标就是这个明确版本，不是上传列表中的“上一个”。
- 确认 Git 仓库为 `yuukiLike/bamboo-old-house`，production branch 为 `main`。
- 查看是否还有其他平台或 workflow 在发布同一个正式入口。仓库保留的 `netlify.toml` 不能证明 Netlify 仍在使用；不要再接一套自动上线流程。

维护者已提供控制台截图并确认过渡配置完成；上一次准确生产版本的短 ID 为 `03f1fb5a`。正式地址与完整 version UUID 仍待记录。短 ID 不是 Git SHA，不据此推断对应源码版本。

### 2. 在旧 main 上也能执行的过渡设置

在 **Settings → Build** 中，先将当前可见的 **Deploy command（部署命令）** 改成下面的命令：

```sh
npx wrangler versions upload --config wrangler.static.jsonc
```

先保留当前能成功运行的 Build command。过渡命令兼容尚未包含新 package scripts 的 `main`，只上传版本。确认保存成功后再合并实现分支。不要在旧 `main` 上提前改成尚不存在的 `pnpm deploy:preview`。

随后进入 **Settings → Build → Branch control**，勾选 **Builds for non-production branches** 并保存。非生产分支部署命令仅在开启此功能后适用；未开启时不要假定界面已有两个命令输入框。

回到构建配置的编辑界面，找到 **Non-production branch deploy command**（维护者实际中文界面中的 **“版本命令”**），也填写上面的过渡命令。如果开启后仍未找到该字段，按实际界面核对入口，不要把构建命令误当成第二个部署命令。

复选框默认会覆盖所有非生产分支；开启后按上面的“一次性配置”收紧为 `preview`。初次试运行使用的 `chore/preview-release` 不再作为持续预览分支。

在 **Settings → Domains & Routes** 开启 **Preview URLs**；仓库也通过 `preview_urls: true` 保留此设置。不要切换已有正式域名。

> 仅修改仓库里的 Wrangler 文件不会修改 Workers Builds 的部署命令。若控制台仍是 `wrangler deploy`，推送正式分支仍可能立即上线。

### 3. 可选：以后需要发布清单时再接入仓库脚本

当前 `pnpm run build` 配合两条 `npx wrangler versions upload --config wrangler.static.jsonc` 命令已能提供预览，继续保持即可。以下是以后接入发布清单的可选设置，不是本次分支过滤的前置条件；只有所构建的分支包含这些脚本时才可使用。

| 位置 / 字段 | 填写内容 |
| --- | --- |
| Production branch | `main` |
| Root directory | 仓库根目录，界面通常表示为 `/` 或留空 |
| Build command | `pnpm install --frozen-lockfile && pnpm build:release` |
| Deploy command | `pnpm deploy:preview` |
| Non-production branch deploy command（版本命令） | `pnpm deploy:preview` |
| Non-production branch builds | 开启；通过 Builds API 将非生产 trigger 限定为 `preview` |
| Build variable: `NODE_VERSION` | `24` |
| Build variable: `PNPM_VERSION` | `11.14.0` |
| Build variable: `SKIP_DEPENDENCY_INSTALL` | `true`，安装已写进 Build command |

构建变量填写在 **Build variables and secrets**，不是应用运行时的 Variables & Secrets。沿用现有 Workers Builds 连接和构建 token，不需要新增 GitHub Actions secret，也不要把个人 OAuth token 复制进仓库。

此期间旧分支没有新脚本时，先更新分支，不要临时改回自动上线命令。

[Cloudflare 的构建配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、[分支规则](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)、[运行时与构建变量](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)。

## 仓库命令与版本来源

| 命令 | 行为 |
| --- | --- |
| `pnpm build` | 普通本地生产构建，允许未提交修改 |
| `pnpm check` | 类型、lint、测试、竹子 LOD 数据一致性检查 |
| `pnpm build:release` | 检查通过后构建；要求 Git 工作区干净，检查单文件 25 MiB 上限，写入 `dist/client/release.json` |
| `pnpm deploy:preview` | 核对提交、分支及产物摘要，再运行 `wrangler versions upload`；输出版本 ID 和预览 URL |

`build:release` 在 Cloudflare 侧重复执行质量检查，因为 Workers Builds 不会等待 GitHub 的 `Checks`。GitHub CI 继续独立运行，并检查构建产物大小。

只有使用 `build:release` / `deploy:preview` 时，预览的 `/release.json` 才提供完整 commit SHA、分支、构建时间、Cloudflare build UUID（本地构建为 `null`）和静态产物摘要，版本 tag/message 才记录对应来源。当前原生构建使用 Cloudflare Builds 页面核对 Git 提交与版本；不要求 `/release.json`。version UUID 在上传后由 Cloudflare 分配。

版本预览地址形式：

```text
https://<version-prefix>-bamboo-old-house.<你的账户子域>.workers.dev
```

使用 Cloudflare 实际返回的链接，不手工拼猜。性能测量记录固定版本 URL 和完整 UUID。若平台同时提供分支 alias，它会随新构建变化，不作为性能基线的唯一标识。[版本预览与 alias](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)

## 首次预览验收

1. 记下当前正式 version UUID，再触发 `preview` 分支构建。
2. 确认构建检查通过、日志实际执行 `versions upload`，记录新 UUID 和固定 preview URL。
3. 在 Cloudflare 构建页面核对 commit SHA、分支和 build UUID；以后启用发布清单脚本时，再同时核对 `/release.json`。
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

Cloudflare 操作由维护者执行。2026-09-16，首次 `chore/preview-release` 预览上传成功，随后维护者要求收紧为固定 `preview` 分支；云端过滤尚待执行。最新验收进度以 [GitHub issue #6](https://github.com/yuukiLike/bamboo-old-house/issues/6) 为准。正式发布和回退尚未执行。

本地已通过类型检查、lint、24 项测试、LOD 校验、生产构建和 Wrangler upload dry run。Wrangler 本地静态服务实际响应验证：带版本前缀的主机名返回 `noindex`，无版本前缀的正式主机名和自定义主机名不返回该 header；未提交源码时准备发布会被拒绝。以上不替代线上验收。

| 项目 | 结果 |
| --- | --- |
| 已验证正式 workers.dev 地址 | https://bamboo-old-house.yuuki-lab.workers.dev；自定义域名待记录 |
| 上一次准确生产版本 | 维护者提供短 ID `03f1fb5a`；完整 version UUID 与 deployment ID 待记录 |
| 已保存的构建配置 | 部署命令与版本命令均为 `versions upload --config wrangler.static.jsonc`（通过 npx 运行）；`main` 为生产分支，已开启非生产分支构建；仅 `preview` 的过滤尚待维护者应用 |
| 首次预览 commit / build UUID / version UUID | `14ed6c4` / `145dc449-6bd0-48a0-8f14-73d33c7538f7` / `7273aa70-88c8-49a3-8f14-b929c82b3594` |
| 首次固定预览 URL | https://7273aa70-bamboo-old-house.yuuki-lab.workers.dev |
| 桌面、手机、模型、声音与无 404 | 待验证 |
| 预览 noindex、正式响应头不受影响 | 已验证；维护者也已确认 noindex 检查 |
| 上传前后正式 UUID 不变 | 待验证 |
| 发布：时间、原因、新旧 UUID、验收人 | 尚未执行 |
| 回退：时间、原因、明确目标 UUID、结果 | 尚未执行 |

关联：[LOCAL-004](issues/004-preview-release.md)、[3D 性能基线](issues/003-3d-performance-baseline.md)。
