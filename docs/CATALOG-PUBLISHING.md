# 收录一个新 VibeDev 插件 · Adding a plugin to the catalog

这份指引写给团队维护者：**新插件发布 npm 之后，只要把条目写进 `catalog/catalog.json` 并提交到 main，就已经对所有用户生效**——不用打 tag、不用发 Release、不用更新生态客户端。客户端在**一次成功读取之后缓存 5 分钟**：提交目录后，下一次成功读取就会显示新条目，实际时间取决于缓存与网络（CDN、镜像、延迟），我们不做"全球立刻生效"的承诺。

> 唯一的例外是仓库自身的 CI：它会核对 `client.js` 与目录快照一致，所以**每次改目录都要 `npm run build` 并把重新生成的 `client.js` 一起提交**。这只是保持仓库里那份"随包兜底快照"可构建、可复现——它不改变上面的结论：用户仍不需要更新客户端（随包目录只在在线读取失败时兜底）。

> 我们只做「列出、介绍、一键安装、更新检查」。**不承诺自动安装任何东西**：装什么由用户点。

---

## 一、五步流程

1. **发布 npm 包**
   - 包名：官方插件用 `@vibedev-si/` 作用域；历史包 `dsh-film` 是唯一的例外（grandfathered）。
   - 版本必须是**已发布的精确版本** `x.y.z`（不要 prerelease、不要 range、不要 dist-tag）。
   - 包里必须有 `dsh.bundle` 清单（插件管理器会据此接受它），否则 `validate:online` 会报错。
   - 记下 npm 上的**精确发布时间**（`https://registry.npmjs.org/<包名>` 的 `time["x.y.z"]`）。

2. **在 `catalog/catalog.json` 里加一条 `plugins[]` 条目**（字段见第二节）。

3. **本地校验 + 重建随包快照**
   ```bash
   npm run validate          # 结构校验，离线
   npm run validate:online   # 再加 npm 在线核对：版本存在、dsh.bundle、发布时间、体积
   npm run build             # 重新生成 client.js：它内嵌的正是这份目录快照
   ```
   `npm run build` 会打印 `client.js built: … KB (engine N exports, catalog … KB)`。**改目录而不 build，CI 会因为 `client.js` 与目录不一致而红。**

4. **提交到 main（目录 + 快照一起）**
   ```bash
   git add catalog/catalog.json client.js
   git commit -m "catalog: add @vibedev-si/<name> 1.0.0"
   git push origin main
   ```
   不需要改 `package.json` 版本、不需要打 tag、不需要发 Release/Publish——这次提交只是"目录 + 随包兜底快照"。

5. **生效**：无需其它动作。用户端在缓存过期后的**下一次成功读取**看到新条目——具体时间取决于各端缓存与网络状况，不是全球同步的保证；如果那一次网络失败，客户端继续用**上一次成功读到的目录**（标记为 stale），不会因此丢失新列表，也不会拿旧的覆盖新的。

回滚：`git revert` 那次提交（目录与 `client.js` 一起回退），同样在下一个读取周期生效。

---

## 二、条目字段（都必须是双语）

| 字段 | 要求 |
| --- | --- |
| `id` / `npm` | 必须**完全相同**，且是纯包名（不能是 url、git spec、路径、带版本或 dist-tag） |
| `version` | 精确已发布版本 `x.y.z` |
| `publishedAt` | npm 的真实发布时间，ISO UTC（如 `2026-10-05T14:40:00.000Z`），不早于 2020、不超前现在 24 小时 |
| `origin` | `official`（`@vibedev-si/*` 或 `dsh-film`）或 `community`（仅既有的 `dsh-better-sidebar` / `dshmarket`） |
| `role` | `official` / `dependency` / `companion` / `featured`；社区条目不能是 `official` |
| `updates` | `center`（本中心负责更新）或 `self`（插件自更新）；本中心只对自己负责的条目提示更新 |
| `name` / `tagline` / `does[]` | 中英双语必填，`does` 中英行数必须一致（≤8 行），`tagline` ≤200 字 |
| `tags` | `official` / `community` / `needsAccount` / `paid` / `needsHost02` / `needsSidebar` / `dependency` / `companion` / `tested` |
| `requires` / `partners` | 必须是**已存在于同一目录**的 id 数组，不能自依赖、不能成环；`partners` 是可选搭档 |
| `legacyNames` | 旧包名（改名迁移用），没有就 `[]` |
| `sizeKB` | 近似安装体积（KB），与 npm `unpackedSize` 偏差超过 25% 会被 `validate:online` 拦下 |
| `capabilities[]` | **权限与费用的诚实声明**，至少一条；社区条目必须带 `community` 免责声明。key 只能是：`network` / `writeFiles` / `readFiles` / `credentials` / `cost` / `agentTools` / `localRoute` / `pageScripts` / `community` / `fileAccess` / `writeConfig` |
| `links.repo` | 必须 https，且官方条目必须是 `https://github.com/VibeDev-Si/<repo>` |
| `links.npm` | 必须 https，且必须是 npm 包页 `https://www.npmjs.com/package/<包名>` |
| `cmd` | 规范格式：`dsh plugin add <包名>@<版本>`（可带 `--profile <名称>`）。**客户端展示和复制的命令由它自己的 npm 名与精确版本重新生成**，目录里的字符串只是被校验，不会被当 shell 执行 |
| `icon.glyph` | `{zh, en}`，`en` 必须纯 ASCII |
| `icon.grad` | **两个 CSS hex 颜色**（如 `#6f7bff`）；不接受 `url(...)`、`var(...)` 或颜色名 |
| `reviewed` / `compat` | 可选：`reviewed{date, tested[]}`；`compat{s: verified\|likely\|unknown\|incompatible, why{zh,en}}` |

