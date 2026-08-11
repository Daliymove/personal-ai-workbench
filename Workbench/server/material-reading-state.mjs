import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { DEFAULT_VAULT_ROOT, isPathInside } from "./security.mjs";

export const MATERIAL_READING_STATE_PATH =
  "10_raw/my-thoughts/reading-notes/.workbench-material-reading-state.json";

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 5_000;
const MAX_PATH_LENGTH = 768;
const STORE_DIRECTORY = path.posix.dirname(MATERIAL_READING_STATE_PATH);

export class MaterialReadingStateError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "MaterialReadingStateError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new MaterialReadingStateError(code, message, details);
}

function normalizePath(value) {
  if (typeof value !== "string") fail("INVALID_MATERIAL_PATH", "素材路径必须是字符串。");
  const result = value.normalize("NFC").trim();
  if (!result || result.length > MAX_PATH_LENGTH) {
    fail("INVALID_MATERIAL_PATH", "素材路径为空或过长。");
  }
  if (
    path.isAbsolute(result) ||
    result.includes("\\") ||
    result.includes("\0") ||
    result.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
    !result.startsWith("10_raw/")
  ) {
    fail("INVALID_MATERIAL_PATH", "待看状态只接受 10_raw 下的 Vault 相对路径。");
  }
  return result;
}

function normalizeId(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    fail("INVALID_MATERIAL_DOCUMENT", "素材文档 ID 无效。");
  }
  return value.trim();
}

function normalizeOptional(value, maximum = 512) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > maximum) {
    fail("INVALID_MATERIAL_DOCUMENT", "素材版本字段无效。");
  }
  return value;
}

function emptyStore() {
  return { version: STORE_VERSION, updatedAt: null, items: [] };
}

async function ensureSafeStorageDirectory(vaultRoot) {
  let realVaultRoot;
  try {
    realVaultRoot = await realpath(path.resolve(vaultRoot));
  } catch (error) {
    fail("INVALID_VAULT", "Vault 不存在或不可访问。", { cause: error?.code });
  }
  const rootDetails = await stat(realVaultRoot);
  if (!rootDetails.isDirectory()) fail("INVALID_VAULT", "Vault 不是目录。");

  let parent = realVaultRoot;
  for (const segment of STORE_DIRECTORY.split("/")) {
    const candidate = path.join(parent, segment);
    let details;
    try {
      details = await lstat(candidate);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(candidate, { mode: 0o700 });
      details = await lstat(candidate);
    }
    if (details.isSymbolicLink() || !details.isDirectory()) {
      fail(
        "UNSAFE_MATERIAL_READING_STATE_DIRECTORY",
        `${segment} 必须是 Vault 内的真实目录，不能是符号链接。`,
      );
    }
    const resolved = await realpath(candidate);
    if (!isPathInside(realVaultRoot, resolved) || !isPathInside(parent, resolved)) {
      fail("SYMLINK_ESCAPE", "素材待看状态目录越出了 Vault。");
    }
    parent = resolved;
  }
  return parent;
}

