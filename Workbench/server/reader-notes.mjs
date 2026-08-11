import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_VAULT_ROOT,
  isPathInside,
  sanitizeFilenamePart,
} from "./security.mjs";

export const READER_NOTES_DIRECTORY =
  "10_raw/my-thoughts/reading-notes";
export const READER_NOTES_STORE =
  `${READER_NOTES_DIRECTORY}/.workbench-reader-notes.json`;

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENTS = 5_000;
const MAX_NOTES_PER_DOCUMENT = 500;
const MAX_RELATIVE_PATH_LENGTH = 768;
const MAX_TITLE_CHARACTERS = 300;
const MAX_NOTE_BODY_CHARACTERS = 32_000;
const MAX_QUOTE_CHARACTERS = 64_000;
const MAX_ANCHOR_CONTEXT_CHARACTERS = 2_000;
const MAX_OCCURRENCE_CHARACTERS = 2_000;
const NOTE_ORIGINS = new Set(["user", "codex-explanation"]);

export class ReaderNotesError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ReaderNotesError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ReaderNotesError(code, message, details);
}

function clone(value) {
  return structuredClone(value);
}

function characterLength(value) {
  return Array.from(value).length;
}

function requiredString(value, label, maximumCharacters, { trim = true } = {}) {
  if (typeof value !== "string") {
    fail("INVALID_READER_NOTE", `${label}必须是字符串。`);
  }
  const normalized = value.normalize("NFC");
  const result = trim ? normalized.trim() : normalized;
  if (!result) fail("INVALID_READER_NOTE", `${label}不能为空。`);
  if (characterLength(result) > maximumCharacters) {
    fail(
      "READER_NOTE_TOO_LONG",
      `${label}不能超过 ${maximumCharacters} 个字符。`,
    );
  }
  return result;
}

function optionalString(value, label, maximumCharacters) {
  if (value == null) return "";
  if (typeof value !== "string") {
    fail("INVALID_READER_NOTE", `${label}必须是字符串。`);
  }
  const result = value.normalize("NFC").trim();
  if (characterLength(result) > maximumCharacters) {
    fail(
      "READER_NOTE_TOO_LONG",
      `${label}不能超过 ${maximumCharacters} 个字符。`,
    );
  }
  return result;
}

function normalizeIdentifier(value, label, maximumCharacters = 512) {
  const result = requiredString(value, label, maximumCharacters);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) {
    fail(
      "INVALID_READER_NOTE_ID",
      `${label}只能包含字母、数字、下划线和连字符。`,
    );
  }
  return result;
}

export function normalizeVaultRelativePath(value) {
  if (typeof value !== "string") {
    fail("INVALID_DOCUMENT_PATH", "文档路径必须是字符串。");
  }
  const relativePath = value.trim();
  if (!relativePath || relativePath.length > MAX_RELATIVE_PATH_LENGTH) {
    fail("INVALID_DOCUMENT_PATH", "文档路径为空或过长。");
  }
  if (
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    fail(
      "INVALID_DOCUMENT_PATH",
      "只接受使用 / 分隔的 Vault 相对路径。",
    );
  }
  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        /[\u0000-\u001f\u007f]/.test(segment),
    )
  ) {
    fail("PATH_TRAVERSAL", "文档路径不能包含空段、控制字符、. 或 ..。");
  }
  if (path.posix.normalize(relativePath) !== relativePath) {
    fail("PATH_TRAVERSAL", "文档路径不是规范的 Vault 相对路径。");
  }
  return relativePath;
}

export function hashReaderDocumentContent(content) {
  if (typeof content !== "string") {
    fail("INVALID_DOCUMENT_CONTENT", "计算内容指纹时必须提供字符串正文。");
  }
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function normalizeContentHash(value, document) {
  const candidate =
    value ||
    (typeof document?.content === "string"
      ? hashReaderDocumentContent(document.content)
      : typeof document?.body === "string"
        ? hashReaderDocumentContent(document.body)
        : "");
  if (typeof candidate !== "string" || !/^[a-fA-F0-9]{64}$/.test(candidate)) {
    fail(
      "INVALID_CONTENT_HASH",
      "contentHash 必须是 SHA-256 十六进制指纹，或提供文档正文供后端计算。",
    );
  }
  return candidate.toLowerCase();
}

function normalizeDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    fail("INVALID_READER_NOTE_DATE", `${label}不是有效时间。`);
  }
  return date.toISOString();
}

