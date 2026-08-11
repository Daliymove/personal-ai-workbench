import assert from "node:assert/strict";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  READER_NOTES_STORE,
  ReaderNotesError,
  createIngestSnapshot,
  createReaderNotesRepository,
  hashReaderDocumentContent,
} from "../server/reader-notes.mjs";

async function makeVault(t) {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-reader-notes-"));
  await mkdir(path.join(vaultRoot, "10_raw", "articles"), { recursive: true });
  await mkdir(path.join(vaultRoot, "10_raw", "my-thoughts"), {
    recursive: true,
  });
  t.after(() => rm(vaultRoot, { recursive: true, force: true }));
  return vaultRoot;
}

function quoteNote(overrides = {}) {
  return {
    id: "quote-1",
    type: "quote",
    body: "这里把采集和沉淀混在了一起。",
    quoteText: "raw 保存证据，wiki 沉淀知识。",
    anchor: {
      startBlock: 4,
      endBlock: 4,
      startOffset: 2,
      endOffset: 24,
      prefix: "前一段",
      suffix: "后一段",
    },
    ...overrides,
  };
}

function documentRecord(overrides = {}) {
  return {
    documentId: "MTBfcmF3L2FydGljbGUtb25lLm1k",
    relativePath: "10_raw/articles/article-one.md",
    title: "把阅读变成知识",
    contentHash: hashReaderDocumentContent("article body"),
    notes: [
      {
        id: "free-1",
        type: "free",
        body: "这篇文章最有价值的是证据层和知识层的分离。",
      },
      quoteNote(),
    ],
    ...overrides,
  };
}

test("persists, updates, lists, and deletes per-document notes", async (t) => {
  const vaultRoot = await makeVault(t);
  const times = [
    new Date("2026-07-27T01:00:00.000Z"),
    new Date("2026-07-27T02:00:00.000Z"),
  ];
  let nextId = 0;
  const repository = createReaderNotesRepository({
    vaultRoot,
    now: () => times.shift(),
    makeId: () => `generated-${++nextId}`,
  });

  const created = await repository.save(
    documentRecord({
      notes: [
        { type: "free", body: "一条没有客户端 ID 的笔记。" },
        quoteNote(),
      ],
    }),
  );
  assert.equal(created.notes[0].id, "generated-1");
  assert.equal(created.notes[0].createdAt, "2026-07-27T01:00:00.000Z");
  assert.equal(created.notes[1].anchor.startBlock, 4);

  const fetched = await repository.get(created.documentId);
  assert.deepEqual(fetched, created);
  fetched.notes[0].body = "调用方修改副本不应污染仓库";
  assert.notEqual((await repository.get(created.documentId)).notes[0].body, fetched.notes[0].body);

  const updated = await repository.save({
    ...created,
    title: "更新后的标题",
    notes: [
      created.notes[0],
      { ...created.notes[1], body: "修改后的引用判断。" },
    ],
  });
  assert.equal(updated.notes[0].updatedAt, "2026-07-27T01:00:00.000Z");
  assert.equal(updated.notes[1].updatedAt, "2026-07-27T02:00:00.000Z");
  assert.equal((await repository.list())[0].title, "更新后的标题");

  const rawStore = JSON.parse(
    await readFile(path.join(vaultRoot, READER_NOTES_STORE), "utf8"),
  );
  assert.equal(rawStore.version, 1);
  assert.equal(rawStore.documents.length, 1);
  const outputNames = await readdir(path.dirname(path.join(vaultRoot, READER_NOTES_STORE)));
  assert.equal(outputNames.some((name) => name.endsWith(".tmp")), false);

  assert.equal(await repository.delete(created.documentId), true);
  assert.equal(await repository.delete(created.documentId), false);
  assert.equal(await repository.get(created.documentId), null);
});

test("serializes concurrent saves instead of losing a document", async (t) => {
  const vaultRoot = await makeVault(t);
  let tick = 0;
  const repository = createReaderNotesRepository({
    vaultRoot,
    now: () => new Date(Date.UTC(2026, 6, 27, 3, 0, tick++)),
  });

  await Promise.all([
    repository.save(documentRecord()),
    repository.save(
      documentRecord({
        documentId: "MTBfcmF3L2FydGljbGUtdHdvLm1k",
        relativePath: "10_raw/articles/article-two.md",
        title: "第二篇",
      }),
    ),
  ]);

  assert.equal((await repository.list()).length, 2);
});

