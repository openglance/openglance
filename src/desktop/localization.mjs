import {
  createTranslator,
  resolveLocalePreference,
} from "../../public/i18n.js";

export const DESKTOP_MESSAGES = Object.freeze({
  en: Object.freeze({
    "common.unknown": "Unknown",
    "common.ok": "OK",
    "common.cancel": "Cancel",
    "common.close": "Close",
    "common.retry": "Retry",
    "common.count": "{count}",

    "menu.about": "About {app}",
    "menu.checkUpdates": "Check for Updates...",
    "menu.settings": "Settings...",
    "menu.hide": "Hide {app}",
    "menu.hideOthers": "Hide Others",
    "menu.showAll": "Show All",
    "menu.quit": "Quit {app}",
    "menu.file": "File",
    "menu.openRepository": "Open Repository...",
    "menu.repositories": "Repositories...",
    "menu.previousRepository": "Previous Repository",
    "menu.nextRepository": "Next Repository",
    "menu.exportPdf": "Export PDF...",
    "menu.closeRepository": "Close Repository",
    "menu.removeRepository": "Remove Repository from OpenGlance",
    "menu.edit": "Edit",
    "menu.undo": "Undo",
    "menu.redo": "Redo",
    "menu.cut": "Cut",
    "menu.copy": "Copy",
    "menu.paste": "Paste",
    "menu.selectAll": "Select All",
    "menu.findDocument": "Find in Document",
    "menu.view": "View",
    "menu.toggleSidebar": "Toggle Sidebar",
    "menu.sidebarViews": "Sidebar Views",
    "menu.sidebarAll": "All",
    "menu.sidebarFavorites": "Favorites",
    "menu.sidebarSync": "Sync",
    "menu.toggleOutline": "Toggle Document Navigation",
    "menu.preview": "Preview",
    "menu.source": "Source",
    "menu.live": "Live",
    "menu.pageMargins": "Page Margins",
    "menu.pageMarginsStandard": "Standard (Default)",
    "menu.pageMarginsWide": "Wide",
    "menu.tabs": "Tabs",
    "menu.previousTab": "Previous Tab",
    "menu.nextTab": "Next Tab",
    "menu.closeTab": "Close Tab",
    "menu.reload": "Reload",
    "menu.actualSize": "Actual Size",
    "menu.zoomIn": "Zoom In",
    "menu.zoomOut": "Zoom Out",
    "menu.help": "Help",
    "menu.openGlanceHelp": "OpenGlance Help...",

    "home.subtitle": "Git-based docs workbench",
    "home.introduction":
      "Choose a local Git repository to open its Markdown / MDX documentation workspace in OpenGlance.",
    "home.readyTitle": "Environment ready",
    "home.readyMessage": "You can open a local Git repository.",
    "home.blockedTitle": "Environment not ready",
    "home.blockedMessage":
      "OpenGlance needs access to the Git command before it can open a local repository.",
    "home.blockedAction":
      "Set up Git, then reopen OpenGlance or return to this page and try again.",
    "home.chooseRepository": "Choose Git Repository",
    "home.environment": "Environment checks",
    "home.repositories": "Opened repositories",
    "home.pending": "Pending",
    "home.preparingChecks": "Preparing check results.",
    "home.status.ok": "Ready",
    "home.status.warn": "Needs attention",
    "home.status.error": "Error",
    "home.version": "Version {version}",
    "home.released": "Released {date}",
    "home.progressTitle": "Working",
    "home.progressMessage": "Please wait.",

    "progress.openingRepository": "Opening repository",
    "progress.switchingRepository": "Switching repository",
    "progress.closingRepository": "Closing repository",
    "progress.preparingWorkspace": "Preparing the documentation workspace for {repo}.",
    "progress.checkingRepository": "Checking the selected folder and starting the local service.",
    "progress.switchingWorkspace": "Switching from {from} to {to}.",
    "progress.closingWorkspace": "Closing {repo} and stopping the local service.",
    "progress.restoringWorkspace": "Restoring the workspace for {repo}.",

    "settings.fileTypes.title": "Supported file types",
    "settings.fileTypes.body":
      "“Always shown” files stay in the content tree. “Shown when needed” files appear temporarily when opened, referenced, matched by search, or locally changed. Switch to “All repository files” at any time to see the complete repository.",
    "settings.version": "Version",
    "settings.build": "Build",
    "settings.releaseDate": "Release date",
    "settings.updateStatus": "Update status",
    "settings.notChecked": "Updates have not been checked yet.",
    "settings.privacy": "Privacy & usage analytics",
    "settings.analyticsOn":
      "Usage analytics are on. OpenGlance sends only anonymous summaries and update state; it never sends repository names, paths, file names, search terms, document content, or Git identity.",
    "settings.analyticsOff": "Usage analytics are off. This build does not send usage analytics.",
    "settings.repository": "Repository",
    "settings.workingDirectory": "Working directory",
    "settings.worktree": "Worktree",
    "settings.mainWorkingDirectory": "Main working directory",
    "settings.branch": "Branch",
    "settings.repositoryFiles": "Repository files",
    "settings.markdownFiles": "Markdown / MDX",
    "settings.fileCount.one": "1 file",
    "settings.fileCount.other": "{count} files",
    "settings.frontmatterRules": "Front Matter rules",
    "settings.frontmatterDetected":
      "Detected, with {count} filter fields: {fields}",
    "settings.frontmatterNoFields": "Detected, but no filter fields are available",
    "settings.frontmatterMissing": "docs/frontmatter-rules.json was not found",

    "updates.checking": "Checking for updates…",
    "updates.downloading": "Downloading and preparing the new version…",
    "updates.downloaded": "The new version is ready and will install after OpenGlance quits.",
    "updates.available": "A new version is available and is downloading automatically.",
    "updates.current": "OpenGlance is up to date.",
    "updates.error": "Could not check for updates.",
    "updates.packageUnavailable":
      "The update package is temporarily unavailable. Choose Retry.",
    "updates.availableVersion":
      "OpenGlance {version} is available and is downloading automatically.",
    "updates.handoffAvailableVersion":
      "The internal OpenGlance {version} release is available and is downloading automatically.",
    "updates.disabledDevBuild":
      "Only a packaged OpenGlance dev installation can switch to the internal release.",
    "updates.disabledSourceBuild":
      "Community Builds do not connect to the official OpenGlance update service. Install a signed official build to receive updates.",
    "updates.disabledNoTrack": "This build does not have an official update track.",
    "updates.disabledDevelopmentMode": "Development mode does not check for automatic updates.",
    "updates.checkIncomplete": "The update check did not finish. Choose Retry.",
    "updates.downloadFailedRetry": "Could not download the update. Choose Retry.",
    "updates.downloadFailed": "Could not download the update.",
    "updates.unsupportedPlatform": "Automatic updates are not supported on this platform.",
    "updates.checkFailed": "Could not check for updates.",
    "updates.manifestInvalid": "The update manifest is invalid.",
    "updates.manifestTrackMismatch":
      "The update manifest release track does not match this build.",
    "updates.manifestChannelMismatch":
      "The update manifest channel does not match this build.",
    "updates.manifestPlatformMismatch":
      "The update manifest platform does not match this build.",
    "updates.manifestVersionInvalid": "The update manifest contains an invalid version.",
    "updates.packageUrlMissing":
      "A new version is available, but its update package URL is missing.",
    "updates.saveChoiceFailedRetry": "Could not save the verified update target. Choose Retry.",
    "updates.saveChoiceFailed": "Could not save the verified update target.",
    "updates.prepareFailedRetry": "Could not prepare the update. Choose Retry.",
    "updates.prepareFailed": "Could not prepare the update.",
  }),
  "zh-CN": Object.freeze({
    "common.unknown": "未知",
    "common.ok": "好",
    "common.cancel": "取消",
    "common.close": "关闭",
    "common.retry": "重试",
    "common.count": "{count}",

    "menu.about": "关于 {app}",
    "menu.checkUpdates": "检查更新…",
    "menu.settings": "设置…",
    "menu.hide": "隐藏 {app}",
    "menu.hideOthers": "隐藏其他",
    "menu.showAll": "全部显示",
    "menu.quit": "退出 {app}",
    "menu.file": "文件",
    "menu.openRepository": "打开仓库…",
    "menu.repositories": "仓库…",
    "menu.previousRepository": "上一个仓库",
    "menu.nextRepository": "下一个仓库",
    "menu.exportPdf": "导出 PDF…",
    "menu.closeRepository": "关闭仓库",
    "menu.removeRepository": "从 OpenGlance 移除仓库",
    "menu.edit": "编辑",
    "menu.undo": "撤销",
    "menu.redo": "重做",
    "menu.cut": "剪切",
    "menu.copy": "复制",
    "menu.paste": "粘贴",
    "menu.selectAll": "全选",
    "menu.findDocument": "在文档中查找",
    "menu.view": "显示",
    "menu.toggleSidebar": "显示或隐藏侧边栏",
    "menu.sidebarViews": "侧边栏视图",
    "menu.sidebarAll": "全部",
    "menu.sidebarFavorites": "收藏",
    "menu.sidebarSync": "同步",
    "menu.toggleOutline": "显示或隐藏文档导航",
    "menu.preview": "Preview",
    "menu.source": "Source",
    "menu.live": "Live",
    "menu.pageMargins": "页边距",
    "menu.pageMarginsStandard": "标准（默认）",
    "menu.pageMarginsWide": "宽",
    "menu.tabs": "标签页",
    "menu.previousTab": "上一个标签页",
    "menu.nextTab": "下一个标签页",
    "menu.closeTab": "关闭标签页",
    "menu.reload": "重新载入",
    "menu.actualSize": "实际大小",
    "menu.zoomIn": "放大",
    "menu.zoomOut": "缩小",
    "menu.help": "帮助",
    "menu.openGlanceHelp": "OpenGlance 帮助…",

    "home.subtitle": "Git 文档工作台",
    "home.introduction":
      "选择一个本地 Git 仓库后，OpenGlance 会在桌面窗口中打开 Markdown / MDX 文档工作台。",
    "home.readyTitle": "环境已就绪",
    "home.readyMessage": "可以打开本地 Git 仓库。",
    "home.blockedTitle": "环境未就绪",
    "home.blockedMessage": "OpenGlance 需要先检测到 Git 命令，才能打开本地仓库。",
    "home.blockedAction": "请先处理 Git 命令，然后重新打开 OpenGlance 或回到此页面再试。",
    "home.chooseRepository": "选择 Git 仓库",
    "home.environment": "环境检查",
    "home.repositories": "已打开的仓库",
    "home.pending": "待检查",
    "home.preparingChecks": "正在准备检查结果。",
    "home.status.ok": "正常",
    "home.status.warn": "需处理",
    "home.status.error": "错误",
    "home.version": "版本 {version}",
    "home.released": "发布于 {date}",
    "home.progressTitle": "正在处理",
    "home.progressMessage": "请稍候。",

    "progress.openingRepository": "正在打开仓库",
    "progress.switchingRepository": "正在切换仓库",
    "progress.closingRepository": "正在关闭仓库",
    "progress.preparingWorkspace": "正在准备 {repo} 的文档工作区。",
    "progress.checkingRepository": "正在检查所选目录并启动本地服务。",
    "progress.switchingWorkspace": "正在从 {from} 切换到 {to}。",
    "progress.closingWorkspace": "正在关闭 {repo}，并停止本地服务。",
    "progress.restoringWorkspace": "正在恢复 {repo} 的工作区。",

    "settings.fileTypes.title": "文件类型支持",
    "settings.fileTypes.body":
      "“默认显示”表示文件会常驻内容目录；“按需显示”表示它只在当前打开、被文档引用、命中搜索或存在本地改动时临时出现。切换到“全部仓库文件”可以随时查看完整仓库。",
    "settings.version": "版本",
    "settings.build": "构建",
    "settings.releaseDate": "更新时间",
    "settings.updateStatus": "更新状态",
    "settings.notChecked": "尚未检查更新。",
    "settings.privacy": "隐私与使用统计",
    "settings.analyticsOn":
      "使用统计已开启；只发送匿名汇总与更新状态，不发送仓库名、路径、文件名、搜索词、文档内容或 Git 身份。",
    "settings.analyticsOff": "使用统计已关闭；当前构建不会发送使用统计。",
    "settings.repository": "仓库",
    "settings.workingDirectory": "工作目录",
    "settings.worktree": "Worktree",
    "settings.mainWorkingDirectory": "主工作目录",
    "settings.branch": "分支",
    "settings.repositoryFiles": "仓库文件",
    "settings.markdownFiles": "Markdown / MDX",
    "settings.fileCount.one": "1 个",
    "settings.fileCount.other": "{count} 个",
    "settings.frontmatterRules": "Front Matter 规则",
    "settings.frontmatterDetected": "已检测，{count} 个可筛选字段：{fields}",
    "settings.frontmatterNoFields": "已检测，但没有可筛选字段",
    "settings.frontmatterMissing": "未检测到 docs/frontmatter-rules.json",

    "updates.checking": "正在检查更新…",
    "updates.downloading": "正在下载并准备新版本…",
    "updates.downloaded": "新版本已准备好，退出 OpenGlance 后自动安装。",
    "updates.available": "发现新版本，正在自动下载。",
    "updates.current": "OpenGlance 已经是最新版本。",
    "updates.error": "检查更新失败。",
    "updates.packageUnavailable": "更新包暂不可用，点击重试。",
    "updates.availableVersion": "OpenGlance {version} 可用，正在自动下载。",
    "updates.handoffAvailableVersion":
      "OpenGlance {version} 内部正式版可用，正在自动下载。",
    "updates.disabledDevBuild":
      "只有已打包安装的 OpenGlance dev 才能切换到内部正式版。",
    "updates.disabledSourceBuild":
      "社区构建不会连接 OpenGlance 官方更新服务。请从官方渠道安装签名版本以接收更新。",
    "updates.disabledNoTrack": "当前构建没有可用的正式更新轨道。",
    "updates.disabledDevelopmentMode": "开发模式不会检查自动更新。",
    "updates.checkIncomplete": "更新检查未完成，点击重试。",
    "updates.downloadFailedRetry": "下载更新失败，点击重试。",
    "updates.downloadFailed": "下载更新失败。",
    "updates.unsupportedPlatform": "当前平台暂不支持 OpenGlance 自动更新。",
    "updates.checkFailed": "检查更新失败。",
    "updates.manifestInvalid": "更新清单格式无效。",
    "updates.manifestTrackMismatch": "更新清单的发行轨道与当前构建不匹配。",
    "updates.manifestChannelMismatch": "更新清单的更新通道与当前构建不匹配。",
    "updates.manifestPlatformMismatch": "更新清单的平台与当前构建不匹配。",
    "updates.manifestVersionInvalid": "更新清单中的版本号无效。",
    "updates.packageUrlMissing": "发现新版本，但更新包地址缺失。",
    "updates.saveChoiceFailedRetry": "无法保存已验证的更新目标，点击重试。",
    "updates.saveChoiceFailed": "无法保存已验证的更新目标。",
    "updates.prepareFailedRetry": "准备更新失败，点击重试。",
    "updates.prepareFailed": "准备更新失败。",
  }),
});

