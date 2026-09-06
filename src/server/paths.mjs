import { access, lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";

import {
  isMarkdownPath,
  openableFileTypeForPath,
  RAW_ASSET_EXTENSIONS,
} from "./file-types.mjs";
import {
  ExternalCommandOutputError,
  runExternalCommand,
} from "./external-command.mjs";
import {
  gitCommandReportsMissingRepository,
  GitRepositoryNotFoundError,
} from "./git-errors.mjs";

const NEW_DOCUMENT_MESSAGES = Object.freeze({
  en: Object.freeze({
    location: "The document location must be an existing directory.",
    format: "Document format must be Markdown or MDX.",
    nameRequired: "Enter a document name.",
    nameInvalid: "The document name contains characters that are not supported by the system.",
    locationOutside: "The document location must be inside the current repository.",
    pathOutside: "The document path must be inside the current repository: {path}",
  }),
  "zh-CN": Object.freeze({
    location: "创建位置必须是已有目录。",
    format: "文档格式只支持 Markdown 或 MDX。",
    nameRequired: "请输入文档名称。",
    nameInvalid: "文档名称包含系统不支持的字符。",
    locationOutside: "创建位置必须位于当前仓库内。",
    pathOutside: "路径必须位于当前仓库内：{path}",
  }),
});
const NEW_DOCUMENT_ERROR_CODES = Object.freeze({
  location: "new_document_directory_invalid",
  format: "new_document_format_invalid",
  nameRequired: "new_document_name_required",
  nameInvalid: "new_document_name_invalid",
  outside: "new_document_path_outside_repository",
});

export function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

export async function findRepoRoot(
  startDir = process.cwd(),
  { gitRunner = runGitTopLevel } = {},
) {
  let commandCwd;
  try {
    commandCwd = await realpath(startDir);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new GitRepositoryNotFoundError(startDir, { cause: error });
    }
    throw error;
  }

  try {
    const { stdout } = await gitRunner(commandCwd);
    const repoRoot = String(stdout ?? "").trim();
    if (!repoRoot || /[\r\n\0]/.test(repoRoot) || !path.isAbsolute(repoRoot)) {
      throw new ExternalCommandOutputError(
        "git",
        ["rev-parse", "--show-toplevel"],
        "an invalid repository root",
      );
    }
    return repoRoot;
  } catch (gitError) {
    if (!gitCommandReportsMissingRepository(gitError)) {
      throw gitError;
    }
    throw new GitRepositoryNotFoundError(startDir, { cause: gitError });
  }
}

function runGitTopLevel(cwd) {
  return runExternalCommand("git", ["rev-parse", "--show-toplevel"], { cwd });
}

export async function resolveInsideRepo(repoRoot, inputPath) {
  const root = await realpath(repoRoot);
  const absoluteCandidate = path.resolve(
    path.isAbsolute(inputPath) ? inputPath : path.join(root, inputPath),
  );
  const absolutePath = await realpath(absoluteCandidate);

  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
    throw new Error(`Preview path must be inside the repository: ${inputPath}`);
  }

  const relativePath = toPosixPath(path.relative(root, absolutePath));
  return { root, absolutePath, relativePath };
}

export async function resolvePreviewPath(repoRoot, inputPath) {
  const resolved = await resolveInsideRepo(repoRoot, inputPath);
  const fileStat = await stat(resolved.absolutePath);

  if (!fileStat.isFile()) {
    throw new Error(`Preview path must point to a file: ${inputPath}`);
  }

  if (!isMarkdownPath(resolved.absolutePath)) {
    throw new Error(`Preview path must be a Markdown or MDX file: ${inputPath}`);
  }

  return {
    absolutePath: resolved.absolutePath,
    relativePath: resolved.relativePath,
  };
}

