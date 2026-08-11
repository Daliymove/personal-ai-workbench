import assert from "node:assert/strict";
import test from "node:test";

import {
  httpApiError,
  isLocalOnlyApiError,
  LOCAL_API_UNAVAILABLE_MESSAGE,
} from "../src/lib/api-errors.js";
import {
  CODEX_CLIENT_LAUNCH_URL,
  buildManualWikiIngestPackage,
  canExplainDocument,
  clampSelectionToolbarPosition,
  launchCodexClient,
  readableDocumentBody,
  readerExplanationPollRetry,
  readerExplanationRequiresReselection,
  readerImageRequestProps,
  readerIngestExecutionFeedback,
  readerIngestJobWithRecoveredHandoff,
  readerPreformattedBlockClassName,
  readerPreformattedBlockText,
} from "../src/lib/reader-ui.js";
import {
  readerExplanationChain,
  readerExplanationFollowUpState,
  readerExplanationThreadSaveState,
  readerExplanationThreads,
} from "../src/lib/reader-explanation-thread.js";

test("only a real document body with a content hash can be explained", () => {
  assert.equal(readableDocumentBody({ body: "   " }), null);
  assert.equal(readableDocumentBody({ bodyText: "真实正文" }), "真实正文");
  assert.equal(
    readableDocumentBody({ body: " ", bodyText: "bodyText 正文" }),
    "bodyText 正文",
  );
  assert.equal(canExplainDocument({ body: "   " }, "hash"), false);
  assert.equal(
    canExplainDocument({ body: "该文件暂不支持正文预览。" }, "hash"),
    false,
  );
  assert.equal(canExplainDocument({ body: "真实正文" }, "hash"), true);
});

test("remote reader images omit the Workbench referrer and remain lazy-loaded", () => {
  assert.deepEqual(
    readerImageRequestProps(
      "https://mmbiz.qpic.cn/mmbiz_png/example/640?wx_fmt=png&from=appmsg",
    ),
    {
      src: "https://mmbiz.qpic.cn/mmbiz_png/example/640?wx_fmt=png&from=appmsg",
      loading: "lazy",
      decoding: "async",
      referrerPolicy: "no-referrer",
    },
  );
  assert.deepEqual(readerImageRequestProps("./assets/local.png"), {
    src: "./assets/local.png",
    loading: "lazy",
    decoding: "async",
  });
  assert.deepEqual(readerImageRequestProps("./assets/local.png", "raw:article"), {
    src: "/api/reader-images/raw%3Aarticle?src=.%2Fassets%2Flocal.png",
    loading: "lazy",
    decoding: "async",
  });
});

test("reader prose blocks wrap while explicitly typed code blocks retain code layout", () => {
  assert.equal(readerPreformattedBlockClassName(), "reader-prose-block");
  assert.equal(readerPreformattedBlockClassName(""), "reader-prose-block");
  assert.equal(
    readerPreformattedBlockClassName("language-javascript"),
    "reader-code-block",
  );
  assert.equal(
    readerPreformattedBlockClassName("highlight language-json"),
    "reader-code-block",
  );
  assert.equal(
    readerPreformattedBlockText(
      "",
      "    定价：收取它真正值的价格\n\n\n\n    引文\n\n\n      ——Dan Kennedy\n",
    ),
    "定价：收取它真正值的价格\n\n引文\n\n——Dan Kennedy",
  );
  assert.equal(
    readerPreformattedBlockText(
      "language-javascript",
      "  const first = 1;\n\n\n  const second = 2;\n",
    ),
    "  const first = 1;\n\n\n  const second = 2;\n",
  );
});

test("manual Wiki ingest package combines source, free notes, and quote notes without authorizing writes", () => {
  const result = buildManualWikiIngestPackage({
    document: {
      title: "定价章节",
      relativePath: "10_raw/books/定价/第四章.md",
      contentHash: "sha256-example",
    },
    notes: [
      { type: "free", body: "这章真正讨论的是报价时的信心。" },
      { type: "free", body: "   " },
      {
        type: "quote",
        quoteText: "把价格定到你能面不改色地说出来的最高水平。",
        body: "价格也是筛选机制。",
      },
      {
        type: "quote",
        quoteText: "AI 给出的上下文解释",
        body: "这是辅助说明。",
        origin: "codex-explanation",
      },
    ],
  });

  assert.equal(result.sourcePath, "10_raw/books/定价/第四章.md");
  assert.equal(result.sourceLink, "[[10_raw/books/定价/第四章]]");
  assert.equal(result.freeNoteCount, 1);
  assert.equal(result.quoteNoteCount, 2);
  assert.match(result.prompt, /只请求“入库前判断与方案”，不授权写入 Wiki/);
  assert.match(result.prompt, /Vault 相对路径：`10_raw\/books\/定价\/第四章\.md`/);
  assert.match(result.prompt, /这章真正讨论的是报价时的信心/);
  assert.match(result.prompt, /> 把价格定到你能面不改色地说出来的最高水平/);
  assert.match(result.prompt, /Codex 辅助解释（非用户判断）/);
  assert.match(result.prompt, /内容指纹：`sha256-example`/);
});

