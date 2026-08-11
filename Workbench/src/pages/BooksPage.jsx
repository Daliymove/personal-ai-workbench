import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useNavigate, useParams } from "react-router-dom";
import {
  IconArrowLeft,
  IconArrowRight,
  IconBook,
  IconBook2,
  IconBookmark,
  IconBooks,
  IconChevronRight,
  IconFileText,
  IconLanguage,
  IconPhoto,
} from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { loadBooks } from "../lib/api";
import {
  BOOK_READING_PROGRESS_EVENT,
  BOOK_READING_PROGRESS_KEY,
  bookReadingStorage,
  formatBookChapterProgress,
  loadBookReadingProgress,
  resolveBookResume,
  resolveLatestBookResume,
} from "../lib/book-reading-progress";

function loadingResult() {
  return { data: null, source: "loading", error: null };
}

function coverUrl(book) {
  return book.coverDocumentId
    ? `/api/vault-images/${encodeURIComponent(book.coverDocumentId)}`
    : null;
}

function BookCover({ book, compact = false, current = false }) {
  const source = coverUrl(book);
  return (
    <span className={`book-cover${compact ? " book-cover--compact" : ""}${current ? " book-cover--current" : ""}`}>
      {source ? (
        <img alt={`《${book.title}》封面`} src={source} />
      ) : (
        <span className="book-cover__fallback" aria-hidden="true">
          <IconBook2 size={compact ? 34 : 44} stroke={1.4} />
          <small>{book.title}</small>
        </span>
      )}
    </span>
  );
}

function readerContext(book, language, chapter, initialPosition = null) {
  return {
    kind: "book",
    bookId: book.id,
    bookTitle: book.title,
    language,
    chapterId: chapter.id,
    chapters: (book.chapters[language] || []).map((item) => ({
      id: item.id,
      title: item.title,
      order: item.order,
    })),
    initialPosition,
  };
}

function Shelf({ data, onOpenBook, onOpenDocument, progressByBook }) {
  const books = data?.books ?? [];
  const currentReading = resolveLatestBookResume(books, progressByBook);

  const continueReading = () => {
    if (!currentReading) return;
    const { book, resume } = currentReading;
    onOpenDocument({
      id: resume.chapter.id,
      readerContext: readerContext(book, resume.language, resume.chapter, resume),
    });
  };

  return (
    <div className="page page--books">
      <PageHeader
        eyebrow="READING LIBRARY"
        title="书架"
        description="Books 是独立阅读空间：从封面进入书籍，按章节阅读中文译本，也可随时切回英文原版。"
        aside={
          <div className="books-total mono">
            <span>{data?.total ?? 0}</span>
            <small>BOOKS</small>
          </div>
        }
      />

      {currentReading ? (
        <motion.button
          animate={{ opacity: 1, y: 0 }}
          aria-label={`继续阅读《${currentReading.book.title}》${currentReading.resume.chapter.title}，${formatBookChapterProgress(currentReading.resume.progress)}`}
          className="book-current"
          initial={{ opacity: 0, y: 8 }}
          onClick={continueReading}
          transition={{ duration: 0.24 }}
          type="button"
        >
          <BookCover book={currentReading.book} current />
          <span className="book-current__body">
            <span className="eyebrow">CURRENTLY READING</span>
            <strong>{currentReading.book.title}</strong>
            <span className="book-current__chapter">
              上次读到 {currentReading.resume.chapter.title}
            </span>
            <span className="book-current__meta">
              <span>
                {currentReading.book.languages.find(
                  (item) => item.key === currentReading.resume.language,
                )?.label || currentReading.resume.language}
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatBookChapterProgress(currentReading.resume.progress)}</span>
            </span>
            <span
              aria-label={`${currentReading.resume.chapter.title}阅读位置`}
              aria-valuemax="100"
              aria-valuemin="0"
              aria-valuenow={Math.round(currentReading.resume.progress * 100)}
              className="book-current__progress"
              role="progressbar"
            >
              <span style={{ width: `${Math.round(currentReading.resume.progress * 100)}%` }} />
            </span>
          </span>
          <span className="book-current__action">
            回到上次位置 <IconArrowRight size={17} />
          </span>
        </motion.button>
      ) : null}

      {books.length > 0 ? (
        <motion.section
          animate={{ opacity: 1, y: 0 }}
          className="bookshelf"
          initial={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.28 }}
        >
          <div className="bookshelf__grid">
            {books.map((book, index) => {
              const resume = resolveBookResume(book, progressByBook.get(book.id));
              return (
                <motion.button
                  animate={{ opacity: 1, y: 0 }}
                  aria-label={`打开《${book.title}》`}
                  className="book-card"
                  initial={{ opacity: 0, y: 12 }}
                  key={book.id}
                  onClick={() => onOpenBook(book)}
                  transition={{ delay: index * 0.04, duration: 0.28 }}
                  type="button"
                >
                  <BookCover book={book} />
                  <span className="book-card__body">
                    <span className="eyebrow">IN YOUR LIBRARY</span>
                    <strong>{book.title}</strong>
                    <span className="book-card__author">{book.author || "作者未记录"}</span>
                    <span className="book-card__stats">
                      <span><IconFileText size={14} /> {book.chapterCount} 章</span>
                      <span><IconLanguage size={14} /> {book.languages.length} 个版本</span>
                      <span><IconPhoto size={14} /> {book.imageCount} 张原图</span>
                    </span>
                    {resume ? (
                      <span className="book-card__resume">
                        <IconBookmark size={14} />
                        <span>上次读到 {resume.chapter.title} · {formatBookChapterProgress(resume.progress)}</span>
                      </span>
                    ) : null}
                    <span className="book-card__enter">
                      {resume ? "继续阅读" : "查看章节"} <IconChevronRight size={16} />
                    </span>
                  </span>
                </motion.button>
              );
            })}
          </div>
        </motion.section>
      ) : (
        <div className="books-empty">
          <IconBooks size={28} stroke={1.5} />
          <strong>书架还是空的</strong>
          <span>放入 `10_raw/books/书名/` 的章节会自动出现在这里。</span>
        </div>
      )}
    </div>
  );
}

