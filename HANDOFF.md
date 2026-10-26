# dsh-live-proxy 交接文档

> **进度更新（2026-10-27 凌晨）：** 插件已完成、已装进 desktop profile；「设置页看不到字段」的根因已定位——这一版 DSH 不会给第三方 bundle 自动生成表单，必须由插件自己的浏览器半侧占用 `settings.section` / `plugins.row.config`。已补 `lib/client.js`，隔离环境验证通过；桌面端重启一次后可在 **设置 → 代理**（以及 Plugins 行配置）修改。接手请先读 [HANDOFF-NEXT.md](HANDOFF-NEXT.md)，本文作为立项背景与 seam 研究保留。

> 由上一会话（工作区 `default-workspace`）在 2026-10-25 生成。新会话读完这份即可接上，无需回看原对话。

## 0. 一句话

DSH 官方已内置「可切换的进程级代理策略」这个能力，缺的只是**运行期改配置的入口**。`dsh-live-proxy` 就是补这个入口。

## 1. 背景：为什么需要它

上一会话排查的真实故障：

- **症状**：`web_fetch` 抓外网站点报 `Error: web fetch failed: TypeError: fetch failed`；国内站点和 `web_search` 正常。
- **根因**：DSH 的 fetch 走 Node 内置 `fetch`（undici），**不读 macOS 系统代理**，只认环境变量。用户代理软件（YouTuCore，`127.0.0.1:7897`）只开了「系统代理」开关，Node 看不到。
- **临时解法**：往 `~/.dsh/.env` 写 `HTTPS_PROXY` / `HTTP_PROXY`，重启应用后恢复正常（已实测 200）。
- **临时解法的缺口**：`.env` **只在启动时读一次**，改代理必须重启；也没有界面开关、没有按用途分流、代理挂了不会自动回落。

这就是本插件的立项理由。

## 2. 环境事实

| 项 | 值 |
|---|---|
| DSH 版本 | `0.2.1-rc.3` |
| Node | `24.21.0`（随 app 打包） |
| `DSH_HOME` | `~/.dsh` |
| 目标 profile | `desktop`（bundles: `dsh-base`, `dsh-web-app`, `@local/dsh-mcp-bridge`） |
| 本机代理 | `127.0.0.1:7897`（HTTP/HTTPS/SOCKS 同端口，Clash 系） |

## 3. 官方 seam（已从 app.asar 反解确认）

包：`@deepseek-ai/dsh-http-proxy@0.2.1-rc.3`
源码位置（虚拟路径）：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-http-proxy/lib/index.js`

**全部导出只有四个：**

```js
export { clearedProxyEnv, installProxyFromEnvironment, proxyEnvironmentForChild, proxyRouteFor }
```

### 3.1 `installProxyFromEnvironment(env, report) → Promise<disposer>`

**这是运行期切换的唯一入口**（`installGlobalProxy` 未导出）。

- `env`：类 Map 对象，接口是 `env.get(name)` → `{ value: string } | undefined`。
- 读取的变量：`all_proxy` / `http_proxy` / `https_proxy` / `no_proxy`，**小写优先，大写兜底**，空串视为未设置。
- 解析优先级：scheme 自己的变量 > `ALL_PROXY`；`https` 还额外兜底 `http`。
- 只接受 `http:` / `https:`；**`socks5://` 会被拒绝**并产生诊断消息（不抛异常，该 scheme 转直连）。
- `noProxy` 会自动并入 `localhost,127.0.0.1,::1,[::1]`。
- 返回的 disposer 恢复上一个 dispatcher、策略和环境变量。

**结论：插件要实现「改配置立即生效」，就是构造一个新的 env Map 再调一次这个函数，并 dispose 上一次的返回值。**

### 3.2 `proxyRouteFor(url) → { proxied: false } | { proxied: true, proxy, dispatcher }`

`dsh-web-fetch-http` 每次请求都调它，读的是模块级 `active` 策略。

**关键坑**：只 `setGlobalDispatcher()` 的插件修不了 `web_fetch` —— 因为 `web_fetch` 不走这个 dispatcher，走的是 `proxyRouteFor` 的返回值。这也解释了为什么生态里有些「全局代理插件」装了没用。

### 3.3 `proxyEnvironmentForChild()`

给子进程用的环境覆盖，含 `NODE_USE_ENV_PROXY=1`（只有 Node 22.21+/24+ 认）。已处理：用户原始 SOCKS 值保留给 curl/git、拒绝值时不设该 flag 以免 Node 子进程启动即退出。

### 3.4 已知不覆盖的地方

- **worker 线程**：`workflow` 引擎和 ptc-runtime 跑模型写的脚本，被刻意排除（怕代理 URL 里的密码泄漏给模型脚本）。
- 遥测（OTLP）直连。

## 4. 插件设计

### 4.1 命名

- 仓库/包名：`dsh-live-proxy`（已确认 npm 未被占用）。
- 本地开发期先用 `@local/dsh-live-proxy`，与现有 `@local/dsh-mcp-bridge` 保持一致。
- 发布时给 GitHub 仓库加 `dsh-plugin` topic。

