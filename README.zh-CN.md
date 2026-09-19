---
last_updated: 2026-09-16
---

# OpenGlance

[English](README.md) | 简体中文

OpenGlance 是一款桌面应用，让非技术同事也能轻松查看和维护保存在 Git 中、由团队与 AI Agent 共用的
Markdown 知识库。

如果团队把 Markdown 知识库保存在 Git 中，让团队成员与 Agent 围绕同一份上下文共同维护内容，OpenGlance
会是一个以阅读和检查为先、比 Obsidian 更简单实用的选择。

> **名称迁移：** OpenGlance 替代最初的 Git Leaf 1.x 名称。已有仓库、会话和个人设置继续使用同一个本机
> Profile；`git-leaf` CLI 命令及其 URL scheme 继续作为兼容入口，新生成的命令和链接统一使用 `openglance`
> 与 `openglance://`。GitHub 会把之前的仓库地址重定向到
> `openglance/openglance`；下载域名和更新服务根路径暂时保持原地址，等待后续独立完成域名迁移。

## 为什么需要 OpenGlance？

- 团队把 Markdown 知识库保存在 Git 中，方便 Agent、开发者和自动化直接使用这些文件，但对市场、运营等
  同事来说，理解和处理 Git 同步往往过于复杂。
- 非技术同事更多是在阅读现有文档、定位具体内容和检查 Agent 的修改，而不是从空白页面持续写笔记，却常常
  只能使用以编辑或开发为中心的工具。
- 团队不应该在“Agent 可以直接使用的文件”和“普通同事熟悉的文档体验”之间二选一，也不应该为了方便人
  阅读而维护第二份内容。

## 为什么不直接使用 Obsidian？

