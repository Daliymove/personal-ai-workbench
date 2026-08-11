import path from "node:path";

import { buildVaultIndex } from "./vault-index.mjs";

const DEFAULT_DEBOUNCE_MS = 380;
const MAX_EVENT_PATHS = 160;
const EXCLUDED_SEGMENTS = new Set([
  ".agents",
  ".baoyu-skills",
  ".git",
  ".obsidian",
  ".openai",
  ".workbuddy",
  "dist",
  "node_modules",
  "workbench",
]);
const TRACKED_EVENTS = new Set(["add", "change", "unlink", "addDir", "unlinkDir"]);
const TEMPORARY_FILE_PATTERNS = [
  /(?:^|\/)\.[^/]+\.(?:swp|swo|tmp)$/i,
  /(?:^|\/)[^/]+\.(?:tmp|temp|part|crdownload)$/i,
  /(?:^|\/)~\$[^/]+$/,
];

export class VaultSyncError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "VaultSyncError";
    this.code = code;
    this.details = details;
  }
}

function toPosix(value) {
  return String(value).split(path.sep).join("/");
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function normalizeVaultEventPath(vaultRoot, candidatePath) {
  if (!candidatePath) return null;
  const root = path.resolve(vaultRoot);
  const absolute = path.resolve(String(candidatePath));
  if (!isInside(root, absolute)) return null;
  const relativePath = toPosix(path.relative(root, absolute));
  if (!relativePath) return null;
  const segments = relativePath.split("/");
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return null;
  if (TEMPORARY_FILE_PATTERNS.some((pattern) => pattern.test(relativePath))) return null;
  return relativePath;
}

export function affectedScopesForPaths(paths = []) {
  const scopes = new Set(["runtime"]);
  for (const relativePath of paths) {
    const value = String(relativePath);
    const top = value.split("/")[0];
    scopes.add("search");
    scopes.add("recent");
    if (top === "wiki") {
      ["wiki", "graph", "overview"].forEach((scope) => scopes.add(scope));
    } else if (top === "10_raw") {
      scopes.add("materials");
      scopes.add("overview");
      if (value.includes("/.workbench-material-reading-state.json")) {
        scopes.add("reading_queue");
      }
      if (value.startsWith("10_raw/douyin/")) {
        scopes.add("douyin");
        scopes.add("overview");
      }
      if (value.startsWith("10_raw/social-insights/")) {
        scopes.add("social_insights");
      }
    } else if (top === "Brainstorm") {
      scopes.add("brainstorm");
    } else if (top === "40_topics") {
      ["topics", "content", "overview"].forEach((scope) => scopes.add(scope));
    } else if (top === "50_scripts") {
      scopes.add("content");
      scopes.add("overview");
      if (value.startsWith("50_scripts/public-account/")) {
        scopes.add("public_account");
      }
    } else if (top === "90_runs") {
      scopes.add("archive");
      if (value.startsWith("90_runs/data_reviews/douyin/")) {
        scopes.add("douyin");
        scopes.add("overview");
      }
    } else if (top === "30_self_media") {
      scopes.add("overview");
      if (value.startsWith("30_self_media/douyin/")) scopes.add("douyin");
      if (value.startsWith("30_self_media/public-account/")) {
        scopes.add("public_account");
      }
    } else {
      scopes.add("overview");
    }
  }
  return [...scopes].sort();
}

function publicError(error) {
  return error
    ? {
        code: error.code || "VAULT_INDEX_REBUILD_FAILED",
        message: error.message || "Vault 索引重建失败。",
      }
    : null;
}

export function createVaultSyncService({
  vaultRoot,
  buildIndex = buildVaultIndex,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!vaultRoot) {
    throw new VaultSyncError("INVALID_VAULT_ROOT", "Vault 同步服务缺少根目录。");
  }
  const resolvedRoot = path.resolve(vaultRoot);
  const listeners = new Set();
  const pendingPaths = new Map();
  let index = null;
  let indexPromise = null;
  let refreshPromise = null;
  let debounceTimer = null;
  let watcherCleanup = null;
  let closed = false;
  let indexVersion = 0;
  let status = "starting";
  let lastChangeAt = null;
  let lastIndexedAt = null;
  let lastError = null;

  function snapshot() {
    return {
      status,
      indexVersion,
      lastChangeAt,
      lastIndexedAt,
      pendingChangeCount: pendingPaths.size,
      lastError: publicError(lastError),
    };
  }

  function emit(event) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // A browser subscriber cannot interrupt indexing.
      }
    }
  }

  async function rebuild({ reason = "manual", paths = [], eventTypes = [] } = {}) {
    if (closed) throw new VaultSyncError("SERVICE_CLOSED", "Vault 同步服务已关闭。");
    if (refreshPromise) return refreshPromise;
    status = "rebuilding";
    lastError = null;
    const startedAt = now().toISOString();
    emit({ type: "vault.index.rebuilding", startedAt, reason, ...snapshot() });
    refreshPromise = (async () => {
      try {
        indexPromise = buildIndex(resolvedRoot);
        const nextIndex = await indexPromise;
        index = nextIndex;
        indexVersion += 1;
        status = watcherCleanup ? "watching" : "ready";
        lastIndexedAt = now().toISOString();
        const changedPaths = [...new Set(paths)].slice(0, MAX_EVENT_PATHS);
        const event = {
          type: "vault.index.changed",
          reason,
          generatedAt: nextIndex.generatedAt,
          changedPaths,
          affectedScopes: affectedScopesForPaths(changedPaths),
          changeCount: paths.length,
          eventTypes: [...new Set(eventTypes)].sort(),
          ...snapshot(),
        };
        emit(event);
        return nextIndex;
      } catch (error) {
        lastError = error;
        status = index ? "degraded" : "failed";
        if (!index) indexPromise = null;
        emit({
          type: "vault.index.failed",
          reason,
          changedPaths: [...new Set(paths)].slice(0, MAX_EVENT_PATHS),
          ...snapshot(),
        });
        throw error;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function currentIndex() {
    if (index) return index;
    if (!indexPromise) indexPromise = rebuild({ reason: "initial" });
    return indexPromise;
  }

  function flushPending() {
    if (debounceTimer) {
      clearTimer(debounceTimer);
      debounceTimer = null;
    }
    if (!pendingPaths.size || closed) return Promise.resolve(index);
    if (refreshPromise) {
      return refreshPromise
        .catch(() => index)
        .then(() => flushPending());
    }
    const changes = [...pendingPaths.entries()];
    pendingPaths.clear();
    return rebuild({
      reason: "filesystem",
      paths: changes.map(([relativePath]) => relativePath),
      eventTypes: changes.map(([, eventType]) => eventType),
    }).catch(() => index);
  }

  function queueChange(eventType, candidatePath) {
    if (closed || !TRACKED_EVENTS.has(eventType)) return false;
    const relativePath = normalizeVaultEventPath(resolvedRoot, candidatePath);
    if (!relativePath) return false;
    pendingPaths.set(relativePath, eventType);
    lastChangeAt = now().toISOString();
    status = "pending";
    if (debounceTimer) clearTimer(debounceTimer);
    debounceTimer = setTimer(() => {
      debounceTimer = null;
      void flushPending();
    }, debounceMs);
    debounceTimer?.unref?.();
    return true;
  }

  function notifyPaths(paths, eventType = "change") {
    for (const changedPath of paths ?? []) {
      const candidate = path.isAbsolute(changedPath)
        ? changedPath
        : path.join(resolvedRoot, changedPath);
      queueChange(eventType, candidate);
    }
  }

  function attachWatcher(watcher) {
    if (!watcher || typeof watcher.on !== "function") return () => {};
    watcher.add?.(resolvedRoot);
    const onAll = (eventType, changedPath) => queueChange(eventType, changedPath);
    watcher.on("all", onAll);
    watcherCleanup = () => {
      watcher.off?.("all", onAll);
      watcher.unwatch?.(resolvedRoot);
      watcherCleanup = null;
    };
    if (index) status = "watching";
    return watcherCleanup;
  }

  function subscribe(listener, { emitCurrent = true } = {}) {
    if (typeof listener !== "function") {
      throw new VaultSyncError("INVALID_LISTENER", "Vault 同步订阅器必须是函数。");
    }
    listeners.add(listener);
    if (emitCurrent) listener({ type: "vault.sync.snapshot", ...snapshot() });
    return () => listeners.delete(listener);
  }

  async function close() {
    if (closed) return;
    closed = true;
    status = "stopped";
    if (debounceTimer) clearTimer(debounceTimer);
    debounceTimer = null;
    pendingPaths.clear();
    watcherCleanup?.();
    listeners.clear();
    await refreshPromise?.catch(() => {});
  }

  return Object.freeze({
    currentIndex,
    refresh: rebuild,
    flushPending,
    queueChange,
    notifyPaths,
    attachWatcher,
    subscribe,
    getStatus: snapshot,
    close,
  });
}
