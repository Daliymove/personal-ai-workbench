import assert from "node:assert/strict";
import test from "node:test";

import {
  BOOK_READING_PROGRESS_KEY,
  bookReadingStorage,
  formatBookChapterProgress,
  loadBookReadingProgress,
  resolveBookResume,
  resolveLatestBookResume,
  saveBookReadingProgress,
} from "../src/lib/book-reading-progress.js";

test("resume labels identify progress as belonging to the current chapter", () => {
  assert.equal(formatBookChapterProgress(0.376), "本章 38%");
  assert.equal(formatBookChapterProgress(-1), "本章 0%");
  assert.equal(formatBookChapterProgress(2), "本章 100%");
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("book reading progress persists the last chapter and clamps its position", () => {
  const storage = memoryStorage();
  const saved = saveBookReadingProgress(storage, {
    bookId: "book-1",
    language: "zh",
    chapterId: "chapter-3",
    chapterTitle: "第三章",
    scrollTop: 842.5,
    progress: 1.4,
    updatedAt: 1234,
  });

  assert.equal(saved.progress, 1);
  assert.deepEqual(loadBookReadingProgress(storage, "book-1"), {
    bookId: "book-1",
    language: "zh",
    chapterId: "chapter-3",
    chapterTitle: "第三章",
    scrollTop: 842.5,
    progress: 1,
    updatedAt: 1234,
  });
});

test("book reading progress recovers from corrupt storage without losing later saves", () => {
  const storage = memoryStorage({ [BOOK_READING_PROGRESS_KEY]: "{broken" });
  assert.equal(loadBookReadingProgress(storage, "book-1"), null);

  saveBookReadingProgress(storage, {
    bookId: "book-1",
    language: "en",
    chapterId: "chapter-2",
    progress: 0.25,
  });
  assert.equal(loadBookReadingProgress(storage, "book-1")?.chapterId, "chapter-2");
});

test("resume targets must still exist in the current language chapter list", () => {
  const book = {
    id: "book-1",
    chapters: {
      zh: [{ id: "chapter-1", title: "第一章" }],
      en: [{ id: "chapter-1-en", title: "Chapter 1" }],
    },
  };
  const valid = {
    bookId: "book-1",
    language: "zh",
    chapterId: "chapter-1",
    progress: 0.4,
  };

  assert.equal(resolveBookResume(book, valid)?.chapter.title, "第一章");
  assert.equal(resolveBookResume(book, { ...valid, chapterId: "removed" }), null);
  assert.equal(resolveBookResume(book, { ...valid, bookId: "another-book" }), null);
});

test("the bookshelf shortcut selects the newest valid reading position", () => {
  const books = [
    {
      id: "book-1",
      chapters: { zh: [{ id: "chapter-1", title: "第一章" }] },
    },
    {
      id: "book-2",
      chapters: { zh: [{ id: "chapter-2", title: "第二章" }] },
    },
    {
      id: "book-3",
      chapters: { zh: [{ id: "chapter-3", title: "第三章" }] },
    },
  ];
  const progressByBook = new Map([
    ["book-1", {
      bookId: "book-1",
      language: "zh",
      chapterId: "chapter-1",
      progress: 0.2,
      updatedAt: 100,
    }],
    ["book-2", {
      bookId: "book-2",
      language: "zh",
      chapterId: "chapter-2",
      progress: 0.6,
      updatedAt: 300,
    }],
    ["book-3", {
      bookId: "book-3",
      language: "zh",
      chapterId: "removed-chapter",
      progress: 0.9,
      updatedAt: 500,
    }],
  ]);

  const latest = resolveLatestBookResume(books, progressByBook);
  assert.equal(latest.book.id, "book-2");
  assert.equal(latest.resume.chapter.title, "第二章");
  assert.equal(latest.resume.progress, 0.6);
});

test("unavailable browser storage falls back without interrupting reading", () => {
  const target = {};
  Object.defineProperty(target, "localStorage", {
    get() {
      throw new Error("storage disabled");
    },
  });

  assert.equal(bookReadingStorage(target), null);
  assert.equal(loadBookReadingProgress(bookReadingStorage(target), "book-1"), null);
});
