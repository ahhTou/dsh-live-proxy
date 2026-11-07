# dsh-live-proxy 交接文档（2026-10-27 凌晨）

> **2026-11-07 更新（DSH 升到 `0.2.2-rc.1`）**：Settings 导航出现「齿轮 + 双向箭头」双 Icon。根因是 0.2.2 的 shell 把导航图标包进了 `<span class="…navIcon">`，并且新增了 `settings.section.icon` 槽位；本插件旧实现靠 `svg[class*="navIcon"]:has(...)` 隐藏齿轮，选择器失配后就两个都显示。已改成：`settings.section` 的 `label` 回到纯文本，同 id 注册 `settings.section.icon` 由 shell 替换齿轮（见 §2、§6.10）。验证：live `Slots.listSubTree` 已看到 icon 占位者 `live-proxy`，`npm test` 45 passed / 0 failed；像素级复看需要在窗口里打开一次设置。
>
> 给下一个会话：这份文档覆盖当前状态。立项背景、seam 逆向、旧排查记录在 [HANDOFF.md](HANDOFF.md)，这里只写结论与现状。

## 0. 一句话状态

**根因已定位并修复**：这一版 DSH **不会**给第三方 bundle 的行自动生成配置表单，`plugins.row.config` 槽位必须由插件自己的**浏览器半侧**占用。已新增 `lib/client.js` 并完成隔离验证（入口、6 个字段、保存写回 patch、热生效、恢复默认、SOCKS 校验都通过）。**桌面客户端还差一次重启**：浏览器半侧只在启动时扫描，`dsh-client-modules` 对「不是客户端包」的否定结果会缓存到进程重启。

重启后入口：**设置 → 代理**（独立菜单，首选）；也可以走 **Plugins → 已安装插件 → 实时代理 → 配置**。两个入口共用同一份表单。

## 1. 根因（已实时确认）

- `dsh-client-ui-plugin-manager` 的 `configLedgerSource` 只用 `plugins.row.config` 的**注册键**决定一行有没有配置页：

  ```js
  rows: keysOf("plugins.row.config")   // 没有占用者 → 行标题只是纯文本，没有「配置」按钮
  ```

  `plugins.row.config` 是 keyed slot，key 为 `<bundle 包名>#<rowId>`；页面把 `form`（`state` + `mutate`）传给占用者，但**它自己不渲染任何字段**。
- 实时查询 `Slots.listSubTree({ root: 'plugins.row.config' })` 得到 `occupants: []`——不是「看错页面」，是确实没有渲染器。
- `SettingsForms.describe()` 会为我们的行生成表单数据（`ns: 'dsh-live-proxy'`、6 个 volatile 字段、当前值/默认值/用户层），但那只是数据；官方页面（`ui-settings-shell` 等）都是各自占 `plugins.item` 并自绘表单。
- `Settings → 内置插件` 仍然是只读清单，第三方 bundle 的配置入口只在 Plugins 页。

## 2. 修复内容

| 文件 | 职责 |
|---|---|
| `lib/client.js` | 浏览器半侧：注册 `settings.section`（设置 → 代理，id `live-proxy`、order 17，`label` 为纯文本「代理」）＋同 id 的 `settings.section.icon`（双向箭头，替换 shell 对未知 section 回退的齿轮）与 `plugins.row.config`（row 键 `@local/dsh-live-proxy#dsh-live-proxy`）；中英文案；6 字段表单；保存 / 放弃修改 / 恢复默认；SOCKS、URL、整数范围校验；只用 React，不 require 内部 primitives |
| `package.json` | 增加 `exports["./client"]`、`exports["./locale/*.json"]`、`exports["./icon"]`；`dsh.client`（`platform: web`，inject locale + plugin-manager + settings）；`icon`；`files` |
| `locale/en.json` / `locale/zh.json` | `meta.title` / `meta.description`，Plugins 卡片与行显示「实时代理」 |
| `icon.svg` | 原创图标（蓝色圆角底 + 穿过节点的双向箭头 + 绿色在线点） |
| `test/client.test.js` | 校验 module id、注册 key、inject、双语字典、locale 元数据、icon 导出 |
| `README.md` | 修正入口路径，新增「2.1 界面入口」与浏览器半侧说明 |

Host 半侧（`index.js`、`lib/*.js`）**没有改动**；6 个字段本来就是 volatile，`loader/volatile-update` 热更新链路原本就成立，缺的只是 UI。

> 发布时若把包名从 `@local/dsh-live-proxy` 改成 `dsh-live-proxy`，必须同步改三处：`lib/client.js` 的 module `id` 和 `ROW_KEY`，以及 `test/client.test.js` 的期望值（测试会检查 module id 等于 `package.json.name`、key 等于 `<name>#dsh-live-proxy`）。

## 3. 已验证（隔离实例）

