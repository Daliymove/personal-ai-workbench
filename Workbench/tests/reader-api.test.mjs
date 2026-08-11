import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createServer as createViteServer } from "vite";

import { buildVaultIndex } from "../server/vault-index.mjs";
import { workbenchApiPlugin } from "../server/vite-plugin-workbench.mjs";

async function startFixture(t, { readerExplanationService = null } = {}) {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-reader-api-"));
  await mkdir(path.join(vaultRoot, "10_raw", "articles"), { recursive: true });
  await mkdir(path.join(vaultRoot, "10_raw", "articles", "imgs"), { recursive: true });
  await mkdir(path.join(vaultRoot, "wiki"), { recursive: true });
  await writeFile(
    path.join(vaultRoot, "10_raw", "articles", "source.md"),
    "# Source\n\n![](imgs/pixel.png)\n\nraw 保存证据，wiki 沉淀知识。\n",
    "utf8",
  );
  await writeFile(
    path.join(vaultRoot, "10_raw", "articles", "imgs", "pixel.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await writeFile(path.join(vaultRoot, "wiki", "index.md"), "# Index\n", "utf8");

  const index = await buildVaultIndex(vaultRoot);
  const source = index.documents.find((document) =>
    document.path === "10_raw/articles/source.md"
  );
  assert.ok(source);

  const vite = await createViteServer({
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
    plugins: [workbenchApiPlugin({ vaultRoot, readerExplanationService })],
  });
  const server = http.createServer(vite.middlewares);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await vite.close();
    await rm(vaultRoot, { recursive: true, force: true });
  });
  return { origin, source, vaultRoot };
}

test("reader image endpoint resolves local Markdown images relative to the source file", async (t) => {
  const { origin, source } = await startFixture(t);
  const response = await fetch(
    `${origin}/api/reader-images/${encodeURIComponent(source.id)}?${new URLSearchParams({
      src: "imgs/pixel.png",
    })}`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.ok((await response.arrayBuffer()).byteLength > 0);

  const remote = await fetch(
    `${origin}/api/reader-images/${encodeURIComponent(source.id)}?${new URLSearchParams({
      src: "https://example.invalid/tracker.png",
    })}`,
  );
  assert.equal(remote.status, 404);
});

function fakeExplanationService() {
  const records = new Map();
  const calls = [];
  return {
    calls,
    async list(documentId) {
      return [...records.values()].filter((record) => record.document.id === documentId);
    },
    async start(input) {
      calls.push(input);
      const record = {
        id: "analysis-1",
        parentId: null,
        document: { id: input.document.id, title: input.document.title },
        contentHash: input.contentHash,
        quoteText: input.quoteText,
        anchor: input.anchor,
        mode: input.mode || "understand",
        question: input.question || "",
        status: "completed",
        result: {
          answer: "结合全文来看，raw 用来保存可追溯证据，wiki 才沉淀经过确认、可复用的知识。",
        },
        savedNoteId: null,
        followUpDepth: 0,
        followUpLimit: 3,
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      };
      records.set(record.id, record);
      return structuredClone(record);
    },
    async followUp(parentId, input) {
      calls.push({ ...input, parentId, kind: "follow-up" });
      const parent = records.get(parentId);
      const record = {
        ...structuredClone(parent),
        id: "analysis-2",
        parentId,
        question: input.question,
        mode: input.mode,
        followUpDepth: 1,
        savedNoteId: null,
      };
      records.set(record.id, record);
      return structuredClone(record);
    },
    async get(id) {
      const record = records.get(id);
      if (!record) {
        const error = new Error("解释不存在");
        error.code = "READER_EXPLANATION_NOT_FOUND";
        throw error;
      }
      return structuredClone(record);
    },
    async markSaved(id, noteId) {
      const record = records.get(id);
      record.savedNoteId = noteId;
      return structuredClone(record);
    },
    async markThreadSaved(ids, noteId) {
      return ids.map((id) => {
        const record = records.get(id);
        record.savedNoteId = noteId;
        return structuredClone(record);
      });
    },
    async close() {},
  };
}

test("concurrent note POST requests merge instead of overwriting one another", async (t) => {
  const { origin, source } = await startFixture(t);
  const save = (body) => fetch(`${origin}/api/reader-notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: source.id,
      note: { type: "free", body },
    }),
  });

  const responses = await Promise.all([save("第一条并发笔记"), save("第二条并发笔记")]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);

  const notesResponse = await fetch(
    `${origin}/api/reader-notes?documentId=${encodeURIComponent(source.id)}`,
  );
  assert.equal(notesResponse.status, 200);
  const payload = await notesResponse.json();
  assert.deepEqual(
    payload.notes.map((note) => note.body).sort(),
    ["第一条并发笔记", "第二条并发笔记"],
  );
});

test("local mutation endpoints reject cross-site and form-style requests", async (t) => {
  const { origin, source } = await startFixture(t);
  const body = JSON.stringify({
    documentId: source.id,
    note: { type: "free", body: "不应写入" },
  });

  const crossSite = await fetch(`${origin}/api/reader-notes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://example.invalid",
    },
    body,
  });
  assert.equal(crossSite.status, 403);

  const formStyle = await fetch(`${origin}/api/reader-notes`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body,
  });
  assert.equal(formStyle.status, 415);

  const notesResponse = await fetch(
    `${origin}/api/reader-notes?documentId=${encodeURIComponent(source.id)}`,
  );
  const payload = await notesResponse.json();
  assert.deepEqual(payload.notes, []);
});

