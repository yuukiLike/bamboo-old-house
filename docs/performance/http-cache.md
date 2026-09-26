# HTTP 缓存：首次访问与同会话复访

缓存结果是性能数据的一部分。短请求不等于缓存命中，配置了 `max-age` 也不证明本次命中。报告分别记录实际请求的分类、证据来源、可见字节和本轮访问条件。

## 本地可以测什么

工具运行的位置与被测页面的位置是两回事：

- `--url http://127.0.0.1:4175/` 观测本地预览服务的缓存行为；它使用本机网络，响应策略可能与线上不同。
- `--url https://yuuki.fans/` 在本机 Chrome Canary 中观测线上页面的真实响应，无需登录或查询 Cloudflare 后台。
- 页面内诊断面板只使用浏览器提供的 Resource Timing；外部采集器可以从同一次请求的 CDP 事件补充缓存标记、响应头与真实的 304。

采集器监听页面本来就会发出的请求，不额外发送 `fetch` / `HEAD` 来探测缓存，不改写 `fetch`，不强制禁用缓存。安全响应头白名单可能包含 `CF-Cache-Status` 与 `Age`，它们只作为原始响应证据保留；当前缓存指标聚焦浏览器。浏览器本地缓存里的旧 CDN 响应头不能解释成本次又访问了 CDN。

## 可重复的采集命令

先按[工具说明](../../scripts/perf/README.md)配置 `PERF_CHROME` 与 `PERF_DRIVER`，再运行：

```sh
# 本地工具观测线上页面；无需将诊断代码部署到线上即可记录浏览器网络证据
pnpm perf --url https://yuuki.fans/ --flow cache --profile desktop \
  --mode baseline --iterations 3 --observe-ms 5000 --instrumentation off \
  --out outputs/performance/online-cache-before

# 本地预览使用同一流水线；它测到的是预览服务自身的缓存策略
pnpm perf --url http://127.0.0.1:4175/ --flow cache --profile desktop \
  --mode baseline --iterations 3 --observe-ms 5000 \
  --out outputs/performance/local-cache-before
```

每轮启动新的 ChromeDriver 会话与默认临时 profile，然后在**同一会话**中执行：

1. `initial-3d`：首次导航，等待页面适配器定义的就绪条件，再观察固定时间。
2. `cache-revisit`：正常再次导航到相同 URL，保留浏览器缓存，重新创建页面文档和场景。

这条流程不使用硬刷新、不绕过缓存、不预热目标 URL。复访可能得到本地复用、304 或完整下载，按服务器策略与浏览器实际结果记录。每轮的操作系统、服务端与 CDN 缓存不保证冷态；“新浏览器会话”不能叫“全链路完全冷启动”。同页切换场景复用内存中的模型和音频属于另一类操作，继续用 `views` / `journey` / `system` 观测。

## 分类与证据

| 分类 | 外部采集证据 | 仅页面内 Resource Timing 时 |
| --- | --- | --- |
| 本地复用 | CDP 明确标记 cache-served、disk cache 或 prefetch cache | `transferSize = 0` 且响应体大小为正，推断本地复用；不能区分内存、磁盘或证明具体强缓存策略 |
| 协商复用 | 网络层真实 `304`，并有浏览器合并成功响应或已有响应体的证据 | `transferSize = 300` 且 `encodedBodySize > 0` 时按规范推断，标明“推断” |
| 网络传输 | CDP 明确的非 304 网络响应 | `transferSize = encodedBodySize + 300` 且大于 300 时推断有响应体传输 |
| Service Worker | CDP 标记或 `workerStart > 0` | 单独列出，不能推断其内部 HTTP 缓存 |
| 未知 | 未匹配、证据不足或边界不确定 | 字段缺失、跨域时序受限或全零不会算作命中 |

CDP 的 `responseReceived` 可能把重新验证后的响应呈现为 `200`，因此真实网络状态单列为 `wireStatus`，只取 `responseReceivedExtraInfo`；未收到该事件就保持 `null`。只有状态码 200 不能证明下载了完整响应体。

`Cache-Control`、`ETag`、`Last-Modified` 与请求验证器保留在逐资源证据中。它们解释策略和条件请求；实际命中仍依据本次缓存/传输事件。网络传输可以来自边缘服务器，不能据此断言请求到了源站。

## 汇总口径与数据格式