环境：`DSH_HOME=/tmp/dsh-ui-verify`，`dsh plugin --profile web add link:/Users/ahhtou/Dev/dsh-live-proxy`，`dsh --profile web --port 0 --no-open`，浏览器用 bsk 打开。

| 验证 | 结果 |
|---|---|
| 安装后的卡片 | Plugins → 已安装插件显示「实时代理」、图标、中文描述 |
| 设置入口 | **更多/账号菜单 → 设置**，左侧导航出现独立 **代理** 项（0.2.2 起由同 id 的 `settings.section.icon` 提供单色双向箭头并替换 shell 齿轮；页面标题也用同一图标），6 个字段渲染正常 |
| 行入口 | 卡片内 `dsh-live-proxy` 行出现「配置 实时代理」按钮（修复前是纯文本） |
| 配置页 | 6 个字段全部渲染，默认值来自 `cordis.patch.yml`（manual / 127.0.0.1:7897 / 例外列表 / 回落开 / 15000 / 2000） |
| 保存 | 在设置页改 `probeIntervalMs` → profile patch 出现完整 config（DSH 的 config editor 会持久化整份配置，不是只写改动字段，这是正常行为）；两个入口值同步 |
| 热生效 | 把 `proxyUrl` 指向 127.0.0.1:8799 的临时 listener、`probeIntervalMs: 500` → 保存后 3 秒内捕获 7 次连接，间隔严格 0.5s，**未重启 host** |
| 校验 | `socks5://...` → 页面提示「DSH 不接受 SOCKS」，patch 不变 |
| 恢复默认 | 写 `unset` 操作 → 用户 patch 中的 `dsh-live-proxy` 条目被删除，表单回到 bundle 默认值 |
| 单测 | `node --test test/*.test.js` → 45 pass / 1 skip（`test/plugin.test.js` 需要 app 内的 schemastery，属预期） |

截图（已入库）：`docs/settings-nav.png`、`docs/settings-proxy-page.png`、`docs/plugins-entry.png`。

## 4. 桌面客户端：只差一次重启

为什么必须重启：`dsh-client-modules` 在启动时扫描每个 Loader 行的 `package.json`；当时本包还没有 `dsh.client`，否定结果按 `(baseUrl, 包名)` 缓存在 `pkgMeta` 里，直到进程重启（源码：`dsh-client-modules/lib/index.js` 的 `resolveMeta` / `pkgMeta`）。改代码、开关插件、刷新页面都不会清掉这个缓存。

重启后自检：

1. **更多/账号菜单 → 设置 → 代理**，确认左侧导航的「代理」带单色双向箭头（跟随主题色，不是齿轮）、页面 6 个字段与当前值；改一个值保存，确认「已保存，立即生效」；
2. **Plugins → 已安装插件 → 实时代理**，确认卡片标题/描述/图标正常，行上也有「配置」入口；
3. 用 `web_fetch https://www.google.com` 或 `nc` 验证策略真的切换（`web_fetch` 走 `proxyRouteFor`，不是全局 dispatcher）。

若重启后仍没有「代理」行 /「配置」按钮：

- 查 `~/.dsh/profiles/desktop/package.json` 的依赖是否仍为 `link:/Users/ahhtou/Dev/dsh-live-proxy`；
- 用 `cordis_inspect_query`（client `Slots.listSubTree`，root `settings.section`、`settings.section.icon` 与 `plugins.row.config`）看 occupants 是否出现 `live-proxy`（section 与 icon 各一条）与 `@local/dsh-live-proxy#dsh-live-proxy`；
- 看桌面端开发者工具 console 是否有 `client-modules` / `module-loader` 报错（常见：`dsh.client` 声明缺 `exports["./client"]`、module id 与包名不一致、`configForms` 服务缺失）；
- 确认 `package.json` 的 `exports["./client"]` 指向的文件存在，且 `lib/client.js` 的 module id 与包名一致。

## 5. 环境备忘