### 4.2 目录结构（照抄 `~/Dev/dsh-mcp-bridge` 的约定）

```
dsh-live-proxy/
  package.json          # type: module; dsh.bundle.patch -> ./cordis.patch.yml
  cordis.patch.yml      # 声明插件行与默认配置
  index.js              # 插件入口
  lib/*.js
  README.md
```

`package.json` 关键字段：

```json
{
  "name": "@local/dsh-live-proxy",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

### 4.3 配置项（建议）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `mode` | `direct` \| `manual` \| `system` | `manual` | `system` 在 macOS 上读 `scutil --proxy` |
| `proxyUrl` | string | — | `http://127.0.0.1:7897`，仅 `manual` 用 |
| `noProxy` | string | — | 追加的直连例外，逗号分隔 |
| `fallbackToDirect` | boolean | `true` | 代理探测失败时回落直连 |
| `probeIntervalMs` | number | `15000` | 探测周期，`0` 关闭 |

### 4.4 切换逻辑（骨架）

```js
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'

let dispose = null

function envMap({ proxyUrl, noProxy }) {
  const m = new Map()
  if (proxyUrl) {
    m.set('http_proxy',  { value: proxyUrl })
    m.set('https_proxy', { value: proxyUrl })
  }
  if (noProxy) m.set('no_proxy', { value: noProxy })
  return m
}

export async function apply(cfg) {
  await dispose?.()                    // 先撤旧策略
  dispose = cfg.mode === 'direct'
    ? await installProxyFromEnvironment(new Map(), () => {})
    : await installProxyFromEnvironment(envMap(cfg), (msg) => warn(msg))
}
```

注意 `dispose` 是异步的，切换期间不要并发调用（加个 mutex 或串行队列）。

### 4.5 macOS 系统代理读取

```sh
scutil --proxy
# HTTPEnable : 1 / HTTPProxy : 127.0.0.1 / HTTPPort : 7897
# SOCKSEnable / SOCKSProxy / SOCKSPort …
```

取 `HTTPEnable=1` 时的 `HTTPProxy:HTTPPort` 拼成 `http://host:port`；**不要取 SOCKS**（本包不支持）。

## 5. 验证方法

```sh
# 1) 环境是否注入
env | grep -i proxy

# 2) 真实抓取（改配置后应立即生效，无需重启）
#    在会话里让 agent 执行 web_fetch https://www.google.com

# 3) 直连 vs 代理对照
curl -s -o /dev/null -w "%{http_code}\n" -m 5  https://www.google.com
curl -s -o /dev/null -w "%{http_code}\n" -m 8 -x http://127.0.0.1:7897 https://www.google.com
```

## 6. 踩过的坑

1. **只换 undici dispatcher 修不了 `web_fetch`**，必须走 `installProxyFromEnvironment` / `proxyRouteFor` 这条线。
2. **`socks5://` 会被静默拒绝**（有诊断但用户容易忽略）；必须写 HTTP 端口。
3. **`NO_PROXY` 不支持 CIDR**，只能写主机名/域名后缀；`*` 表示全部直连。
4. **`.env` 只在启动时读**，这是本插件要解决的痛点本身。
5. **worker 不继承代理**（设计如此），别指望 workflow 里的脚本走代理。
6. 安装插件到 desktop profile 后**需要重启应用**；但插件**自己切换代理**不需要重启。

## 7. 如何再读 app.asar 里的源码

Electron 的 asar 支持可以直接用它的 `ELECTRON_RUN_AS_NODE` 读，无需解包工具：

```sh
E="/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"
ELECTRON_RUN_AS_NODE=1 "$E" -e '
const fs=require("fs");
const P="/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-http-proxy";
fs.writeFileSync("/tmp/http-proxy.js", fs.readFileSync(P+"/lib/index.js"));
console.log("ok");
'
```

## 8. 下一步建议

1. 定稿配置 schema（先 `manual` + `direct` 两种模式，`system` 作为第二步）。
2. 写 `index.js`：mount 时读配置 → `apply()`；配置变更时重新 `apply()`。
3. 加连通性探测 + 自动回落（可选，但这是相对 `.env` 的主要增值）。
4. 设置页：`设置 → 插件 → 代理`，配置项声明 `applies: live`。
5. 安装：`dsh plugin --profile desktop add /Users/ahhtou/Dev/dsh-live-proxy`，重启验证。

## 9. 参考

- 官方文档《在网络代理后面运行 DSH》：https://deepseek-harness.github.io/deepseek-harness/guide/network-proxy
- 官方包说明：https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/web.md
- 可对标的社区实现（注意各自的局限）：
  - https://github.com/fengyevvv/dsh-egress-router （分流 + 自动回落，Windows）
  - https://github.com/yanglaofish/dsh-proxy-pro （明确接进 `installProxyFromEnvironment`，Windows）
  - https://github.com/apolenkov/dsh-provider-proxy （按 provider/模型分流，跨平台，有测试）
