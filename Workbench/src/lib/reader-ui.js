export const READER_EXPLANATION_POLL_RETRY_LIMIT = 3;
export const CODEX_CLIENT_LAUNCH_URL = "codex://";
const READER_RESELECT_ERROR_CODES = new Set([
  "CONTENT_HASH_MISMATCH",
  "INVALID_QUOTE_ANCHOR",
  "QUOTE_CONTEXT_MISMATCH",
  "QUOTE_NOT_IN_DOCUMENT",
]);

const NON_CONTENT_BODIES = new Set([
  "该文件暂不支持正文预览。",
]);

export function readableDocumentBody(document) {
  for (const value of [document?.body, document?.bodyText]) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (normalized && !NON_CONTENT_BODIES.has(normalized)) return value;
  }
  return null;
}

export function canExplainDocument(document, contentHash) {
  return Boolean(
    readableDocumentBody(document) &&
      typeof contentHash === "string" &&
      contentHash.trim(),
  );
}

export function readerImageRequestProps(src, documentId = null) {
  const normalized = typeof src === "string" ? src.trim() : "";
  const isRemote = /^https?:\/\//i.test(normalized);
  const isBrowserOwned = /^(?:data|blob):/i.test(normalized);
  const resolvedSrc =
    normalized && documentId && !isRemote && !isBrowserOwned
      ? `/api/reader-images/${encodeURIComponent(documentId)}?${new URLSearchParams({
          src: normalized,
        }).toString()}`
      : normalized;
  return {
    src: resolvedSrc,
    loading: "lazy",
    decoding: "async",
    ...(isRemote ? { referrerPolicy: "no-referrer" } : {}),
  };
}

export function readerPreformattedBlockClassName(codeClassName) {
  return /\blanguage-[^\s]+/.test(String(codeClassName || ""))
    ? "reader-code-block"
    : "reader-prose-block";
}

export function readerPreformattedBlockText(codeClassName, value) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n");
  if (readerPreformattedBlockClassName(codeClassName) === "reader-code-block") {
    return text;
  }

  return text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanClipboardText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function markdownQuote(value) {
  const text = cleanClipboardText(value);
  return text
    ? text.split("\n").map((line) => `> ${line}`).join("\n")
    : "> （引用原文缺失）";
}

function obsidianLink(relativePath) {
  const path = cleanClipboardText(relativePath).replace(/\.md$/i, "");
  return path ? `[[${path}]]` : "（来源路径缺失）";
}

export function buildManualWikiIngestPackage({ document, notes = [] } = {}) {
  const sourcePath = cleanClipboardText(document?.relativePath ?? document?.path);
  if (!sourcePath) throw new Error("缺少来源全文路径，无法生成可审计材料包。");

  const title = cleanClipboardText(document?.title) || sourcePath.split("/").at(-1)?.replace(/\.md$/i, "") || "未命名材料";
  const contentHash = cleanClipboardText(document?.contentHash);
  const normalizedNotes = Array.isArray(notes) ? notes : [];
  const freeNotes = normalizedNotes.filter(
    (note) => note?.type !== "quote" && cleanClipboardText(note?.body),
  );
  const quoteNotes = normalizedNotes.filter(
    (note) => note?.type === "quote" && (cleanClipboardText(note?.quoteText) || cleanClipboardText(note?.body)),
  );

  const freeSections = freeNotes.length
    ? freeNotes.map((note, index) => [
        `### 全文笔记 ${index + 1}`,
        "",
        cleanClipboardText(note.body),
      ].join("\n")).join("\n\n")
    : "（暂无全文笔记）";

  const quoteSections = quoteNotes.length
    ? quoteNotes.map((note, index) => {
        const isCodexExplanation = note?.origin === "codex-explanation";
        return [
          `### 引用笔记 ${index + 1}${isCodexExplanation ? " · Codex 辅助解释（非用户判断）" : ""}`,
          "",
          "#### 引用原文",
          "",
          markdownQuote(note.quoteText),
          "",
          `#### ${isCodexExplanation ? "Codex 辅助解释" : "我的笔记"}`,
          "",
          cleanClipboardText(note.body) || "（仅标记原文，尚未补充笔记）",
        ].join("\n");
      }).join("\n\n")
    : "（暂无引用笔记）";

  const prompt = [
    "请使用 $media-content-wiki 对以下阅读材料执行 Wiki 入库前审查。",
    "",
    "重要边界：",
    "- 这条消息只请求“入库前判断与方案”，不授权写入 Wiki。",
    "- 请先读取来源全文，再结合全文笔记和引用笔记进行判断。",
    "- 请输出具体入库方案后暂停，等待我二次确认。",
    "- Codex 辅助解释不是我的判断，不能当作用户观点入库。",
    "",
    "## 来源全文",
    "",
    `- 标题：${title}`,
    `- Vault 相对路径：\`${sourcePath}\``,
    `- Obsidian 链接：${obsidianLink(sourcePath)}`,
    ...(contentHash ? [`- 内容指纹：\`${contentHash}\``] : []),
    "",
    "## 全文笔记",
    "",
    freeSections,
    "",
    "## 引用笔记",
    "",
    quoteSections,
  ].join("\n");

  return {
    prompt,
    sourcePath,
    sourceLink: obsidianLink(sourcePath),
    freeNoteCount: freeNotes.length,
    quoteNoteCount: quoteNotes.length,
  };
}

