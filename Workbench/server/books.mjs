import path from "node:path";

const BOOKS_ROOT = "10_raw/books";

function bookId(relativePath) {
  return Buffer.from(relativePath, "utf8").toString("base64url");
}

function updatedTime(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function chapterLanguage(document) {
  const language = String(document.frontmatter?.language || "").toLowerCase();
  if (language.startsWith("zh") || document.path.includes("/中文阅读版/")) return "zh";
  if (language.startsWith("en") || document.path.includes("/英文原版/")) return "en";
  return null;
}

function chapterGroup(document) {
  if (/^00-/.test(document.fileName || "")) {
    return { key: "opening", label: "开始之前" };
  }
  if (
    /^(?:第\s*(?:\d+|[零〇一二三四五六七八九十百]+)\s*(?:章|讲)|\d+\.)/i.test(
      document.title || "",
    )
  ) {
    return { key: "chapters", label: "正文章节" };
  }
  return { key: "closing", label: "结尾与行动" };
}

function compareChapters(left, right) {
  return (left.fileName || left.path).localeCompare(
    right.fileName || right.path,
    "zh-CN",
    { numeric: true },
  );
}

function publicChapter(document, index) {
  const group = chapterGroup(document);
  return {
    id: document.id,
    path: document.path,
    title: document.title,
    order: index + 1,
    group: group.key,
    groupLabel: group.label,
    language: chapterLanguage(document),
    excerpt: document.excerpt,
    updatedAt: document.updatedAt,
  };
}

function latestUpdatedAt(documents) {
  return documents.reduce(
    (latest, document) =>
      updatedTime(document.updatedAt) > updatedTime(latest)
        ? document.updatedAt
        : latest,
    null,
  );
}

function coverDocument(documents) {
  const images = documents.filter((document) => document.previewKind === "image");
  return (
    images.find((document) => /\/images\/page-001-image-01\.[^.]+$/i.test(document.path)) ||
    images.find((document) => /\/images\/(?:cover|front)[^/]*\.[^.]+$/i.test(document.path)) ||
    images.sort((left, right) => left.path.localeCompare(right.path, "en"))[0] ||
    null
  );
}

function buildBook(relativePath, documents) {
  const chapterDocuments = documents
    .filter(
      (document) =>
        document.previewKind === "markdown" &&
        document.path !== `${relativePath}/README.md` &&
        chapterLanguage(document),
    )
    .sort(compareChapters);
  const chineseDocuments = chapterDocuments.filter(
    (document) => chapterLanguage(document) === "zh",
  );
  const englishDocuments = chapterDocuments.filter(
    (document) => chapterLanguage(document) === "en",
  );
  const metadataSource = chineseDocuments[0] || englishDocuments[0] || null;
  const cover = coverDocument(documents);
  const original = documents.find((document) => document.extension === "pdf") || null;
  const title =
    metadataSource?.frontmatter?.book ||
    path.posix.basename(relativePath).replace(/\s+-\s+.+$/, "");

  return {
    id: bookId(relativePath),
    relativePath,
    title,
    author: metadataSource?.frontmatter?.author || null,
    coverDocumentId: cover?.id || null,
    coverPath: cover?.path || null,
    original: original
      ? {
          id: original.id,
          fileName: original.fileName,
          path: original.path,
        }
      : null,
    imageCount: documents.filter((document) => document.previewKind === "image").length,
    chapterCount: chineseDocuments.length || englishDocuments.length,
    totalReadingFiles: chapterDocuments.length,
    languages: [
      ...(chineseDocuments.length
        ? [{ key: "zh", label: "中文阅读版", count: chineseDocuments.length }]
        : []),
      ...(englishDocuments.length
        ? [{ key: "en", label: "英文原版", count: englishDocuments.length }]
        : []),
    ],
    chapters: {
      zh: chineseDocuments.map(publicChapter),
      en: englishDocuments.map(publicChapter),
    },
    updatedAt: latestUpdatedAt(documents),
  };
}

export function booksPayload(index) {
  const grouped = new Map();
  for (const document of index?.documents ?? []) {
    if (
      !document.path.startsWith(`${BOOKS_ROOT}/`) ||
      document.path.split("/").some((segment) => segment.startsWith("."))
    ) {
      continue;
    }
    const remainder = document.path.slice(`${BOOKS_ROOT}/`.length);
    const folderName = remainder.split("/")[0];
    if (!folderName || !remainder.includes("/")) continue;
    const relativePath = `${BOOKS_ROOT}/${folderName}`;
    if (!grouped.has(relativePath)) grouped.set(relativePath, []);
    grouped.get(relativePath).push(document);
  }

  const books = [...grouped.entries()]
    .map(([relativePath, documents]) => buildBook(relativePath, documents))
    .filter((book) => book.totalReadingFiles > 0)
    .sort(
      (left, right) =>
        updatedTime(right.updatedAt) - updatedTime(left.updatedAt) ||
        left.title.localeCompare(right.title, "zh-CN"),
    );

  return {
    generatedAt: index?.generatedAt ?? null,
    total: books.length,
    chapterTotal: books.reduce((sum, book) => sum + book.chapterCount, 0),
    books,
  };
}