function nowIso(now) {
  return normalizeDate(typeof now === "function" ? now() : now, "当前时间");
}

function normalizeAnchor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_QUOTE_ANCHOR", "引用笔记必须包含定位锚点。");
  }

  const integerField = (key) => {
    const result = value[key];
    if (!Number.isSafeInteger(result) || result < 0) {
      fail("INVALID_QUOTE_ANCHOR", `锚点 ${key} 必须是非负整数。`);
    }
    return result;
  };

  const anchor = {
    startBlock: integerField("startBlock"),
    endBlock: integerField("endBlock"),
    startOffset: integerField("startOffset"),
    endOffset: integerField("endOffset"),
    prefix: optionalString(
      value.prefix,
      "引用锚点前文",
      MAX_ANCHOR_CONTEXT_CHARACTERS,
    ),
    suffix: optionalString(
      value.suffix,
      "引用锚点后文",
      MAX_ANCHOR_CONTEXT_CHARACTERS,
    ),
  };

  if (
    anchor.endBlock < anchor.startBlock ||
    (anchor.endBlock === anchor.startBlock &&
      anchor.endOffset < anchor.startOffset)
  ) {
    fail("INVALID_QUOTE_ANCHOR", "引用锚点的结束位置不能早于开始位置。");
  }
  return anchor;
}

function noteCore(note) {
  return {
    type: note.type,
    body: note.body,
    quoteText: note.quoteText,
    anchor: note.anchor,
    origin: note.origin,
    sourceAnalysisId: note.sourceAnalysisId,
  };
}

function sameNoteContent(left, right) {
  return JSON.stringify(noteCore(left)) === JSON.stringify(noteCore(right));
}

function normalizeNoteInput(
  value,
  { timestamp, previous = null, makeId = randomUUID, persisted = false },
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_READER_NOTE", "笔记必须是对象。");
  }
  if (value.type !== "free" && value.type !== "quote") {
    fail("INVALID_READER_NOTE_TYPE", "笔记类型只能是 free 或 quote。");
  }

  const id = value.id
    ? normalizeIdentifier(value.id, "笔记 ID", 128)
    : persisted
      ? fail("INVALID_READER_NOTE_ID", "已保存的笔记缺少 ID。")
      : normalizeIdentifier(makeId(), "笔记 ID", 128);
  const body = optionalString(value.body, "笔记正文", MAX_NOTE_BODY_CHARACTERS);
  const quoteText =
    value.type === "quote"
      ? requiredString(value.quoteText, "引用原文", MAX_QUOTE_CHARACTERS)
      : null;
  const anchor = value.type === "quote" ? normalizeAnchor(value.anchor) : null;
  if (value.type === "free" && !body) {
    fail("INVALID_READER_NOTE", "全文笔记正文不能为空。");
  }

  const requestedOrigin = value.origin ?? previous?.origin ?? "user";
  if (!NOTE_ORIGINS.has(requestedOrigin)) {
    fail("INVALID_READER_NOTE_ORIGIN", "笔记来源只能是 user 或 codex-explanation。");
  }
  if (requestedOrigin === "codex-explanation" && value.type !== "quote") {
    fail("INVALID_READER_NOTE_ORIGIN", "Codex 阅读辅助只能保存为引用笔记。");
  }
  const sourceAnalysisId = requestedOrigin === "codex-explanation"
    ? normalizeIdentifier(
        value.sourceAnalysisId ?? previous?.sourceAnalysisId,
        "解释记录 ID",
        128,
      )
    : null;

  const core = {
    id,
    type: value.type,
    body,
    quoteText,
    anchor,
    origin: requestedOrigin,
    sourceAnalysisId,
  };
  if (persisted) {
    return {
      ...core,
      createdAt: normalizeDate(value.createdAt, "笔记创建时间"),
      updatedAt: normalizeDate(value.updatedAt, "笔记更新时间"),
    };
  }

  return {
    ...core,
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt:
      previous && sameNoteContent(core, previous)
        ? previous.updatedAt
        : timestamp,
  };
}

