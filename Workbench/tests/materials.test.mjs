import assert from "node:assert/strict";
import test from "node:test";

import {
  MaterialsError,
  buildMaterialFolderIndex,
  materialFolderPayload,
  materialReadingQueuePayload,
  materialsHomePayload,
} from "../server/materials.mjs";

function document(overrides = {}) {
  return {
    id: "doc-1",
    path: "10_raw/articles/one.md",
    title: "第一篇文章",
    layer: "raw",
    section: "articles",
    previewKind: "markdown",
    updatedAt: "2026-07-25T08:00:00.000Z",
    ...overrides,
  };
}

function fixtureIndex() {
  return {
    generatedAt: "2026-07-27T08:00:00.000Z",
    documents: [
      document(),
      document({
        id: "doc-2",
        path: "10_raw/articles/nested/two.md",
        title: "嵌套文章",
        updatedAt: "2026-07-27T08:00:00.000Z",
      }),
      document({
        id: "doc-3",
        path: "10_raw/web-search/research.md",
        title: "网页研究",
        section: "web-search",
        updatedAt: "2026-07-26T08:00:00.000Z",
      }),
      document({
        id: "doc-4",
        path: "10_raw/root-note.md",
        title: "根目录材料",
        section: null,
        updatedAt: null,
      }),
      document({
        id: "wiki-1",
        path: "wiki/index.md",
        title: "Wiki Index",
        layer: "wiki",
        section: null,
      }),
      document({
        id: "book-1",
        path: "10_raw/books/example/中文阅读版/01.md",
        title: "书籍章节",
        section: "books",
      }),
      document({
        id: "social-insight-1",
        path: "10_raw/social-insights/example/report.md",
        title: "社媒洞察",
        section: "social-insights",
      }),
    ],
  };
}

function readingState() {
  return {
    updatedAt: "2026-07-27T09:00:00.000Z",
    items: [
      {
        documentId: "doc-2",
        relativePath: "10_raw/articles/nested/two.md",
        queuedAt: "2026-07-27T07:00:00.000Z",
        updatedAt: "2026-07-27T07:00:00.000Z",
      },
      {
        documentId: "missing-doc",
        relativePath: "10_raw/articles/deleted.md",
        queuedAt: "2026-07-27T06:00:00.000Z",
        updatedAt: "2026-07-27T06:00:00.000Z",
      },
    ],
  };
}

test("builds nested raw-material folders with aggregate and queue counts", () => {
  const result = buildMaterialFolderIndex(fixtureIndex(), readingState());

  assert.equal(result.documents.length, 4);
  assert.equal(result.documents.some((item) => item.id === "wiki-1"), false);
  assert.equal(result.documents.some((item) => item.id === "book-1"), false);
  assert.equal(result.documents.some((item) => item.id === "social-insight-1"), false);
  const root = result.folders.get("10_raw");
  assert.equal(root.descendantFileCount, 4);
  assert.equal(root.directFileCount, 1);
  assert.equal(root.queuedCount, 1);
  assert.equal(root.updatedAt, "2026-07-27T08:00:00.000Z");
  assert.deepEqual(
    root.childFolders.map((folder) => [folder.relativePath, folder.displayName]),
    [
      ["10_raw/web-search", "网页研究"],
      ["10_raw/articles", "文章"],
    ],
  );

  const articles = result.folders.get("10_raw/articles");
  assert.equal(articles.directFileCount, 1);
  assert.equal(articles.descendantFileCount, 2);
  assert.equal(articles.childFolderCount, 1);
  assert.equal(articles.queuedCount, 1);
  assert.equal(result.folders.get("10_raw/articles/nested").items[0].isQueued, true);
});

test("returns material home data with recent ordering and unavailable queued files", () => {
  const payload = materialsHomePayload(fixtureIndex(), readingState());

  assert.equal(payload.generatedAt, "2026-07-27T08:00:00.000Z");
  assert.equal(payload.total, 4);
  assert.equal(payload.root.items, undefined);
  assert.deepEqual(payload.recent.map((item) => item.id), ["doc-2", "doc-3", "doc-1", "doc-4"]);
  assert.equal(payload.queue.length, 2);
  assert.equal(payload.queue[0].id, "doc-2");
  assert.equal(payload.queue[0].available, true);
  assert.equal(payload.queue[1].id, "missing-doc");
  assert.equal(payload.queue[1].available, false);
  assert.equal(payload.queue[1].title, "deleted");
});

test("returns folder breadcrumbs, child folders, and direct documents", () => {
  const payload = materialFolderPayload(
    fixtureIndex(),
    readingState(),
    "10_raw/articles",
  );

  assert.deepEqual(
    payload.breadcrumbs.map((item) => [item.relativePath, item.displayName]),
    [
      ["10_raw", "素材"],
      ["10_raw/articles", "文章"],
    ],
  );
  assert.equal(payload.folder.descendantFileCount, 2);
  assert.equal(payload.folder.items, undefined);
  assert.deepEqual(payload.folders.map((item) => item.relativePath), [
    "10_raw/articles/nested",
  ]);
  assert.deepEqual(payload.items.map((item) => item.id), ["doc-1"]);
});

test("returns the reading queue in queued order with state metadata", () => {
  const payload = materialReadingQueuePayload(fixtureIndex(), readingState());

  assert.equal(payload.updatedAt, "2026-07-27T09:00:00.000Z");
  assert.equal(payload.total, 2);
  assert.deepEqual(payload.items.map((item) => item.id), ["doc-2", "missing-doc"]);
  assert.equal(payload.items[0].queuedAt, "2026-07-27T07:00:00.000Z");
});

test("rejects traversal, non-material roots, and missing folders", () => {
  for (const invalidPath of [
    "wiki",
    "/10_raw/articles",
    "10_raw/../wiki",
    "10_raw\\articles",
    "10_raw//articles",
  ]) {
    assert.throws(
      () => materialFolderPayload(fixtureIndex(), readingState(), invalidPath),
      (error) => error instanceof MaterialsError && error.code === "INVALID_MATERIAL_FOLDER",
    );
  }
  assert.throws(
    () => materialFolderPayload(fixtureIndex(), readingState(), "10_raw/empty"),
    (error) => error instanceof MaterialsError && error.code === "MATERIAL_FOLDER_NOT_FOUND",
  );
});