test("reader explanation API rereads the document and saves an idempotent AI-attributed note", async (t) => {
  const explanations = fakeExplanationService();
  const { origin, source } = await startFixture(t, {
    readerExplanationService: explanations,
  });
  const documentResponse = await fetch(
    `${origin}/api/documents/${encodeURIComponent(source.id)}`,
  );
  const document = await documentResponse.json();
  const anchor = {
    startBlock: 1,
    endBlock: 1,
    startOffset: 0,
    endOffset: 17,
    prefix: "",
    suffix: "",
    quoteText: "raw 保存证据，wiki 沉淀知识。",
  };
  const start = await fetch(`${origin}/api/reader-explanations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: source.id,
      contentHash: document.contentHash,
      quoteText: anchor.quoteText,
      anchor,
      mode: "understand",
      question: "为什么不能直接把原文写入 wiki？",
    }),
  });
  assert.equal(start.status, 202);
  assert.equal(explanations.calls.length, 1);
  assert.match(explanations.calls[0].body, /raw 保存证据/);

  const beforeSave = await fetch(
    `${origin}/api/reader-notes?documentId=${encodeURIComponent(source.id)}`,
  ).then((response) => response.json());
  assert.deepEqual(beforeSave.notes, []);

  const save = () => fetch(`${origin}/api/reader-explanations/analysis-1/save-note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: source.id,
      contentHash: document.contentHash,
    }),
  });
  const firstSave = await save();
  const secondSave = await save();
  assert.equal(firstSave.status, 200);
  assert.equal(secondSave.status, 200);

  const afterSave = await fetch(
    `${origin}/api/reader-notes?documentId=${encodeURIComponent(source.id)}`,
  ).then((response) => response.json());
  assert.equal(afterSave.notes.length, 1);
  assert.equal(afterSave.notes[0].origin, "codex-explanation");
  assert.equal(afterSave.notes[0].sourceAnalysisId, "analysis-1");
  assert.match(afterSave.notes[0].body, /AI 阅读辅助，非用户判断/);
  assert.match(afterSave.notes[0].body, /为什么不能直接把原文写入 wiki/);
  assert.match(afterSave.notes[0].body, /Codex 回答/);

  const forgedUpdate = await fetch(`${origin}/api/reader-notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: source.id,
      note: {
        ...afterSave.notes[0],
        body: "用普通笔记接口篡改 AI 解释。",
      },
    }),
  });
  assert.equal(forgedUpdate.status, 409);
  const unchanged = await fetch(
    `${origin}/api/reader-notes?documentId=${encodeURIComponent(source.id)}`,
  ).then((response) => response.json());
  assert.match(unchanged.notes[0].body, /AI 阅读辅助，非用户判断/);
  assert.doesNotMatch(unchanged.notes[0].body, /篡改 AI 解释/);
});

test("reader explanation API rejects browser attempts to override the isolated runner", async (t) => {
  const explanations = fakeExplanationService();
  const { origin, source } = await startFixture(t, {
    readerExplanationService: explanations,
  });
  const response = await fetch(`${origin}/api/reader-explanations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: source.id,
      contentHash: "0".repeat(64),
      quoteText: "raw 保存证据",
      anchor: {},
      mode: "understand",
      question: "",
      model: "browser-chosen-model",
      sandbox: "workspace-write",
      fullText: "浏览器伪造全文",
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(explanations.calls.length, 0);
});

