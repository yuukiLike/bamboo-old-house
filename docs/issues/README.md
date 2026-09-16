# 本地 Issues

这里维护当前四项工作。LOCAL-004 已发布为 [GitHub issue #6](https://github.com/yuukiLike/bamboo-old-house/issues/6)，范围收窄为创建预览分支；其余三项保留为本地计划。

`LOCAL-001` 等为本地编号，不是 GitHub issue 编号。已发布项的进度与验收以对应 GitHub issue 为准。

| 本地编号 | Issue | 状态 | 建议执行顺序 | 开始前需要明确的事项 |
| --- | --- | --- | --- | --- |
| LOCAL-001 | [极简截图模式与 PNG 截图按钮](./001-photo-mode.md) | 待开发 | 3 | 截图内容、模式中的交互与动画行为 |
| LOCAL-002 | [中英日切换及各语言独立文案](./002-localized-content.md) | 待开发；文案待用户提供 | 4 | 首次访问语言；收到文案后确定内容位置与排版 |
| LOCAL-003 | [3D 性能基线与优化证据记录流程](./003-3d-performance-baseline.md) | 待开发 | 2 | 固定设备、浏览器与原始证据保存位置 |
| LOCAL-004 | [创建 Cloudflare 预览分支](./004-preview-release.md) | [GitHub #6](https://github.com/yuukiLike/bamboo-old-house/issues/6)，待预览验收 | 1 | 验证预览可用且正式版本 `03f1fb5a` 不变 |

## 执行约定

- 先建立可追溯的预览与发布流程，记录 `v0.1.0` 的性能基线，再推进新功能和优化；测量协议可与部署准备并行，具体优化优先级由测量结果决定。
- 截图与多语言分别用 PR 完成；基线建立与后续优化也分开提交 PR，每次优化尽量验证一个主要假设。
- 每次优化动手前先保存具体过程、证据、假设与计划；完成后补齐实际改动、同条件复测、画面与交互检查，以及保留或回退结论。
- 中文、英文、日语的文案由用户各自独立编写，不要求逐句对应；助手暂不代拟。
- 本地阶段以这些 issue 文件为规格依据，原 [准备计划](../plans/photo-mode-and-localized-content.md) 保留摘要与链接。
- 发布到 GitHub 后，以对应远端 issue 跟踪讨论、范围变更与状态，在本地文件保留链接及必要记录，避免维护两份持续变化的规格。