export async function resolveOpenablePath(repoRoot, inputPath) {
  const resolved = await resolveRepositoryEntry(repoRoot, inputPath);
  const fileStat = resolved.fileStat;
  const entryKind = fileStat.isSymbolicLink()
    ? "symlink"
    : fileStat.isDirectory()
      ? "submodule"
      : "";
  const fileType = entryKind
    ? { kind: entryKind, extension: "", editable: false, text: false, raw: false }
    : await openableFileTypeForPath(resolved.absolutePath);

  return {
    absolutePath: resolved.absolutePath,
    relativePath: resolved.relativePath,
    extension: fileType.extension,
    kind: fileType.kind,
    editable: fileType.editable,
    text: fileType.text,
    raw: fileType.raw,
    fileStat,
  };
}

export async function resolveExistingRepoPath(repoRoot, inputPath = "") {
  const root = await realpath(repoRoot);
  const absoluteCandidate = path.resolve(root, String(inputPath || "."));
  assertInsideRoot(root, absoluteCandidate, inputPath);
  const absolutePath = await realpath(absoluteCandidate);
  assertInsideRoot(root, absolutePath, inputPath);
  const fileStat = await stat(absolutePath);
  return {
    root,
    absolutePath,
    relativePath: toPosixPath(path.relative(root, absolutePath)),
    fileStat,
  };
}

export async function resolveNewDocumentPath(
  repoRoot,
  {
    directory = "",
    name = "",
    format = "md",
    language = "en",
    locale,
  } = {},
) {
  const translate = createNewDocumentTranslator(locale ?? language);
  const root = await realpath(repoRoot);
  const normalizedDirectory = normalizeRelativeDirectory(directory, translate);
  const absoluteDirectory = path.resolve(root, normalizedDirectory || ".");
  assertNewDocumentInsideRoot(root, absoluteDirectory, directory, translate);
  const realDirectory = await realpath(absoluteDirectory);
  assertNewDocumentInsideRoot(root, realDirectory, directory, translate);
  const directoryStat = await stat(realDirectory);
  if (!directoryStat.isDirectory()) {
    throw invalidNewDocumentError(
      translate("location"),
      NEW_DOCUMENT_ERROR_CODES.location,
    );
  }

  const extension = normalizeDocumentFormat(format, translate);
  const title = normalizeDocumentName(name, translate);
  const filename = `${title}.${extension}`;
  const absolutePath = path.join(realDirectory, filename);
  assertNewDocumentInsideRoot(root, absolutePath, filename, translate);
  return {
    root,
    absolutePath,
    relativePath: toPosixPath(path.relative(root, absolutePath)),
    title,
    extension,
  };
}

async function resolveRepositoryEntry(repoRoot, inputPath) {
  const root = await realpath(repoRoot);
  const absolutePath = path.resolve(
    path.isAbsolute(inputPath) ? inputPath : path.join(root, inputPath),
  );
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
    throw new Error(`Preview path must be inside the repository: ${inputPath}`);
  }
  if (absolutePath !== root) {
    // A leaf symlink is displayed as metadata; an ancestor symlink must never
    // let a document read or write escape the repository.
    assertInsideRoot(root, await realpath(path.dirname(absolutePath)), inputPath);
  }
  const fileStat = await lstat(absolutePath);
  if (!fileStat.isFile() && !fileStat.isSymbolicLink() && !fileStat.isDirectory()) {
    throw new Error(`Preview path must point to a repository file: ${inputPath}`);
  }
  if (fileStat.isDirectory()) {
    try {
      await access(path.join(absolutePath, ".git"), constants.F_OK);
    } catch {
      throw new Error(`Preview path must point to a file: ${inputPath}`);
    }
  }
  return {
    root,
    absolutePath,
    relativePath: toPosixPath(path.relative(root, absolutePath)),
    fileStat,
  };
}

function normalizeRelativeDirectory(value, translate) {
  const directory = String(value ?? "").trim().replaceAll("\\", "/");
  if (!directory || directory === ".") {
    return "";
  }
  if (
    path.posix.isAbsolute(directory) ||
    path.win32.isAbsolute(directory) ||
    directory.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw invalidNewDocumentError(
      translate("locationOutside"),
      NEW_DOCUMENT_ERROR_CODES.outside,
    );
  }
  return directory;
}

