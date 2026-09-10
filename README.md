# 竹林里的老屋 · Bamboo Old House

基于 Three.js 的交互式 3D 老屋场景，在竹林、木廊与房间之间漫游，观看日光与夜色变化。使用 pnpm，可部署为静态网站。

## 目录

```text
bamboo-old-house/
├── src/          网页、Three.js 场景、实际使用的组件
├── public/       GLB 模型（贴图内嵌）、备用画面和图标
├── dist/client/  构建后上传的完整网站
└── 根目录配置    pnpm、类型检查、构建与部署配置
```

`node_modules/`、`.next/` 和 `dist/` 由工具生成。类型检查缓存放在 `node_modules/.cache/`。源码保留在 `src/`，说明集中在本文件，不另外生成交付记录或压缩包。

## 运行与部署

环境：Node.js 24、pnpm 11.14.0。版本分别由 `.nvmrc` 和 `package.json` 指定。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

开发地址以终端显示为准，通常为 `http://localhost:3000/`。构建与预览：

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm preview
```

预览地址默认为 `http://localhost:4175/`，以终端输出为准。部署时上传 **`dist/client/` 内的全部内容**，无需压缩。在线构建的安装命令为 `pnpm install --frozen-lockfile`，构建命令为 `pnpm build`，发布目录为 `dist/client`；Netlify 配置已包含这些设置。

网页使用 `/models/` 和 `/_next/` 等根路径，按 `https://你的域名/` 部署。通过 HTTP/HTTPS 访问，不能双击 HTML 文件。线上无需 Blender、数据库或 Node.js 服务。`dist/server/` 是静态导出的构建中间产物，不需要上传。

## 从原项目同步资源

原项目位于同级 `../blender-two/`。先在原项目完成建模并导出网页资源，确认更新已经进入 `../blender-two/website/public/`，然后在本项目执行：

```sh
pnpm sync
```

该命令使用 macOS 自带的 `rsync`，单向复制原项目 `website/public/` 到本项目 `public/`，跳过 `.DS_Store` 与空目录，替换同名文件、补充新资源，再重新构建 `dist/client/`。它不回写原项目，也不自动删除本项目中额外的资源。完成后上传新的 `dist/client/`。如果把目录迁到 Windows，需要安装 rsync 或使用 WSL。

**修改 `.blend` 文件本身不会更新网页。** 必须先导出适合网页的 GLB；完整建模与导出步骤见原项目 [README](../blender-two/README.md)。这里保留实际副本，不依赖符号链接；普通安装、开发和构建不要求原目录存在，只有 `pnpm sync` 需要它。

同步范围需要区分：

| 原项目的更新 | 网页项目的处理 |
| --- | --- |
| 同名 GLB 的几何、内嵌贴图，或已有路径下的图片更新 | 执行 `pnpm sync` |
| 模型改名、增删模型，或修改地形、植物布局、相机、灯光、风和水 | 同时合并 `website/components/scene/` 到 `src/components/scene/` 的对应改动，再同步资源、检查并构建 |
| 页面或交互改动 | 对照 `website/app/`、`website/components/experience.tsx`，合并到 `src/` 中的对应位置 |
| 新代码引入新的依赖或组件 | 只补充实际使用的依赖和文件，再运行类型检查与构建 |

GLB 不包含网页的全部效果，所以 `pnpm sync` 明确只同步资源。代码更新需要按上表合并，避免覆盖网页项目自己的改动，或把未使用的模板组件重新带回来。不要用原项目的 `package.json`、锁文件、构建配置覆盖这里的配置。

## 保留内容与验证

技术栈为 React、TypeScript、Three.js、Tailwind CSS、Vinext/Vite。网页保留廊下望竹、进屋看看、沿路走走、走近看看、环顾与昼夜切换。六个模型位于 `public/models/`，贴图和缓冲数据已内嵌；建筑模型的 Meshopt 解码由现有场景代码完成。

本次精简保留 27 个运行源码文件，移除 55 个未使用 UI 文件、一个未使用的 hook，以及 13 项无用直接依赖。运行源码和公开资源与原项目逐文件比对一致；pnpm 锁定安装、类型检查、lint、静态构建及公开文件 HTTP 检查均通过。没有重新执行浏览器交互或画面对比，也没有上线发布。

维护原则：根目录只放工具要求的配置和本说明；业务源码放入 `src/`；优先复用现有配置与 pnpm 命令，不增加重复记录、压缩包或无实际用途的组件。