async function safeStorePath(vaultRoot) {
  const directory = await ensureSafeStorageDirectory(vaultRoot);
  const targetPath = path.join(directory, path.posix.basename(MATERIAL_READING_STATE_PATH));
  try {
    const details = await lstat(targetPath);
    if (details.isSymbolicLink() || !details.isFile()) {
      fail(
        "UNSAFE_MATERIAL_READING_STATE_STORE",
        "素材待看状态必须是普通文件，不能是符号链接。",
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return targetPath;
}

function clone(value) {
  return structuredClone(value);
}

function validatePersistedStore(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MATERIAL_READING_STATE_CORRUPT", "素材待看状态文件格式无效。");
  }
  if (value.version !== STORE_VERSION || !Array.isArray(value.items)) {
    fail("MATERIAL_READING_STATE_CORRUPT", "素材待看状态文件版本无效。");
  }
  if (value.items.length > MAX_ITEMS) {
    fail("MATERIAL_READING_STATE_TOO_LARGE", "素材待看记录超过安全上限。");
  }
  const seenIds = new Set();
  const seenPaths = new Set();
  const items = value.items.map((item) => {
    const documentId = normalizeId(item.documentId);
    const relativePath = normalizePath(item.relativePath);
    if (seenIds.has(documentId) || seenPaths.has(relativePath)) {
      fail("MATERIAL_READING_STATE_CORRUPT", "素材待看状态存在重复记录。");
    }
    seenIds.add(documentId);
    seenPaths.add(relativePath);
    return {
      documentId,
      relativePath,
      contentHash: normalizeOptional(item.contentHash),
      contentFingerprint: normalizeOptional(item.contentFingerprint),
      status: "queued",
      queuedAt: String(item.queuedAt || item.updatedAt || ""),
      updatedAt: String(item.updatedAt || item.queuedAt || ""),
    };
  });
  return {
    version: STORE_VERSION,
    updatedAt: value.updatedAt ? String(value.updatedAt) : null,
    items,
  };
}

export function createMaterialReadingStateRepository({
  vaultRoot = DEFAULT_VAULT_ROOT,
  now = () => new Date(),
} = {}) {
  const resolvedRoot = path.resolve(vaultRoot);
  const absoluteStorePath = path.resolve(resolvedRoot, MATERIAL_READING_STATE_PATH);
  if (!isPathInside(resolvedRoot, absoluteStorePath)) {
    fail("UNSAFE_MATERIAL_READING_STATE", "素材待看状态路径越出了 Vault。");
  }
  let mutationQueue = Promise.resolve();

  async function readStore() {
    const targetPath = await safeStorePath(resolvedRoot);
    let details;
    try {
      details = await stat(targetPath);
    } catch (error) {
      if (error?.code === "ENOENT") return emptyStore();
      throw error;
    }
    if (!details.isFile() || details.size > MAX_STORE_BYTES) {
      fail("MATERIAL_READING_STATE_TOO_LARGE", "素材待看状态文件无效或超过安全上限。");
    }
    let parsed;
    try {
      parsed = JSON.parse(await readFile(targetPath, "utf8"));
    } catch (error) {
      fail("MATERIAL_READING_STATE_CORRUPT", "素材待看状态文件无法解析。", {
        cause: error?.code || error?.message,
      });
    }
    return validatePersistedStore(parsed);
  }

  async function writeStore(store) {
    const normalized = validatePersistedStore(store);
    const targetPath = await safeStorePath(resolvedRoot);
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    const content = `${JSON.stringify(normalized, null, 2)}\n`;
    if (Buffer.byteLength(content, "utf8") > MAX_STORE_BYTES) {
      fail("MATERIAL_READING_STATE_TOO_LARGE", "素材待看状态超过安全上限。");
    }
    try {
      await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await safeStorePath(resolvedRoot);
      await rename(temporaryPath, targetPath);
    } finally {
      await unlink(temporaryPath).catch(() => {});
    }
    return normalized;
  }

  function mutate(operation) {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.catch(() => {});
    return result;
  }

  async function list() {
    return clone(await readStore());
  }

  function add(document) {
    return mutate(async () => {
      const documentId = normalizeId(document?.id ?? document?.documentId);
      const relativePath = normalizePath(document?.relativePath ?? document?.path);
      const timestamp = now().toISOString();
      const store = await readStore();
      const previous = store.items.find(
        (item) => item.documentId === documentId || item.relativePath === relativePath,
      );
      const next = {
        documentId,
        relativePath,
        contentHash: normalizeOptional(document?.contentHash),
        contentFingerprint: normalizeOptional(document?.contentFingerprint),
        status: "queued",
        queuedAt: previous?.queuedAt || timestamp,
        updatedAt: timestamp,
      };
      const items = [
        next,
        ...store.items.filter(
          (item) => item.documentId !== documentId && item.relativePath !== relativePath,
        ),
      ];
      if (items.length > MAX_ITEMS) {
        fail("TOO_MANY_MATERIAL_READING_ITEMS", "素材待看记录超过安全上限。");
      }
      const saved = await writeStore({ version: STORE_VERSION, updatedAt: timestamp, items });
      return clone(saved.items[0]);
    });
  }

  function remove({ documentId = null, relativePath = null } = {}) {
    return mutate(async () => {
      const safeId = documentId == null ? null : normalizeId(documentId);
      const safePath = relativePath == null ? null : normalizePath(relativePath);
      if (!safeId && !safePath) {
        fail("INVALID_MATERIAL_DOCUMENT", "移出待看需要文档 ID 或路径。");
      }
      const store = await readStore();
      const items = store.items.filter(
        (item) => item.documentId !== safeId && item.relativePath !== safePath,
      );
      if (items.length === store.items.length) return false;
      const timestamp = now().toISOString();
      await writeStore({ version: STORE_VERSION, updatedAt: timestamp, items });
      return true;
    });
  }

  return Object.freeze({ list, add, remove });
}