test("manual Wiki ingest package fails closed when the full-source path is missing", () => {
  assert.throws(
    () => buildManualWikiIngestPackage({ document: { title: "无路径" }, notes: [] }),
    /缺少来源全文路径/,
  );
});

test("confirmed Wiki ingest exposes durable execution feedback at the action location", () => {
  assert.equal(readerIngestExecutionFeedback({ status: "awaiting_review" }), null);
  assert.deepEqual(
    readerIngestExecutionFeedback({
      status: "executing",
      confirmedAt: "2026-07-31T08:40:18.241Z",
      updatedAt: "2026-07-31T08:41:18.893Z",
    }),
    {
      title: "确认已收到，正在写入 Wiki",
      description: "Codex 正在按你确认的审核方案执行。完成后，这里会显示写入结果和变更文件。",
      activityAt: "2026-07-31T08:41:18.893Z",
    },
  );
});

test("Codex client handoff launches the registered desktop URL scheme", () => {
  const assigned = [];
  assert.equal(
    launchCodexClient({
      assign(value) {
        assigned.push(value);
      },
    }),
    true,
  );
  assert.deepEqual(assigned, [CODEX_CLIENT_LAUNCH_URL]);
  assert.equal(CODEX_CLIENT_LAUNCH_URL, "codex://");
  assert.equal(launchCodexClient(null), false);
});

test("a persisted client packet restores a failed or missing Wiki ingest job", () => {
  const handoff = {
    absolutePath: "/vault/90_runs/ingest_plans/recovered.md",
    prompt: "在 Codex 执行恢复任务",
  };
  const restoredFailure = readerIngestJobWithRecoveredHandoff(
    {
      id: "old-job",
      status: "failed",
      error: { message: "旧 CLI 超时" },
    },
    handoff,
    "raw:source",
  );
  assert.equal(restoredFailure.id, "old-job");
  assert.equal(restoredFailure.status, "handoff_ready");
  assert.equal(restoredFailure.error, null);
  assert.equal(restoredFailure.recoveredHandoff, true);
  assert.deepEqual(restoredFailure.handoff, handoff);

  const restoredAfterRestart = readerIngestJobWithRecoveredHandoff(
    null,
    handoff,
    "raw:source",
  );
  assert.equal(restoredAfterRestart.id, "recovered-raw:source");
  assert.equal(restoredAfterRestart.status, "handoff_ready");

  const active = { id: "active", status: "awaiting_review" };
  assert.equal(
    readerIngestJobWithRecoveredHandoff(active, handoff, "raw:source"),
    active,
  );
});

test("explanation polling backs off and stops after three retries", () => {
  assert.deepEqual(readerExplanationPollRetry(1), {
    attempt: 1,
    exhausted: false,
    delay: 800,
  });
  assert.deepEqual(readerExplanationPollRetry(3), {
    attempt: 3,
    exhausted: false,
    delay: 3_200,
  });
  assert.deepEqual(readerExplanationPollRetry(4), {
    attempt: 4,
    exhausted: true,
    delay: null,
  });
});

test("reader explanation history groups follow-ups into persistent conversation threads", () => {
  const records = [
    {
      id: "root-a",
      parentId: null,
      status: "completed",
      followUpDepth: 0,
      question: "最初的问题",
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:01.000Z",
    },
    {
      id: "follow-a-1",
      parentId: "root-a",
      status: "completed",
      followUpDepth: 1,
      question: "第一个追问",
      createdAt: "2026-07-31T00:01:00.000Z",
      updatedAt: "2026-07-31T00:01:01.000Z",
    },
    {
      id: "follow-a-2",
      parentId: "follow-a-1",
      status: "completed",
      followUpDepth: 2,
      question: "第二个追问",
      createdAt: "2026-07-31T00:02:00.000Z",
      updatedAt: "2026-07-31T00:02:01.000Z",
    },
    {
      id: "root-b",
      parentId: null,
      status: "completed",
      followUpDepth: 0,
      question: "另一段原文",
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:01.000Z",
    },
  ];

  assert.deepEqual(
    readerExplanationChain(records, "follow-a-2").map((record) => record.id),
    ["root-a", "follow-a-1", "follow-a-2"],
  );
  const threads = readerExplanationThreads(records);
  assert.equal(threads.length, 2);
  assert.equal(threads[0].root.id, "root-a");
  assert.equal(threads[0].latest.id, "follow-a-2");
  assert.deepEqual(
    threads[0].records.map((record) => record.id),
    ["root-a", "follow-a-1", "follow-a-2"],
  );
});

test("reader explanation follow-up state respects the persisted server limit", () => {
  assert.deepEqual(
    readerExplanationFollowUpState({
      status: "completed",
      followUpDepth: 2,
      followUpLimit: 3,
    }),
    {
      depth: 2,
      limit: 3,
      remaining: 1,
      canFollowUp: true,
    },
  );
  assert.equal(
    readerExplanationFollowUpState({
      status: "completed",
      followUpDepth: 3,
      followUpLimit: 3,
    }).canFollowUp,
    false,
  );
});

