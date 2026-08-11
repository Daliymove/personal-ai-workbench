import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  READER_EXPLANATION_STATUS,
  ReaderExplanationsError,
  createReaderExplanationsService,
  hashReaderExplanationBody,
  readerMarkdownVisibleBlocks,
} from "../server/reader-explanations.mjs";
import { projectDomSelectionToCanonical } from "../shared/reader-text-contract.mjs";

const BODY = `# 上下文工程

这是 **关键判断**，涉及 [[wiki/知识层|知识层]] 的边界。

结尾段落用于验证区块范围。
`;

const REAL_LIST_ITEMS = [
  "URL：https://support.google.com/gemininotebook/answer/16269187?hl=en",
  "读取状态：完整帮助页可靠读取。",
  "可核查事实：来源多时，系统按问题检索相关信息并据此形成回答；来源全集或用户选择的子集进入回答上下文；对话历史参与生成；用户笔记只有被明确选择时才参与；免费层当前为 100 个 notebook、每个最多 50 个来源。",
  "边界：官方只描述任务行为，没有公开底层是否纯向量、混合检索、重排或长上下文组合。",
];
const REAL_LIST_BODY = REAL_LIST_ITEMS.map((item) => `- ${item}`).join("\n");
const REAL_LIST_DOM_TEXT = `\n${REAL_LIST_ITEMS.join("\n")}\n`;

function result(label = "测试") {
  return {
    answer: `${label}：这段话是在区分证据与知识；结合全文来看，原文应先保留在 raw，经过确认后可持续复用的判断才进入 wiki。`,
  };
}

function selection(overrides = {}) {
  const blocks = readerMarkdownVisibleBlocks(BODY);
  const blockText = blocks[1];
  const quoteText = "关键判断，涉及 知识层";
  const startOffset = blockText.indexOf(quoteText);
  const endOffset = startOffset + quoteText.length;
  return {
    document: {
      id: "document-1",
      relativePath: "10_raw/articles/context.md",
      title: "上下文工程",
    },
    body: BODY,
    contentHash: hashReaderExplanationBody(BODY),
    quoteText,
    anchor: {
      startBlock: 1,
      endBlock: 1,
      startOffset,
      endOffset,
      prefix: blockText.slice(Math.max(0, startOffset - 3), startOffset),
      suffix: blockText.slice(endOffset, endOffset + 4),
    },
    mode: "understand",
    question: "",
    ...overrides,
  };
}

function realListSelection({ rawDomAnchor = false } = {}) {
  const blockText = readerMarkdownVisibleBlocks(REAL_LIST_BODY)[0];
  const quoteText = "没有公开底层是否纯向量";
  const domStart = REAL_LIST_DOM_TEXT.indexOf(quoteText);
  const projection = projectDomSelectionToCanonical({
    domText: REAL_LIST_DOM_TEXT,
    canonicalText: blockText,
    domStart,
    domEnd: domStart + quoteText.length,
    quoteText,
  });
  assert.equal(projection.ok, true);
  const startOffset = rawDomAnchor ? domStart : projection.startOffset;
  const endOffset = startOffset + quoteText.length;
  const contextText = rawDomAnchor ? REAL_LIST_DOM_TEXT : blockText;
  return {
    document: {
      id: "real-list-document",
      relativePath:
        "10_raw/web-search/20260727-notebooklm-obsidian-agentic-wiki-official-sources.md",
      title: "NotebookLM、Obsidian 文件型 Wiki 与 Agent 检索机制",
    },
    body: REAL_LIST_BODY,
    contentHash: hashReaderExplanationBody(REAL_LIST_BODY),
    quoteText,
    anchor: {
      startBlock: 0,
      endBlock: 0,
      startOffset,
      endOffset,
      prefix: contextText.slice(Math.max(0, startOffset - 36), startOffset),
      suffix: contextText.slice(endOffset, endOffset + 36),
    },
    mode: "understand",
    question: "",
  };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "reader-explanations-test-"));
  const storePath = path.join(root, "state", "reader-explanations.json");
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, storePath };
}