### 关于 `requires` 与 `partners` 的区别

- `requires`：装了它才能用。安装器会**先装依赖**（拓扑序），缺失时在详情里说明。
- `partners`：可选搭档（例如账号插件 ↔ 影视工作台 ↔ 媒体预览），只在详情里列出来给用户看，不会被自动安装。

---

## 三、会被整份拒绝的情况

校验是「一份要么全信、要么不用」：任何一条不合格，客户端就**整份回退到随包目录**，不会半信半疑地用一半。常见触发：

- schema 不是 `1`；`plugins[]` 超过 40 条或 `suites[]` 超过 20 条
- 包名不是纯包名（含 url / `github:` / 路径 / `^1.2.3` / `latest`）
- 版本不是精确 `x.y.z`；`publishedAt` 非法或离谱
- 任何条目使用 `@deepseek-ai/*`（冒充 VibeDev 官方包）
- `community` 条目用了既有两个之外的包名（不因目录改动扩大受信安装面）
- 链接不是 https，或带凭据/查询/片段；官方 `links.repo` 不是 VibeDev 仓库
- 引用了不存在的 id、自依赖、依赖成环、suite 列了不存在的插件
- `icon.grad` 不是两个 hex；`cmd` 不是规范格式（例如带 `;`、管道或别的命令）
- 中英文本缺失、行数不一致或超出长度上限

传输层面同样严格：固定地址、`GET`、不跟随重定向、不带凭据、8 秒总超时（含读取 body）、响应超过 256 KB 立刻取消。任何一层失败都**不缓存**，下次会重试；若此前读到过好目录，就继续用它并标记 stale。

---

## 四、本地验证（离线 / 未来包）

```bash
node test/remote-catalog.test.mjs
```

这个测试用假 fetch 跑完整的读取路径，不需要网络，也不会碰任何真实环境。其中一条 fixture 是 `@vibedev-si/future-plugin`——一个「以后才可能出现」的插件条目，用来证明**目录里新增的包名会被读进来**，而不需要更新客户端；其余用例覆盖离线、超时、坏 JSON、超限、毒化 payload（DSH scope 冒充、git spec、url、版本范围、依赖被移除、试图放宽社区安装面、非 https 链接、链接劫持、超条数、成环）、stale 保留与失败不缓存。

---

## 五、English summary

Publish the package to npm, add one entry to `catalog/catalog.json`, run `npm run validate`, `npm run validate:online` and `npm run build`, then commit **both `catalog/catalog.json` and the regenerated `client.js`** and push to `main`. That is the whole release: no version bump, no tag, no GitHub release and no client update. The build step only keeps the repository's own fallback snapshot (`client.js` embeds the catalog) in step with the file — CI fails if they differ, which is why both go in one commit. Clients cache a successful read for five minutes and pick the entry up on their next successful read; when exactly that happens depends on each machine's cache and network, which we do not promise to be instant worldwide.

Keep the bilingual text, `role`, `requires`/`partners` and the **permissions and cost** honest; `icon.grad` takes two hex colours only, and `cmd` is regenerated by the client from the entry's own package name and exact version (the string in the catalog is validated, never executed). One bad field refuses the whole payload, which then falls back to the catalog shipped in the package; a previously read good catalog is kept, marked stale, and never overwritten by a failure. We list, describe, install on a click and check for updates — **we never install anything by ourselves**.