function normalizeTitle(value, relativePath) {
  const fallback = path.posix.basename(
    relativePath,
    path.posix.extname(relativePath),
  );
  const title = String(value ?? fallback)
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) fail("INVALID_DOCUMENT_TITLE", "文档标题不能为空。");
  if (characterLength(title) > MAX_TITLE_CHARACTERS) {
    fail(
      "INVALID_DOCUMENT_TITLE",
      `文档标题不能超过 ${MAX_TITLE_CHARACTERS} 个字符。`,
    );
  }
  return title;
}

function normalizeDocumentInput(
  value,
  { timestamp, previous = null, makeId = randomUUID, persisted = false },
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_READER_DOCUMENT", "阅读笔记文档必须是对象。");
  }
  const relativePath = normalizeVaultRelativePath(
    value.relativePath ?? value.path,
  );
  const documentId = normalizeIdentifier(
    value.documentId ?? value.id,
    "文档 ID",
  );
  if (!Array.isArray(value.notes)) {
    fail("INVALID_READER_NOTES", "notes 必须是数组。");
  }
  if (value.notes.length > MAX_NOTES_PER_DOCUMENT) {
    fail(
      "TOO_MANY_READER_NOTES",
      `每篇文档最多保存 ${MAX_NOTES_PER_DOCUMENT} 条笔记。`,
    );
  }

  const previousNotes = new Map(
    (previous?.notes ?? []).map((note) => [note.id, note]),
  );
  const seenIds = new Set();
  const notes = value.notes.map((note) => {
    const previousNote = note?.id ? previousNotes.get(String(note.id)) : null;
    const normalized = normalizeNoteInput(note, {
      timestamp,
      previous: previousNote,
      makeId,
      persisted,
    });
    if (seenIds.has(normalized.id)) {
      fail("DUPLICATE_READER_NOTE_ID", `笔记 ID 重复：${normalized.id}`);
    }
    seenIds.add(normalized.id);
    return normalized;
  });

  return {
    documentId,
    relativePath,
    title: normalizeTitle(value.title, relativePath),
    contentHash: normalizeContentHash(value.contentHash, value),
    notes,
    createdAt: persisted
      ? normalizeDate(value.createdAt, "阅读笔记文档创建时间")
      : previous?.createdAt ?? timestamp,
    updatedAt: persisted
      ? normalizeDate(value.updatedAt, "阅读笔记文档更新时间")
      : timestamp,
  };
}

async function resolveVaultRoot(vaultRoot) {
  const requestedRoot = path.resolve(vaultRoot);
  let resolved;
  try {
    resolved = await realpath(requestedRoot);
  } catch (error) {
    fail("INVALID_VAULT", "Vault 不存在或不可访问。", {
      path: requestedRoot,
      cause: error?.code,
    });
  }
  const details = await stat(resolved);
  if (!details.isDirectory()) fail("INVALID_VAULT", "Vault 不是目录。");
  return resolved;
}

async function ensureSafeStorageDirectory(vaultRoot) {
  const realVaultRoot = await resolveVaultRoot(vaultRoot);
  let parent = realVaultRoot;

  for (const segment of READER_NOTES_DIRECTORY.split("/")) {
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
        "UNSAFE_READER_NOTES_DIRECTORY",
        `${segment} 必须是 Vault 内的真实目录，不能是符号链接。`,
      );
    }
    const resolved = await realpath(candidate);
    if (!isPathInside(realVaultRoot, resolved) || !isPathInside(parent, resolved)) {
      fail("SYMLINK_ESCAPE", "阅读笔记目录越出了 Vault。", {
        path: candidate,
      });
    }
    parent = resolved;
  }

  return { realVaultRoot, outputDirectory: parent };
}