- **本地复用率**：本地复用数 / 可判定 HTTP 资源数。
- **含协商复用比例**：（本地复用数 + 协商复用数）/ 可判定 HTTP 资源数。
- **可判定 HTTP 资源数**：本地复用 + 协商复用 + 网络传输；未知与 Service Worker 不参与比例分母。
- **分类覆盖率**：已分类条目 / 已保存资源条目。它不是整个页面所有请求的完整采集率；无资源时为 N/A。
- **可见传输体积**：已知 `transferSize` 之和，并显示已知条目数。Resource Timing 的响应头开销使用固定 300 B 估算，不是实际线上数据包大小；时序权限导致的全零不能当作已知 0 B。

统计单位是资源请求记录，多轮相加不按 URL 去重；主 HTML 文档单列，避免与资源总数混合。各轮、各场景保留独立汇总，复访不会混入首次访问。没有新资源请求的场景不会显示 100% 命中。

原始场景 JSON 中，`resources[].cache` 与 `navigation[].cache` 保存分类，`resources[].network` / `navigation[].network` 保存匹配的 CDP 证据，`resourceCache` 保存资源汇总。`networkCapture` 记录采集可用性、匹配数量、缺失和截断。`summary.json`、`report.md`、HTML 与面板导出保留同一套分类规则。

`manifest.config.networkCache` 记录采集方式、会话/导航策略及网络采集和分类脚本的哈希。新增网络观测有开销，新旧采集器不能混算优化收益；两份历史采集都缺少该配置时保留旧比较，同时提示缓存证据局限。

CDP 最多保留 5,000 个请求、每个请求 ID 最多 20 个附加事件、单个白名单头最多 4,096 字符；不保存 Cookie、Authorization 或全量响应头。资源按 URL 与导航相对开始时间唯一匹配，75 ms 容差内有歧义或重定向链则留空。旧数据仍可按 Resource Timing 分类，缺失的响应头与真实 304 不会被补造。

规范依据：[W3C Resource Timing](https://www.w3.org/TR/resource-timing/#dom-performanceresourcetiming-transfersize)、[Chrome DevTools Network](https://chromedevtools.github.io/devtools-protocol/tot/Network/#event-responseReceivedExtraInfo)。

## 2026-09-21 实测记录

使用 Canary 156.0.8066.0，由本机运行采集器；单轮首访 / 复访、就绪后观察 1 秒，用于核实缓存功能，不作为稳定性能收益基线。线上采集没有业务埋点，也没有查询 Cloudflare 后台或修改缓存配置。

| 页面与访问 | 已记录资源 | 本地复用 | 协商复用 | 网络传输 | 未知分类 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 本地产品首访 | 17 | 0 | 0 | 17 | 0 |
| 本地产品复访 | 16 | 0 | 16 | 0 | 0 |
| `https://yuuki.fans/` 首访 | 19 | 0 | 0 | 19 | 0 |
| `https://yuuki.fans/` 复访 | 18 | 10 | 6 | 2 | 0 |

线上复访中，JS / CSS / 封面等资源带有 `public, max-age=14400, must-revalidate`，观测到浏览器本地缓存复用；6 个 GLB 带有 `public, max-age=0, must-revalidate`，全部观测到网络层 304。`architecture.glb` 首次传输体大小约 25.46 MB，这次请求约 14.10 秒；复访约 322 ms、wire304。耗时受当时网络等条件影响，这不是优化前后对照。

线上首访的 19 条资源均能分类，但只有 18 条有可见字节；复访 18 条中有 17 条。跨域 beacon 的 Resource Timing 字节为零，CDP 可确认其传输 / 缓存状态，但字节在汇总中保持未知。不能把“分类覆盖 100%”理解成“所有字节都可测”。

另用仅在 `outputs/` 中的临时 HTTP 页面实际提供 `no-store`、`max-age=3600`、`no-cache + ETag` 三种资源，复访分别得到网络 200、本地缓存和 wire304。此协议验证页的数据没有混入产品报告；没有新增仓库测试用例。还验证了页面面板的缓存汇总、资源标签和实际下载的 JSON 导出。

本地产物：`outputs/performance/canary-cache-online/`、`canary-cache-local/`、`canary-cache-protocol/`、`canary-cache-panel/`。原有 desktop baseline / recheck 已用新展示重生成，原始采集保留；旧数据缺少的网络层响应头没有补造。

类型检查、lint、现有 24 项测试和生产构建通过；Canary 中核对了报告筛选、首访 / 复访逐轮表与逐资源标签。新版面板所用本地构建归档在 `outputs/performance/build-v5-http-cache/`，`assets.json` 的 SHA-256 为 `cc865795d38fc715fd701377ba25e0f0a19187ce14ea498edfd53017c64ef94e`；线上采集针对当时已部署版本，不将本地构建认作线上产物。