test("reader explanation follow-up reuses the server-side current document", async (t) => {
  const explanations = fakeExplanationService();
  const { origin, source } = await startFixture(t, {
    readerExplanationService: explanations,
  });
  const document = await fetch(
    `${origin}/api/documents/${encodeURIComponent(source.id)}`,
  ).then((response) => response.json());
  const anchor = {
    startBlock: 1,
    endBlock: 1,
    startOffset: 0,
    endOffset: 17,
    prefix: "",
    suffix: "",
    quoteText: "raw 保存证据，wiki 沉淀知识。",
  };
  await fetch(`${origin}/api/reader-explanations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: source.id,
      contentHash: document.contentHash,
      quoteText: anchor.quoteText,
      anchor,
      mode: "understand",
      question: "",
    }),
  });
  const followed = await fetch(
    `${origin}/api/reader-explanations/analysis-1/follow-up`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: source.id,
        contentHash: document.contentHash,
        mode: "logic",
        question: "这条推理的隐含前提是什么？",
      }),
    },
  );
  assert.equal(followed.status, 202);
  const payload = await followed.json();
  assert.equal(payload.explanation.parentId, "analysis-1");
  assert.equal(payload.explanation.followUpDepth, 1);
  assert.match(explanations.calls[1].body, /raw 保存证据/);
  assert.equal(explanations.calls[1].quoteText, undefined);

  const save = await fetch(`${origin}/api/reader-explanations/analysis-2/save-note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: source.id,
      contentHash: document.contentHash,
    }),
  });
  assert.equal(save.status, 200);
  const savedPayload = await save.json();
  assert.equal(savedPayload.analysisId, "analysis-1");
  assert.equal(savedPayload.explanations.length, 2);
  assert.equal(savedPayload.explanations[0].savedNoteId, savedPayload.savedNoteId);
  assert.equal(savedPayload.explanations[1].savedNoteId, savedPayload.savedNoteId);

  const notes = await fetch(
    `${origin}/api/reader-notes?documentId=${encodeURIComponent(source.id)}`,
  ).then((response) => response.json());
  assert.equal(notes.notes.length, 1);
  assert.equal(notes.notes[0].sourceAnalysisId, "analysis-1");
  assert.match(notes.notes[0].body, /我的问题/);
  assert.match(notes.notes[0].body, /Codex 回答/);
  assert.match(notes.notes[0].body, /我的追问 1/);
  assert.match(notes.notes[0].body, /Codex 继续回答 1/);
});

test("ordinary note writes cannot forge the reserved Codex explanation provenance", async (t) => {
  const { origin, source } = await startFixture(t);
  const response = await fetch(`${origin}/api/reader-notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: source.id,
      note: {
        type: "quote",
        body: "浏览器尝试伪造 AI 来源。",
        quoteText: "raw 保存证据",
        anchor: {
          startBlock: 1,
          endBlock: 1,
          startOffset: 0,
          endOffset: 8,
          prefix: "",
          suffix: "",
        },
        origin: "codex-explanation",
        sourceAnalysisId: "forged-analysis",
      },
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.note.origin, "user");
  assert.equal(payload.note.sourceAnalysisId, null);
});

test("saving an explanation refuses a document that changed after generation", async (t) => {
  const explanations = fakeExplanationService();
  const { origin, source, vaultRoot } = await startFixture(t, {
    readerExplanationService: explanations,
  });
  const document = await fetch(
    `${origin}/api/documents/${encodeURIComponent(source.id)}`,
  ).then((response) => response.json());
  const anchor = {
    startBlock: 1,
    endBlock: 1,
    startOffset: 0,
    endOffset: 17,
    prefix: "",
    suffix: "",
    quoteText: "raw 保存证据，wiki 沉淀知识。",
  };
  const started = await fetch(`${origin}/api/reader-explanations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: source.id,
      contentHash: document.contentHash,
      quoteText: anchor.quoteText,
      anchor,
      mode: "understand",
      question: "",
    }),
  });
  assert.equal(started.status, 202);

  await writeFile(
    path.join(vaultRoot, "10_raw", "articles", "source.md"),
    "# Source\n\n正文已经变化。\n",
    "utf8",
  );

  const save = await fetch(`${origin}/api/reader-explanations/analysis-1/save-note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: source.id,
      contentHash: document.contentHash,
    }),
  });
  assert.equal(save.status, 409);
  const notes = await fetch(
    `${origin}/api/reader-notes?documentId=${encodeURIComponent(source.id)}`,
  ).then((response) => response.json());
  assert.deepEqual(notes.notes, []);
});

test("starting an explanation rejects a stale browser hash without an index refresh", async (t) => {
  const explanations = fakeExplanationService();
  const { origin, source, vaultRoot } = await startFixture(t, {
    readerExplanationService: explanations,
  });
  const document = await fetch(
    `${origin}/api/documents/${encodeURIComponent(source.id)}`,
  ).then((response) => response.json());
  await writeFile(
    path.join(vaultRoot, "10_raw", "articles", "source.md"),
    "# Source\n\n已经换成新的正文。\n",
    "utf8",
  );

  const response = await fetch(`${origin}/api/reader-explanations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      documentId: source.id,
      contentHash: document.contentHash,
      quoteText: "raw 保存证据",
      anchor: {
        startBlock: 1,
        endBlock: 1,
        startOffset: 0,
        endOffset: 8,
        prefix: "",
        suffix: "",
      },
      mode: "understand",
      question: "",
    }),
  });
  assert.equal(response.status, 409);
  assert.equal(explanations.calls.length, 0);
});