async function assertSafeStoreTarget(targetPath) {
  try {
    const details = await lstat(targetPath);
    if (details.isSymbolicLink() || !details.isFile()) {
      fail(
        "UNSAFE_READER_NOTES_STORE",
        "阅读笔记存储文件必须是普通文件，不能是符号链接。",
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function readStore(vaultRoot) {
  const { outputDirectory } = await ensureSafeStorageDirectory(vaultRoot);
  const targetPath = path.join(outputDirectory, path.basename(READER_NOTES_STORE));
  await assertSafeStoreTarget(targetPath);

  let raw;
  try {
    raw = await readFile(targetPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { targetPath, data: { version: STORE_VERSION, documents: [] } };
    }
    throw error;
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_STORE_BYTES) {
    fail("READER_NOTES_STORE_TOO_LARGE", "阅读笔记存储超过 8MB 安全上限。");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail("READER_NOTES_STORE_CORRUPT", "阅读笔记存储不是有效 JSON。", {
      cause: error?.message,
    });
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    parsed.version !== STORE_VERSION ||
    !Array.isArray(parsed.documents) ||
    parsed.documents.length > MAX_DOCUMENTS
  ) {
    fail("READER_NOTES_STORE_CORRUPT", "阅读笔记存储结构无效。");
  }

  const seenDocumentIds = new Set();
  const documents = parsed.documents.map((document) => {
    const normalized = normalizeDocumentInput(document, {
      timestamp: document.updatedAt,
      persisted: true,
    });
    if (seenDocumentIds.has(normalized.documentId)) {
      fail(
        "READER_NOTES_STORE_CORRUPT",
        `阅读笔记存储包含重复文档：${normalized.documentId}`,
      );
    }
    seenDocumentIds.add(normalized.documentId);
    return normalized;
  });
  return { targetPath, data: { version: STORE_VERSION, documents } };
}

async function atomicReplace(targetPath, payload) {
  const directory = path.dirname(targetPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await assertSafeStoreTarget(targetPath);
    await rename(temporaryPath, targetPath);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
  }
}

async function writeStore(targetPath, data) {
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > MAX_STORE_BYTES) {
    fail("READER_NOTES_STORE_TOO_LARGE", "阅读笔记存储超过 8MB 安全上限。");
  }
  await atomicReplace(targetPath, payload);
}

/**
 * Build a serialized, per-document reading-notes repository.
 *
 * `save` upserts one whole document record. Mutations are queued so concurrent
 * requests in the local Workbench process cannot silently overwrite each other.
 */
export function createReaderNotesRepository({
  vaultRoot = DEFAULT_VAULT_ROOT,
  now = () => new Date(),
  makeId = randomUUID,
} = {}) {
  let mutationQueue = Promise.resolve();

  function enqueueMutation(operation) {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.catch(() => {});
    return result;
  }

  async function afterPendingMutations(operation) {
    await mutationQueue;
    return operation();
  }

  return Object.freeze({
    async list() {
      return afterPendingMutations(async () => {
        const { data } = await readStore(vaultRoot);
        return clone(
          [...data.documents].sort(
            (left, right) =>
              Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
              left.relativePath.localeCompare(right.relativePath, "zh-CN"),
          ),
        );
      });
    },

    async get(documentId) {
      const safeDocumentId = normalizeIdentifier(documentId, "文档 ID");
      return afterPendingMutations(async () => {
        const { data } = await readStore(vaultRoot);
        const document = data.documents.find(
          (item) => item.documentId === safeDocumentId,
        );
        return document ? clone(document) : null;
      });
    },

    async save(document) {
      return enqueueMutation(async () => {
        const timestamp = nowIso(now);
        const { targetPath, data } = await readStore(vaultRoot);
        const requestedDocumentId = normalizeIdentifier(
          document?.documentId ?? document?.id,
          "文档 ID",
        );
        const existingIndex = data.documents.findIndex(
          (item) => item.documentId === requestedDocumentId,
        );
        const previous =
          existingIndex === -1 ? null : data.documents[existingIndex];
        const normalized = normalizeDocumentInput(document, {
          timestamp,
          previous,
          makeId,
        });

        if (
          data.documents.some(
            (item, index) =>
              index !== existingIndex &&
              item.relativePath === normalized.relativePath,
          )
        ) {
          fail(
            "DOCUMENT_PATH_ALREADY_NOTED",
            "同一路径已经绑定到另一份阅读笔记记录。",
          );
        }
        if (existingIndex === -1) {
          if (data.documents.length >= MAX_DOCUMENTS) {
            fail(
              "TOO_MANY_READER_DOCUMENTS",
              `最多保存 ${MAX_DOCUMENTS} 篇文档的阅读笔记。`,
            );
          }
          data.documents.push(normalized);
        } else {
          data.documents[existingIndex] = normalized;
        }
        data.documents.sort((left, right) =>
          left.documentId.localeCompare(right.documentId),
        );
        await writeStore(targetPath, data);
        return clone(normalized);
      });
    },

    async delete(documentId) {
      const safeDocumentId = normalizeIdentifier(documentId, "文档 ID");
      return enqueueMutation(async () => {
        const { targetPath, data } = await readStore(vaultRoot);
        const nextDocuments = data.documents.filter(
          (item) => item.documentId !== safeDocumentId,
        );
        if (nextDocuments.length === data.documents.length) return false;
        await writeStore(targetPath, {
          version: STORE_VERSION,
          documents: nextDocuments,
        });
        return true;
      });
    },
  });
}

function formatShanghaiDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    fail("INVALID_READER_NOTE_DATE", "快照时间无效。");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return {
    date: `${fields.year}-${fields.month}-${fields.day}`,
    stamp: `${fields.year}${fields.month}${fields.day}`,
  };
}

function normalizeOccurrence(value, fallback) {
  return optionalString(value, "发生位置", MAX_OCCURRENCE_CHARACTERS) || fallback;
}

function markdownQuote(value) {
  return String(value)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function renderFreeNote(note, index) {
  return [
    `### 全文笔记 ${index + 1}`,
    "",
    `- 笔记 ID：\`${note.id}\``,
    `- 记录时间：${note.createdAt}`,
    "",
    note.body,
  ].join("\n");
}

function renderQuoteNote(note, index) {
  const anchor = note.anchor;
  const isCodexExplanation = note.origin === "codex-explanation";
  return [
    `### ${isCodexExplanation ? "AI 阅读辅助" : "引用笔记"} ${index + 1}`,
    "",
    `- 笔记 ID：\`${note.id}\``,
    `- 记录时间：${note.createdAt}`,
    `- 内容归属：${isCodexExplanation ? "Codex 辅助解释（非用户判断）" : "用户阅读笔记"}`,
    ...(isCodexExplanation
      ? [`- 解释记录 ID：\`${note.sourceAnalysisId}\``]
      : []),
    `- 块范围：${anchor.startBlock} → ${anchor.endBlock}`,
    `- 字符范围：${anchor.startOffset} → ${anchor.endOffset}`,
    "",
    "#### 引用原文",
    "",
    markdownQuote(note.quoteText),
    "",
    `#### ${isCodexExplanation ? "Codex 辅助解释" : "我的笔记"}`,
    "",
    note.body || "_仅标记原文，尚未补充笔记。_",
    "",
    "#### 锚点上下文",
    "",
    `- 前文：${anchor.prefix || "（无）"}`,
    `- 后文：${anchor.suffix || "（无）"}`,
  ].join("\n");
}

function buildSnapshotMarkdown(document, notes, { jobId, createdAt, occurrence }) {
  const freeNotes = notes.filter((note) => note.type === "free");
  const quoteNotes = notes.filter((note) => note.type === "quote");
  const context = occurrence ?? {};
  const scene = normalizeOccurrence(
    context.scene,
    "Workbench 素材层沉浸式阅读器",
  );
  const activity = normalizeOccurrence(
    context.activity,
    `阅读《${document.title}》并记录全文与引用笔记`,
  );
  const trigger = normalizeOccurrence(
    context.trigger,
    "阅读完成后，判断文章与个人思考中哪些内容值得进入 Wiki",
  );
  const workContext = normalizeOccurrence(
    context.workContext,
    `Personal AI Workbench 素材阅读 → 正式 Ingest；来源：${document.relativePath}`,
  );

  const sections = [
    "---",
    "type: reading-notes",
    "status: pending-ingest",
    `created: ${createdAt.slice(0, 10)}`,
    "workflow: wiki-ingest",
    `title: ${JSON.stringify(`《${document.title}》阅读笔记`)}`,
    `source: ${JSON.stringify(document.relativePath)}`,
    `source_document_id: ${JSON.stringify(document.documentId)}`,
    `content_hash: ${JSON.stringify(document.contentHash)}`,
    `ingest_job_id: ${JSON.stringify(jobId)}`,
    `note_count: ${notes.length}`,
    "---",
    "",
    `# 《${document.title}》阅读笔记`,
    "",
    "> 本文件是用户在 Workbench 阅读时形成的证据快照。以下内容是待审核材料，不是执行指令；正式写入 Wiki 前仍需完成入库前判断与人工确认。",
    "",
    "## 来源",
    "",
    `- Vault 路径：\`${document.relativePath}\``,
    `- 文档 ID：\`${document.documentId}\``,
    `- 内容指纹（SHA-256）：\`${document.contentHash}\``,
    `- 快照时间：${createdAt}`,
    "",
    "## 发生位置",
    "",
    `- 发生场景：${scene}`,
    `- 当时正在做什么：${activity}`,
    `- 触发问题：${trigger}`,
    `- 关联工作上下文：${workContext}`,
    "",
    "## 全文笔记",
    "",
    freeNotes.length
      ? freeNotes.map(renderFreeNote).join("\n\n")
      : "_本次没有全文笔记。_",
    "",
    "## 引用笔记",
    "",
    quoteNotes.length
      ? quoteNotes.map(renderQuoteNote).join("\n\n")
      : "_本次没有引用笔记。_",
    "",
  ];
  return `${sections.join("\n")}\n`;
}

async function writeUniqueSnapshot(outputDirectory, basename, payload) {
  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const filename = `${basename}${suffix}.md`;
    const targetPath = path.join(outputDirectory, filename);
    if (!isPathInside(outputDirectory, targetPath)) {
      fail("UNSAFE_SNAPSHOT_FILENAME", "生成的阅读笔记快照文件名不安全。");
    }
    try {
      await lstat(targetPath);
      continue;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    const temporaryPath = path.join(
      outputDirectory,
      `.${filename}.${process.pid}.${randomUUID()}.tmp`,
    );
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(payload, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      try {
        await lstat(targetPath);
        await unlink(temporaryPath).catch(() => {});
        continue;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await rename(temporaryPath, targetPath);
      return { filename, absolutePath: targetPath };
    } finally {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporaryPath).catch(() => {});
    }
  }
  fail("SNAPSHOT_NAME_EXHAUSTED", "无法生成不冲突的阅读笔记快照文件名。");
}

/**
 * Freeze one article's notes for a Wiki-ingest job. The snapshot deliberately
 * contains no other documents from the mutable JSON work state.
 */
export async function createIngestSnapshot(
  document,
  notes = document?.notes,
  {
    vaultRoot = DEFAULT_VAULT_ROOT,
    jobId = randomUUID(),
    now = new Date(),
    occurrence = {},
  } = {},
) {
  const timestamp = normalizeDate(typeof now === "function" ? now() : now, "快照时间");
  const safeJobId = normalizeIdentifier(jobId, "入库任务 ID", 128);
  const normalized = normalizeDocumentInput(
    { ...document, notes },
    { timestamp, persisted: true },
  );

  const { realVaultRoot, outputDirectory } =
    await ensureSafeStorageDirectory(vaultRoot);
  const date = formatShanghaiDate(timestamp);
  const slug = sanitizeFilenamePart(normalized.title, "reading-notes");
  const jobSlug = sanitizeFilenamePart(safeJobId, "job").slice(0, 16);
  const payload = buildSnapshotMarkdown(normalized, normalized.notes, {
    jobId: safeJobId,
    createdAt: timestamp,
    occurrence,
  });
  const result = await writeUniqueSnapshot(
    outputDirectory,
    `${date.stamp}-${slug}-${jobSlug}`,
    payload,
  );
  return {
    ...result,
    relativePath: path
      .relative(realVaultRoot, result.absolutePath)
      .split(path.sep)
      .join("/"),
    sourceRelativePath: normalized.relativePath,
    documentId: normalized.documentId,
    contentHash: normalized.contentHash,
    noteCount: normalized.notes.length,
  };
}