function groupChapters(chapters) {
  const groups = [];
  for (const chapter of chapters) {
    let group = groups.find((item) => item.key === chapter.group);
    if (!group) {
      group = { key: chapter.group, label: chapter.groupLabel, chapters: [] };
      groups.push(group);
    }
    group.chapters.push(chapter);
  }
  return groups;
}

function BookDetail({ book, onBack, onOpenDocument, savedProgress }) {
  const resume = useMemo(
    () => resolveBookResume(book, savedProgress),
    [book, savedProgress],
  );
  const [language, setLanguage] = useState(
    resume?.language || (book.chapters.zh?.length ? "zh" : "en"),
  );

  useEffect(() => {
    setLanguage(resume?.language || (book.chapters.zh?.length ? "zh" : "en"));
  }, [book.id, book.chapters.en?.length, book.chapters.zh?.length, resume?.language]);

  const chapters = book.chapters[language] ?? [];
  const groups = useMemo(() => groupChapters(chapters), [chapters]);
  const firstChapter = chapters[0] ?? null;
  const languageResume = resume?.language === language ? resume : null;
  const primaryChapter = languageResume?.chapter || firstChapter;

  const openChapter = (chapter) => {
    if (!chapter) return;
    const initialPosition = languageResume?.chapterId === chapter.id ? languageResume : null;
    onOpenDocument({
      id: chapter.id,
      readerContext: readerContext(book, language, chapter, initialPosition),
    });
  };

  return (
    <div className="page page--books page--book-detail">
      <button className="book-back" onClick={onBack} type="button">
        <IconArrowLeft size={17} /> 返回书架
      </button>

      <motion.section
        animate={{ opacity: 1, y: 0 }}
        className="book-detail-hero"
        initial={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.3 }}
      >
        <BookCover book={book} compact />
        <div className="book-detail-hero__content">
          <span className="eyebrow">CURRENT BOOK</span>
          <h1>{book.title}</h1>
          <p className="book-detail-hero__author">{book.author || "作者未记录"}</p>
          <p className="book-detail-hero__description">
            中文忠实阅读版与英文原版逐章对应，书中原图会在沉浸阅读器里按原位置展示。
          </p>
          <div className="book-detail-hero__meta">
            <span><IconFileText size={15} /> {book.chapterCount} 个章节</span>
            <span><IconPhoto size={15} /> {book.imageCount} 张原图</span>
            <span><IconLanguage size={15} /> {book.languages.length} 个版本</span>
          </div>
          <button
            className="book-primary-action"
            disabled={!primaryChapter}
            onClick={() => openChapter(primaryChapter)}
            type="button"
          >
            <IconBook size={18} />
            {languageResume
              ? `继续阅读 · ${languageResume.chapter.title}（${formatBookChapterProgress(languageResume.progress)}）`
              : language === "zh" ? "开始读中文版" : "Start reading"}
          </button>
        </div>
      </motion.section>

      <section className="chapter-browser">
        <header className="chapter-browser__header">
          <div>
            <span className="eyebrow">TABLE OF CONTENTS</span>
            <h2>章节目录</h2>
          </div>
          <div aria-label="阅读版本" className="chapter-language-tabs" role="tablist">
            {book.languages.map((item) => (
              <button
                aria-selected={language === item.key}
                className={language === item.key ? "is-active" : ""}
                key={item.key}
                onClick={() => setLanguage(item.key)}
                role="tab"
                type="button"
              >
                {item.label}
                <span>{item.count}</span>
              </button>
            ))}
          </div>
        </header>

        <div className="chapter-tree">
          {groups.map((group) => (
            <section className="chapter-group" key={group.key}>
              <div className="chapter-group__label">
                <span aria-hidden="true" />
                <strong>{group.label}</strong>
              </div>
              <div className="chapter-group__items">
                {group.chapters.map((chapter) => (
                  <button
                    className={`chapter-row${languageResume?.chapterId === chapter.id ? " chapter-row--resume" : ""}`}
                    key={chapter.id}
                    onClick={() => openChapter(chapter)}
                    type="button"
                  >
                    <span className="chapter-row__number mono">
                      {String(chapter.order).padStart(2, "0")}
                    </span>
                    <span className="chapter-row__title">{chapter.title}</span>
                    <span className="chapter-row__action">
                      {languageResume?.chapterId === chapter.id
                        ? `${formatBookChapterProgress(languageResume.progress)} · 继续`
                        : "阅读"} <IconChevronRight size={16} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

export function BooksPage({ onOpenDocument }) {
  const navigate = useNavigate();
  const { bookId } = useParams();
  const [result, setResult] = useState(loadingResult);
  const [progressRevision, setProgressRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadBooks().then((response) => {
      if (!cancelled) setResult(response);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const refresh = () => setProgressRevision((revision) => revision + 1);
    const onStorage = (event) => {
      if (event.key === BOOK_READING_PROGRESS_KEY) refresh();
    };
    window.addEventListener(BOOK_READING_PROGRESS_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BOOK_READING_PROGRESS_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  if (result.source === "loading") {
    return (
      <div className="page page--books">
        <PageHeader eyebrow="READING LIBRARY" title="书架" description="正在整理本地书籍与章节……" />
        <div className="books-loading">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      </div>
    );
  }

  if (result.error && !result.data) {
    return <div className="page"><div className="error-note">书架加载失败：{result.error.message}</div></div>;
  }

  const data = result.data;
  const readingStorage = bookReadingStorage(window);
  const progressByBook = new Map(
    (data?.books || []).map((book) => [
      book.id,
      loadBookReadingProgress(readingStorage, book.id),
    ]),
  );
  const activeBook = bookId
    ? data?.books?.find((book) => book.id === bookId)
    : null;

  if (bookId && !activeBook) {
    return (
      <div className="page page--books">
        <button className="book-back" onClick={() => navigate("/books")} type="button">
          <IconArrowLeft size={17} /> 返回书架
        </button>
        <div className="books-empty">
          <IconBook2 size={28} stroke={1.5} />
          <strong>没有找到这本书</strong>
          <span>它可能已经改名或移出了本地 Books 目录。</span>
        </div>
      </div>
    );
  }

  return activeBook ? (
    <BookDetail
      book={activeBook}
      onBack={() => navigate("/books")}
      onOpenDocument={onOpenDocument}
      savedProgress={progressByBook.get(activeBook.id)}
    />
  ) : (
    <Shelf
      data={data}
      onOpenBook={(book) => navigate(`/books/${book.id}`)}
      onOpenDocument={onOpenDocument}
      progressByBook={progressByBook}
      revision={progressRevision}
    />
  );
}