test("reader explanation save state treats one root and its follow-ups as one note", () => {
  const records = [
    { id: "root", status: "completed", savedNoteId: null },
    { id: "follow-1", parentId: "root", status: "completed", savedNoteId: null },
  ];
  assert.deepEqual(
    readerExplanationThreadSaveState({ root: records[0], records }),
    {
      savedNoteId: null,
      completedCount: 2,
      consolidated: false,
      canSave: true,
      isUpdate: false,
    },
  );

  const saved = records.map((record) => ({ ...record, savedNoteId: "thread-note" }));
  assert.deepEqual(
    readerExplanationThreadSaveState({ root: saved[0], records: saved }),
    {
      savedNoteId: "thread-note",
      completedCount: 2,
      consolidated: true,
      canSave: false,
      isUpdate: false,
    },
  );

  const appended = [...saved, {
    id: "follow-2",
    parentId: "follow-1",
    status: "completed",
    savedNoteId: null,
  }];
  assert.equal(
    readerExplanationThreadSaveState({ root: appended[0], records: appended }).isUpdate,
    true,
  );
});

test("anchor and source drift errors require a new selection instead of retry", () => {
  for (const code of [
    "CONTENT_HASH_MISMATCH",
    "INVALID_QUOTE_ANCHOR",
    "QUOTE_CONTEXT_MISMATCH",
    "QUOTE_NOT_IN_DOCUMENT",
  ]) {
    assert.equal(readerExplanationRequiresReselection(code), true);
  }
  assert.equal(readerExplanationRequiresReselection("RUNNER_BUSY"), false);
});

test("404 and 405 API responses become a typed local-only state", () => {
  for (const status of [404, 405]) {
    const error = httpApiError(status, "<!doctype html><title>Not found</title>", "text/html");
    assert.equal(error.message, LOCAL_API_UNAVAILABLE_MESSAGE);
    assert.equal(error.code, "LOCAL_API_UNAVAILABLE");
    assert.equal(error.status, status);
    assert.equal(isLocalOnlyApiError(error), true);
    assert.doesNotMatch(error.message, /doctype|title/i);
  }
});

test("JSON 404 keeps the local API business error instead of disabling the service", () => {
  const error = httpApiError(
    404,
    JSON.stringify({
      error: {
        code: "READER_EXPLANATION_NOT_FOUND",
        message: "阅读解释记录不存在。",
      },
    }),
    "application/json",
  );

  assert.equal(error.code, "READER_EXPLANATION_NOT_FOUND");
  assert.equal(error.message, "阅读解释记录不存在。");
  assert.equal(error.status, 404);
  assert.equal(isLocalOnlyApiError(error), false);
  assert.equal(error.localOnly, false);
});

test("API response normalization preserves safe JSON errors and hides HTML", () => {
  const jsonError = httpApiError(
    500,
    JSON.stringify({ error: { code: "RUNNER_BUSY", message: "Runner 正忙" } }),
    "application/json",
  );
  assert.equal(jsonError.code, "RUNNER_BUSY");
  assert.equal(jsonError.message, "Runner 正忙");

  const htmlError = httpApiError(
    500,
    "<html><body><h1>Proxy stack trace</h1></body></html>",
    "text/html",
  );
  assert.equal(htmlError.message, "请求失败（500）");
  assert.doesNotMatch(htmlError.message, /html|proxy|stack/i);
});

test("selection toolbar uses its measured size and stays inside the visual viewport", () => {
  const toolbarRect = { width: 264, height: 88 };
  const viewport = {
    offsetLeft: 12,
    offsetTop: 24,
    width: 280,
    height: 420,
  };
  const position = clampSelectionToolbarPosition({
    rangeRect: {
      left: 10,
      top: 36,
      bottom: 56,
      width: 24,
    },
    toolbarRect,
    viewport,
  });

  assert.equal(position.placement, "below");
  assert.ok(position.left - toolbarRect.width / 2 >= viewport.offsetLeft + 8);
  assert.ok(
    position.left + toolbarRect.width / 2 <=
      viewport.offsetLeft + viewport.width - 8,
  );
  assert.ok(position.top >= viewport.offsetTop + 8);
  assert.ok(
    position.top + toolbarRect.height <=
      viewport.offsetTop + viewport.height - 8,
  );
});

test("selection toolbar prefers above when the measured toolbar fits there", () => {
  const position = clampSelectionToolbarPosition({
    rangeRect: {
      left: 240,
      top: 300,
      bottom: 322,
      width: 80,
    },
    toolbarRect: { width: 220, height: 44 },
    viewport: {
      offsetLeft: 0,
      offsetTop: 0,
      width: 520,
      height: 600,
    },
  });

  assert.equal(position.placement, "above");
  assert.ok(position.top - 44 >= 8);
});