test("rejects traversal, malformed anchors, and oversized notes", async (t) => {
  const vaultRoot = await makeVault(t);
  const repository = createReaderNotesRepository({ vaultRoot });

  await assert.rejects(
    repository.save(documentRecord({ relativePath: "10_raw/../wiki/secret.md" })),
    (error) =>
      error instanceof ReaderNotesError && error.code === "PATH_TRAVERSAL",
  );
  await assert.rejects(
    repository.save(
      documentRecord({
        notes: [quoteNote({ anchor: { ...quoteNote().anchor, endBlock: 3 } })],
      }),
    ),
    (error) =>
      error instanceof ReaderNotesError &&
      error.code === "INVALID_QUOTE_ANCHOR",
  );
  await assert.rejects(
    repository.save(
      documentRecord({
        notes: [{ type: "free", body: "x".repeat(32_001) }],
      }),
    ),
    (error) =>
      error instanceof ReaderNotesError &&
      error.code === "READER_NOTE_TOO_LONG",
  );
  await assert.rejects(
    repository.save(
      documentRecord({
        notes: [quoteNote({ origin: "external-model" })],
      }),
    ),
    (error) =>
      error instanceof ReaderNotesError &&
      error.code === "INVALID_READER_NOTE_ORIGIN",
  );
});

test("rejects a reading-notes directory that escapes through a symlink", async (t) => {
  const vaultRoot = await makeVault(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), "workbench-notes-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, path.join(vaultRoot, "10_raw", "my-thoughts", "reading-notes"));
  const repository = createReaderNotesRepository({ vaultRoot });

  await assert.rejects(
    repository.list(),
    (error) =>
      error instanceof ReaderNotesError &&
      error.code === "UNSAFE_READER_NOTES_DIRECTORY",
  );
});

test("writes an isolated, auditable Markdown snapshot for Wiki ingest", async (t) => {
  const vaultRoot = await makeVault(t);
  const repository = createReaderNotesRepository({
    vaultRoot,
    now: () => new Date("2026-07-27T01:00:00.000Z"),
  });
  const saved = await repository.save(documentRecord());

  const snapshot = await createIngestSnapshot(saved, saved.notes, {
    vaultRoot,
    jobId: "ingest-job-42",
    now: new Date("2026-07-27T04:05:06.000Z"),
    occurrence: {
      trigger: "这篇文章应当强化还是挑战现有 Wiki？",
    },
  });

  assert.match(
    snapshot.relativePath,
    /^10_raw\/my-thoughts\/reading-notes\/20260727-.+-ingest-job-42\.md$/,
  );
  assert.equal(snapshot.noteCount, 2);
  assert.equal((await lstat(snapshot.absolutePath)).isFile(), true);

  const markdown = await readFile(snapshot.absolutePath, "utf8");
  assert.match(markdown, /status: pending-ingest/);
  assert.match(markdown, /## 发生位置/);
  assert.match(markdown, /这篇文章应当强化还是挑战现有 Wiki/);
  assert.match(markdown, /## 全文笔记/);
  assert.match(markdown, /## 引用笔记/);
  assert.match(markdown, /> raw 保存证据，wiki 沉淀知识。/);
  assert.match(markdown, /块范围：4 → 4/);
  assert.doesNotMatch(markdown, /article-two/);
});

test("allows an article-only ingest snapshot before the reader has written notes", async (t) => {
  const vaultRoot = await makeVault(t);
  const repository = createReaderNotesRepository({ vaultRoot });
  const saved = await repository.save({
    ...documentRecord(),
    notes: [],
  });

  const snapshot = await createIngestSnapshot(saved, [], {
    vaultRoot,
    jobId: "article-only",
    now: new Date("2026-07-27T04:05:06.000Z"),
  });

  assert.equal(snapshot.noteCount, 0);
  const markdown = await readFile(snapshot.absolutePath, "utf8");
  assert.match(markdown, /本次没有全文笔记/);
  assert.match(markdown, /本次没有引用笔记/);
});

test("keeps Codex explanations separate from user-authored judgments in ingest snapshots", async (t) => {
  const vaultRoot = await makeVault(t);
  const repository = createReaderNotesRepository({ vaultRoot });
  const saved = await repository.save(
    documentRecord({
      notes: [
        quoteNote({
          id: "explain-note-1",
          origin: "codex-explanation",
          sourceAnalysisId: "analysis-1",
          body: "这段在全文中承担从证据层过渡到知识层的作用。",
        }),
      ],
    }),
  );

  assert.equal(saved.notes[0].origin, "codex-explanation");
  assert.equal(saved.notes[0].sourceAnalysisId, "analysis-1");

  const snapshot = await createIngestSnapshot(saved, saved.notes, {
    vaultRoot,
    jobId: "ai-assisted-note",
    now: new Date("2026-07-27T04:05:06.000Z"),
  });
  const markdown = await readFile(snapshot.absolutePath, "utf8");
  assert.match(markdown, /AI 阅读辅助 1/);
  assert.match(markdown, /Codex 辅助解释（非用户判断）/);
  assert.match(markdown, /解释记录 ID：`analysis-1`/);
  assert.match(markdown, /#### Codex 辅助解释/);
  assert.doesNotMatch(markdown, /#### 我的笔记/);
});
