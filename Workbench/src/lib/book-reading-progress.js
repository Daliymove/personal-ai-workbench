export const BOOK_READING_PROGRESS_KEY = "workbench:books:reading-progress:v1";
export const BOOK_READING_PROGRESS_EVENT = "workbench:book-reading-progress";

const MAX_SAVED_BOOKS = 100;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeRecord(record, fallbackBookId = null) {
  if (!record || typeof record !== "object") return null;
  const bookId = String(record.bookId || fallbackBookId || "").trim();
  const chapterId = String(record.chapterId || "").trim();
  const language = String(record.language || "").trim();
  if (!bookId || !chapterId || !language) return null;

  return {
    bookId,
    language,
    chapterId,
    chapterTitle: String(record.chapterTitle || "").trim(),
    scrollTop: Math.max(0, finiteNumber(record.scrollTop)),
    progress: Math.min(1, Math.max(0, finiteNumber(record.progress))),
    updatedAt: Math.max(0, finiteNumber(record.updatedAt, Date.now())),
  };
}

function readStore(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(BOOK_READING_PROGRESS_KEY) || "null");
    if (parsed?.version !== 1 || !parsed.books || typeof parsed.books !== "object") {
      return { version: 1, books: {} };
    }
    return { version: 1, books: { ...parsed.books } };
  } catch {
    return { version: 1, books: {} };
  }
}

export function bookReadingStorage(target = globalThis) {
  try {
    return target?.localStorage || null;
  } catch {
    return null;
  }
}

export function loadBookReadingProgress(storage, bookId) {
  if (!bookId) return null;
  const store = readStore(storage);
  return normalizeRecord(store.books[bookId], bookId);
}

export function saveBookReadingProgress(storage, record) {
  const normalized = normalizeRecord({ ...record, updatedAt: record?.updatedAt || Date.now() });
  if (!normalized || !storage?.setItem) return null;

  try {
    const store = readStore(storage);
    store.books[normalized.bookId] = normalized;
    store.books = Object.fromEntries(
      Object.entries(store.books)
        .map(([bookId, value]) => [bookId, normalizeRecord(value, bookId)])
        .filter(([, value]) => value)
        .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
        .slice(0, MAX_SAVED_BOOKS),
    );
    storage.setItem(BOOK_READING_PROGRESS_KEY, JSON.stringify(store));
    return normalized;
  } catch {
    return null;
  }
}

export function resolveBookResume(book, record) {
  if (!book || !record || record.bookId !== book.id) return null;
  const chapters = book.chapters?.[record.language] || [];
  const chapter = chapters.find((item) => item.id === record.chapterId);
  return chapter ? { ...record, chapter, language: record.language } : null;
}

export function resolveLatestBookResume(books, progressByBook) {
  if (!Array.isArray(books)) return null;

  let latest = null;
  for (const book of books) {
    const record = progressByBook instanceof Map
      ? progressByBook.get(book.id)
      : progressByBook?.[book.id];
    const resume = resolveBookResume(book, record);
    if (!resume) continue;
    if (!latest || resume.updatedAt > latest.resume.updatedAt) {
      latest = { book, resume };
    }
  }
  return latest;
}

export function formatBookChapterProgress(progress) {
  const normalized = Math.min(1, Math.max(0, finiteNumber(progress)));
  return `本章 ${Math.round(normalized * 100)}%`;
}

export function announceBookReadingProgress(record, target = globalThis) {
  if (!record || typeof target?.dispatchEvent !== "function") return;
  const EventConstructor = target.CustomEvent || globalThis.CustomEvent;
  if (typeof EventConstructor !== "function") return;
  target.dispatchEvent(new EventConstructor(BOOK_READING_PROGRESS_EVENT, { detail: record }));
}