export function readerIngestExecutionFeedback(job) {
  if (job?.status !== "executing") return null;
  return {
    title: "确认已收到，正在写入 Wiki",
    description: "Codex 正在按你确认的审核方案执行。完成后，这里会显示写入结果和变更文件。",
    activityAt: job.updatedAt || job.confirmedAt || null,
  };
}

export function launchCodexClient(locationLike = globalThis.location) {
  if (typeof locationLike?.assign !== "function") return false;
  locationLike.assign(CODEX_CLIENT_LAUNCH_URL);
  return true;
}

export function readerIngestJobWithRecoveredHandoff(
  job,
  handoff,
  documentId = "document",
) {
  if (!handoff || (job && job.status !== "failed")) return job;
  return {
    ...(job || {}),
    id: job?.id || `recovered-${documentId}`,
    workflow: "wiki-ingest",
    status: "handoff_ready",
    progress: "awaiting_codex_client",
    handoff: { ...handoff },
    error: null,
    recoveredHandoff: true,
    recoveredFromStatus: job?.status || null,
  };
}

export function readerExplanationPollRetry(failureCount) {
  const attempt = Math.max(1, Math.trunc(Number(failureCount) || 1));
  const exhausted = attempt > READER_EXPLANATION_POLL_RETRY_LIMIT;
  return {
    attempt,
    exhausted,
    delay: exhausted ? null : Math.min(800 * 2 ** (attempt - 1), 4_800),
  };
}

export function readerExplanationRequiresReselection(code) {
  return READER_RESELECT_ERROR_CODES.has(String(code || ""));
}

function clamp(value, minimum, maximum) {
  if (minimum > maximum) return (minimum + maximum) / 2;
  return Math.min(Math.max(value, minimum), maximum);
}

export function clampSelectionToolbarPosition({
  rangeRect,
  toolbarRect,
  viewport,
  margin = 8,
  gap = 10,
}) {
  const viewportLeft = Number(viewport?.offsetLeft) || 0;
  const viewportTop = Number(viewport?.offsetTop) || 0;
  const viewportWidth = Math.max(0, Number(viewport?.width) || 0);
  const viewportHeight = Math.max(0, Number(viewport?.height) || 0);
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;
  const toolbarWidth = Math.max(0, Number(toolbarRect?.width) || 0);
  const toolbarHeight = Math.max(0, Number(toolbarRect?.height) || 0);
  const rangeLeft = Number(rangeRect?.left) || 0;
  const rangeTop = Number(rangeRect?.top) || 0;
  const rangeWidth = Math.max(0, Number(rangeRect?.width) || 0);
  const rangeBottom = Number(rangeRect?.bottom) || rangeTop;

  const halfWidth = toolbarWidth / 2;
  const left = clamp(
    rangeLeft + rangeWidth / 2,
    viewportLeft + margin + halfWidth,
    viewportRight - margin - halfWidth,
  );
  const fitsAbove =
    rangeTop - gap - toolbarHeight >= viewportTop + margin;
  const fitsBelow =
    rangeBottom + gap + toolbarHeight <= viewportBottom - margin;
  const spaceAbove = rangeTop - viewportTop;
  const spaceBelow = viewportBottom - rangeBottom;
  const placement = fitsAbove || (!fitsBelow && spaceAbove >= spaceBelow)
    ? "above"
    : "below";
  const top = placement === "above"
    ? clamp(
        rangeTop - gap,
        viewportTop + margin + toolbarHeight,
        viewportBottom - margin,
      )
    : clamp(
        rangeBottom + gap,
        viewportTop + margin,
        viewportBottom - margin - toolbarHeight,
      );

  return { left, top, placement };
}