export function preferredSystemLanguages(app) {
  if (typeof app?.getPreferredSystemLanguages === "function") {
    const languages = app.getPreferredSystemLanguages();
    if (Array.isArray(languages) && languages.length > 0) {
      return languages;
    }
  }
  if (typeof app?.getLocale === "function") {
    const locale = app.getLocale();
    return locale ? [locale] : [];
  }
  return [];
}

export function resolveDesktopLanguage(preferences = {}, { app, systemLanguages } = {}) {
  return resolveLocalePreference(
    preferences?.language,
    systemLanguages ?? preferredSystemLanguages(app),
  );
}

export function createDesktopTranslator(preferences = {}, options = {}) {
  return createTranslator(
    DESKTOP_MESSAGES,
    resolveDesktopLanguage(preferences, options),
  );
}

export function createDesktopTranslatorForLanguage(language) {
  return createTranslator(DESKTOP_MESSAGES, language);
}

export function desktopPreferencesForRenderer(preferences = {}, options = {}) {
  const source = preferences && typeof preferences === "object" && !Array.isArray(preferences)
    ? preferences
    : {};
  return {
    ...source,
    resolvedLanguage: resolveDesktopLanguage(source, options),
  };
}

export function translatedFileCount(translate, count) {
  return translate(
    Number(count) === 1 ? "settings.fileCount.one" : "settings.fileCount.other",
    { count: Number(count) || 0 },
  );
}
