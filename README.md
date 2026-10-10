# @vibedev-si/dsh-ecosystem · VibeDev 生态

集中了解、安装和管理 **VibeDev 出品的插件**，并在独立的社区标签页里浏览 **DSH 社区市场（dshmarket）**。VibeDev 生态与 DSH 宿主的插件管理器是不同入口；安装、启停与卸载仍由宿主执行。

## 0.1.11

- 目录：媒体预览与画廊升到 0.2.0，直接用 DSH 自带的右侧栏，**不再需要 Better Sidebar**；「AI 创作套装」只含 VibeDev 自己的三个插件。Better Sidebar 仍可单独安装，作为推荐搭档。
- 随包离线目录同步更新：读不到在线目录时（例如网络无法访问 GitHub）看到的也是新版本与新依赖关系。

## 0.1.10

- 兼容 DSH 0.2.1-alpha.2 及以后：宿主把启动参数服务从 `webRuntime` 改名为 `webStartup`，0.1.9 及更早版本在新宿主上会停在「等待服务」而不加载。现在只依赖 Web 服务本身，额外的受信主机从两种服务中按宿主实际提供的读取。

## 0.1.9

- **VibeDev Next 内置**：VibeDev Next 把 VibeDev 生态作为内置官方插件提供。它出现在「插件」页的「官方」分组里，点开即进入生态页面；版本随应用更新，在 VibeDev Next 里不需要也不能另外安装。
- 内置时，生态自身的新版本提示改为「随应用更新」，不再给出卸载重装步骤。
- 官方 DSH 或自行安装时行为不变：侧栏入口加面板，可停用、可卸载，自更新沿用手动说明。只有应用在自己的插入行里写明 `config: { official: true }` 才进入内置模式。

## 0.1.8

- 社区市场的样式与生态页面隔离，生态的按钮、卡片和字体规则不再覆盖市场子树。对不透明填充按钮上不足 4.5:1 的文字对比度，按按钮实际背景选择黑或白文字；保留市场的背景、主题 token、图标按钮和开关。
- 「可更新」读取已收录 VibeDev 包的 npm 正式发布版本，包括生态自身的更新说明。版本来自官方 npm，官方读取失败时才降级到镜像并标明状态。读取失败不会宣称所有插件都是最新版。
- 使用**在线目录与随包离线目录**。新插件上架、下架及目录信息更新独立于生态客户端发版。生态自身的功能修复仍通过版本发布提供。
- 名称统一为 **VibeDev 生态 / VibeDev Ecosystem**。包名、面板身份和已安装状态保持兼容。「关于」默认收起；已撤回的插件页尾推荐块没有恢复。

## 收录与更新来源

团队维护的在线目录：

[目录文件](https://raw.githubusercontent.com/VibeDev-Si/dsh-ecosystem/main/catalog/catalog.json)

打开生态面板或点击「检查更新」时，宿主读取并校验该目录，再核对其中 VibeDev 包的 npm 正式版本。在线目录成功读取后缓存 5 分钟，完整版本检查成功后缓存 1 分钟；没有后台定时轮询。目录或网络读取失败时保留上次可用目录，或使用随包目录，并显示来源与未核验状态。

新插件不必等待生态客户端更新：发布 npm 包后，把包名、用途、双语说明、前置依赖、权限与费用、来源仓库和精确版本加入目录，校验后提交到本仓库 `main`。用户下次成功读取目录时就能看见它，实际显示时间取决于缓存与网络。

维护步骤见 [收录与发布指引](docs/CATALOG-PUBLISHING.md)。

## 安装与管理

VibeDev Next 已内置 VibeDev 生态，无需安装；在 VibeDev Next 的「添加插件」里输入它会提示已安装。

在 DSH 的插件页按完整包名安装：

```text
@vibedev-si/dsh-ecosystem@0.1.11
```

独立 DSH 的命令：

```sh
dsh plugin --profile <profile> add @vibedev-si/dsh-ecosystem@0.1.11
```

- 安装前会列出精确版本与依赖，先检查、安装为停用状态，再启用。已安装的组件会复用；更新原本停用的插件会保持停用。
- 新版本和在线新增插件从核验过的发布源取得；其余随包版本保留宿主的源选择策略。npm 包名、版本或 bundle 身份不一致时拒绝安装。
- **应用内置组件**只显示版本差异和升级应用说明，不重复安装、更新或卸载外部副本。
- **生态自身**的新版本在「可更新」中显示精确包名与手动更新说明，避免运行中的生态卸载自身。
- 更新已安装插件后完全退出并重新打开 VibeDev Next，使新代码加载。生态不会替用户退出应用、刷新页面或重启。
- 依赖构建脚本、宿主兼容性检查与 pnpm 新版本冷却期继续由宿主处理。遇到失败会报告实际结果，不自动扩大授权。

## 目录规则与网络

在线目录必须通过与随包目录相同的校验：精确包名和版本、双语说明、来源、权限、依赖引用和无环关系。VibeDev 条目限团队包命名空间（历史包 `dsh-film` 保留兼容）；社区集成限已明确支持的市场与侧栏组件。目录不可把生态自身变成普通安装条目，不接受链接式安装目标、范围版本或 shell 命令注入。

在线目录来自固定 GitHub 地址；npm 核验只读取通过校验的 VibeDev 包，检查包名、版本、bundle 声明、来源仓库及发布时间。请求不携带账号凭据、cookie 或用户文件内容，不做遥测、不自动安装。目录读取有 8 秒与 256 KB 限制，版本查询并发受限且有批次期限；失败时显示可用事实与回退状态。

社区页嵌入 dshmarket 的界面，社区市场有自己的目录和网络行为，由 dsh-market 团队维护。VibeDev 生态没有审查其全部插件代码，也不替代 DSH 的插件管理器。

## 开发

```sh
npm test                    # 共享目录校验、安装/迁移引擎、Host、版本查询、在线目录
npm run test:browser         # 真实 Chrome 的完整界面流程
node test/theme.browser.test.mjs    # 黑白主题、市场样式隔离、对比度
node test/updates.browser.test.mjs  # 旧目录、实时更新、失败、内置与自身更新
npm run validate:online     # 核对目录精确版本与 npm 发布事实
```

客户端由 [构建脚本](scripts/build.mjs)生成并提交。Host 与客户端共享 [目录校验器](catalog-validator.js)；[在线目录读取器](remote-catalog.js)与[版本检查器](catalog-updates.js)负责固定来源与受限查询。测试使用隔离的假插件管理器与假注册表，不操作真实 profile 或账号。

## English

**VibeDev Ecosystem** discovers and manages plugins made by VibeDev, with the DSH community market embedded in a separate tab. Its catalog is maintained independently on the repository's main branch: publishing a new package and updating the validated catalog makes it discoverable without another client release. The bundled catalog remains an offline fallback.

Opening the panel or explicitly checking updates reads the catalog and verifies stable npm releases. Successful catalog reads are cached for five minutes and complete release checks for one minute, with no polling. Official npm takes precedence; a mirror is only a labelled fallback. Failed reads never claim everything is current. Built-in packages require an app update, and ecosystem self-updates show an exact manual spec rather than unloading the running panel.

The embedded market's styles are isolated. Unreadable filled text buttons receive a narrowly scoped black-or-white foreground adjustment without altering backgrounds or theme tokens. The package name and panel identity remain compatible; the About section starts collapsed and withdrawn promotional footers stay removed.

## License

[MIT](LICENSE) © VibeDev