function normalizeDocumentFormat(value, translate) {
  const format = String(value ?? "md").trim().toLowerCase().replace(/^\./, "");
  if (format !== "md" && format !== "mdx") {
    throw invalidNewDocumentError(
      translate("format"),
      NEW_DOCUMENT_ERROR_CODES.format,
    );
  }
  return format;
}

function normalizeDocumentName(value, translate) {
  const raw = String(value ?? "").trim().replace(/\.(?:md|mdx)$/i, "").trim();
  if (!raw) {
    throw invalidNewDocumentError(
      translate("nameRequired"),
      NEW_DOCUMENT_ERROR_CODES.nameRequired,
    );
  }
  if (
    /[\u0000-\u001f<>:\"/\\|?*]/.test(raw) ||
    /[. ]$/.test(raw) ||
    raw === "." ||
    raw === ".." ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(raw)
  ) {
    throw invalidNewDocumentError(
      translate("nameInvalid"),
      NEW_DOCUMENT_ERROR_CODES.nameInvalid,
    );
  }
  return raw;
}

function assertNewDocumentInsideRoot(root, absolutePath, inputPath, translate) {
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
    throw invalidNewDocumentError(
      translate("pathOutside", { path: inputPath }),
      NEW_DOCUMENT_ERROR_CODES.outside,
    );
  }
}

function assertInsideRoot(root, absolutePath, inputPath) {
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
    throw invalidNewDocumentError(`路径必须位于当前仓库内：${inputPath}`);
  }
}

function invalidNewDocumentError(message, code) {
  const error = new Error(message);
  if (code) {
    error.code = code;
  }
  error.statusCode = 400;
  return error;
}

function createNewDocumentTranslator(locale) {
  const messages = NEW_DOCUMENT_MESSAGES[resolveNewDocumentLocale(locale)];
  return (key, replacements = {}) => {
    const template = messages[key] ?? NEW_DOCUMENT_MESSAGES.en[key] ?? key;
    return template.replace(/\{([a-zA-Z]+)\}/g, (_match, name) => (
      replacements[name] == null ? "" : String(replacements[name])
    ));
  };
}

function resolveNewDocumentLocale(locale) {
  return String(locale || "").toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export async function resolveRawAssetPath(repoRoot, inputPath) {
  const resolved = await resolveInsideRepo(repoRoot, inputPath);
  const fileStat = await stat(resolved.absolutePath);
  const extension = path.extname(resolved.absolutePath).toLowerCase();

  if (!fileStat.isFile()) {
    throw new Error(`Asset path must point to a file: ${inputPath}`);
  }

  if (!RAW_ASSET_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported preview asset type: ${inputPath}`);
  }

  return {
    absolutePath: resolved.absolutePath,
    relativePath: resolved.relativePath,
    extension,
  };
}

export function resolveRelativeRepoLink(sourceRelativePath, destination) {
  if (isExternalDestination(destination) || destination.startsWith("#")) {
    return destination;
  }

  const [pathPart, suffix = ""] = splitDestinationSuffix(destination);
  if (!pathPart) {
    return destination;
  }

  const sourceDir = path.posix.dirname(sourceRelativePath);
  const decodedPath = decodeURI(pathPart);
  const resolved = decodedPath.startsWith("/")
    ? path.posix.normalize(decodedPath.slice(1))
    : path.posix.normalize(path.posix.join(sourceDir, decodedPath));
  if (resolved.startsWith("../") || resolved === "..") {
    return destination;
  }

  return encodeURI(resolved) + suffix;
}

export function isExternalDestination(destination) {
  const normalized = destination.trim().toLowerCase();
  return (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("mailto:") ||
    normalized.startsWith("tel:") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("//")
  );
}

function splitDestinationSuffix(destination) {
  const hashIndex = destination.indexOf("#");
  const queryIndex = destination.indexOf("?");
  const indexes = [hashIndex, queryIndex].filter((index) => index >= 0);
  if (indexes.length === 0) {
    return [destination, ""];
  }

  const splitIndex = Math.min(...indexes);
  return [destination.slice(0, splitIndex), destination.slice(splitIndex)];
}
