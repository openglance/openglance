# 托管的 `/open` 与 `/share` 链接

[English](hosted-links.md) | 简体中文

OpenGlance 文档始终保存在本机 Git 仓库中。OpenGlance 生成的公开 HTTPS 链接使用 Mango Future 托管在
`gitleaf.mangofuture.com` 的轻量中转服务，让浏览器和聊天客户端可以启动已安装的桌面 App。

这个服务只负责协议中转，不是云端仓库、知识库或上下文服务。它不会克隆仓库、读取文档正文、授予 GitHub
权限，也不会把私有仓库变成公开仓库。

OpenGlance 自己复制的新链接统一使用规范的 `openglance://`。在已安装客户端迁移期间，托管页面会启动等价的
`git-leaf://` 兼容链接，因为 Git Leaf 1.x 与 OpenGlance 都注册了这个协议。这不会改变
用户看到的产品名称，也不会改变 OpenGlance 复制的新链接格式。

## `/open`

普通文档链接可能传输以下 URL 字段：

| 字段 | 含义 |
| --- | --- |
| `repo` | 小写的 GitHub `owner/repository` 身份 |
| `path` | 仓库相对 `.md` 或 `.mdx` 路径 |
| `worktree` | 可选的 16 位本机 worktree ID，仅用于同一台机器精确打开 |

Worktree ID 由规范化的本机路径派生，但不包含绝对路径，也不能在另一台电脑上使用。不带仓库参数的链接只启动或聚焦 OpenGlance。

不带 `worktree` 时，应用会在匹配仓库的主工作目录中打开文档，即使上次使用的是 linked worktree。
带 `worktree` 时，只打开该 ID 对应的可用本机工作目录；目录缺失会明确报错。文档不存在时，错误会显示在
所选工作目录内；`/open` 不会搜索其他 worktree，也不会为打开链接而同步仓库。

## `/share`

版本 1 的分享链接可能传输：

| 字段 | 含义 |
| --- | --- |
| `v` | 协议版本，当前为 `1` |
| `repo` | 小写的 GitHub `owner/repository` 身份 |
| `path` | 仓库相对 `.md` 或 `.mdx` 路径 |
| `rev` | 必须已经位于 `origin/main` 的完整 Git commit |
| `title` | 可选的文档标题，最多 100 个字符，用于链接预览 |

OpenGlance 已不再发送文档摘要或 `ai_snippet`。托管端只为兼容旧链接继续接受有长度限制的历史 `snippet` 参数。

收到链接的人可以看到仓库身份、路径、revision 和可选标题，因此不要在路径或标题中写入敏感信息。链接不包含文档正文、
本机绝对路径、Git 凭据、访问令牌、diff、剪贴板内容或发送者的 Git 身份。

## 中转状态

服务会为每次浏览器中转创建一个随机一次性 ID，只在内存中保存 pending、received、opened、cancelled 或 failed
等简短状态。记录在十分钟后过期，不会成为持久化仓库或文档记录。

浏览器页面轮询该状态，用于区分 App 真正打开和浏览器只是失去焦点。桌面 App 会在本机 Electron userData 下的
`deep-link.log` 中写入自己的中转诊断信息。

## 常规 HTTPS 元数据

与普通网页请求一样，Mango Future 的托管系统可能收到请求时间、来源 IP、User-Agent、请求 URL（包括上述字段）
以及浏览器提供的 HTTP Header。按照统计与隐私规范，反向代理访问日志最多保留七天。

中转响应使用 `Cache-Control: no-store`、严格的 Content Security Policy 和
`Referrer-Policy: no-referrer`。

## 中转之后

已安装的 App 会在用户已经打开过的本机仓库中匹配 `repo`。必要时，它会请用户选择本机目录并核对 GitHub origin。
对于分享链接，App 使用该仓库已有的本机 Git 凭据 fetch `origin/main` 并验证 `rev`。

Mango Future 的中转服务不执行 Git fetch，也不会收到 Git 凭据。分享链接不会授予接收者原本不具备的仓库权限。

## 下载入口独立

`/open` 和 `/share` 不提供安装包。普通[下载页](https://gitleaf.mangofuture.com/download?lang=zh-CN)
不会触发任何桌面协议，只展示明确的公开发布制品。