function makeService(root, storePath, runCommand, options = {}) {
  let sequence = 0;
  return createReaderExplanationsService({
    vaultRoot: root,
    storePath,
    detectImpl: async () => ({
      available: true,
      executablePath: "/test/bin/codex",
      source: "test",
    }),
    runCommand,
    idFactory: () => `analysis-${++sequence}`,
    now: (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 6, 27, 1, 0, tick++));
    })(),
    ...options,
  });
}

async function waitForStatus(service, id, expected, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await service.get(id);
    if (record.status === expected) return record;
    if (
      record.status === READER_EXPLANATION_STATUS.FAILED &&
      expected !== READER_EXPLANATION_STATUS.FAILED
    ) {
      assert.fail(`record failed: ${JSON.stringify(record.error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${expected}`);
}

function explanationError(code) {
  return (error) =>
    error instanceof ReaderExplanationsError && error.code === code;
}

test("validates rendered Markdown blocks, invokes isolated Codex, caches, and marks a note", async (t) => {
  const { root, storePath } = await fixture(t);
  const calls = [];
  const service = makeService(root, storePath, async (call) => {
    calls.push(call);
    return { exitCode: 0, result: result() };
  });
  t.after(() => service.close());

  assert.deepEqual(readerMarkdownVisibleBlocks(BODY), [
    "上下文工程",
    "这是 关键判断，涉及 知识层 的边界。",
    "结尾段落用于验证区块范围。",
  ]);
  assert.deepEqual(
    readerMarkdownVisibleBlocks(
      "前言\n\n| 字段 | 含义 |\n| --- | --- |\n| raw | 证据 |\n\n表后段落",
    ),
    ["前言", "字段含义raw证据", "表后段落"],
  );

  const started = await service.start(selection());
  assert.equal(started.status, READER_EXPLANATION_STATUS.QUEUED);
  const completed = await waitForStatus(
    service,
    started.id,
    READER_EXPLANATION_STATUS.COMPLETED,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, "/test/bin/codex");
  assert.deepEqual(calls[0].args, [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ignore-user-config",
    "--ignore-rules",
    "--color",
    "never",
    "--output-schema",
    calls[0].schemaPath,
    "--output-last-message",
    calls[0].outputPath,
    "-",
  ]);
  assert.equal(calls[0].cwd, path.dirname(calls[0].schemaPath));
  assert.equal(calls[0].timeoutMs, 180_000);
  assert.match(calls[0].input, /BEGIN UNTRUSTED READER DATA/);
  assert.match(calls[0].input, /文章完整正文|articleFullText/);
  assert.match(calls[0].input, /关键判断/);
  assert.match(calls[0].input, /一段连贯、自然、直接的中文/);
  assert.deepEqual(Object.keys(completed.result), ["answer"]);
  assert.equal(completed.result.answer.startsWith("测试"), true);

  const cached = await service.start(selection());
  assert.equal(cached.id, completed.id);
  assert.equal(cached.cached, true);
  assert.equal(calls.length, 1);

  const saved = await service.markSaved(completed.id, "note-1");
  const repeated = await service.markSaved(completed.id, "note-1");
  assert.equal(saved.savedNoteId, "note-1");
  assert.equal(repeated.savedNoteId, "note-1");
  assert.equal((await service.list("document-1")).length, 1);

  const stored = JSON.parse(await readFile(storePath, "utf8"));
  assert.equal(stored.version, 1);
  assert.equal(stored.records.length, 1);
  assert.equal(stored.records[0].savedNoteId, "note-1");
  assert.equal(Object.hasOwn(stored.records[0], "body"), false);
});

test("accepts the canonical projection of a real React-rendered list selection", async (t) => {
  const { root, storePath } = await fixture(t);
  const calls = [];
  const service = makeService(root, storePath, async (call) => {
    calls.push(call);
    return { exitCode: 0, result: result("列表选段") };
  });
  t.after(() => service.close());

  await assert.rejects(
    () => service.start(realListSelection({ rawDomAnchor: true })),
    explanationError("QUOTE_NOT_IN_DOCUMENT"),
  );

  const started = await service.start(realListSelection());
  const completed = await waitForStatus(
    service,
    started.id,
    READER_EXPLANATION_STATUS.COMPLETED,
  );

  assert.equal(completed.anchor.startOffset, 204);
  assert.equal(completed.anchor.endOffset, 215);
  assert.equal(calls.length, 1);
});

test("accepts a continuous selection spanning multiple Markdown blocks", async (t) => {
  const { root, storePath } = await fixture(t);
  const calls = [];
  const service = makeService(root, storePath, async (call) => {
    calls.push(call);
    return { exitCode: 0, result: result("跨段选区") };
  });
  t.after(() => service.close());

  const blocks = readerMarkdownVisibleBlocks(BODY);
  const startOffset = blocks[1].indexOf("关键判断");
  const endOffset = blocks[2].indexOf("验证") + "验证".length;
  const quoteText = [
    blocks[1].slice(startOffset),
    blocks[2].slice(0, endOffset),
  ].join("\n");
  const started = await service.start(selection({
    quoteText,
    anchor: {
      startBlock: 1,
      endBlock: 2,
      startOffset,
      endOffset,
      prefix: blocks[1].slice(Math.max(0, startOffset - 3), startOffset),
      suffix: blocks[2].slice(endOffset, endOffset + 4),
    },
  }));
  const completed = await waitForStatus(
    service,
    started.id,
    READER_EXPLANATION_STATUS.COMPLETED,
  );

  assert.equal(completed.quoteText, quoteText);
  assert.equal(completed.anchor.startBlock, 1);
  assert.equal(completed.anchor.endBlock, 2);
  assert.equal(calls.length, 1);
});

test("preserves NFD body bytes until after content hash and anchor validation", async (t) => {
  const { root, storePath } = await fixture(t);
  const calls = [];
  const service = makeService(root, storePath, async (call) => {
    calls.push(call);
    return { exitCode: 0, result: result("组合字符") };
  });
  t.after(() => service.close());

  const body = "# 组合字符\n\nCafe\u0301 保持原始编码。";
  const blockText = readerMarkdownVisibleBlocks(body)[1];
  const quoteText = "Cafe\u0301";
  const startOffset = blockText.indexOf(quoteText);
  const started = await service.start({
    document: {
      id: "nfd-document",
      relativePath: "10_raw/articles/nfd.md",
      title: "组合字符",
    },
    body,
    contentHash: hashReaderExplanationBody(body),
    quoteText,
    anchor: {
      startBlock: 1,
      endBlock: 1,
      startOffset,
      endOffset: startOffset + quoteText.length,
      prefix: "",
      suffix: blockText.slice(startOffset + quoteText.length),
    },
    mode: "understand",
    question: "",
  });
  const completed = await waitForStatus(
    service,
    started.id,
    READER_EXPLANATION_STATUS.COMPLETED,
  );

  assert.equal(completed.quoteText, quoteText);
  assert.equal(calls.length, 1);
});

test("rejects stale hashes, forged anchors, unsupported modes, long questions, and runtime overrides", async (t) => {
  const { root, storePath } = await fixture(t);
  const calls = [];
  const service = makeService(root, storePath, async (call) => {
    calls.push(call);
    return { exitCode: 0, result: result() };
  });
  t.after(() => service.close());

  await assert.rejects(
    () => service.start(selection({ contentHash: "0".repeat(64) })),
    explanationError("CONTENT_HASH_MISMATCH"),
  );
  await assert.rejects(
    () => service.start(selection({
      anchor: { ...selection().anchor, prefix: "伪造的前文" },
    })),
    explanationError("QUOTE_CONTEXT_MISMATCH"),
  );
  await assert.rejects(
    () => service.start(selection({ mode: "summary" })),
    explanationError("INVALID_EXPLANATION_MODE"),
  );
  await assert.rejects(
    () => service.start(selection({ question: "困".repeat(501) })),
    explanationError("EXPLANATION_INPUT_TOO_LONG"),
  );
  const oversizedBody = "过".repeat(500_001);
  await assert.rejects(
    () => service.start(selection({
      body: oversizedBody,
      contentHash: hashReaderExplanationBody(oversizedBody),
    })),
    explanationError("EXPLANATION_INPUT_TOO_LONG"),
  );
  await assert.rejects(
    () => service.start({ ...selection(), model: "browser-model" }),
    explanationError("UNSUPPORTED_EXPLANATION_OVERRIDE"),
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(await service.list("document-1"), []);
});

test("strict result validation retries once and persists a terminal failure after the repair fails", async (t) => {
  const firstFixture = await fixture(t);
  const repairedCalls = [];
  const invalid = { ...result("损坏") };
  delete invalid.answer;
  const repairedService = makeService(
    firstFixture.root,
    firstFixture.storePath,
    async (call) => {
      repairedCalls.push(call);
      return {
        exitCode: 0,
        result: repairedCalls.length === 1 ? invalid : result("修复后"),
      };
    },
  );
  t.after(() => repairedService.close());

  const repairedStart = await repairedService.start(selection());
  const repaired = await waitForStatus(
    repairedService,
    repairedStart.id,
    READER_EXPLANATION_STATUS.COMPLETED,
  );
  assert.equal(repairedCalls.length, 2);
  assert.match(repairedCalls[1].input, /上一次输出未通过服务端结构校验/);
  assert.match(repaired.result.answer, /修复后/);

  const secondFixture = await fixture(t);
  let invalidCalls = 0;
  const failedService = makeService(
    secondFixture.root,
    secondFixture.storePath,
    async () => {
      invalidCalls += 1;
      return { exitCode: 0, result: invalid };
    },
  );
  t.after(() => failedService.close());
  const failedStart = await failedService.start(selection());
  const failed = await waitForStatus(
    failedService,
    failedStart.id,
    READER_EXPLANATION_STATUS.FAILED,
  );
  assert.equal(invalidCalls, 2);
  assert.equal(failed.error.code, "INVALID_MODEL_OUTPUT");
});

test("persists a bounded three-round follow-up chain with the previous result as context", async (t) => {
  const { root, storePath } = await fixture(t);
  const calls = [];
  const service = makeService(root, storePath, async (call) => {
    calls.push(call);
    return { exitCode: 0, result: result(String(calls.length)) };
  });
  t.after(() => service.close());

  let current = await service.start(selection());
  current = await waitForStatus(
    service,
    current.id,
    READER_EXPLANATION_STATUS.COMPLETED,
  );
  for (let depth = 1; depth <= 3; depth += 1) {
    const parentId = current.id;
    current = await service.followUp(parentId, {
      document: selection().document,
      body: BODY,
      contentHash: hashReaderExplanationBody(BODY),
      mode: "logic",
      question: `第 ${depth} 个追问`,
    });
    current = await waitForStatus(
      service,
      current.id,
      READER_EXPLANATION_STATUS.COMPLETED,
    );
    assert.equal(current.parentId, parentId);
    assert.equal(current.followUpDepth, depth);
  }
  assert.equal(calls.length, 4);
  assert.match(calls[1].input, /previousExplanation/);
  assert.match(calls[1].input, /1：这段话/);
  assert.match(calls[3].input, /第 1 个追问/);
  assert.match(calls[3].input, /第 2 个追问/);
  assert.match(calls[3].input, /2：这段话/);
  assert.match(calls[3].input, /3：这段话/);
  await assert.rejects(
    () => service.followUp(current.id, {
      document: selection().document,
      body: BODY,
      contentHash: hashReaderExplanationBody(BODY),
      mode: "logic",
      question: "第四个追问",
    }),
    explanationError("FOLLOW_UP_LIMIT_REACHED"),
  );
  const thread = await service.list("document-1");
  assert.equal(thread.length, 4);
  const marked = await service.markThreadSaved(
    thread.map((record) => record.id),
    "thread-note-1",
  );
  assert.equal(marked.length, 4);
  assert.equal(marked.every((record) => record.savedNoteId === "thread-note-1"), true);
  assert.equal(
    (await service.list("document-1")).every((record) => record.savedNoteId === "thread-note-1"),
    true,
  );
});

test("runs at most two Codex processes concurrently", async (t) => {
  const { root, storePath } = await fixture(t);
  const calls = [];
  const releases = [];
  let active = 0;
  let maximumActive = 0;
  const service = makeService(root, storePath, (call) => {
    calls.push(call);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    return new Promise((resolve) => {
      releases.push(() => {
        active -= 1;
        resolve({ exitCode: 0, result: result(`并发-${calls.length}`) });
      });
    });
  });
  t.after(() => service.close());

  const started = await Promise.all(
    [1, 2, 3].map((index) => service.start(selection({
      document: { ...selection().document, id: `document-${index}` },
      question: `任务 ${index}`,
    }))),
  );

  const waitUntil = async (predicate) => {
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail("condition was not reached");
  };
  await waitUntil(() => calls.length === 2);
  assert.equal(maximumActive, 2);
  releases[0]();
  await waitUntil(() => calls.length === 3);
  assert.equal(maximumActive, 2);
  releases.slice(1).forEach((release) => release());
  await Promise.all(started.map((record) =>
    waitForStatus(service, record.id, READER_EXPLANATION_STATUS.COMPLETED),
  ));
});

test("recovers persisted running records as failed and closes the public mutation API", async (t) => {
  const { root, storePath } = await fixture(t);
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify({
    version: 1,
    updatedAt: "2026-07-27T00:00:00.000Z",
    records: [{
      id: "stale-running",
      parentId: null,
      document: {
        id: "document-1",
        relativePath: "10_raw/articles/context.md",
        title: "上下文工程",
      },
      contentHash: hashReaderExplanationBody(BODY),
      quoteText: "关键判断",
      anchor: selection().anchor,
      mode: "understand",
      question: "",
      inputHash: "a".repeat(64),
      promptVersion: "reader-explain-v2",
      provider: "codex_cli",
      model: "default",
      status: "running",
      result: null,
      error: null,
      savedNoteId: null,
      followUpDepth: 0,
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    }],
  }), "utf8");
  const service = makeService(root, storePath, async () => ({
    exitCode: 0,
    result: result(),
  }));
  const recovered = await service.get("stale-running");
  assert.equal(recovered.status, READER_EXPLANATION_STATUS.FAILED);
  assert.equal(recovered.error.code, "INTERRUPTED_ON_STARTUP");
  const persisted = JSON.parse(await readFile(storePath, "utf8"));
  assert.equal(persisted.records[0].status, "failed");

  await service.close();
  await assert.rejects(
    () => service.start(selection()),
    explanationError("SERVICE_CLOSED"),
  );
});

test("migrates a completed v2 structured result to the single-answer contract", async (t) => {
  const { root, storePath } = await fixture(t);
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify({
    version: 1,
    updatedAt: "2026-07-27T00:00:00.000Z",
    records: [{
      id: "legacy-completed",
      parentId: null,
      document: selection().document,
      contentHash: hashReaderExplanationBody(BODY),
      quoteText: selection().quoteText,
      anchor: selection().anchor,
      mode: "understand",
      question: "这段话是什么意思？",
      inputHash: "b".repeat(64),
      promptVersion: "reader-explain-v2",
      provider: "codex_cli",
      model: "default",
      status: "completed",
      result: {
        plainLanguage: "旧版白话解释会迁移为单段回答。",
        contextRole: "旧版上下文作用。",
        reasoningSteps: [],
        keyConcepts: [],
        example: "",
        misreadings: [],
        authorVsInference: { authorSays: "", inference: "" },
        uncertainties: [],
      },
      error: null,
      savedNoteId: null,
      followUpDepth: 0,
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
    }],
  }), "utf8");

  const service = makeService(root, storePath, async () => ({
    exitCode: 0,
    result: result(),
  }));
  const migrated = await service.get("legacy-completed");
  assert.deepEqual(migrated.result, {
    answer: "旧版白话解释会迁移为单段回答。",
  });
  const persisted = JSON.parse(await readFile(storePath, "utf8"));
  assert.deepEqual(persisted.records[0].result, migrated.result);
  await service.close();
});

test("rejects an explanation store directory that escapes the Vault through a symlink", async (t) => {
  const { root } = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), "reader-explanations-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, path.join(root, "state"));
  const service = makeService(
    root,
    path.join(root, "state", "reader-explanations.json"),
    async () => ({ exitCode: 0, result: result() }),
  );
  await assert.rejects(
    () => service.list("document-1"),
    explanationError("UNSAFE_READER_EXPLANATIONS_STORE"),
  );
});