- Obsidian 以编辑为先，[Live Preview](https://help.obsidian.md/Live%2Bpreview%2Bupdate) 让笔记在可编辑状态中
  接近最终呈现；OpenGlance 以 Preview 为先，文档默认以完整呈现效果打开，重点是阅读和检查。
- 只需要预览文档、精确定位、少量编辑和 Agent 协作的团队，并不需要 Obsidian 提供的许多笔记与知识管理
  功能。
- 知识库不在 Git 中时，Obsidian 可能更合适；Git 已经承载人与 Agent 的共享上下文，而非技术同事不应该
  日常操作 Git 时，OpenGlance 是更专注的选择。

## 核心功能

- **Preview First，需要时再编辑。** Markdown／MDX 文档默认在 Preview 中以完整呈现效果打开，并保留
  源文件行号和文本选区；需要小改时，再切换到 Live 或 Source 编辑原文件。
- **尚未发布的编辑始终容易找回。** 对已有提交版本的文档，OpenGlance 会在正文中高亮当前新增和替换的
  内容，在文档导航中为受影响章节铺满整行底色；还可通过默认关闭的弱化开关查看带删除线的删除内容，原有
  当前文档行号保持不变。尚未跟踪的新文档仍按普通完整文档阅读，由 Sync 标识它尚未发布。这是一条轻量的
  编辑轨迹，不是面向开发者的标准 Git diff。
- **准确的 Agent 上下文。** 选择单个文件中带源位置的几行，或组合多个文件的内容，复制为 Agent 可以
  直接使用的 Markdown 上下文。
- **无感更新，受控发布。** OpenGlance 在安全时自动应用远端更新；用户决定发布时，一次操作提交并推送当前
  仓库的全部本地改动。
- **像在线文档一样发送链接。** 同事或 Agent 可以在聊天中发送 OpenGlance HTTPS 链接，接收者点开后即可在
  本地知识库中打开对应文档。普通文档链接打开主工作目录；带 worktree 的链接精确打开指定本机工作目录。
  OpenGlance 只会在确认已发布版本后生成可供同事使用的版本化分享链接。
- **Agent 可读的数据，人可读的图表。** 标准 Mermaid 围栏和受控 MDX 把流程图、图表、表格和指标保留
  为仓库中的可读文本，让 Agent 直接修改，让人通过 OpenGlance 查看可视化结果。

[**下载 macOS 版**](https://gitleaf.mangofuture.com/download?lang=zh-CN#macos) ·
[Windows Preview](https://gitleaf.mangofuture.com/download?lang=zh-CN#windows) ·
[从源码构建](docs/build-from-source.md)

![OpenGlance 展示共享上下文仓库、本地改动和 Agent 上下文](docs/assets/user-guide/workspace-overview.png)

[![CI](https://github.com/openglance/openglance/actions/workflows/ci.yml/badge.svg)](https://github.com/openglance/openglance/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

安装 OpenGlance 后，可以直接[打开公开使用指南 Demo 仓库](https://gitleaf.mangofuture.com/open?repo=openglance%2Fopenglance-example-knowledge-base&path=README.zh-CN.md)，
也可以先克隆到本机，完成一次完全本地的首次体验。
更完整的界面介绍和日常工作方式见 [OpenGlance 用户手册](docs/user-guide.zh-CN.md)。

## 一个仓库，两种界面

Git 仓库是持久的共享上下文事实源：其中可以保存知识、指令、决策、计划、操作手册，以及帮助团队和 Agent
保持一致的其他文件。知识库可以是仓库中的一部分，但这个仓库不只是供人查询资料，还直接服务 Agent 的工作。

- **AI Agent、开发者和自动化直接使用 Git。** 它们继续使用原来的路径、文件、分支、revision 和指令。
- **人使用 OpenGlance。** 通过熟悉的目录树、搜索、Preview 和范围明确的编辑参与，不必把内容搬到另一个系统。
- **Git 始终是共同事实源。** OpenGlance 不会把仓库导入、索引或复制到另一个知识服务。

## 人参与的工作闭环

1. **找到并阅读相关上下文。** 沿仓库原有目录浏览、直接搜索，或打开 Agent 返回的链接；Preview 是
   默认阅读界面。
2. **检查发生了什么变化。** Sync 显示尚未发布的本地文件和远端状态；打开相关文档后，正文直接高亮
   当前改动，文档导航为受影响章节铺满整行底色。首个章节以前的改动归入“文档顶部”；右上角的可选
   弱化的右上角开关可进一步显示带删除线的删除内容，原有行号保持不变。
3. **把准确上下文交回 Agent。** 在 Preview、Source 或 Live 中选择保留源文件位置的行，整理成通用
   Agent 上下文，再交给外部 Agent。
4. **必要时直接做一个小修改。** Live 以接近阅读效果的方式呈现标题、列表和链接，同时仍写回原来的
   Markdown／MDX 文件；需要精确控制文本时再使用 Source。图片、链接、Frontmatter 字段、原生表格和
   MDX-lite 组件采用同一套紧凑的上下文工具栏，并且只显示当前对象最常用的操作。原生 Markdown 表格
   支持单元格局部源码编辑、矩形选区文字格式、固定前景色与高亮色、列对齐和基础列移动，同时不引入
   私有表格格式。
5. **保持共享仓库最新。** OpenGlance 可以在保留未完成编辑的同时引入远端变化；“同步并发布”由人主动
   提交和推送，“复制分享链接”只在复核已发布 revision 后返回版本化链接。
   Sync 中可以选填本次修改摘要；留空时，App 在本地根据改动文件和本次新增或修改的文档变更摘要生成说明。

## 本地优先的文件，也能像在线文档一样打开

在线文档之所以方便，其中一个重要原因是：发出一个 URL，别人就能直接到达正确的页面。OpenGlance 把这种
交互带到本地优先、由 Git 支撑的文件库；协作与发布通过 Git 完成，而不是依赖另一个托管编辑数据库。

AI Agent 可以为 Markdown／MDX 文件返回一个 HTTPS **Open in OpenGlance** 链接。浏览器把链接交给
已经安装的 App，由 OpenGlance 打开匹配的本机仓库、worktree 和文档。需要把已经发布的结果发给同事时，
“复制分享链接”会先同步并复核 `origin/main`，再生成带 revision 的 URL。链接本身不会授予仓库权限，
每个人仍然使用自己原本有权访问的本机 checkout。

[用户手册](docs/user-guide.zh-CN.md#用-url-打开本机对应文档)展示了完整流程，以及如何用仓库提示词要求
Agent 在交付时返回这类链接。

## 同一份数据，Agent 直接读写，人直接看图表

Markdown 或 MDX 中标准的 `mermaid` 围栏会在 Preview 和 Live 的非活动区块里本地渲染。图形工具栏可以
让图适应画布、缩放和平移；`</>` 始终返回完全相同、可移植的源码。OpenGlance 不加载远程绘图服务，语法
错误时也会保留源码入口，不会生成需要另行同步的第二份视觉模型。

对于没有由作者指定布局的复杂 `flowchart`，“智能阅读”把从上到下作为文档阅读的默认方向，不依赖任何
业务词汇。横向源码只有在节点、关系和分组数量完全一致、节点没有重叠时，才会以纵向方式呈现；已有的纵向
源码绝不会被自动改成横向。完整图始终可见；OpenGlance 不会从中派生丢失上下文的节点列表或一跳小图。
这些阅读视图都不会改写 Mermaid 源码。

方向明确的过程适合自动布局的 `flowchart`。如果架构总览中的位置本身有含义，应由作者显式选择 Mermaid
布局，或使用 `block-beta` 指定行列和 `space` 留白；OpenGlance 会尊重该选择。阶段标签保持简短，一张总览仍
承载过多概念时，由作者使用明确的 Mermaid 分组或把详细路径拆成较小的后续图。

OpenGlance 支持 Markdown 和受控的 MDX，让结构化数据直接保存在文档中，而不是藏在截图或独立仪表盘里。
图表序列、数据表、时间线、关键指标、决策和流程，可以用可读的 CSV、TSV、JSON 或 Markdown 写在
`.mdx` 文件内。AI Agent 把这些值当作普通仓库文本直接读取和修改；OpenGlance 则把同一份源文件呈现为
图表和其他视觉内容，供人理解。

长期维护的公司报表可以把完整历史数据保存在仓库内的标准 CSV、TSV 或 JSON 文件中，并用独立的
`.dataset.json` 描述字段类型、含义、主键、源数据粒度和聚合口径。原有 `Chart`、`DataTable` 可以选择
时间区间，并只显示源数据可靠支持的时间视图：日数据可切换日、周、月、自然季度；周数据还可以按
每周第四天归属自然月或季度，但不会虚构日数据。每个字段的聚合方式必须明确声明；缺失周期不会被
当成 0，文档也不能执行脚本或查询其他仓库。
对于常见的表格或 BI 导出，sidecar 可以显式选择物理列和千分位数字格式，同时保持原始数据文件不变。

Preview 负责呈现文档，Source 和 Live 仍编辑原文件，不需要同步第二份视觉数据模型。OpenGlance 只呈现
白名单中的组件；文档不能运行任意 JSX、JavaScript、`import` 或脚本。

![OpenGlance 从 Agent 可读的上下文文档中呈现柱线组合图](docs/assets/user-guide/mdx-visuals.png)

## 为人读得懂的上下文

- All、Favorites、Sync 三个视图，可在“内容文件”和完整仓库目录树之间切换；Markdown／MDX 使用
  非中文源文件名时，默认在不改变文件名的前提下于第二行显示文档标题，并将第一行文件名略微淡化，让标题
  更易扫读；也可关闭第二行以获得更紧凑的目录树。目录内文件夹优先，名称按自然顺序排列（`2` 在 `10` 前）。
- 紧凑的文档 Tab 在存在独立人类可读标题时使用相同的“文件名＋标题”层级，并在悬停提示中保留完整仓库
  相对路径。
- 可搜索、可拖动排序的仓库面板，用于打开、切换仓库或将仓库移出 OpenGlance（不会删除本地文件）；
  切换仓库与 worktree 时分别恢复文档 Tab、导航历史、滚动位置和焦点。文档缺失时仍可使用工作台；
  仓库不可用时，首页保留已打开的仓库列表，方便进入其他仓库。
- Preview 和 Live 支持悬停预览本地 Markdown／MDX 文档，以及 GitHub 仓库、Issue、PR、Milestone、文件、提交和
  Release。本地链接展示已保存的摘要、章节或源文件行；GitHub 使用本机 `gh` 的当前登录与私有仓库权限。
  不同 GitHub 链接共用连接；成功的预览在内存中保留最多 60 秒，加快重复悬停；切换 `gh` 登录后清除旧内容。
  卡片可以展开摘录、打开目标，或按 Esc 关闭。
- 只读预览图片、PDF、CSV、JSON、JSON Lines（`.ndjson`／`.jsonl`）、YAML、HTML、代码和其他仓库附件；CSV 单元格只包含仓库内 Markdown 链接时，可以直接打开对应文档。
- 把选中内容作为引用粘贴，保留源文件行号与来源，并预留一个可以直接输入提示词的空白段落。
- 克制的文件操作，避免把 OpenGlance 变成通用文件管理器或 IDE。

## 同一个仓库不要求所有人使用同一种 App

每个参与者可以继续使用适合自己的界面，而文件始终保持共享：

| 参与者 | 主要界面 | 与仓库的关系 |
| --- | --- | --- |
| AI Agent | Codex、Claude、Copilot 或其他 Agent 客户端 | 直接读取和修改文件 |
| 阅读或做范围明确修改的团队成员 | **OpenGlance** | 通过面向文档的桌面界面使用仓库 |
| 开发者和仓库维护者 | IDE、终端和 Git 工具 | 完整控制分支、diff、冲突、代码和自动化 |

## 下载

普通用户使用已安装的 OpenGlance 桌面 App。首次打开时选择本机 Git 仓库；之后 App 会恢复已打开仓库和各
worktree 的工作台状态。官方公开安装包由 [OpenGlance 下载页](https://gitleaf.mangofuture.com/download?lang=zh-CN) 提供；
公司内部正式包通过公司发布渠道提供，不会出现在公开下载页。

Mango Future 官方 macOS 安装包使用 Developer ID 签名和公证。Windows 当前是明确标记的 unsigned Preview；
下载后应核对发布版本的 SHA-256，具体见 [Windows Preview](docs/windows-portable-guide.md)。

### 从源码运行

从源码运行需要 Node.js 22 或更高版本，并且本机已安装 Git：

```bash
npm ci
npm run desktop -- --repo /path/to/docs-repo
```

[从源码构建指南](docs/build-from-source.md)说明了依赖、打包方式、Community Build 身份，以及它与
Mango Future 官方发行版的区别。[公开使用指南 Demo 仓库](https://github.com/openglance/openglance-example-knowledge-base)
提供了一组可以直接打开的 Markdown／MDX 内容。

CLI／Web 入口主要用于本机开发和浏览器工作台：

```bash
npm start -- /path/to/docs-repo/README.md
npm start -- /path/to/docs-repo/README.md --no-open
```

桌面版和 CLI／Web 服务都只监听 localhost。人工安装的 `OpenGlance dev` 会替换同一个已安装 App，并与
正式版共用真实 Profile，因此正常工作的仓库和界面状态会保留。全新安装使用 `OpenGlance.app`；维护者安装
开发构建时，会在规范副本成功写入后迁移已有的 `Git Leaf.app`，避免 macOS 同时保留重复的 App。只有 Agent 自动化 smoke
使用隔离的一次性副本，不能写入真实 Profile。具体命令和安全边界见 [AGENTS.md](AGENTS.md)。

## 构建身份与隐私

| 构建 | 更新轨道 | 新安装默认使用统计 |
| --- | --- | --- |
| 社区或本机源码构建 | 关闭 | 关闭 |
| 人工安装的 `OpenGlance dev` | 只可单向切换到 `internal-stable` | dev 运行时关闭 |
| Mango Future 官方公开包 | `stable` | 关闭 |
| Mango Future 官方内部包 | `internal-stable` | 开启 |

Settings 会显示当前是“社区构建”“官方公开构建”“官方内部构建”还是“开发构建”，并显示实际使用统计状态。
官方仍然只有公开版和内部版两个发行轨道，macOS 也仍然只有两个 Bundle ID。安装的源码开发构建不是第三种
发行版：只有最新官方内部包的版本号严格高于本地开发版本时才会进入切换流程；验证通过的安装包会自动下载，
安装仍等待用户正常退出或点击“立即重启”。同版本或更低版本都视为当前已是最新。没有开发标记的 Community
包仍不会连接官方更新源。

官方构建发现新版本后会自动下载并准备。准备完成前，侧边栏只显示进度，不再提供下载按钮；准备完成后显示
“立即重启”，正常退出 OpenGlance 也会安装。如果安装前又发现了更新版本，新包会替换原先等待安装的包；更新
缓存中最多保留一个已完整下载但尚未安装的版本。

通常，构建包里的默认值只用于首次初始化；普通更新不会覆盖 userData 中已经存在的
`usageAnalyticsEnabled`。只有从源码开发构建切换到内部正式包是受限例外：安装开始前会清除开发构建写入的
初始化值，让目标内部包应用它自身打包的“开启”默认值；此后的内部版更新继续保留该设置。

使用统计只在公司管理的官方构建且本机设置已启用时运行。它不发送仓库名、路径、文件名、搜索词、文档内容或
Git 身份。完整事件语义与禁止推断项见英文技术文档
[Usage analytics specification](docs/app-usage-analytics-spec.md)。

## 产品边界

- OpenGlance 是本地工具，不提供账号、SSO、多人协同编辑或公网文档站。
- OpenGlance 只编辑 Markdown／MDX 的正文；其他仓库文件保持只读或由系统应用打开，但仍可在目录树中重命名
  或删除普通文件。
- 文件树的显示偏好不改变 Git 文件发现、状态统计、同步或提交范围。
- 正常分支都可以编辑；Detached worktree 在第一次实际写入前自动创建保护分支。
- Source／Live 实时写回、localhost 绑定、MDX-lite 白名单、分享 revision 门禁和 Git 历史安全不是个人设置。
- 公开 `/open`、`/share` 页面由 Mango Future 托管，只承担打开和分享中转。它们会接收仓库标识和文档元数据，
  不接收 Git 凭证或文档正文；完整说明见[托管链接的元数据与隐私](docs/hosted-links.zh-CN.md)。
- HTTPS 文档链接为 Codex 等支持预览的客户端提供标题、仓库路径与小图标。生成器默认带上文档标题；
  `--no-preview-title` 可省略标题，预览不传正文或 AI 摘要。

## 开发验证

```bash
npm test
npm run test:all
npm run test:ci:mac
npm run test:ci:win
```

修改 `src/client/source-editor.mjs` 或 `src/client/mermaid-renderer.mjs` 后，还必须运行
`npm run build:client`，并提交 `public/` 中对应发生变化的编辑器或 Mermaid 生成文件。贡献流程见
[CONTRIBUTING.md](CONTRIBUTING.md)，技术文档入口见 [docs/README.md](docs/README.md)，UI 专项验收与
userData 隔离要求见 [AGENTS.md](AGENTS.md)。

## License

源码使用 [Apache License 2.0](LICENSE)。该许可证不授予将社区构建描述为 Mango Future 官方发行版的权利；
官方身份以公司代码签名、官方下载渠道、checksum、tag 和公开 commit 的对应关系为准。
