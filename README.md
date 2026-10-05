# @vibedev-si/dsh-ecosystem · VibeDev 插件中心

> 集中了解、**一键安装**和管理 VibeDev 官方插件。
> Learn about, one-click install and manage the official VibeDev plugins.

![首页](docs/img/01-home.png)

## 它做什么

- **官方插件，说明写清楚**：每个插件的功能、费用、会读写什么、依赖什么，都写在卡片和详情里；需要 VibeDev 账号、按用量计费的会明确标出。
- **一键安装**：点一次、确认一次，自动完成「检查 → 安装 → 启用」，缺少的前置插件一并装好。
- **套装**：「AI 创作套装」= Better Sidebar + 媒体生成 + 影视工作台 + 媒体预览，一次装齐，已装的自动跳过。
- **旧包名迁移**：发现旧包名（例如 `dsh-media-viewer`）时，按"新包装但不启用 → 停用旧包 → 启用新包 → 确认后卸载旧包"的顺序切换，避免两者同时启用互相冲突；失败时自动把旧包恢复，不会让你两个都没有。
- **管理与更新**：停用、启用、卸载、更新；有新版本时按钮变"更新到 x"。
- **社区插件**：一键安装社区的插件市场 `dshmarket`，已装时在「社区插件」标签页里嵌入它的界面。本中心**只收录官方插件**，不替代插件市场。

| 安装进度 | 失败也说清楚 |
|---|---|
| ![安装中](docs/img/03-running.png) | ![冷却期](docs/img/08-fail-cooldown.png) |

## 安装

在 VibeDev / DSH 的插件页按包名安装 `@vibedev-si/dsh-ecosystem`，或：

```sh
dsh plugin --profile <你的 profile 名> add @vibedev-si/dsh-ecosystem
```

VibeDev 桌面版的命令是 `vibedev-app plugin --profile desktop add @vibedev-si/dsh-ecosystem`，先完全退出应用再运行。

> **包名必须带 `@vibedev-si/` 前缀。** 只写 `dsh-ecosystem` 会提示「未找到相关插件」，那是另一个不存在的名字。

装好后插件由 VibeDev 自己加载，通常几秒内侧边栏就会出现「VibeDev 插件中心」，**不需要刷新页面**；如果过一会儿仍没有，请完全退出并重新打开 VibeDev。

## 安全

这是一个"能安装别的插件"的插件，所以限制得很死：

- **只能安装目录里登记的包**，并且只装目录里写明的**精确版本**（`name@x.y.z`），不接受链接、路径、版本范围或标签。
- 安装前先让官方插件管理器 `inspect`；**返回的包名、版本和目录不一致时，直接拦截，不安装**。
- 先**不启用**地安装，成功后再启用，所以失败不会留下半启用的插件。
- 依赖需要执行构建脚本时，**停下来等你决定**，不会自动放行。
- 社区插件（Better Sidebar、插件市场）只提供安装入口，并明确标注"本中心不审查其代码"。
- 插件自身不联网、不上报任何数据，目录随包发布；安装时由官方插件管理器去访问 npm（并按官方插件页的做法，先问宿主哪个源最快）。

## 已知情况

- **一次装多个插件时，插件中心会在每个插件之间、以及全部装完之后，等 VibeDev 安静下来再继续。** 0.1.1 没有这样做，还多了一个「立即刷新页面」按钮；有用户在装完套装、紧接着点刷新后，桌面版启动时报「1 entry did not activate」。触发的确切原因没有被证实，但 0.1.2 去掉了刷新按钮并加了等待。若遇到类似的启动失败，请到 Issues 附上崩溃日志。

- **更新已安装的插件需要重启 VibeDev** 才会加载新代码（官方插件管理器的行为），界面会这样提示。
- pnpm 的"新版本冷却期"（默认一天）会拦住**所有**安装和卸载，界面会指出是哪个包、什么时候恢复。
- 官方卸载流程不是原子的：失败时插件可能变成"已停用、仍安装"，界面会明说，并提供"重新启用"和"重试卸载"。

## 开发

```sh
npm test            # 构建 client.js、校验目录、目录变异测试、引擎、host 路由
npm run test:browser  # 真实 Chrome 里驱动整个界面（需要 puppeteer-core 和本机 Chrome）
npm run validate:online  # 核对目录里每个包@版本真的在 npm 上
```

- `src/engine.js`：安装、迁移、卸载、更新的纯逻辑，对着一个**假的 pluginManager** 测试，覆盖成功、网络失败、版本不兼容、待批准构建、冷却期、注册表返回不一致、安装一半、重启等分支。
- `catalog/catalog.json`：目录，也是安装白名单。`scripts/validate-catalog.mjs` 会拒绝链接式的包名、版本范围、社区插件冒充官方、缺英文、依赖环等。
- `client.js` 由 `scripts/build.mjs` 生成并提交（插件的 client 包无构建步骤，仓库因此也能直接从源码安装）。

### 开发者自检（默认关闭）

在 `<profile>/.vdc/` 下手动创建空文件 `enable-selfcheck`，下次加载时插件会做**只读**检查（`listBundles`、`inspect`、读取主题和语言等），把报告写到本机的 `<profile>/.vdc/selfcheck.json`。不创建这个文件就什么都不会发生。这一步完全不可见。若还想验证面板能在真实界面里挂载（会让屏幕**短暂闪一下**，因为要临时切到插件中心面板再切回），需要**另外**创建空文件 `enable-selfcheck-mount`。

## 参与

插件要进入目录，请提 issue 说明；目录是安装白名单，所以每一条都会核对来源和版本。

## English

**@vibedev-si/dsh-ecosystem** is the VibeDev Plugin Center: a panel in the sidebar that explains the official VibeDev plugins (what they do, what they cost, what they read and write, what they need), installs them in one click (inspect → install disabled → enable, with prerequisites), offers a one-click "AI Creator Suite", migrates old package names safely, and installs the community plugin market on request. It lists **only official plugins** and does not replace the market.

Because it can install other plugins, it is deliberately strict: it installs only catalog entries at their exact version; it blocks the install if the registry's answer does not match the catalog; it stops and asks before any dependency build script runs; and it sends no data anywhere.

Install by package name from your DSH plugin manager, or `dsh plugin --profile <name> add @vibedev-si/dsh-ecosystem`. The package name must include the `@vibedev-si/` scope (plain `dsh-ecosystem` does not exist). VibeDev loads the plugin itself, usually within seconds, so there is no need to reload the page; if the sidebar still has not changed after a while, quit VibeDev completely and reopen it. Updating an already-installed plugin needs a restart of VibeDev to load the new code.

## License

[MIT](./LICENSE) © VibeDev