| 项 | 值 |
|---|---|
| DSH | `0.2.2-rc.1`（asar：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/`） |
| CLI | `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh` |
| 桌面 profile | `~/.dsh/profiles/desktop`（只能由 Electron app 启动） |
| 隔离验证 profile | `/tmp/dsh-ui-verify/profiles/web`（可随时删） |
| 本机代理 | `127.0.0.1:7897`（YouTuCore） |
| 浏览器会话 | bsk；隔离实例端口每次随机（从 `web.log` 读） |

## 6. 已知坑（别踩第二遍）

1. **不要为了测试把 `mode` 改成 `direct`**：模型请求也走同一条策略，可能直接断掉当前会话；要验证热切换，用 `noProxy` 加一个只影响测试域名的条目。
2. **peer 警告不是错误**：loader 按 peer 名把 `@deepseek-ai/*` 裸导入路由到运行中安装副本；删掉 peer 反而会让插件导入失败。
3. **官方 installer 的 disposer 是异步的**：`lib/controller.js` 已串行化，别绕过。
4. **只改 `setGlobalDispatcher()` 修不了 `web_fetch`**：必须走 `installProxyFromEnvironment` / `proxyRouteFor`。
5. **worker 和遥测不走代理**（官方设计），别去「修」。
6. **桌面端重启会结束当前会话**；会话持久化，重启后可恢复。
7. **客户端 bundle 不能用 `import`/JSX**：它是 `window.__ModuleLoader__.load({ id, factory })` 工厂，只能用 `require('react')` 等静态模块表里的名字；不要 require `@deepseek-ai/dsh-client-ui-primitives`（内部包，版本会变）。
8. **key 必须精确匹配**：`<bundle 包名>#<rowId>`；包名是 inventory 里的 `pkg.name`（当前 `@local/dsh-live-proxy`），rowId 是 patch 里的 `id`（`dsh-live-proxy`）。
9. **Settings 行依赖 `configForms` 服务**：`lib/client.js` 的 `inject` 里必须有 `configForms`；`dsh.client.inject` 里必须有 `@deepseek-ai/dsh-client-ui-settings`，否则 client 半侧在启动时不会按依赖顺序拿到 settings 的客户端包（服务本身由 `dsh-client-ui-settings` 提供）。
10. **Settings 导航图标用 `settings.section.icon` 槽位，别改 label、别写 CSS 补丁**：`dsh-client-ui-settings-general` 的 `navIcon(id)` 只为官方 id 配图标（account / models / plugins / agent-presets / archived-sessions），**未知 id 一律回退齿轮**；同包同时声明 `settings.section.icon`，shell 对每一行 `renderSlot('settings.section.icon', { size, active }, { only: row.id, fallback: navIcon(row.id) })`。插件按 **与 section 相同的 id**（`live-proxy`）注册该槽位即可替换齿轮，label 保持纯字符串。**不要**再把 React 元素塞进 label 靠 CSS 隐藏齿轮：0.2.2 起 shell 把图标包进 `<span class="…navIcon">`（不再直接是 `svg`），`svg[class*="navIcon"]:has(...)` 这类选择器失配，齿轮与自绘图标同时出现（就是「双 Icon」）。

## 7. 关键源码位置

- `dsh-client-ui-plugin-manager/lib/client.js`
  - ~13–70：`configLedgerSource` / `rowConfigKey`（行配置只认 slot 注册）
  - ~2349–2468：`RowsSection`（有注册才渲染 configure 按钮）
  - ~2760–2830：`RowDetail`（把 `view: 'page'` + `form` 传给 `plugins.row.config`）
  - ~3832–3838：`formFor`（`configForms` 按 `ns === rowId` 匹配）
- `dsh-client-ui-settings/lib/client.js`
  - ~1080–1244：`ConfigFormController`（`getSnapshot` / `subscribe` / `mutate` / `set` / `unset`）
  - ~1252–1334：`ConfigForms` 服务（`get(entryId)` / `whileServed(namespaces, register)` / `describe()`）
- `dsh-client-ui-settings-general/lib/client.js`
  - ~244–270：`navIcon(id)`（仅官方 section id 有图标，未知 id 回退齿轮）
  - ~305–320：nav 渲染（`<span class="navIcon">{renderSlot('settings.section.icon', {size, active}, {only: row.id, fallback: navIcon(row.id)})}</span>` + `<span class="navLabel">{row.label}</span>`；label 现在是 `string | (() => string)`）
  - ~1299–1309：官方 `settings.section` General 注册与 `settings.general.item` 子槽
- `dsh-client-ui-settings-plugins/lib/client.js` ~201：官方 `settings.section` 注册范式（id / order / label / locale / inject / component）
- `dsh-settings/lib/index.js` ~413–464：`describe()`（fiber 必须 state 2、有 volatile 字段）
- `dsh-settings/lib/types/schema.js`：`volatileForm()` / `projectForm()`
- `dsh-cordis-client-runner/lib/client.js` ~4759：`plugins.row.config` 目录与 owner props；`settings.section` / `settings.general.item` 目录在附近
- `dsh-client-modules/lib/index.js` ~721：`resolveMeta` 负缓存；~625：`rebuilt()`（只刷新已入表的包）

## 8. 建议的下一步

1. 重启桌面端，按 §4 自检并反馈「配置」入口是否出现。
2. 若出现：到此收尾；可把 `README` 的截图补进仓库（可选），并考虑给仓库加 `dsh-plugin` topic。
3. 若仍不出现：按 §4 的三条排查，重点看 occupants 与 console 报错。
4. 长期路线图（未做）：`mode: system`（`scutil --proxy`）、会话头部一键开关、按用途分流、改名发布 `dsh-live-proxy`（记得同步 §2 的三处 id）。
