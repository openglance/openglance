import assert from "node:assert/strict";
import test from "node:test";
import { desktopRepositoryPanelItems, desktopRepositoryRootForPanelId } from "../src/desktop/repository-panel.mjs";

import {
  desktopHomeHtml,
  desktopPageBackgroundColor,
  desktopProgressHtml,
} from "../src/desktop/home.mjs";

test("the error home keeps saved repositories reachable through their opaque IDs", () => {
  const roots = ["/private/work/first", "/private/work/second"];
  const html = desktopHomeHtml({
    checks: [{ id: "git-command", status: "ok" }],
    errorMessage: "The requested worktree is unavailable.",
    repositories: desktopRepositoryPanelItems(roots),
  });
  const links = [...html.matchAll(/href="(openglance:\/\/switch-repository[^\"]+)"/g)];
  assert.deepEqual(links.map(([, href]) => desktopRepositoryRootForPanelId(roots, new URL(href).searchParams.get("id"))), roots);
  assert.doesNotMatch(html, /\/private\/work\//);
});

test("desktop home page explains repository selection and renders environment checks", () => {
  const html = desktopHomeHtml({
    errorMessage: "不是 Git 仓库 <script>alert(1)</script>",
    buildInfo: {
      version: "0.1.1",
      commit: "93458e1",
      builtAt: "2026-07-05T11:47:00.000Z",
      buildId: "93458e1.20260705T114700Z",
    },
    checks: [
      {
        id: "git-command",
        label: "Git 命令",
        status: "ok",
        message: "git version 2.50.1",
      },
      {
        id: "git-identity",
        label: "Git 身份",
        status: "warn",
        message: "还没有配置 user.name / user.email",
      },
    ],
    preferences: { language: "system" },
    systemLanguages: ["zh-CN"],
  });

  assert.match(html, /OpenGlance/);
  assert.match(html, /Git 文档工作台/);
  assert.match(html, /选择一个本地 Git 仓库后，OpenGlance 会在桌面窗口中打开 Markdown \/ MDX 文档工作台。/);
  assert.doesNotMatch(html, /首次启动不会自动弹出目录选择框/);
  assert.match(html, /选择 Git 仓库/);
  assert.match(html, /openglance:\/\/open-repository/);
  assert.match(html, /Git 命令/);
  assert.match(html, /git version 2\.50\.1/);
  assert.match(html, /class="check-status ok">正常</);
  assert.match(html, /class="check-status warn">需处理</);
  assert.match(html, /版本 0\.1\.1/);
  assert.match(html, /发布于 2026-07-05/);
  assert.doesNotMatch(html, /93458e1\.20260705T114700Z/);
  assert.doesNotMatch(html, /构建/);
  assert.match(html, /不是 Git 仓库 &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("desktop home follows an English system language and localizes its own status copy", () => {
  const html = desktopHomeHtml({
    buildInfo: {
      version: "1.2.3",
      builtAt: "2026-07-05T11:47:00.000Z",
    },
    checks: [
      {
        id: "git-command",
        label: "Git command",
        status: "ok",
        message: "git version 2.50.1",
      },
    ],
    preferences: { language: "system" },
    systemLanguages: ["fr-FR", "en-US", "zh-CN"],
  });

  assert.match(html, /<html lang="en" data-color-mode="system">/);
  assert.match(html, /Git-based docs workbench/);
  assert.match(html, /Choose a local Git repository/);
  assert.match(html, /Environment ready/);
  assert.match(html, /Choose Git Repository/);
  assert.match(html, /Environment checks/);
  assert.match(html, /class="check-status ok">Ready</);
  assert.match(html, /Version 1\.2\.3/);
  assert.match(html, /Released 2026-07-05/);
});

test("desktop home localizes the empty environment-check state", () => {
  const html = desktopHomeHtml({
    preferences: { language: "zh-CN" },
  });

  assert.match(html, /<html lang="zh-CN"/);
  assert.match(html, /环境检查/);
  assert.match(html, /待检查/);
  assert.match(html, /正在准备检查结果。/);
});

test("desktop home page marks development builds in the top title", () => {
  const html = desktopHomeHtml({
    buildInfo: {
      version: "0.1.1",
      commit: "93458e1",
      builtAt: "2026-07-05T11:47:00.000Z",
      buildId: "93458e1.20260705T114700Z",
      dev: true,
    },
  });

  assert.match(html, /<h1>OpenGlance dev<\/h1>/);
});

test("desktop home page keeps production builds title clean", () => {
  const html = desktopHomeHtml({
    buildInfo: {
      version: "0.1.1",
      commit: "93458e1",
      builtAt: "2026-07-05T11:47:00.000Z",
      buildId: "93458e1.20260705T114700Z",
    },
  });

  assert.match(html, /<h1>OpenGlance<\/h1>/);
  assert.doesNotMatch(html, /OpenGlance dev/);
});

test("desktop home page allows opening repositories when only optional checks warn", () => {
  const html = desktopHomeHtml({
    preferences: { language: "zh-CN" },
    checks: [
      {
        id: "git-command",
        label: "Git 命令",
        status: "ok",
        message: "git version 2.50.1",
      },
      {
        id: "github-login",
        label: "GitHub 登录",
        status: "warn",
        message: "未检测到 GitHub CLI。",
      },
    ],
  });

  assert.match(html, /环境已就绪/);
  assert.match(html, /可以打开本地 Git 仓库/);
  assert.match(html, /data-next-action="allowed"/);
  assert.match(html, /openglance:\/\/open-repository/);
  assert.doesNotMatch(html, /aria-disabled="true"/);
});

test("desktop home page blocks repository opening when Git is missing", () => {
  const html = desktopHomeHtml({
    repositories: desktopRepositoryPanelItems(["/work/docs"]),
    preferences: { language: "zh-CN" },
    checks: [
      {
        id: "git-command",
        label: "Git 命令",
        status: "error",
        message: "未检测到 Git 命令。请先安装 Git for Windows。",
      },
      {
        id: "github-login",
        label: "GitHub 登录",
        status: "warn",
        message: "未检测到 GitHub CLI。",
      },
    ],
  });

  assert.match(html, /环境未就绪/);
  assert.match(html, /请先处理 Git 命令/);
  assert.match(html, /data-next-action="blocked"/);
  assert.match(html, /aria-disabled="true"/);
  assert.doesNotMatch(html, /openglance:\/\/(?:open-repository|switch-repository)/);
});

test("desktop progress page gives immediate feedback during repository transitions", () => {
  const html = desktopProgressHtml({
    title: "正在打开仓库",
    message: "正在启动本地服务 <script>alert(1)</script>",
    preferences: { language: "zh-CN" },
  });

  assert.match(html, /aria-busy="true"/);
  assert.match(html, /正在打开仓库/);
  assert.match(html, /正在启动本地服务 &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /progress-indicator/);
  assert.doesNotMatch(html, /openglance:\/\/(?:open-repository|switch-repository)/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("desktop progress defaults follow the resolved language", () => {
  const english = desktopProgressHtml({
    preferences: { language: "system" },
    systemLanguages: ["en-GB"],
  });
  const chinese = desktopProgressHtml({
    preferences: { language: "system" },
    systemLanguages: ["zh-Hans"],
  });

  assert.match(english, /<html lang="en"/);
  assert.match(english, /<h1>Working<\/h1>/);
  assert.match(english, /<p>Please wait\.<\/p>/);
  assert.match(chinese, /<html lang="zh-CN"/);
  assert.match(chinese, /<h1>正在处理<\/h1>/);
  assert.match(chinese, /<p>请稍候。<\/p>/);
});

test("desktop transition background matches the workbench before first paint", () => {
  assert.equal(desktopPageBackgroundColor({ colorMode: "light" }), "#f6f7f9");
  assert.equal(desktopPageBackgroundColor({ colorMode: "dark" }), "#111214");
  assert.equal(
    desktopPageBackgroundColor({ colorMode: "system" }, { systemDark: true }),
    "#111214",
  );
  assert.equal(
    desktopPageBackgroundColor({ colorMode: "system" }, { systemDark: false }),
    "#f6f7f9",
  );
});

test("desktop home and progress pages honor an explicit color mode", () => {
  const home = desktopHomeHtml({
    preferences: { colorMode: "dark", language: "zh-CN" },
  });
  const progress = desktopProgressHtml({
    preferences: { colorMode: "light", language: "en" },
  });

  assert.match(home, /<html lang="zh-CN" data-color-mode="dark">/);
  assert.match(progress, /<html lang="en" data-color-mode="light">/);
  assert.match(home, /:root\[data-color-mode="dark"\]/);
  assert.match(progress, /:root:not\(\[data-color-mode="light"\]\)/);
  for (const html of [home, progress]) {
    assert.match(html, /git-leaf-desktop-preferences/);
    assert.match(html, /document\.documentElement\.dataset\.colorMode = colorMode/);
    assert.match(html, /event\.preventDefault\(\)/);
  }
});
