# dsh-live-proxy 交接文档（2026-10-26 晚）

> 给下一个会话：读完这一份就能接手，不需要回看之前的对话。
> 原始立项背景、seam 逆向结论、踩坑记录仍在仓库的 [HANDOFF.md](HANDOFF.md) 里（本文不重复，但下面的「代码地图」覆盖了现状）。

## 0. 一句话状态

插件**写完、测完、已装进 desktop profile，并已证明能在真实 loader 里加载和生效**；唯一没解决的是——**设置界面上看不到它的配置字段**。下一步只需要定位：是「看错页面」，还是「这个版本不会给非官方插件自动生成表单」。

## 1. 已完成，不要重做

### 1.1 仓库

| 项 | 值 |
|---|---|
| 本地路径 | `/Users/ahhtou/Dev/dsh-live-proxy` |
| 远端 | `git@github.com:ahhTou/dsh-live-proxy.git`（`main`） |
| 当前提交 | `dca14a7 feat: scaffold the dsh-live-proxy Host plugin` |
| 包名 | `@local/dsh-live-proxy`（发布时改 `dsh-live-proxy`） |
| 单测 | `node --test test/*.test.js` → 42 通过、1 跳过 |

跳过的那个是 `test/plugin.test.js`：它 `import('../index.js')` 需要 `@deepseek-ai/schemastery`，只有 DSH 安装里有，本地 checkout 解析不到，属预期。

### 1.2 代码地图

| 文件 | 职责 |
|---|---|
| `index.js` | Cordis 插件面：`name`、6 个 `.volatile()` 字段的 `Config`、`apply()`（mount 时 sync + 监听 `loader/volatile-update` + `ctx.effect` 清理） |
| `lib/config.js` | 配置校验/默认值；`readConfig()` 用 `Symbol.for('cosmokit.volatile.write')` 解引用；`socks5://` 给出可执行报错；裸 `host:port` 补 `http://` |
| `lib/policy.js` | `effectivePolicy()`（direct / no-url / unreachable 三种直连原因）、`environmentFor()` 生成 installer 需要的 env Map、`policyKey()`、`describePolicy()` |
| `lib/controller.js` | **串行化**的 install/dispose 链（官方 installer 的 disposer 是异步的，不能并发）；相同策略跳过；懒加载 seam（测试可注入） |
| `lib/probe.js` | 对代理 host:port 做 TCP connect（不发外部请求），只在可达性翻转时回调；定时器 `unref()` |
| `lib/session.js` | 配置快照 + 探测 + 控制器：mount / 设置改动 / 探测翻转都走同一条 reconcile |
| `cordis.patch.yml` | bundle 默认配置：`mode: manual`、`proxyUrl: http://127.0.0.1:7897`、原有直连例外、`probeIntervalMs: 15000` |
| `README.md` / `AGENTS.md` | 使用说明 / 提交必须带 `Agent:` `Model:` trailer |

### 1.3 安装状态（已生效）

`~/.dsh/profiles/desktop/package.json`：

```json
"dsh": { "profile": { "bundles": [
  "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",
  "@local/dsh-mcp-bridge", "@local/dsh-live-proxy" ] } },
"dependencies": {
  "@local/dsh-live-proxy": "link:/Users/ahhtou/Dev/dsh-live-proxy",
  ...
}
```

