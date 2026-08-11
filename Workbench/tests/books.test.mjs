import assert from "node:assert/strict";
import test from "node:test";

import { booksPayload } from "../server/books.mjs";

function document(path, overrides = {}) {
  const fileName = path.split("/").at(-1);
  return {
    id: `id:${path}`,
    path,
    fileName,
    extension: fileName.split(".").at(-1),
    title: fileName.replace(/\.[^.]+$/, ""),
    previewKind: "markdown",
    frontmatter: {},
    updatedAt: "2026-07-29T08:00:00.000Z",
    excerpt: "",
    ...overrides,
  };
}

function fixtureIndex() {
  const root = "10_raw/books/100M Offers - Alex Hormozi";
  return {
    generatedAt: "2026-07-30T08:00:00.000Z",
    documents: [
      document(`${root}/README.md`, { title: "读书资料" }),
      document(`${root}/100M Offers - English Original.pdf`, {
        extension: "pdf",
        previewKind: "unsupported",
      }),
      document(`${root}/images/page-001-image-01.jpg`, {
        extension: "jpg",
        previewKind: "image",
      }),
      document(`${root}/images/page-015-image-01.jpg`, {
        extension: "jpg",
        previewKind: "image",
      }),
      document(`${root}/中文阅读版/00-front-matter.md`, {
        title: "前置内容",
        frontmatter: {
          book: "$100M Offers",
          author: "Alex Hormozi",
          language: "zh-CN",
        },
      }),
      document(`${root}/中文阅读版/01-how-we-got-here.md`, {
        title: "第 1 章 我们是如何走到这里的",
        frontmatter: { language: "zh-CN" },
      }),
      document(`${root}/中文阅读版/17-your-first-100000.md`, {
        title: "你的第一个 10 万美元",
        frontmatter: { language: "zh-CN" },
      }),
      document(`${root}/英文原版/00-front-matter.md`, {
        title: "Front Matter",
        frontmatter: { language: "en" },
      }),
      document(`${root}/英文原版/01-how-we-got-here.md`, {
        title: "1. How We Got Here",
        frontmatter: { language: "en" },
      }),
      document("10_raw/articles/other.md", { title: "Not a book" }),
    ],
  };
}

test("builds a book from local cover, metadata, and bilingual chapters", () => {
  const payload = booksPayload(fixtureIndex());

  assert.equal(payload.total, 1);
  assert.equal(payload.chapterTotal, 3);
  const book = payload.books[0];
  assert.equal(book.title, "$100M Offers");
  assert.equal(book.author, "Alex Hormozi");
  assert.equal(book.chapterCount, 3);
  assert.equal(book.totalReadingFiles, 5);
  assert.equal(book.imageCount, 2);
  assert.match(book.coverPath, /page-001-image-01\.jpg$/);
  assert.deepEqual(book.languages.map((item) => [item.key, item.count]), [
    ["zh", 3],
    ["en", 2],
  ]);
  assert.deepEqual(book.chapters.zh.map((item) => item.group), [
    "opening",
    "chapters",
    "closing",
  ]);
  assert.deepEqual(book.chapters.en.map((item) => item.title), [
    "Front Matter",
    "1. How We Got Here",
  ]);
});

test("ignores unrelated raw files and book folders without readable chapters", () => {
  const index = fixtureIndex();
  index.documents.push(
    document("10_raw/books/PDF only/book.pdf", {
      extension: "pdf",
      previewKind: "unsupported",
    }),
  );

  const payload = booksPayload(index);
  assert.equal(payload.total, 1);
  assert.equal(payload.books.some((book) => book.title === "PDF only"), false);
});

test("groups Chinese-numbered chapters and talks as main chapters", () => {
  const index = fixtureIndex();
  const root = "10_raw/books/100M Offers - Alex Hormozi";
  index.documents.push(
    document(`${root}/中文阅读版/02-chinese-numbered-chapter.md`, {
      title: "第二章 增强判断力",
      frontmatter: { language: "zh-CN" },
    }),
    document(`${root}/中文阅读版/03-chinese-numbered-talk.md`, {
      title: "第十一讲 人类误判心理学",
      frontmatter: { language: "zh-CN" },
    }),
  );

  const book = booksPayload(index).books[0];
  const groupsByTitle = Object.fromEntries(
    book.chapters.zh.map((chapter) => [chapter.title, chapter.group]),
  );
  assert.equal(groupsByTitle["第二章 增强判断力"], "chapters");
  assert.equal(groupsByTitle["第十一讲 人类误判心理学"], "chapters");
});
