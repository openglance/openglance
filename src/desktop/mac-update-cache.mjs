import {
  lstat,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OFFICIAL_PUBLIC_MAC_SHIPIT_JOB_LABEL = "com.mangofuture.openglance.ShipIt";
export const OFFICIAL_INTERNAL_MAC_SHIPIT_JOB_LABEL = "com.mangofuture.gitleaf.ShipIt";
export const COMMUNITY_MAC_SHIPIT_JOB_LABEL = "org.openglance.community.ShipIt";
export const OFFICIAL_MAC_SHIPIT_JOB_LABEL = OFFICIAL_INTERNAL_MAC_SHIPIT_JOB_LABEL;

export function macShipItJobLabelForBuildInfo(buildInfo = {}) {
  if (buildInfo.distribution !== "official") {
    return COMMUNITY_MAC_SHIPIT_JOB_LABEL;
  }
  return buildInfo.releaseTrack === "internal"
    ? OFFICIAL_INTERNAL_MAC_SHIPIT_JOB_LABEL
    : OFFICIAL_PUBLIC_MAC_SHIPIT_JOB_LABEL;
}

export function macUpdateCachePaths({
  homeDir,
  jobLabel = OFFICIAL_MAC_SHIPIT_JOB_LABEL,
} = {}) {
  const resolvedHome = requiredDirectory(homeDir, "homeDir");
  const safeJobLabel = requiredJobLabel(jobLabel);
  const updateRoot = path.join(
    resolvedHome,
    "Library",
    "Caches",
    safeJobLabel,
  );
  return {
    updateRoot,
    stateFile: path.join(updateRoot, "ShipItState.plist"),
  };
}

export async function prepareMacUpdateAppPath({
  homeDir,
  targetAppPath,
  jobLabel = OFFICIAL_MAC_SHIPIT_JOB_LABEL,
  lstatFn = lstat,
  readFileFn = readFile,
  writeFileFn = writeFile,
  renameFn = rename,
  removeFn = rm,
  now = Date.now,
  processId = process.pid,
} = {}) {
  const paths = macUpdateCachePaths({ homeDir, jobLabel });
  const expectedTarget = requiredDirectory(targetAppPath, "targetAppPath");
  let stateStat;
  try {
    stateStat = await lstatFn(paths.stateFile);
  } catch {
    throw new Error("The staged macOS update state is missing.");
  }
  if (!stateStat.isFile() || stateStat.isSymbolicLink()) {
    throw new Error("The staged macOS update state must be a regular file.");
  }

  let request;
  try {
    request = JSON.parse(await readFileFn(paths.stateFile, "utf8"));
  } catch {
    throw new Error("The staged macOS update state is invalid.");
  }
  const stagedDirectory = stagedUpdateDirectoryForRequest({ paths, request });
  if (!stagedDirectory) {
    throw new Error("The staged macOS update is outside the official ShipIt cache.");
  }
  const target = filePathFromUrl(request?.targetBundleURL);
  if (!target || path.resolve(target) !== expectedTarget) {
    throw new Error("The staged macOS update targets another App path.");
  }

  // Squirrel derives the proposed name from CFBundleExecutable (Git Leaf in internal
  // builds), not the staged OpenGlance.app basename. Startup migrates the outer name;
  // ShipIt must preserve it on every subsequent Contents update.
  const useUpdateBundleName = false;

  const nextRequest = {
    ...request,
    useUpdateBundleName,
  };
  const temporaryStateFile = path.join(
    paths.updateRoot,
    `.ShipItState.openglance-${processId}-${now()}.tmp`,
  );
  let temporaryStateCreated = false;
  try {
    await writeFileFn(
      temporaryStateFile,
      JSON.stringify(nextRequest),
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    temporaryStateCreated = true;
    await renameFn(temporaryStateFile, paths.stateFile);
    temporaryStateCreated = false;
  } finally {
    if (temporaryStateCreated) {
      await removeFn(temporaryStateFile, { force: true });
    }
  }
  return {
    stateFile: paths.stateFile,
    targetAppPath: expectedTarget,
    stagedDirectory,
    useUpdateBundleName,
  };
}

export async function pruneObsoleteMacUpdatePackages({
  homeDir,
  jobLabel = OFFICIAL_MAC_SHIPIT_JOB_LABEL,
  readFileFn = readFile,
  readdirFn = readdir,
  removeFn = rm,
} = {}) {
  if (!homeDir) {
    return { preserved: "", removed: [], complete: false };
  }
  const paths = macUpdateCachePaths({ homeDir, jobLabel });
  let preserved = await stagedUpdateDirectory({
    paths,
    readFileFn,
  });
  if (!preserved) {
    return { preserved: "", removed: [], complete: false };
  }

  let entries;
  try {
    entries = await readdirFn(paths.updateRoot, { withFileTypes: true });
  } catch {
    return { preserved, removed: [], complete: false };
  }
  const staleDirectories = entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name.startsWith("update."))
    .map((entry) => path.join(paths.updateRoot, entry.name));
  const removed = [];
  let complete = true;
  for (const staleDirectory of staleDirectories) {
    const current = await stagedUpdateDirectory({ paths, readFileFn });
    if (!current || staleDirectory === current) {
      preserved = current;
      if (!current) {
        complete = false;
      }
      continue;
    }
    preserved = current;
    try {
      await removeFn(staleDirectory, { recursive: true, force: true });
      removed.push(staleDirectory);
    } catch {
      complete = false;
      // Keep pruning other known cache entries; a later check or download retries.
    }
  }
  return { preserved, removed, complete };
}

async function stagedUpdateDirectory({ paths, readFileFn }) {
  let request;
  try {
    request = JSON.parse(await readFileFn(paths.stateFile, "utf8"));
  } catch {
    return "";
  }
  return stagedUpdateDirectoryForRequest({ paths, request });
}

function stagedUpdateDirectoryForRequest({ paths, request }) {
  let updateBundlePath;
  try {
    const updateBundleUrl = new URL(String(request?.updateBundleURL || ""));
    if (updateBundleUrl.protocol !== "file:") {
      return "";
    }
    updateBundlePath = fileURLToPath(updateBundleUrl);
  } catch {
    return "";
  }
  if (path.extname(updateBundlePath).toLowerCase() !== ".app") {
    return "";
  }
  const stagedDirectory = path.resolve(path.dirname(updateBundlePath));
  if (
    path.dirname(stagedDirectory) !== path.resolve(paths.updateRoot)
    || !path.basename(stagedDirectory).startsWith("update.")
  ) {
    return "";
  }
  return stagedDirectory;
}

function filePathFromUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "file:") return "";
    return fileURLToPath(parsed);
  } catch {
    return "";
  }
}

function requiredDirectory(value, label) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) {
    throw new Error(`${label} is required.`);
  }
  return path.resolve(candidate);
}

function requiredJobLabel(value) {
  const label = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(label)) {
    throw new Error("Invalid macOS ShipIt job label.");
  }
  return label;
}
