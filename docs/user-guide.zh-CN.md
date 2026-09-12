---
last_updated: 2026-08-27
---

# OpenGlance 用户手册

[English](user-guide.md) | 简体中文

OpenGlance 是供人使用的桌面 App，用来打开和维护团队与 AI Agent 共享的 Git 上下文仓库。它直接打开已经
存在于本机的仓库，不会把仓库上传或复制到另一个知识服务。

这份手册面向需要理解和维护仓库、但不希望把 Git、Markdown 或开发工具变成日常工作方式的用户。截图与
动手示例使用公开的
[OpenGlance 使用指南 Demo 仓库](https://github.com/openglance/openglance-example-knowledge-base)。

## 从这里开始

1. 从[公开下载页](https://gitleaf.mangofuture.com/download?lang=zh-CN)安装 OpenGlance，或者使用
   [Community Build](build-from-source.md)。
2. 确认共享 Git 仓库已经作为一个本机文件夹存在。仓库维护者可以提前准备好，也可以克隆公开示例：

   ```bash
   git clone https://github.com/openglance/openglance-example-knowledge-base.git
   ```

3. 打开 OpenGlance，选择仓库文件夹。
4. 通过目录树或搜索找到文档。OpenGlance 默认用 Preview 打开 Markdown 和 MDX。
5. 需要修改时再切换到 Live 或 Source。OpenGlance 会直接写入原文件并自动保存。

OpenGlance 没有单独的“保存”按钮。自动保存只代表修改已经写入本机；在发布以前，它仍然是尚未共享的本地
Git 改动。

## 认识 App 界面

![OpenGlance 展示仓库目录树、文档导航和易读的 Preview](assets/user-guide/browse-and-read.jpg)

App 界面主要分为四个区域：

| 区域 | 用途 |
| --- | --- |
| 顶栏 | 已打开文档的 Tab、Preview／Source／Live、分享和文档操作 |
| 左侧栏 | 仓库目录、搜索、All／Favorites／Sync 和 Agent Context |
| 文档导航 | 当前文档的 H1–H5 标题目录，自动压缩跳过的级别；需要更多空间时可以隐藏 |
| 主区域 | 当前文档、编辑器或只读文件预览 |

下次启动时，OpenGlance 会恢复已经打开的仓库及其工作状态，包括 Tab、目录展开和阅读位置。

Markdown／MDX 使用非中文源文件名，并且 Frontmatter `title` 或首个一级标题提供独立标题时，紧凑 Tab
会在略微淡化的第一行保留文件名，并把文档标题作为第二行主要信息；其他文件仍为单行。悬停 Tab 可以查看
完整人类可读标题和仓库相对路径。即使目录树设置为“仅显示文件名”，Tab 仍保持可读；持久化的 Tab 身份和
导航历史继续使用真实路径。

## 查找和阅读上下文

### 从目录树开始

目录结构是理解文档归属的主要方式。像使用普通文件浏览器一样展开文件夹、选择文件即可。

每层目录都先显示文件夹，再显示文件；组内按真实名称自然排序，数字按数值比较，例如 `2` 在 `10` 前、
`chapter2.md` 在 `chapter10.md` 前。以 `_` 开头的文件夹排在其他文件夹之后、文件之前。收藏列表顶层保留保存的顺序。

Markdown／MDX 文件名不含汉字时，OpenGlance 会在第一行保留真实文件名，并在 Frontmatter `title` 或
首个一级标题提供不同标题时，将该标题显示在第二行。包含汉字的文件名以及没有不同标题的文档仍保持单行。
标题作为主要视觉信息，文件名略微淡化但仍清晰可读。第二行默认开启；如需紧凑目录树，可在“设置与帮助
→ 文件与目录 → 仅显示文件名”中关闭。标题只用于展示；排序、链接、文件操作和 Git 始终使用真实文件名
与路径。

左侧栏有三个视图：

- **All** 显示普通仓库目录树。
- **Favorites** 集中放置经常返回的文件夹和 Markdown／MDX 文档。可以从右键菜单收藏，也可以使用当前
  文档旁的星标，或在 macOS 按 `Command+D`、在 Windows 按 `Ctrl+D`。嵌套收藏的文件夹第一行仍是目录名，
  第二行显示其父级仓库相对路径，因此同名目录可以区分；仓库根下的文件夹，以及展开收藏后看到的子目录，
  仍保持单行。完整仓库目录树成功刷新后，OpenGlance 会自动取消路径已经不存在的收藏；文件在外部改名后，
  可以在新位置重新收藏。
- **Sync** 显示远端状态和全部尚未发布的本地文件。

在 **All**、搜索筛选结果、**Favorites** 和 **Sync** 中，文件使用同一套 Tab 规则。直接点击文件，会在
当前活动 Tab 中打开；macOS 按住 Command 点击，或 Windows 按住 Ctrl 点击，会在新 Tab 中打开并立即
切换过去。键盘用户聚焦文件后，也可以在 macOS 按 `Command+Enter`，或在 Windows 按 `Ctrl+Enter`
执行同一个新建 Tab 操作。单独按住 Shift 点击，暂不提供特殊的多选行为。

文件右键菜单还可以复制所选文件的仓库相对路径；仓库具有可识别的 GitHub `origin` 时，也可以准确打开
这个文件对应的 GitHub 源文件页面。

设置中可以选择“内容文件”或“全部仓库文件”。内容模式默认保留 Markdown、MDX、HTML、图片和 PDF；
其他文件在被打开、发生改动或被搜索命中时出现。这个偏好只改变目录树显示，绝不会改变 OpenGlance 发现、
同步、提交或推送的范围。

### 不必为了搜索而重组仓库

使用目录树上方的搜索框；也可以在 macOS 按 `Command+K`，在 Windows 按 `Ctrl+K`。空格分隔的词会
组合匹配，例如 `spring plan` 只保留同时匹配两个词的项目。搜索会临时显露到达结果所需的文件夹，但不会
永久覆盖你手动设置的目录展开状态。它匹配文件夹名、文件名、目录树中展示的文档标题，以及仓库提供的
搜索摘要，并不是文档正文全文搜索。关闭文档标题展示后，被隐藏的标题也不会继续作为不可见搜索字段。
搜索摘要需要展开时，浮窗会在完整高亮摘要上方继续保留文件名和标题，而不是用摘要替换它们。

### 带着来源阅读

Preview 呈现文档，同时保留原文件行号。右侧文档导航跟随 H1–H5 标题；唯一且位于开头的 H1 作为
文档标题，不重复出现在导航中。跳过的标题级别不会产生空缩进：例如文档直接使用 H3、H5 时，
导航中仍显示为连续的两级。H6 可以继续出现在正文中，但不会进入文档导航。普通内部链接会留在
OpenGlance 内打开；在 macOS 使用 Command-click，在 Windows 使用 Ctrl-click，可以把链接打开到另一个
Tab。

这些源文件行号也能在需要提问或纠正时，准确告诉 AI Agent 内容来自哪里。

### 快速回到尚未发布的编辑

当前 Markdown／MDX 文件与最后一次提交的版本不同时，OpenGlance 会在 Preview、Source 和 Live 中显示
一条轻量的编辑轨迹：

- 当前新增或替换的正文与对应行号使用低干扰的暖色高亮；
- 每个受影响章节在文档导航中铺满整行底色，点击区域和跳转到原章节的行为保持不变；
- 首个可见导航标题以前的改动归入“文档顶部”，点击后返回文档开头；
- 打开其他文档再返回时，OpenGlance 会从仓库重新生成同样的提示，不需要维护另一份草稿标记。

只有文档包含删除内容时，右上角才会出现紧凑的“显示删除内容”图标开关，而且默认关闭。开启后，图标
右上角会显示一个实心状态点，在不提升为主要操作的同时明确区分开／关。被删除的片段和整行只在原有
文字样式上增加删除线，不另加文字色或底色。原有单列当前文档行号完全不变，整行删除只使用一个不带
数字的 `−` 标记。这些提示不会把已经删除的文字重新写入文件。

这里的提交版本指 `HEAD`，当前侧指本机磁盘上的文件，因此已暂存和未暂存的本地编辑都会纳入提示。
尚未跟踪的新文档没有可比较的提交版本，会按普通文档展示，不会把全文标成新增；Sync 仍会显示它尚未
发布。文档首次提交以后，后续编辑才显示普通的改动提示。这个功能有意不做完整的 Git diff：它不显示
hunk，也不提供暂存、丢弃或冲突解决。Sync 仍负责展示全部尚未发布的文件；文档内提示只帮助人快速
定位并继续一次编辑。

## 选择合适的编辑方式

OpenGlance 始终编辑原来的 Markdown 或 MDX 文件。三种模式只是同一份源文件的不同界面：

| 模式 | 适合什么时候使用 |
| --- | --- |
| **Preview** | 阅读、跟随链接，或选择带来源的上下文 |
| **Live** | 做日常的小修改，同时让标题、列表、链接和其他结构保持易读 |
| **Source** | 需要精确控制 Markdown、MDX、Frontmatter 或结构化数据，并同时查看 Preview |

![Live 在直接编辑原文件的同时保持文档易读](assets/user-guide/live-editor.jpg)

做一个小修正时，Live 通常是最合适的选择。它不是第二份富文本文件：文字仍然属于原仓库，Agent 和其他
工具仍能直接读取。

Live 为受控图片、链接、Frontmatter 字段、原生表格和 MDX-lite 组件采用同一套上下文编辑方式。同一时间
只激活一个对象，紧凑的工具栏固定在对象上方，可通过关闭按钮、Esc 或选择其他对象关闭。单击 MDX-lite
组件时会保持视觉呈现；无论使用内联还是外部数据，都只通过 `</>` 进入这个文档里的完整组件源码。Preview
不显示 MDX-lite 编辑工具栏。

在原生 Markdown 表格中，单击单元格只编辑该单元格的源码；当前单元格仍在编辑时，也可以从其中开始
拖动，进入相邻单元格后会按任意方向选中起点与终点围成的矩形区域。格式工具栏固定在表格上方，可为
整个选区设置粗体、斜体、删除线、前景色或文字后方的高亮色；对齐按钮会调整选区涉及的整列，清除文字
格式不会改变列对齐。两个固定色板只在点开时展开，工具栏可通过关闭按钮或 Esc 关闭。同一列纵向选中
两个或更多单元格后，列顶部会显示拖动把手；拖动它会移动整列，不要求先选满整列。这些操作只在 Live
中提供，Preview 仍然只读。写回内容仍是原生管道表格、标准 Markdown 标记、分隔行对齐和 Obsidian
可识别的受控内联样式，不会变成 OpenGlance 私有的表格格式。

![Source 同时显示准确的 Markdown 和呈现结果](assets/user-guide/source-editor.jpg)

当 Agent 写入了一段需要精确检查的语法，或者需要调整 Frontmatter 和结构化数据时，可以使用 Source。
Source 和 Live 都会自动写入本机工作目录。

OpenGlance 内只有 Markdown 和 MDX 可以编辑。其他仓库文件提供只读预览，或交给系统应用打开。普通只读
文件会把目录树整行宽度留给文件名；打开后，顶部模式区域会在 Preview 旁显示“只读”。目录树只为会改变
或推迟打开结果的状态保留标签，例如“检测”“不支持”和“缺失”。

### 不离开文档直接阅读 Mermaid 图

标准的 `mermaid` 围栏仍是普通 Markdown 源码，并会在 Preview 中本地渲染。在 Live 中，光标离开完整
围栏后显示图形；把光标移入该区块，就会重新编辑原始语法。

用“适应宽度”返回当前视图的完整图形，用 `+`、`−` 缩放；放大后可拖动画布。`</>` 在图形和完全相同的
Mermaid 源码之间切换。这些控件只是临时阅读状态，不会改写文件。切换深色或浅色外观时，图形会按当前
主题重新渲染。语法无效或内容过大时，卡片会显示错误，同时保留 `</>` 供检查源码。

对于复杂 `flowchart`，“智能阅读”把从上到下作为文档阅读方向。横向源码只有在节点、关系和分组数量与
原图一致、节点不重叠时，才会以纵向方式呈现；已有纵向图绝不会被自动旋转成横向。完整纵向图始终可见。
OpenGlance 不会用节点列表或自动生成的一跳小图替换它；需要参照作者原始布局时，可关闭“智能阅读”。

这个决定只使用图的结构和实际几何测量，不读取标签含义，也没有业务专用规则。作者显式选择的 Mermaid
布局不会被覆盖。方向明确的过程可使用自动布局的 `flowchart`；位置本身有含义时，应显式选择布局或使用
`block-beta`。总览标签保持简短；如果概念本身仍然过多，再使用作者明确指定的分组或把细节拆入后续图。

## Agent 直接读数据，人直接看图表

`.mdx` 文档可以把图表序列、表格行、指标、时间线、决策和流程保存为普通 CSV、TSV、JSON 或 Markdown
文本。AI Agent 能直接读取和修改源数据；OpenGlance 则把同一份源文件呈现为供人理解的视觉内容。

长期报表也可以把完整数据放在文档旁边的 CSV、TSV 或 JSON 文件里，再用 `.dataset.json` 说明源数据
粒度和口径。报表作者为 `Chart` 或 `DataTable` 指定日期区间后，读者只能选择该源数据可靠支持的视图：
日数据可切换日、周、月、季度；周数据可以按每周第四天归属自然月或季度，但不会虚构日数据。按钮只
改变当前视图，不会改写报表或源数据；缺失源数据周期、不完整展示周期和被省略的不完整边界周期都会
被明确提示。这些区间控件属于组件的呈现内容，不是 Live 编辑工具栏，也不会选中组件。
如果表格或 BI 导出包含展示辅助列、重复表头或多行表头，sidecar 可以显式选择所需物理列，原始文件仍
保持不变。

![OpenGlance 把 MDX 文档内的结构化数据呈现为图表](assets/user-guide/mdx-visuals.png)

这样可以避免截图或另一个仪表盘成为重要数据唯一的存在位置。Preview 呈现结果，Source 和 Live 仍然
编辑原文件。OpenGlance 只接受一组受控组件，不会运行任意 JSX、JavaScript、`import` 或文档脚本。

负责制作这类组件的仓库维护者可以查看英文技术文档
[MDX-lite reference](mdx-lite-guide.md)。普通读者只需要打开文档、使用呈现结果。

## 把准确上下文交给 AI Agent

根据问题只涉及当前文档，还是分散在多个文档中，可以使用两种不同的复制方式。

### 单个文档：直接复制选中的行

如果只是对眼前文档中的几行提问：

1. 在 Preview、Source 或 Live 中选中相关源文件行。
2. 点击“复制内容”。
3. 直接粘贴到 Codex、Claude 或其他 Agent 工具。

例如，选中 `demos/agent-context-and-sync.md` 的第 16–17 行，复制结果是：

````markdown
> 16 | OpenGlance opens a local Git repository and presents it as a readable workspace. The repository remains
> 17 | the shared source of truth. OpenGlance does not upload the content or create a separate hosted copy.

Source: demos/agent-context-and-sync.md:16-17
````

其中已经包含仓库相对路径、选中行范围、原始行号和原始 Markdown。选中内容会成为引用，末尾的来源说明
位于引用之外；复制结果还会在最后预留一个空白段落，粘贴后可以直接输入自己的提示词，也不必先放进
Agent Context。

### 多个片段：整理成 Agent Context

如果一个任务需要同时参考一个或多个文件中的多个片段：

1. 在 Preview、Source 或 Live 中选择带来源的行。
2. 点击“加入上下文”。
3. 继续加入每一段相关内容；需要时再打开其他文档。
4. 打开左侧栏底部的 Agent Context，检查或移除选择内容。
5. 复制整个集合，粘贴到 Codex、Claude 或其他 Agent 工具。

![在 Agent Context 中检查多个带来源的片段](assets/user-guide/agent-context.jpg)

包含两个片段时，复制结果会是这样的结构：

````markdown
# Agent Context

Repository: openglance-example-knowledge-base
Worktree: main checkout
Branch: main
Revision: 0123456789abcdef

> 16 | OpenGlance opens a local Git repository and presents it as a readable workspace. The repository remains
> 17 | the shared source of truth. OpenGlance does not upload the content or create a separate hosted copy.

Source: demos/agent-context-and-sync.md:L16-L17

> 24 | People use Preview, Live, and Source to read, inspect, and make focused edits. Agents and developers
> 25 | work directly with the same repository through Git and their normal tools.

Source: demos/agent-context-and-sync.md:L24-L25
````

仓库、worktree、分支和 revision 只在顶部出现一次；之后每一段内容都是引用，并在引用外带有文件路径和
行号范围。上面的元数据只是示例，OpenGlance 实际复制的是当前工作目录的真实信息。最后一个来源说明之后，
同样会预留一个可以直接输入提示词的空白段落。

Agent Context 是按仓库和 worktree 隔离的临时会话状态。它可以收集当前工作目录中的多个文件，但不能跨
仓库，也不是长期内容数据库，更不会自动发送给任何 AI 服务商。

## 检查本地和远端改动

OpenGlance 会在打开仓库时检查一次 Git 远端，之后按“设置 → 常规”中的频率继续检查。默认值为
10 分钟，可选 1、2、5、10、30、60、120 分钟：

- 本机工作目录干净、只是落后于远端时，OpenGlance 会安全地自动快进。
- 本地已有编辑时，OpenGlance 会自动应用能够无冲突合并的远端更新，全部本地修改仍保持未提交。
- 如果更新涉及当前聚焦的 Source 或 Live 文档，OpenGlance 会在后台完成准备，显示“远端更新待合并”，
  并在 OpenGlance 仍处于前台、焦点离开编辑区域后自动应用；切换到其他 App 会继续保持待合并。
  继续输入会让准备结果失效，而不会丢失输入。
- 如果受保护的自动合并无法安全完成，界面才会显示“合并远端修改”供用户重试；真正发生冲突时，
  真实工作目录保持不变。
- “同步并发布”会先整合必要的远端更新，再提交并推送**整个仓库的全部本地改动**。

修改频率后，下一次检查会立即按新间隔重新计时；提交和推送始终不会变成后台自动操作。

![Sync 显示一个尚未发布的文件和明确的“同步并发布”操作](assets/user-guide/sync-and-publish.jpg)

Sync 采用仓库级操作。发布前，需要确认列出的每个文件都应该进入下一份共享版本。可以选填“本次修改摘要”：
第一行作为提交标题，后续行作为正文。发布失败时保留草稿，成功后清空。
分享尚未发布的文档时，“同步并复制”也会使用这份摘要。

留空时，App 在本地根据改动类型和文档标题生成说明。对已有 Markdown／MDX 文档，会比较提交前版本与
本次待提交版本，只提取新增或修改的 `change_log.summary`。未变化或仅调整顺序的历史记录不会重复使用，
也不会只按最新日期取一条。新文档使用标题，因为其中的历史记录可能来自其他文件。此过程不需要 AI 服务，
不会上传文档内容。过长摘要会缩短，大批量改动只展示部分详情；完整文件清单仍由 Git 保留。

外部 AI Agent 修改同一个本机工作目录后，这些文件会像其他本地修改一样出现在 Sync。打开相关文档即可
阅读当前结果。OpenGlance 目前显示改动文件和当前文档内容，不提供完整的逐行 Diff 审核，也不会判断一处
改动来自哪个 Agent。

如果本地和远端历史已经分叉、出现冲突，或另一个 Git 操作正在进行，OpenGlance 会停止，不会改写历史，也
不会把未解决的合并留在真实工作目录。需要开发者级 Git 修复时，失败界面可以提供一段交给 AI Agent 的
提示词。

## 用 URL 打开本机对应文档

在线文档让协作显得简单，其中一个重要原因是：一个 URL 就能打开正确的文档。OpenGlance 保留这种点击即达
的便利，但文件与事实源仍然位于本地优先的 Git 仓库中。

Agent 把文档交给人检查时，完整流程是：

1. 仓库提示词要求 Agent 为需要检查的 Markdown／MDX 文件运行可信的链接生成器。
2. Agent 在最终回复中给出 HTTPS **Open in OpenGlance** 链接，而不是只给一个本机路径。
3. 浏览器打开 Mango Future 托管的 `/open` 中转页；第一次使用时，浏览器可能询问是否允许启动
   OpenGlance。
4. OpenGlance 根据 GitHub 仓库标识匹配本机仓库，必要时请用户选择本机目录，然后在主工作目录打开指定文档。
   如果链接来自 linked worktree，则在同一台机器上选择那个准确的 worktree；目录缺失时会明确报错。

安装 OpenGlance，并让公开示例仓库在本机可用后，可以直接体验完整中转：

Open in OpenGlance：
[OpenGlance 使用指南 Demo](https://gitleaf.mangofuture.com/open?repo=openglance%2Fopenglance-example-knowledge-base&path=guide%2Fuser-guide.zh-CN.md)

### 让 Agent 在交付时返回链接

本仓库提供了一份
[可以直接复制使用的独立生成器](../tools/generate-openglance-open-link.mjs)，只依赖 Node.js 和 Git。
内容仓库可以把它放在同一路径，再在 `AGENTS.md` 等仓库提示文件中加入下面的通用写法：

```markdown
## OpenGlance 文档预览链接

最终回复需要让用户预览 Markdown 或 MDX 文件时，运行仓库自带的 OpenGlance 链接生成器：

node "$(git rev-parse --show-toplevel)/tools/generate-openglance-open-link.mjs" \
  --repo-root "$(git rev-parse --show-toplevel)" \
  --file "<仓库相对路径.md-or-mdx>"

把生成器返回的 HTTPS URL 原样放进 Markdown 链接：
`Open in OpenGlance: [<文档标题>](<返回的 HTTPS URL>)`

不要只返回本机绝对路径，也不要手工拼接 `/open`、`/share` 或 `openglance://` URL。`/open` 只用于本机
定位和预览，不证明文件已经发布。需要把链接发送给其他人时，先把文档发布到 `main`，再使用 OpenGlance
的“复制分享链接”。
```

需要注意这些边界：

- 仓库需要有可识别的 GitHub `origin`。URL 会标识仓库和仓库内 `.md`／`.mdx` 相对路径，但不包含
  文档正文或 Git 凭证。
- 从主工作目录生成的 `/open` 链接可以在另一份有权限的本机 checkout 中使用；linked worktree 生成的
  链接会包含本机 worktree ID，只能在创建它的机器上使用。
- 链接不会自动克隆仓库，也不会授予访问权限；接收方必须原本就有权使用一份本机 checkout。
- 打开 `/open` 不会同步、发布或验证 revision。需要把已发布结果交给其他人时，应使用 App 内的分享流程。

| 链接 | 最适合的用途 | 它保证什么 |
| --- | --- | --- |
| `/open` | Agent 返回本机预览或导航目标 | 打开匹配的本机文件；不保证已经发布，也不保证 revision |
| `/share` | 把已经发布的文档发送给其他人 | 复制前携带已经在 `origin/main` 复核的 revision |

## 分享已经发布的文档

“复制分享链接”用于分享主工作目录 `main` 上的 Markdown／MDX 文档。文档尚未发布时，OpenGlance 会先
询问；确认“同步并复制”后，它会提交并推送仓库、复核 `origin/main` 上的 revision，再复制版本化链接。

需要注意这些边界：

- 链接不包含文档正文、Git 凭证或本机绝对路径。
- 链接会暴露 GitHub 仓库标识、仓库相对路径、revision 和可选标题。
- 链接不会给接收方授予私有仓库权限。
- 接收方仍然需要一个自己原本就有权限使用的本机 checkout。

HTTPS 中转服务由 Mango Future 托管。在敏感仓库路径或标题中使用前，请阅读
[托管链接的元数据与隐私](hosted-links.zh-CN.md)。

## 使用多个仓库和 worktree

OpenGlance 可以保持多个仓库处于已打开状态。保存的仓库顺序会保持稳定，直到你主动调整；每个仓库分别恢复
自己的 Tab 和导航状态。

点击当前仓库名称旁的仓库按钮，或在 macOS 按 `Command+O`、在 Windows 按 `Ctrl+O`，会打开位于窗口
中央的仓库面板。输入文字可以筛选这个顺序稳定的仓库列表，也可以使用方向键与 `Enter`，或直接点击仓库。
面板打开期间，macOS 的 `Command+1` 至 `Command+9`（Windows 的 `Ctrl+1` 至 `Ctrl+9`）会选择面板中
标出相应数字的仓库；`Command+0` 或 `Ctrl+0` 用于打开另一个本机 Git 仓库。关闭面板后，这些数字键会
恢复原有的文档 Tab 和缩放行为。

拖动仓库行左侧的手柄即可上下调整并保存顺序；手柄获得焦点时，也可以使用上下方向键移动。面板中的数字
快捷键会立即按照新顺序重新编号。

仓库行的操作菜单可以把仓库移出 OpenGlance。这个操作只会将它从已打开仓库列表中移除，不会删除本机目录、
Git 文件、分支或未发布修改；以后重新打开同一个仓库时，OpenGlance 会继续恢复已保存的工作区状态和收藏。

请求的文档缺失或无法读取时，错误会显示在工作台中，仍可从文件树打开其他文件，或照常切换仓库。如果仓库
或 worktree 本身已不可用，首页会同时显示错误和“已打开的仓库”，点击仍可用的仓库即可进入，无需重新查找目录。

一个仓库存在多个 Git worktree 时，worktree 选择器会取代侧栏头部重复的仓库名称，仓库面板按钮仍保持
独立。每个 worktree 分别保存 Tab、目录状态、阅读位置和本地改动；收藏在同一个仓库内共享。普通用户通常
应留在主工作目录，除非仓库维护者或 AI Agent 明确要求使用另一个 worktree。

如果 worktree 当前没有分支，OpenGlance 会在第一次真正写入前创建保护分支，不会让修改停留在 Detached
HEAD。

## 打开其他仓库文件

OpenGlance 保持以文档为中心，但仍然让周边证据可以被查看：

| 文件 | OpenGlance 的处理方式 |
| --- | --- |
| 图片和 PDF | 只读视觉预览 |
| HTML | 只读效果预览 |
| CSV | 只读表格预览；单元格只包含仓库内 Markdown 链接时可直接打开对应文档 |
| JSON | 格式化树；解析失败时回退为文本 |
| JSON Lines（`.ndjson`、`.jsonl`） | 每行一棵可折叠、自动换行的 JSON 树；无效行保留原文 |
| YAML、文本、代码和配置 | 只读文本或代码预览 |
| 暂不支持的附件 | 条件允许时交给合适的系统应用打开 |

需要浏览普通内容范围以外的文件时，切换到“全部仓库文件”。

## 设置、帮助和快捷键

在 macOS 使用 `Command+,`，在 Windows 使用 `Ctrl+,` 打开“设置与帮助”。其中可以调整：

- 界面语言：跟随系统、英语或简体中文；
- 明亮或深色外观；
- 文档字体和字号；
- “内容文件”或“全部仓库文件”；
- 当前发行版提供的构建、更新和使用统计设置。

官方构建发现有效的新版本后会自动下载。左下角的更新卡片在准备期间只显示进度，不再提供下载按钮；安装包
准备完成后才显示“立即重启”，正常退出也会完成安装。如果安装前又出现更新版本，新包会替换等待中的旧包，
更新缓存中最多保留一个已完整下载但尚未安装的版本。

同一页面还包含 OpenGlance 帮助、文件类型支持、环境与仓库状态，以及完整快捷键列表。在 macOS 使用
`Command+?`，在 Windows 使用 `Ctrl+?` 可以直接打开快捷键。

## 什么时候应该换用其他工具

当团队和 AI Agent 共享同一个 Git 仓库，而一部分对内容负责的人不希望采用开发者工作流时，OpenGlance
才是合适的人类界面。

详细 Diff、选择性暂存、创建分支、Rebase、解决冲突、重构代码和仓库管理，应使用 IDE 或 Git 客户端；
大范围修改和开发者级修复，应交给外部 AI Agent。OpenGlance 保持专注：让人能够阅读、检查、提供准确
上下文，并对同一批文件做范围明确的修正。

产品范围、下载方式和构建身份见 [OpenGlance README](../README.zh-CN.md)。