安装命令（会同时写依赖和 bundles，`dsh plugin` 自动处理）：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add "link:/Users/ahhtou/Dev/dsh-live-proxy"
```

原清单/锁文件备份在 `/tmp/dsh-profile-backup/`。pnpm 报的两个 peer 解析不到是**预期**的，不要「修」（见 §6）。

### 1.4 已验证的证据

| 验证 | 方法 | 结果 |
|---|---|---|
| 单元测试 | `node --test test/*.test.js` | 42 pass / 1 skip |
| 真 seam（脱离 app） | 用 app 自带 Node + asar 里的包跑插件 | mount → `proxyRouteFor(google)` = proxied；改 volatile 引用 → direct；改回 → proxied；卸载 → direct；child env 带合并后的 loopback 例外 |
| 探测回落 | 指向死端口 + 真 TCP 探测 | 200ms 内切直连并 warn；端口恢复后自动切回 |
| 真实 loader 挂载 | 隔离 `DSH_HOME=/tmp/dsh-verify` 装同一包、`dsh --profile web` 启动、overlay 把 `proxyUrl` 指到 `127.0.0.1:8799`、`probeIntervalMs: 500`，另起 python 监听 8799 | 6 秒窗口内 13 次连接、间隔精确 0.5s → 导入 + schema + apply + 探测循环全部正常 |
| 桌面重启后 | app 20:30:51 重启，`web_fetch https://www.google.com` | HTTP 200（注意：这条**不能**证明是本插件在生效，`.env` 里的 `HTTPS_PROXY` 同样会走 7897） |

## 2. 唯一未决问题：设置页看不到字段

用户原话：**「有 dsh-live-proxy ，但是看不到字段」**——没有说明是在哪一页看的。

### 2.1 已排除

- **schema 本身没问题**：冒烟测试里读到了 `plugin.Config.dict`，6 个字段的 `meta.volatile` 都是 `true`；
- **volatile 判定没问题**：`volatileForm()` 对「根不可变、子字段可变」的 object schema 会返回这 6 个字段；
- **loader 导入/激活没问题**：§1.4 的隔离启动已证明。

### 2.2 相关机制（源码位置都在 app.asar 内）

- 表单来源：`dsh-settings/lib/index.js` → `SettingsForms.describe()`（约 416 行）。进入表单的硬条件：

  ```js
  const schema = this.schema(entry);                 // entry.fiber?.runtime?.Config 且带 toJSON
  if (schema === void 0 || entry.fiber === void 0
      || entry.fiber.runtime === null || entry.fiber.state !== 2) return [];  // state 2 = 已激活
  const form = volatileForm(schema);                 // 没有 volatile 字段就没有表单
  ```

  描述符里的 `applies: "live"` 是 settings 服务自己加的，插件不需要声明。

- 渲染位置：`dsh-client-ui-plugin-manager/lib/client.js`
  - 约 1032 行：`configurations: this.ctx.configForms.describe()`
  - 约 3833 行：`formFor(id)` 用 `configurations.some(view => view.ns === id)` 匹配
  - 约 4143 行：行详情页 `RowDetail` 传的是 `formFor(openRow.rowId)`
  - **即：表单挂在「bundle 详情 → 某一行 → 行详情页」，按 `ns === rowId` 匹配**（`ns` 就是 profile entry id，即 `dsh-live-proxy`）。

- `Settings → Built-in plugins` 是**只读清单**（`dsh-client-ui-settings-plugins` README 明写：「Settings keeps the read-only inventory」），第三方 bundle 的配置在**侧边栏 Plugins 页**。

### 2.3 两个候选原因（下一步就是区分它们）

| # | 假设 | 如何确认 |
|---|---|---|
| A | **看错页面**：用户看的是 Settings → 内置插件（只读），或者只停在 bundle 详情页、没点开里面的行 | 让用户按 §3 的路径再走一遍 |
| B | **插件在 desktop profile 里没激活**（`fiber.state !== 2`），所以 `describe()` 直接跳过它 | 见 §4 的三种判定手段 |
| C | 表单匹配键不一致：`row.rowId` 不等于 entry id `dsh-live-proxy` | 行详情页会把 `rowId` 以 `<code>` 显示出来，看它显示什么 |

## 3. 让用户先按这个路径看

1. 侧边栏 **Plugins**（不是 Settings）；
2. **Installed plugins** → 点开 `@local/dsh-live-proxy` 卡片；
3. 卡片详情里应该列出一行 **`dsh-live-proxy`**（行标题下面会以 `<code>` 显示 `rowId` 和 `moduleName`）；
4. **点这一行**进入行详情页 → 那里才应该有 6 个字段。

如果第 3 步那一行不存在，或第 4 步页面是空的，记录：行标题/`rowId`/`moduleName` 显示成什么、卡片或行上有没有 error/warning 标记。

## 4. 如果确认有行但没字段：判定是否激活

按代价从低到高：

### 4.1 对照实验（最推荐，5 分钟）

`@local/dsh-mcp-bridge` 是同一作者、同样 `link:`、同一 profile、**已知可用**的 Host 插件，只是它没有 `Config`。临时给它加一个只有 1 个 volatile 字段的 `Config`：

```js
// ~/Dev/dsh-mcp-bridge/index.js 顶部
import z from '@deepseek-ai/schemastery';
export const Config = z.object({ debugNote: z.string().default('').volatile() });
```

同时在它的 `package.json` 加 peer `@deepseek-ai/schemastery`，重启 app。

- 如果 mcp-bridge 的字段**出现了** → 机制对 linked 插件有效，问题在我们这边（回到 §2.2 逐条对）；
- 如果 mcp-bridge **也没字段** → 这个 DSH 版本不会给非官方插件自动生成表单，走 §4.4。
- 测完记得把 mcp-bridge 的改动撤掉（那是另一个在用的仓库）。

### 4.2 让插件自己报活

给 `apply()` 加一行「挂载即写文件」（或直接 `ctx.logger.error`，error 级别更可能被某个界面显示）：

```js
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
mkdirSync(`${homedir()}/.dsh`, { recursive: true });
writeFileSync(`${homedir()}/.dsh/live-proxy-status.json`,
  JSON.stringify({ mountedAt: new Date().toISOString(), config: readConfig(config) }, null, 2));
```

重启一次后读这个文件。**这是目前唯一能稳定证明 desktop 进程里插件已 mount 的手段**（日志不可读，见 §6）。确认后这段诊断代码可以删，或者保留成一个 status 文件（类似 mcp-bridge 的 `mcp-bridge-endpoint.json`，排障有用）。

### 4.3 隔离环境复现桌面配置

把 desktop profile 复制到临时 home 里跑（注意 desktop profile 不能直接被 CLI 启动，但复制出来改名可以）：

```sh
export DSH_HOME=/tmp/dsh-verify2
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
mkdir -p "$DSH_HOME/profiles"
cp -a ~/.dsh/profiles/desktop "$DSH_HOME/profiles/probe"
"$DSH" --profile probe --dump-config | grep -A10 dsh-live-proxy   # 看组合是否有这一行
```

`--dump-config` 能告诉你 bundle patch 有没有真的展开成 entry；入口存在但不激活才会是 §2.3-B。

### 4.4 如果结论是「这个版本不自动给第三方插件生成表单」

那就按原 HANDOFF 第 4 步走**自带客户端设置页**：在 `package.json` 声明 `dsh.client`（参考 `dsh-client-ui-plugin-manager`、社区插件 `dsh-whale-widget` 的包结构），Host 侧在 `apply` 里 `ctx.inject(['settings'], (child) => child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)))` 关掉自动表单，客户端注册一个小的配置页。这一步工作量明显更大，做之前先确认 §4.1 的结论。

## 5. 环境备忘（新会话直接用）

### 5.1 事实

| 项 | 值 |
|---|---|
| DSH | `0.2.1-rc.3`（asar 在 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/`） |
| CLI | `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh` |
| Node | 系统 `v22.23.2`；app 内 `24.21.0` |
| 桌面 profile | `~/.dsh/profiles/desktop`（**只能由 Electron app 启动**） |
| 代理 | `127.0.0.1:7897`（YouTuCore） |
| 备份 | `/tmp/dsh-profile-backup/{package.json,pnpm-lock.yaml}` |

### 5.2 命令坑

- `dsh --profile desktop --dump-config` → `error: profile "desktop" is managed exclusively by the Electron application`。**没有**绕过办法，只能复制 profile 到临时 home。
- `dsh web --help` 会**真的启动** web app（`--help` 被当成 app 参数）。要停就 kill。
- 启动 web 实例时加 `--no-open`，否则会在浏览器开一个标签页。
- `ps` 被沙箱挡住（`Operation not permitted`）；`lsof`、`pgrep`、`curl` 正常。
- 应用 stdout/stderr 是 unix socket，没有日志文件；`log show` 也抓不到插件日志。**所以 §4.2 的状态文件是最可靠的探针。**

### 5.3 沙箱

- 文件策略 `workspace-write`：写 `~/.dsh` 需要 `sandbox_permissions: "danger-full-access"` + 说明理由（会弹审批）。
- 写 `/tmp` 正常。

### 5.4 隔离验证配方（已跑通）

```sh
export DSH_HOME=/tmp/dsh-verify
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
mkdir -p "$DSH_HOME"
"$DSH" plugin --profile web add "link:/Users/ahhtou/Dev/dsh-live-proxy"

cat > /tmp/live-proxy-verify.yml <<'EOF'
- id: dsh-live-proxy
  config:
    mode: manual
    proxyUrl: http://127.0.0.1:8799
    fallbackToDirect: true
    probeIntervalMs: 500
    probeTimeoutMs: 300
EOF

"$DSH" --profile web --patch /tmp/live-proxy-verify.yml --no-open   # 后台起
# 另一个终端：python3 监听 8799 数连接，间隔 ≈ probeIntervalMs 就说明插件挂载并在探测
```

## 6. 已知坑（别踩第二遍）

1. **不要为了测试把 `mode` 改成 `direct`**：模型请求也走同一条策略，可能直接断掉当前会话；而且设置会持久化进 profile patch，重启后还是 direct，用户会卡住。要验证热切换，用 `noProxy` 加一个只影响测试域名的条目（如 `www.google.com`）。
2. **peer 警告不是错误**：loader 按 peer 名把 `@deepseek-ai/*` 裸导入路由到运行中安装副本（`dsh-app-boot` 的 `routeLinked` / installation scope）。删掉 peer 反而会让插件导入失败。
3. **官方 installer 的 disposer 是异步的**：必须先 `await` 旧 disposer 再装新的，否则 dispatcher 泄漏；`lib/controller.js` 已经串行化，改代码时别绕过它。
4. **只改 `setGlobalDispatcher()` 修不了 `web_fetch`**：`web_fetch` 每次请求读 `proxyRouteFor()`，必须走 `installProxyFromEnvironment`。
5. **worker 和遥测不走代理**（官方设计），别去「修」。
6. `.env` 里的代理变量在插件生效期间会被插件策略覆盖；插件停用/卸载后会回到 `.env` 的策略。

## 7. 文件/源码速查

插件仓库外、需要重新读 app.asar 时的提取方法（原 HANDOFF §7 有完整版）：

```sh
E="/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"
ELECTRON_RUN_AS_NODE=1 "$E" -e '
const fs=require("fs"), path=require("path");
const SRC="/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai";
function copy(a,b){const s=fs.statSync(a);if(s.isDirectory()){fs.mkdirSync(b,{recursive:true});for(const n of fs.readdirSync(a))if(n!=="node_modules")copy(path.join(a,n),path.join(b,n))}else if(/\.(js|ts|json|md|yml)$/.test(a)){fs.mkdirSync(path.dirname(b),{recursive:true});fs.writeFileSync(b,fs.readFileSync(a))}}
for(const p of ["dsh-settings","dsh-client-ui-plugin-manager","cordis-plugin-loader","cordis","cosmokit","dsh-app-boot","dsh-config-editor"])copy(path.join(SRC,p),path.join("/tmp/dsh-src",p));
console.log("ok")'
```

关键文件：

- `dsh-settings/lib/index.js`：`SettingsForms.describe()`（~416）、`schema()`（~538）
- `dsh-settings/lib/types/schema.js`：`volatileForm()` / `plainSchema()`
- `dsh-client-ui-plugin-manager/lib/client.js`：~1032 `configurations`、~3833 `formFor`、~4140 行详情、~2760 `RowDetail`
- `cordis-plugin-loader/lib/index.js`：~382–422 volatile-only 提交 + 发 `loader/volatile-update`
- `dsh-app-boot/lib/index.js`：~717 installation scope、~1690 `routeLinked`（peer 路由）

## 8. 建议的下一步（按顺序）

1. 让用户按 §3 的路径走一遍，记录行里的 `rowId` 和有没有报错标记。
2. 若页面路径确实没有字段 → 做 §4.1 的 mcp-bridge 对照实验（最快区分「机制问题」还是「我们代码问题」）。
3. 需要证明 desktop 里插件是否激活 → 上 §4.2 的状态文件，重启一次读结果。
4. 结论出来后：
   - 若是位置问题 → 到此收尾，补 README 的界面路径说明；
   - 若是 rowId/ns 不匹配 → 调整 entry id 或包名后重装；
   - 若是非官方插件不生成表单 → 按 §4.4 做客户端设置页（新的一个 commit）。
5. 收尾时更新本文档和 `README.md`，commit 仍要带 `Agent:` / `Model:` trailer。
