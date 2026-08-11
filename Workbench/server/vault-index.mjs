import { promises as fs } from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const INTERNAL_CONTENT = Symbol("vaultDocumentContent");
const INTERNAL_DOCUMENT_MAP = Symbol("vaultDocumentMap");
const INTERNAL_VAULT_ROOT = Symbol("vaultRoot");

const EXCLUDED_DIRECTORIES = new Set([
  ".agents",
  ".baoyu-skills",
  ".git",
  ".obsidian",
  ".openai",
  ".workbuddy",
  "dist",
  "node_modules",
  "workbench",
]);

// These private workflow surfaces are intentionally outside the public build.
// Excluding them at scan time also keeps their files out of global search and
// recent-item feeds when a user connects a larger Vault.
const PUBLIC_HIDDEN_PATH_PREFIXES = [
  "Brainstorm",
  "90_runs",
  "30_self_media/public-account",
];

function isPublicHiddenPath(relativePath) {
  const normalized = toPosixPath(relativePath);
  return PUBLIC_HIDDEN_PATH_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

const FORMAL_WIKI_SECTIONS = new Set([
  "analyses",
  "cases",
  "comparisons",
  "concepts",
  "conflicts",
  "diagnoses",
  "frameworks",
  "questions",
  "sources",
  "topics",
]);

const SUMMARY_FIELD_MAP = {
  作品数: "workCount",
  总播放: "totalViews",
  播放中位数: "medianViews",
  条均播放: "averageViews",
  总点赞: "totalLikes",
  总分享: "totalShares",
  总评论: "totalComments",
  总收藏: "totalSaves",
  总互动量: "totalEngagements",
  总主页访问: "totalProfileVisits",
  总粉丝增量: "totalFollowerGain",
  加权完播率: "weightedCompletionRatePct",
  "加权 5s 完播率": "weightedFiveSecondCompletionRatePct",
  "加权 2s 跳出率": "weightedTwoSecondBounceRatePct",
  加权平均播放时长: "weightedAverageWatchSeconds",
  "点赞 / 播放": "likeRatePct",
  "分享 / 播放": "shareRatePct",
  "评论 / 播放": "commentRatePct",
  "收藏 / 播放": "saveRatePct",
  "主页访问 / 播放": "profileVisitRatePct",
  "涨粉 / 播放": "followerGainRatePct",
  "互动 / 播放": "engagementRatePct",
};

const DOUYIN_WORK_LIST_SOURCE_PATH =
  "10_raw/douyin/20260725-creator-center-full-pull/01_inventory/sheets/work-list__作品列表导出__Sheet1.csv";
const DOUYIN_RAW_ROOT = "10_raw/douyin";
const DOUYIN_LATEST_FEEDBACK_PATH =
  "90_runs/data_reviews/douyin/latest-feedback.md";
const DOUYIN_STORE_CURRENT_PATH = "30_self_media/douyin/current.json";
const DOUYIN_INVENTORY_WORK_LIST =
  "01_inventory/sheets/work-list__作品列表导出__Sheet1.csv";

const DOUYIN_WORK_LIST_PATTERNS = [
  /作品列表导出.*Sheet1\.csv$/,
  /work-list__作品列表导出__Sheet1\.csv$/,
];

const DOUYIN_ACCOUNT_CONTENT_30D_PATTERN =
  /近30天-作品数据表现.*Sheet1\.csv$/;
const DOUYIN_ACCOUNT_FOLLOWER_30D_PATTERN =
  /近30天-粉丝数据表现.*Sheet1\.csv$/;

// The public build never guesses a creator's private content strategy from
// titles. Stable stores should provide contentLine/contentRole explicitly.
const DOUYIN_CLASSIFICATION_RULES = [];

function toPosixPath(value) {
  return String(value).split(path.sep).join("/");
}

function douyinSnapshotSortKey(name) {
  const match = String(name).match(/^(\d{8})(?:-(\d{6}))?/);
  if (!match) return "";
  return `${match[1]}${match[2] ?? "000000"}`;
}

async function findFirstNamedFile(directory, patterns) {
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }
  const names = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
  return names.find((name) => patterns.some((pattern) => pattern.test(name))) ?? null;
}

async function snapshotCapturedAt(vaultRoot, snapshot) {
  const manifestPaths = [
    path.join(snapshot.absoluteRoot, "00_exports", "run_manifest.json"),
    path.join(snapshot.absoluteRoot, "run_manifest.json"),
  ];
  for (const manifestPath of manifestPaths) {
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const value =
        manifest.completedAt ?? manifest.completed_at ?? manifest.startedAt ?? null;
      if (value && Number.isFinite(Date.parse(value))) return value;
    } catch {
      // Older manually collected snapshots do not have a run manifest.
    }
  }

  try {
    const stat = await fs.stat(path.join(vaultRoot, snapshot.workListPath));
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

async function snapshotRunResult(snapshot) {
  const manifestPaths = [
    path.join(snapshot.absoluteRoot, "00_exports", "run_manifest.json"),
    path.join(snapshot.absoluteRoot, "run_manifest.json"),
  ];
  for (const manifestPath of manifestPaths) {
    let source;
    try {
      source = await fs.readFile(manifestPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      return { hasManifest: true, result: "invalid" };
    }
    try {
      const manifest = JSON.parse(source);
      return {
        hasManifest: true,
        result: String(manifest.result ?? manifest.status ?? "").toLowerCase(),
      };
    } catch {
      return { hasManifest: true, result: "invalid" };
    }
  }
  return { hasManifest: false, result: null };
}

async function officialDouyinSnapshotRoot(vaultRoot) {
  try {
    const pointer = await fs.readFile(
      path.join(vaultRoot, DOUYIN_LATEST_FEEDBACK_PATH),
      "utf8",
    );
    if (!/数据质量：\s*`passed`/.test(pointer)) return null;
    const match = pointer.match(/当前官方快照：\s*`([^`]+)`/);
    if (!match) return null;
    const rootPath = toPosixPath(match[1]).replace(/^\.\//, "");
    if (!rootPath.startsWith(`${DOUYIN_RAW_ROOT}/`)) return null;
    return rootPath;
  } catch {
    return null;
  }
}

async function loadStableDouyinStore(vaultRoot) {
  try {
    const payload = JSON.parse(
      await fs.readFile(path.join(vaultRoot, DOUYIN_STORE_CURRENT_PATH), "utf8"),
    );
    if (
      payload.schemaVersion !== 1 ||
      payload.dataQuality?.status === "failed" ||
      payload.douyin?.available !== true ||
      !Array.isArray(payload.douyin?.works)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

async function resolveDouyinSnapshots(vaultRoot) {
  const douyinRoot = path.join(vaultRoot, DOUYIN_RAW_ROOT);
  let entries = [];
  try {
    entries = await fs.readdir(douyinRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const snapshotEntries = entries
    .filter((entry) => entry.isDirectory() && /^\d{8}-/.test(entry.name))
    .sort((left, right) =>
      douyinSnapshotSortKey(right.name).localeCompare(
        douyinSnapshotSortKey(left.name),
      ),
    );

  const snapshots = [];
  for (const entry of snapshotEntries) {
    const absoluteRoot = path.join(douyinRoot, entry.name);
    const inventoryCandidates = [
      path.join(absoluteRoot, "02_inventory", "sheets"),
      path.join(absoluteRoot, "01_inventory", "sheets"),
    ];
    for (const sheetsPath of inventoryCandidates) {
      const workListName = await findFirstNamedFile(
        sheetsPath,
        DOUYIN_WORK_LIST_PATTERNS,
      );
      if (!workListName) continue;
      const workListAbsolute = path.join(sheetsPath, workListName);
      try {
        const stat = await fs.stat(workListAbsolute);
        if (!stat.isFile() || stat.size === 0) continue;
      } catch {
        continue;
      }
      const snapshot = {
        name: entry.name,
        absoluteRoot,
        rootPath: toPosixPath(path.join(DOUYIN_RAW_ROOT, entry.name)),
        sheetsPath,
        workListPath: toPosixPath(path.relative(vaultRoot, workListAbsolute)),
      };
      const run = await snapshotRunResult(snapshot);
      if (run.hasManifest && run.result !== "complete") continue;
      snapshot.runResult = run.result;
      snapshot.capturedAt = await snapshotCapturedAt(vaultRoot, snapshot);
      snapshots.push(snapshot);
      break;
    }
  }
  return snapshots;
}

async function resolveLatestDouyinSnapshot(vaultRoot) {
  const snapshots = await resolveDouyinSnapshots(vaultRoot);
  if (snapshots.length) {
    const officialRoot = await officialDouyinSnapshotRoot(vaultRoot);
    const official = snapshots.find(
      (snapshot) => snapshot.rootPath === officialRoot,
    );
    return { latest: official ?? snapshots[0], snapshots };
  }
  return {
    latest: {
      name: "legacy-fallback",
      absoluteRoot: path.dirname(
        path.dirname(
          path.dirname(path.join(vaultRoot, DOUYIN_WORK_LIST_SOURCE_PATH)),
        ),
      ),
      rootPath: toPosixPath(
        path.dirname(path.dirname(path.dirname(DOUYIN_WORK_LIST_SOURCE_PATH))),
      ),
      sheetsPath: path.dirname(path.join(vaultRoot, DOUYIN_WORK_LIST_SOURCE_PATH)),
      workListPath: DOUYIN_WORK_LIST_SOURCE_PATH,
      capturedAt: null,
    },
    snapshots: [],
  };
}

function safeRelative(root, absolutePath) {
  const relative = toPosixPath(path.relative(root, absolutePath));
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith("../") ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return relative;
}

function encodeId(relativePath) {
  return Buffer.from(relativePath, "utf8").toString("base64url");
}

function sanitizeTextPaths(value, vaultRoot) {
  if (typeof value !== "string") return value;

  const normalizedRoot = vaultRoot
    ? toPosixPath(path.resolve(vaultRoot)).replace(/\/+$/, "")
    : "";
  let sanitized = value;
  if (normalizedRoot) {
    sanitized = sanitized.split(`${normalizedRoot}/`).join("");
    sanitized = sanitized.split(normalizedRoot).join(".");
  }
  sanitized = sanitized.replace(/\/Users\/[^/]+\/?/g, "[home]/");
  return sanitized;
}

function sanitizeValue(value, vaultRoot) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, vaultRoot));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sanitizeValue(item, vaultRoot),
      ]),
    );
  }
  return sanitizeTextPaths(value, vaultRoot);
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => parseScalar(item));
  }

  if (trimmed === "null" || trimmed === "~") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseFrontmatter(lines) {
  const frontmatter = {};
  let currentKey = null;

  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const keyMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (keyMatch) {
      const [, key, rawValue = ""] = keyMatch;
      currentKey = key;
      frontmatter[key] = parseScalar(rawValue);
      continue;
    }

    const listMatch = line.match(/^\s+-\s*(.*)$/);
    if (currentKey && listMatch) {
      if (!Array.isArray(frontmatter[currentKey])) {
        frontmatter[currentKey] =
          frontmatter[currentKey] == null
            ? []
            : [frontmatter[currentKey]];
      }
      frontmatter[currentKey].push(parseScalar(listMatch[1]));
    }
  }

  return frontmatter;
}

function stripMarkdownForExcerpt(value) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[\[[^\]]+\]\]/g, " ")
    .replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) =>
      alias || target
    )
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[`>*_~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseWikiLinks(body) {
  const links = [];
  const pattern = /(!?)\[\[([^\]]+)\]\]/g;
  let match;

  while ((match = pattern.exec(body)) !== null) {
    const raw = match[2].trim();
    const pipeIndex = raw.indexOf("|");
    const targetWithAnchor =
      pipeIndex >= 0 ? raw.slice(0, pipeIndex).trim() : raw;
    const label = pipeIndex >= 0 ? raw.slice(pipeIndex + 1).trim() : null;
    const [target, heading = null] = targetWithAnchor.split("#", 2);
    if (!target.trim()) continue;

    links.push({
      target: target.trim(),
      label: label || null,
      heading: heading || null,
      embedded: match[1] === "!",
      resolvedId: null,
    });
  }

  return links;
}

function parseMarkdown(text) {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  let frontmatter = {};
  let bodyStart = 0;

  if (lines[0]?.trim() === "---") {
    const closingIndex = lines.findIndex(
      (line, index) => index > 0 && line.trim() === "---",
    );
    if (closingIndex > 0) {
      frontmatter = parseFrontmatter(lines.slice(1, closingIndex));
      bodyStart = closingIndex + 1;
    }
  }

  const body = lines.slice(bodyStart).join("\n").trim();
  const headings = [];
  let title = null;

  for (const line of body.split("\n")) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const level = match[1].length;
    const headingTitle = match[2].trim();
    headings.push({ level, title: headingTitle });
    if (level === 1 && !title) title = headingTitle;
  }

  return {
    frontmatter,
    body,
    title,
    headings,
    wikiLinks: parseWikiLinks(body),
  };
}

function classifyDocument(relativePath) {
  const parts = relativePath.split("/");
  const top = parts[0] || "";
  const section = parts.length > 2 ? parts[1] : null;

  if (top === "Brainstorm") {
    const fileName = parts.at(-1) || "";
    const kind = relativePath === "Brainstorm/使用手册.md"
      ? "brainstorm-manual"
      : fileName === "brainstorm.md"
        ? "brainstorm-session"
        : fileName === "knowledge-delta.md"
          ? "knowledge-delta"
          : fileName === "wiki-writeback-plan.md"
            ? "wiki-writeback-plan"
            : "brainstorm-artifact";
    return { layer: "brainstorm", section, kind };
  }

  if (top === "10_raw") {
    return { layer: "raw", section, kind: "material" };
  }
  if (top === "40_topics") {
    return { layer: "topics", section, kind: "topic" };
  }
  if (top === "50_scripts") {
    return {
      layer: "scripts",
      section,
      kind: "script",
    };
  }
  if (top === "90_runs") {
    return { layer: "runs", section, kind: "run" };
  }
  if (top === "wiki") {
    return {
      layer: "wiki",
      section,
      kind: FORMAL_WIKI_SECTIONS.has(section)
        ? "knowledge"
        : section === "templates"
          ? "template"
          : section === "usage"
            ? "usage"
            : "wiki-system",
    };
  }
  return { layer: "other", section: top || null, kind: "file" };
}

function extensionOf(relativePath) {
  const extension = path.posix.extname(relativePath).toLowerCase();
  return extension ? extension.slice(1) : null;
}

function previewKind(extension) {
  if (extension === "md" || extension === "txt" || extension === "html") {
    return extension === "md" ? "markdown" : "text";
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) {
    return "image";
  }
  if (["mp3", "mpeg", "wav", "m4a", "aac", "flac"].includes(extension)) {
    return "audio";
  }
  if (["mp4", "mov", "webm", "mkv"].includes(extension)) {
    return "video";
  }
  if (["xlsx", "xls", "csv"].includes(extension)) return "spreadsheet";
  if (extension === "json") return "json";
  return "unsupported";
}

function normalizeDate(value, fallback) {
  if (value == null || value === "") return fallback;
  const stringValue = String(value);
  const parsed = Date.parse(stringValue);
  if (Number.isNaN(parsed)) return stringValue;
  return new Date(parsed).toISOString();
}

function makeError(relativePath, error, fallbackCode = "READ_FAILED") {
  return {
    path: relativePath || null,
    code:
      typeof error?.code === "string" && error.code
        ? error.code
        : fallbackCode,
  };
}

async function collectFiles(vaultRoot, errors) {
  const files = [];

  async function walk(absoluteDirectory) {
    let entries;
    try {
      entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    } catch (error) {
      errors.push(
        makeError(
          safeRelative(vaultRoot, absoluteDirectory),
          error,
          "DIRECTORY_READ_FAILED",
        ),
      );
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolutePath = path.join(absoluteDirectory, entry.name);
      const relativePath = safeRelative(vaultRoot, absolutePath);
      if (!relativePath) continue;
      if (isPublicHiddenPath(relativePath)) continue;

      if (entry.isSymbolicLink()) {
        errors.push({ path: relativePath, code: "SYMLINK_SKIPPED" });
        continue;
      }

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        await walk(absolutePath);
        continue;
      }

      if (entry.isFile()) files.push({ absolutePath, relativePath });
    }
  }

  await walk(vaultRoot);
  return files;
}

async function buildDocument(file, vaultRoot, errors) {
  let stats;
  try {
    stats = await fs.stat(file.absolutePath);
  } catch (error) {
    errors.push(makeError(file.relativePath, error, "STAT_FAILED"));
    return null;
  }

  const extension = extensionOf(file.relativePath);
  const classification = classifyDocument(file.relativePath);
  const fallbackTitle =
    path.posix.basename(file.relativePath, path.posix.extname(file.relativePath)) ||
    file.relativePath;

  let parsed = {
    frontmatter: {},
    body: "",
    title: null,
    headings: [],
    wikiLinks: [],
  };
  let rawContent = null;
  const qualityFlags = [];

  if (extension === "md" || extension === "txt") {
    try {
      rawContent = await fs.readFile(file.absolutePath, "utf8");
      if (extension === "md") {
        parsed = parseMarkdown(rawContent);
      } else {
        parsed.body = rawContent;
      }
    } catch (error) {
      errors.push(makeError(file.relativePath, error));
      qualityFlags.push("content_read_failed");
    }
  }

  const frontmatter = sanitizeValue(parsed.frontmatter, vaultRoot);
  const title = sanitizeTextPaths(
    frontmatter.title || parsed.title || fallbackTitle,
    vaultRoot,
  );
  const modifiedAt = stats.mtime.toISOString();
  const createdAt = normalizeDate(frontmatter.created, stats.birthtime.toISOString());
  const updatedAt = normalizeDate(frontmatter.updated, modifiedAt);
  const isArchived =
    file.relativePath.includes("/_archive/") ||
    frontmatter.status === "deprecated" ||
    frontmatter.status === "archived";

  if (extension === "md" && !parsed.title) qualityFlags.push("missing_h1");
  if (extension === "md" && Object.keys(frontmatter).length === 0) {
    qualityFlags.push("missing_frontmatter");
  }

  const document = {
    id: encodeId(file.relativePath),
    path: file.relativePath,
    fileName: path.posix.basename(file.relativePath),
    extension,
    sizeBytes: stats.size,
    layer: classification.layer,
    section: classification.section,
    kind: classification.kind,
    title,
    type: frontmatter.type ?? null,
    status: frontmatter.status ?? null,
    tags: Array.isArray(frontmatter.tags)
      ? frontmatter.tags.filter((tag) => tag != null).map(String)
      : frontmatter.tags
        ? [String(frontmatter.tags)]
        : [],
    createdAt,
    updatedAt,
    modifiedAt,
    isArchived,
    previewKind: previewKind(extension),
    frontmatter,
    headings: parsed.headings.map((heading) => ({
      level: heading.level,
      title: sanitizeTextPaths(heading.title, vaultRoot),
    })),
    wikiLinks: parsed.wikiLinks.map((link) => ({
      ...link,
      target: sanitizeTextPaths(link.target, vaultRoot),
      label: sanitizeTextPaths(link.label, vaultRoot),
    })),
    backlinks: [],
    excerpt: sanitizeTextPaths(
      stripMarkdownForExcerpt(parsed.body).slice(0, 320) || "",
      vaultRoot,
    ),
    qualityFlags,
  };

  Object.defineProperty(document, INTERNAL_CONTENT, {
    value: rawContent,
    enumerable: false,
    writable: false,
  });

  return document;
}

function withoutMarkdownExtension(value) {
  return value.replace(/\.md$/i, "");
}

function buildLinkLookup(documents) {
  const exact = new Map();
  const basenames = new Map();

  for (const document of documents) {
    if (document.extension !== "md") continue;
    const noExtension = withoutMarkdownExtension(document.path);
    exact.set(noExtension, document);
    exact.set(document.path, document);

    const basename = path.posix.basename(noExtension);
    const existing = basenames.get(basename) || [];
    existing.push(document);
    basenames.set(basename, existing);
  }

  return { exact, basenames };
}

function resolveWikiLinks(documents) {
  const lookup = buildLinkLookup(documents);
  const documentById = new Map(documents.map((document) => [document.id, document]));

  for (const document of documents) {
    if (document.extension !== "md") continue;
    const sourceDirectory = path.posix.dirname(document.path);

    for (const link of document.wikiLinks) {
      const rawTarget = withoutMarkdownExtension(
        link.target.replace(/^\/+/, "").replace(/\\/g, "/"),
      );
      const candidates = [
        path.posix.normalize(path.posix.join(sourceDirectory, rawTarget)),
        path.posix.normalize(rawTarget),
      ];

      if (document.path.startsWith("wiki/") && !rawTarget.startsWith("wiki/")) {
        candidates.push(path.posix.normalize(path.posix.join("wiki", rawTarget)));
      }

      let resolved = null;
      for (const candidate of candidates) {
        resolved =
          lookup.exact.get(candidate) ||
          lookup.exact.get(`${candidate}.md`) ||
          null;
        if (resolved) break;
      }

      if (!resolved && !rawTarget.includes("/")) {
        const matches = lookup.basenames.get(rawTarget) || [];
        if (matches.length === 1) resolved = matches[0];
      }

      if (!resolved) continue;
      link.resolvedId = resolved.id;
      resolved.backlinks.push({
        id: document.id,
        path: document.path,
        title: document.title,
      });
    }
  }

  return documentById;
}

function countBy(items, getter) {
  const counts = {};
  for (const item of items) {
    const key = getter(item);
    const normalized = key == null || key === "" ? "unlabeled" : String(key);
    counts[normalized] = (counts[normalized] || 0) + 1;
  }
  return counts;
}

function deriveTopic(document) {
  const frontmatter = document.frontmatter;
  const folderStatus = document.path.startsWith("40_topics/ideas/")
    ? "idea"
    : document.path.startsWith("40_topics/selected/")
      ? "selected"
      : null;
  const productionStatus = frontmatter.production_status ?? null;
  const filmingStatus = frontmatter.filming_status ?? null;
  const status = frontmatter.status ?? null;
  const isFilmed =
    filmingStatus === "filmed" ||
    productionStatus === "filmed" ||
    status === "filmed";
  const isPublished =
    productionStatus === "published" || status === "published";

  const precedence = [
    "published",
    "filmed",
    "ready_to_shoot",
    "framework_ready",
    "material_validating",
    "topic_selected",
    "selected",
    "idea",
    "planned",
  ];
  const candidates = [
    isPublished ? "published" : null,
    isFilmed ? "filmed" : null,
    productionStatus,
    status,
    folderStatus,
  ].filter(Boolean);
  const pipelineStage =
    precedence.find((candidate) => candidates.includes(candidate)) ||
    candidates[0] ||
    "unlabeled";

  const stateConflicts = [];
  if (folderStatus === "idea" && status && status !== "idea") {
    stateConflicts.push("folder_status_mismatch");
  }
  if (isPublished && !isFilmed && filmingStatus !== null) {
    stateConflicts.push("published_without_filmed");
  }

  return {
    id: document.id,
    path: document.path,
    title: document.title,
    folderStatus,
    status,
    productionStatus,
    filmingStatus,
    pipelineStage,
    isFilmed,
    isPublished,
    series: frontmatter.series ?? null,
    episode: frontmatter.episode ?? null,
    platform: frontmatter.platform ?? null,
    displayFormat: frontmatter.display_format ?? null,
    journeyStage: frontmatter.journey_stage ?? null,
    contentFormat: frontmatter.content_format ?? null,
    productionFile: frontmatter.production_file ?? null,
    linkedWiki: Array.isArray(frontmatter.linked_wiki)
      ? frontmatter.linked_wiki
      : frontmatter.linked_wiki
        ? [frontmatter.linked_wiki]
        : [],
    tags: document.tags,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    stateConflicts,
  };
}

function sectionText(markdown, heading) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const headingIndex = lines.findIndex(
    (line) => line.trim() === `## ${heading}`,
  );
  if (headingIndex < 0) return "";

  const collected = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break;
    collected.push(lines[index]);
  }
  return collected.join("\n").trim();
}

function splitTableRow(line) {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  return value.split("|").map((cell) =>
    cell
      .replace(/\\\|/g, "|")
      .replace(/`/g, "")
      .trim()
  );
}

function parseFirstMarkdownTable(section) {
  const lines = section.split("\n");
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].trim().startsWith("|")) continue;
    if (!/^\s*\|?(?:\s*:?-+:?\s*\|)+/.test(lines[index + 1])) continue;

    const headers = splitTableRow(lines[index]);
    const rows = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const line = lines[rowIndex];
      if (!line.trim().startsWith("|")) break;
      const cells = splitTableRow(line);
      rows.push(
        Object.fromEntries(
          headers.map((header, cellIndex) => [
            header,
            cells[cellIndex] ?? "",
          ]),
        ),
      );
    }
    return rows;
  }
  return [];
}

function parseMetric(rawValue) {
  if (rawValue == null) {
    return { value: null, lowerBound: false, raw: null };
  }

  const raw = String(rawValue).trim();
  if (!raw || raw === "-" || raw === "—" || raw.toLowerCase() === "null") {
    return { value: null, lowerBound: false, raw };
  }

  const lowerBound = raw.startsWith("≥");
  const cleaned = raw
    .replace(/^≥/, "")
    .replace(/,/g, "")
    .replace(/%$/, "")
    .replace(/s$/i, "")
    .trim();
  const number = Number(cleaned);
  return {
    value: Number.isFinite(number) ? number : null,
    lowerBound,
    raw,
  };
}

function metricValue(rawValue) {
  return parseMetric(rawValue).value;
}

function ratePct(numerator, denominator) {
  if (
    numerator == null ||
    denominator == null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return null;
  }
  return Number(((numerator / denominator) * 100).toFixed(4));
}

function roundMetric(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function parseCsvRows(csvText) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    if (quoted) {
      if (character === '"' && csvText[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((items) => items.some((item) => item !== ""));
}

function parseCsvObjects(csvText) {
  const rows = parseCsvRows(csvText.replace(/^\uFEFF/, ""));
  const headers = rows[0] ?? [];
  return rows.slice(1).map((cells) =>
    Object.fromEntries(
      headers.map((header, index) => [header, cells[index] ?? ""]),
    ),
  );
}

function csvNumber(value) {
  if (value == null || value === "" || value === "-") return null;
  const number = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function decimalRateToPct(value) {
  const number = csvNumber(value);
  return number == null ? null : roundMetric(number * 100);
}

function percentageToPct(value, decimal = false) {
  if (value == null || value === "" || value === "-") return null;
  const text = String(value).trim();
  const number = csvNumber(text.replace(/%$/, "").replace(/s$/i, ""));
  if (number == null) return null;
  return roundMetric(text.endsWith("%") || !decimal ? number : number * 100);
}

function compactChineseNumber(value) {
  if (value == null || value === "" || value === "-") return null;
  const text = String(value).trim().replace(/,/g, "");
  const match = text.match(/^(-?\d+(?:\.\d+)?)(万|亿)?$/);
  if (!match) return csvNumber(text);
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  if (match[2] === "万") return roundMetric(number * 10_000, 2);
  if (match[2] === "亿") return roundMetric(number * 100_000_000, 2);
  return number;
}

function cleanDouyinTitle(value) {
  return String(value ?? "")
    .replace(/#[^#\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("zh-CN");
}

function douyinWorkKey(publishedAt, title) {
  return `${String(publishedAt ?? "").slice(0, 16)}|${cleanDouyinTitle(title)}`;
}

function pageTextLines(bodyText) {
  return String(bodyText ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function sectionLines(lines, startLabel, endLabels = []) {
  const start = lines.indexOf(startLabel);
  if (start < 0) return [];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (endLabels.includes(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

function rankedPercentRows(lines) {
  const rows = [];
  for (let index = 0; index < lines.length - 2; index += 1) {
    if (!/^\d+\.?$/.test(lines[index])) continue;
    const sharePct = percentageToPct(lines[index + 2]);
    if (sharePct == null) continue;
    rows.push({
      rank: Number(lines[index].replace(/\.$/, "")),
      name: lines[index + 1],
      sharePct,
    });
    index += 2;
  }
  return rows;
}

function labeledPercentRows(lines, ignoredLabels = []) {
  const rows = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const name = lines[index];
    if (ignoredLabels.includes(name)) continue;
    const sharePct = percentageToPct(lines[index + 1]);
    if (sharePct == null) continue;
    rows.push({ name, sharePct });
    index += 1;
  }
  return rows;
}

function parsePageOnlyWorkEvidence(bodyByLabel) {
  const trafficLines = pageTextLines(bodyByLabel.traffic);
  const audienceLines = pageTextLines(bodyByLabel.audience);
  const commentLines = pageTextLines(bodyByLabel.comments);

  const chapterLines = sectionLines(trafficLines, "章节点击率", ["观众参与度"]);
  const chapters = [];
  for (let index = 0; index < chapterLines.length - 3; index += 1) {
    if (!/^\d+$/.test(chapterLines[index])) continue;
    if (!/^\d{2}:\d{2}$/.test(chapterLines[index + 1])) continue;
    const clickRatePct = percentageToPct(chapterLines[index + 3]);
    if (clickRatePct == null) continue;
    chapters.push({
      rank: Number(chapterLines[index]),
      time: chapterLines[index + 1],
      name: chapterLines[index + 2],
      clickRatePct,
    });
    index += 3;
  }

  const incomingSearchTerms = rankedPercentRows(
    sectionLines(trafficLines, "用户通过这些词看到作品", [
      "用户看完作品后常搜的词",
    ]),
  );
  const postWatchSearchTerms = rankedPercentRows(
    sectionLines(trafficLines, "用户看完作品后常搜的词"),
  );
  const geography = labeledPercentRows(
    sectionLines(audienceLines, "地域分布", ["受众兴趣分布"]),
    ["地区", "占比"],
  );
  const interests = labeledPercentRows(
    sectionLines(audienceLines, "受众兴趣分布", ["受众关注热词"]),
    ["兴趣", "占比"],
  );

  const audienceHotWords = [];
  const hotWordLines = sectionLines(audienceLines, "受众关注热词", ["活跃分布"]);
  for (let index = 0; index < hotWordLines.length - 1; index += 1) {
    if (["兴趣", "热度"].includes(hotWordLines[index])) continue;
    const heat = compactChineseNumber(hotWordLines[index + 1]);
    if (heat == null) continue;
    audienceHotWords.push({
      name: hotWordLines[index],
      heat,
      heatRaw: hotWordLines[index + 1],
    });
    index += 1;
  }

  const commentKeywords = [];
  for (const line of commentLines) {
    const match = line.match(/^(\d+)\.?\s*\t\s*(.+)$/);
    if (!match) continue;
    commentKeywords.push({ rank: Number(match[1]), name: match[2].trim() });
  }

  const missingFields = [];
  if (
    audienceLines.includes("性别分布") &&
    sectionLines(audienceLines, "性别分布", ["年龄分布"]).length === 0
  ) {
    missingFields.push("性别分布");
  }
  if (
    audienceLines.includes("年龄分布") &&
    sectionLines(audienceLines, "年龄分布", ["地域分布"]).length === 0
  ) {
    missingFields.push("年龄分布");
  }
  if (
    audienceLines.includes("活跃分布") &&
    sectionLines(audienceLines, "活跃分布").length === 0
  ) {
    missingFields.push("活跃分布");
  }

  return {
    chapters,
    incomingSearchTerms,
    postWatchSearchTerms,
    geography,
    interests,
    audienceHotWords,
    commentKeywords,
    missingFields,
  };
}

function classifyDouyinWork(title) {
  const normalized = String(title ?? "").replace(/\s+/g, " ").trim();
  const rule = DOUYIN_CLASSIFICATION_RULES.find(([prefix]) =>
    normalized.startsWith(prefix),
  );
  return {
    contentLine: rule?.[1] ?? "未分类",
    contentRole: rule?.[2] ?? "未分类",
  };
}

function sumMetric(items, key) {
  return items.reduce(
    (sum, item) => sum + (Number.isFinite(item[key]) ? item[key] : 0),
    0,
  );
}

function medianMetric(items, key) {
  const values = items
    .map((item) => item[key])
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}

function weightedMetric(items, key) {
  const pairs = items
    .map((item) => [item[key], item.views])
    .filter(([value, weight]) => Number.isFinite(value) && weight > 0);
  const denominator = pairs.reduce((sum, [, weight]) => sum + weight, 0);
  if (!denominator) return null;
  return roundMetric(
    pairs.reduce((sum, [value, weight]) => sum + value * weight, 0) /
      denominator,
  );
}

function aggregateDouyinWorks(works, keySelector, includeViewShare = false) {
  const groups = new Map();
  for (const work of works) {
    const key = keySelector(work) || "未分类";
    const items = groups.get(key) ?? [];
    items.push(work);
    groups.set(key, items);
  }

  const allViews = sumMetric(works, "views");
  return [...groups.entries()]
    .map(([name, items]) => {
      const views = sumMetric(items, "views");
      const saves = sumMetric(items, "saves");
      const profileVisits = sumMetric(items, "profileVisits");
      const followerGain = sumMetric(items, "followerGain");
      const profileVisitsIsLowerBound = items.some(
        (item) => item.profileVisits == null,
      );
      const aggregate = {
        name,
        workCount: items.length,
        views,
        medianViews: medianMetric(items, "views"),
        weightedCompletionRatePct: weightedMetric(items, "completionRatePct"),
        weightedFiveSecondCompletionRatePct: weightedMetric(
          items,
          "fiveSecondCompletionRatePct",
        ),
        weightedTwoSecondBounceRatePct: weightedMetric(
          items,
          "twoSecondBounceRatePct",
        ),
        weightedAverageWatchSeconds: weightedMetric(
          items,
          "averageWatchSeconds",
        ),
        saves,
        saveRatePct: ratePct(saves, views),
        profileVisits,
        profileVisitsIsLowerBound,
        profileVisitRatePct: ratePct(profileVisits, views),
        followerGain,
        followerGainRatePct: ratePct(followerGain, views),
      };
      if (includeViewShare) {
        aggregate.viewSharePct = roundMetric((views / allViews) * 100, 2);
      }
      return aggregate;
    })
    .sort((a, b) => b.views - a.views);
}

function parseDouyinWorkListCsv(csvText, sourcePath, documents) {
  const publishedWorkLookup = buildPublishedWorkLookup(documents);
  const rows = parseCsvObjects(csvText);
  const works = rows.map((row, index) => {
    const publishedAt = row["发布时间"] || null;
    const title = row["作品名称"] || null;
    const classification = classifyDouyinWork(title);
    const views = csvNumber(row["播放量"]);
    const likes = csvNumber(row["点赞量"]);
    const shares = csvNumber(row["分享量"]);
    const comments = csvNumber(row["评论量"]);
    const saves = csvNumber(row["收藏量"]);
    const profileVisits = csvNumber(row["主页访问量"]);
    const followerGain = csvNumber(row["粉丝增量"]);
    const engagements = [likes, shares, comments, saves].every(Number.isFinite)
      ? likes + shares + comments + saves
      : null;
    const platformWorkId = publishedAt
      ? publishedWorkLookup.get(String(publishedAt).slice(0, 16)) || null
      : null;
    const qualityFlags = [];
    if (profileVisits == null) qualityFlags.push("missing_profile_visits");
    if (decimalRateToPct(row["封面点击率"]) == null) {
      qualityFlags.push("missing_cover_click_rate");
    }
    if (classification.contentLine === "未分类") {
      qualityFlags.push("missing_manual_classification");
    }
    const identity = platformWorkId || `${publishedAt || ""}:${title || ""}`;

    return {
      id: `douyin-${encodeId(identity)}`,
      platformWorkId,
      rowNumber: index + 1,
      publishedAt,
      title,
      format: row["体裁"] || null,
      reviewStatus: row["审核状态"] || null,
      ...classification,
      views,
      completionRatePct: decimalRateToPct(row["完播率"]),
      fiveSecondCompletionRatePct: decimalRateToPct(row["5s完播率"]),
      coverClickRatePct: decimalRateToPct(row["封面点击率"]),
      twoSecondBounceRatePct: decimalRateToPct(row["2s跳出率"]),
      averageWatchSeconds: csvNumber(row["平均播放时长"]),
      likes,
      shares,
      comments,
      saves,
      engagements,
      profileVisits,
      profileVisitsIsLowerBound: false,
      followerGain,
      likeRatePct: ratePct(likes, views),
      shareRatePct: ratePct(shares, views),
      commentRatePct: ratePct(comments, views),
      saveRatePct: ratePct(saves, views),
      engagementRatePct: ratePct(engagements, views),
      profileVisitRatePct: ratePct(profileVisits, views),
      followerGainRatePct: ratePct(followerGain, views),
      qualityFlags,
    };
  });

  const totalViews = sumMetric(works, "views");
  const totalLikes = sumMetric(works, "likes");
  const totalShares = sumMetric(works, "shares");
  const totalComments = sumMetric(works, "comments");
  const totalSaves = sumMetric(works, "saves");
  const totalEngagements = sumMetric(works, "engagements");
  const totalProfileVisits = sumMetric(works, "profileVisits");
  const totalFollowerGain = sumMetric(works, "followerGain");
  const summary = {
    workCount: works.length,
    totalViews,
    medianViews: medianMetric(works, "views"),
    averageViews: works.length ? roundMetric(totalViews / works.length, 2) : null,
    totalLikes,
    totalShares,
    totalComments,
    totalSaves,
    totalEngagements,
    totalProfileVisits,
    totalFollowerGain,
    weightedCompletionRatePct: weightedMetric(works, "completionRatePct"),
    weightedFiveSecondCompletionRatePct: weightedMetric(
      works,
      "fiveSecondCompletionRatePct",
    ),
    weightedTwoSecondBounceRatePct: weightedMetric(
      works,
      "twoSecondBounceRatePct",
    ),
    weightedAverageWatchSeconds: weightedMetric(works, "averageWatchSeconds"),
    likeRatePct: ratePct(totalLikes, totalViews),
    shareRatePct: ratePct(totalShares, totalViews),
    commentRatePct: ratePct(totalComments, totalViews),
    saveRatePct: ratePct(totalSaves, totalViews),
    profileVisitRatePct: ratePct(totalProfileVisits, totalViews),
    followerGainRatePct: ratePct(totalFollowerGain, totalViews),
    engagementRatePct: ratePct(totalEngagements, totalViews),
  };

  const contentLines = aggregateDouyinWorks(
    works,
    (work) => work.contentLine,
    true,
  );
  const formats = aggregateDouyinWorks(works, (work) => work.format);
  const roles = aggregateDouyinWorks(works, (work) => work.contentRole);
  const monthlyGroups = new Map();
  for (const work of works) {
    const month = String(work.publishedAt ?? "").slice(0, 7) || "未知";
    const items = monthlyGroups.get(month) ?? [];
    items.push(work);
    monthlyGroups.set(month, items);
  }
  const monthly = [...monthlyGroups.entries()]
    .map(([month, items]) => ({
      month,
      workCount: items.length,
      views: sumMetric(items, "views"),
      likes: sumMetric(items, "likes"),
      shares: sumMetric(items, "shares"),
      comments: sumMetric(items, "comments"),
      saves: sumMetric(items, "saves"),
      profileVisits: sumMetric(items, "profileVisits"),
      profileVisitsIsLowerBound: items.some(
        (item) => item.profileVisits == null,
      ),
      followerGain: sumMetric(items, "followerGain"),
      weightedCompletionRatePct: weightedMetric(items, "completionRatePct"),
      weightedFiveSecondCompletionRatePct: weightedMetric(
        items,
        "fiveSecondCompletionRatePct",
      ),
      weightedTwoSecondBounceRatePct: weightedMetric(
        items,
        "twoSecondBounceRatePct",
      ),
      weightedAverageWatchSeconds: weightedMetric(
        items,
        "averageWatchSeconds",
      ),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const publishedDates = works
    .map((work) => work.publishedAt)
    .filter(Boolean)
    .sort();
  const missingCoverCount = works.filter((work) =>
    work.qualityFlags.includes("missing_cover_click_rate"),
  ).length;
  const unclassifiedCount = works.filter((work) =>
    work.qualityFlags.includes("missing_manual_classification"),
  ).length;
  const qualityIssues = [];
  if (missingCoverCount) {
    qualityIssues.push({
      issue: "部分作品没有封面点击率",
      affectedWorks: `${missingCoverCount} 条`,
      resolution: "保持缺失，不补 0；相关图表只使用已知值。",
    });
  }
  if (unclassifiedCount) {
    qualityIssues.push({
      issue: "最新作品尚未完成人工内容分类",
      affectedWorks: `${unclassifiedCount} 条`,
      resolution: "工作台显示为“未分类”，不根据标题标签自动冒充业务判断。",
    });
  }

  return {
    available: works.length > 0,
    sourcePath,
    updatedAt: sourcePath.match(/\/(\d{8})-/)?.[1]?.replace(
      /(\d{4})(\d{2})(\d{2})/,
      "$1-$2-$3",
    ) ?? null,
    comparableCount: works.length,
    range: {
      from: publishedDates[0] ?? null,
      to: publishedDates.at(-1) ?? null,
    },
    reviewStatusCounts: {
      public: works.filter((work) => work.reviewStatus === "公开").length,
      private: works.filter((work) => work.reviewStatus !== "公开").length,
    },
    summary,
    summaryLowerBounds: {
      totalProfileVisits: works.some((work) => work.profileVisits == null),
    },
    works,
    contentLines,
    formats,
    roles,
    monthly,
    qualityIssues,
    qualityFlags: unclassifiedCount ? ["unclassified_work"] : [],
  };
}

async function readCsvObjectsIfAvailable(filePath) {
  if (!filePath) return [];
  try {
    return parseCsvObjects(await fs.readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

async function listSnapshotSheetFiles(snapshot) {
  let names = [];
  try {
    names = await fs.readdir(snapshot.sheetsPath);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".csv"))
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .map((name) => ({
      name,
      absolutePath: path.join(snapshot.sheetsPath, name),
      relativePath: toPosixPath(
        path.relative(path.dirname(path.dirname(path.dirname(snapshot.absoluteRoot))), path.join(snapshot.sheetsPath, name)),
      ),
    }));
}

function sumKnown(items, key) {
  const values = items.map((item) => item[key]).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function normalizeAccountDaily(contentRows, followerRows) {
  const byDate = new Map();
  for (const row of contentRows) {
    const date = row["日期"] || null;
    if (!date) continue;
    byDate.set(date, {
      date,
      posts: csvNumber(row["投稿量"]),
      views: csvNumber(row["总播放量"]),
      likes: csvNumber(row["总点赞量"]),
      comments: csvNumber(row["总评论量"]),
      fiveSecondCompletionRatePct: percentageToPct(row["5秒完播率"]),
      twoSecondBounceRatePct: percentageToPct(row["2秒跳出率"]),
      coverClickRatePct: percentageToPct(row["封面点击率"]),
      averageWatchSeconds: csvNumber(
        String(row["平均播放时长"] ?? "").replace(/s$/i, ""),
      ),
      totalFollowers: null,
      netFollowerGain: null,
      followersGained: null,
      followersLost: null,
      returningFollowers: null,
    });
  }
  for (const row of followerRows) {
    const date = row["日期"] || null;
    if (!date) continue;
    const current = byDate.get(date) ?? { date };
    Object.assign(current, {
      totalFollowers: csvNumber(row["总粉丝量"]),
      netFollowerGain: csvNumber(row["粉丝净增"]),
      followersGained: csvNumber(row["吸粉量"]),
      followersLost: csvNumber(row["脱粉量"]),
      returningFollowers: csvNumber(row["回访粉丝量"]),
    });
    byDate.set(date, current);
  }
  return [...byDate.values()].sort((left, right) =>
    String(left.date).localeCompare(String(right.date)),
  );
}

function accountWindowSummary(daily) {
  if (!daily.length) return null;
  return {
    from: daily[0].date,
    to: daily.at(-1).date,
    dayCount: daily.length,
    posts: sumKnown(daily, "posts"),
    views: sumKnown(daily, "views"),
    likes: sumKnown(daily, "likes"),
    comments: sumKnown(daily, "comments"),
    netFollowerGain: sumKnown(daily, "netFollowerGain"),
    followersGained: sumKnown(daily, "followersGained"),
    followersLost: sumKnown(daily, "followersLost"),
    returningFollowers: sumKnown(daily, "returningFollowers"),
    latestFollowerTotal: daily.at(-1).totalFollowers ?? null,
  };
}

function nextMetricToken(lines, label, startAt = 0) {
  const index = lines.indexOf(label, startAt);
  if (index < 0) return { value: null, raw: null, index: -1 };
  let cursor = index + 1;
  while (cursor < lines.length && lines[cursor] === label) cursor += 1;
  if (cursor >= lines.length) return { value: null, raw: null, index };
  let raw = lines[cursor];
  if (["万", "亿"].includes(lines[cursor + 1])) raw += lines[cursor + 1];
  return { value: compactChineseNumber(raw), raw, index };
}

function parseHomePageSnapshot(bodyText) {
  const lines = pageTextLines(bodyText);
  if (!lines.length) return null;
  const accountOverview = sectionLines(lines, "账号总览", ["互动管理"]);
  const firstFollowerIndex = lines.findIndex((line) => line === "粉丝");
  const firstLikeIndex = lines.findIndex((line) => line === "获赞");
  const firstFollowingIndex = lines.findIndex((line) => line === "关注");
  const metric = (label) => nextMetricToken(accountOverview, label).value;
  return {
    account: {
      following:
        firstFollowingIndex >= 0
          ? compactChineseNumber(lines[firstFollowingIndex + 1])
          : null,
      followers:
        firstFollowerIndex >= 0
          ? compactChineseNumber(lines[firstFollowerIndex + 1])
          : null,
      totalLikes:
        firstLikeIndex >= 0
          ? compactChineseNumber(lines[firstLikeIndex + 1])
          : null,
    },
    latestPeriod: {
      label:
        String(bodyText).match(/统计周期：([^\n（]+)/)?.[1]?.trim() ?? null,
      views: metric("播放量"),
      profileVisits: metric("主页访问量"),
      likes: metric("作品点赞"),
      shares: metric("作品分享"),
      comments: metric("作品评论"),
      netFollowerGain: metric("净增粉丝"),
    },
  };
}

function mergeKnownMetrics(target, row) {
  if (!row) return target;
  const numberFields = {
    播放量: "views",
    点赞量: "likes",
    评论量: "comments",
    分享量: "shares",
    收藏量: "saves",
    弹幕量: "bulletComments",
    涨粉量: "followerGain",
    脱粉量: "followerLoss",
    不感兴趣量: "notInterested",
  };
  const percentageFields = {
    封面点击率: "coverClickRatePct",
    平均播放占比: "averageWatchSharePct",
    完播率: "completionRatePct",
    "2s跳出率": "twoSecondBounceRatePct",
    "5s完播率": "fiveSecondCompletionRatePct",
    点赞率: "likeRatePct",
    评论率: "commentRatePct",
    分享率: "shareRatePct",
    收藏率: "saveRatePct",
    不感兴趣率: "notInterestedRatePct",
    涨粉率: "followerGainRatePct",
    脱粉率: "followerLossRatePct",
    粉丝播放占比: "followerViewSharePct",
  };
  for (const [source, field] of Object.entries(numberFields)) {
    const value = csvNumber(row[source]);
    if (value != null) target[field] = value;
  }
  for (const [source, field] of Object.entries(percentageFields)) {
    const value = percentageToPct(row[source]);
    if (value != null) target[field] = value;
  }
  const watchSeconds = csvNumber(
    String(row["平均播放时长"] ?? "").replace(/秒|s$/i, ""),
  );
  if (watchSeconds != null) target.averageWatchSeconds = watchSeconds;
  return target;
}

function incrementalSeries(rows, valueField) {
  let cumulative = 0;
  return rows
    .map((row) => {
      const value = csvNumber(row[valueField]);
      if (!row["日期"] || value == null) return null;
      cumulative += value;
      return {
        date: row["日期"],
        value,
        douyin: csvNumber(row["抖音"]),
        douyinFeatured: csvNumber(row["抖音精选"]),
        cumulative,
      };
    })
    .filter(Boolean);
}

function retentionSeries(rows, valueField) {
  return rows
    .map((row) => {
      const valuePct = percentageToPct(row[valueField]);
      if (!row["时间"] || valuePct == null) return null;
      return {
        time: row["时间"],
        valuePct,
        peerPct: percentageToPct(row["同类作品"]),
      };
    })
    .filter(Boolean);
}

function progressSeries(rows) {
  return rows
    .map((row) => {
      if (!row["时间"]) return null;
      return {
        time: row["时间"],
        skipRatePct: percentageToPct(row["跳过率"]),
        rewatchRatePct: percentageToPct(row["回看率"]),
      };
    })
    .filter(Boolean);
}

function trafficSourceRows(rows) {
  return rows
    .map((row) => {
      if (!row["来源"]) return null;
      return {
        name: row["来源"],
        sharePct: percentageToPct(row["来源占比"]),
        comparedWithSevenDaysPct: percentageToPct(row["对比7日"]),
        comparisonRaw: row["对比7日"] || null,
      };
    })
    .filter(Boolean);
}

function applyDetailRows(detail, sheetName, rows) {
  if (!rows.length) return;
  if (sheetName.includes("指标数据")) {
    mergeKnownMetrics(detail.metrics, rows[0]);
  }
  if (sheetName.includes("播放量-新增-每小时趋势数据")) {
    detail.hourlyViews = incrementalSeries(rows, "播放量");
  }
  if (sheetName.includes("涨粉量-新增-每小时趋势数据")) {
    detail.hourlyFollowerGain = incrementalSeries(rows, "涨粉量");
  }
  if (sheetName.includes("涨粉量-累计-每天趋势数据")) {
    detail.dailyFollowerCumulative = rows
      .map((row) => ({
        date: row["日期"] || null,
        value: csvNumber(row["涨粉量"]),
        douyin: csvNumber(row["抖音"]),
        douyinFeatured: csvNumber(row["抖音精选"]),
      }))
      .filter((row) => row.date && row.value != null);
  }
  if (sheetName.includes("进度分析")) detail.progress = progressSeries(rows);
  if (sheetName.includes("留存分析")) {
    detail.retention = retentionSeries(rows, "留存");
  }
  if (sheetName.includes("跳出分析")) {
    detail.bounce = retentionSeries(rows, "跳出率");
  }
  if (rows[0]?.["来源"] != null) detail.trafficSources = trafficSourceRows(rows);
}

function emptyWorkDetail(platformWorkId, capturedAt, sourceKind) {
  return {
    platformWorkId,
    capturedAt,
    sourceKind,
    sourcePaths: [],
    metrics: {},
    hourlyViews: [],
    hourlyFollowerGain: [],
    dailyFollowerCumulative: [],
    progress: [],
    retention: [],
    bounce: [],
    trafficSources: [],
    pageEvidence: {
      chapters: [],
      incomingSearchTerms: [],
      postWatchSearchTerms: [],
      geography: [],
      interests: [],
      audienceHotWords: [],
      commentKeywords: [],
      missingFields: [],
    },
  };
}

async function loadPageSnapshots(snapshot, vaultRoot) {
  const directory = path.join(snapshot.absoluteRoot, "01_page_snapshots");
  let names = [];
  try {
    names = await fs.readdir(directory);
  } catch {
    return { home: null, works: new Map(), sourcePaths: [] };
  }

  const home = { bodyText: null, capturedAt: null, sourcePath: null };
  const works = new Map();
  const sourcePaths = [];
  for (const name of names.filter((value) => value.endsWith(".json"))) {
    const absolutePath = path.join(directory, name);
    let payload;
    try {
      payload = JSON.parse(await fs.readFile(absolutePath, "utf8"));
    } catch {
      continue;
    }
    const relativePath = toPosixPath(path.relative(vaultRoot, absolutePath));
    sourcePaths.push(relativePath);
    if (name.startsWith("首页")) {
      home.bodyText = payload.bodyText ?? null;
      home.capturedAt = payload.capturedAt ?? null;
      home.sourcePath = relativePath;
      continue;
    }
    const platformWorkId = name.match(/(\d{19})/)?.[1] ?? null;
    if (!platformWorkId) continue;
    const current = works.get(platformWorkId) ?? {
      capturedAt: payload.capturedAt ?? null,
      sourcePaths: [],
      bodyByLabel: {},
    };
    current.sourcePaths.push(relativePath);
    if (name.includes("流量分析")) current.bodyByLabel.traffic = payload.bodyText;
    else if (name.includes("观众分析")) current.bodyByLabel.audience = payload.bodyText;
    else if (name.includes("评论热词")) current.bodyByLabel.comments = payload.bodyText;
    else if (name.includes("总览")) current.bodyByLabel.overview = payload.bodyText;
    works.set(platformWorkId, current);
  }
  return { home, works, sourcePaths };
}

function workIdentityFromPage(bodyText) {
  const lines = pageTextLines(bodyText);
  const index = lines.findIndex((line) =>
    /^\d{4}年\d{2}月\d{2}日\s+\d{2}:\d{2}$/.test(line),
  );
  if (index < 1) return { title: null, publishedAt: null };
  const match = lines[index].match(
    /^(\d{4})年(\d{2})月(\d{2})日\s+(\d{2}):(\d{2})$/,
  );
  return {
    title: lines[index - 1] ?? null,
    publishedAt: match
      ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`
      : null,
  };
}

function matchDouyinWork(works, publishedAt, title = null) {
  const minute = String(publishedAt ?? "").slice(0, 16);
  const byMinute = works.filter(
    (work) => String(work.publishedAt ?? "").slice(0, 16) === minute,
  );
  if (byMinute.length === 1) return byMinute[0];
  const titleKey = cleanDouyinTitle(title);
  return (
    byMinute.find((work) => cleanDouyinTitle(work.title) === titleKey) ??
    works.find((work) => cleanDouyinTitle(work.title) === titleKey) ??
    null
  );
}

async function loadSnapshotWorkDetails(snapshot, vaultRoot, works, files, pages) {
  const detailsByPlatformId = new Map();
  for (const file of files) {
    const platformWorkId = file.name.match(/(\d{19})/)?.[1] ?? null;
    if (!platformWorkId) continue;
    const detail =
      detailsByPlatformId.get(platformWorkId) ??
      emptyWorkDetail(platformWorkId, snapshot.capturedAt, "official-csv-snapshot");
    const rows = await readCsvObjectsIfAvailable(file.absolutePath);
    applyDetailRows(detail, file.name, rows);
    detail.sourcePaths.push(file.relativePath);
    detailsByPlatformId.set(platformWorkId, detail);
  }

  for (const [platformWorkId, page] of pages.works) {
    const detail =
      detailsByPlatformId.get(platformWorkId) ??
      emptyWorkDetail(
        platformWorkId,
        page.capturedAt ?? snapshot.capturedAt,
        "official-page-snapshot",
      );
    detail.pageEvidence = parsePageOnlyWorkEvidence(page.bodyByLabel);
    detail.sourcePaths.push(...page.sourcePaths);
    const identity = workIdentityFromPage(
      page.bodyByLabel.overview ??
        page.bodyByLabel.traffic ??
        page.bodyByLabel.audience,
    );
    const work = matchDouyinWork(works, identity.publishedAt, identity.title);
    if (work) work.platformWorkId = platformWorkId;
    detailsByPlatformId.set(platformWorkId, detail);
  }

  const details = {};
  for (const detail of detailsByPlatformId.values()) {
    const work = works.find(
      (item) => item.platformWorkId === detail.platformWorkId,
    );
    if (!work) continue;
    detail.workId = work.id;
    detail.sourcePaths = [...new Set(detail.sourcePaths)];
    details[work.id] = detail;
  }
  return details;
}

async function workbookSheets(filePath) {
  try {
    const workbook = XLSX.read(await fs.readFile(filePath), { type: "buffer" });
    return workbook.SheetNames.map((sheetName) => ({
      sheetName,
      rows: XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        defval: null,
      }),
    }));
  } catch {
    return [];
  }
}

async function loadLegacyWorkDetails(vaultRoot, works) {
  const absoluteRawRoot = path.join(vaultRoot, DOUYIN_RAW_ROOT);
  let entries = [];
  try {
    entries = await fs.readdir(absoluteRawRoot, { withFileTypes: true });
  } catch {
    return {};
  }

  const details = {};
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const directory = path.join(absoluteRawRoot, entry.name);
    const sourcePath = path.join(directory, "source.md");
    let parsed;
    try {
      parsed = parseMarkdown(await fs.readFile(sourcePath, "utf8"));
    } catch {
      continue;
    }
    if (parsed.frontmatter.type !== "douyin-work-raw-data") continue;
    const platformWorkId = String(parsed.frontmatter.work_id ?? "");
    const publishedAt = parsed.frontmatter.published_at ?? null;
    if (!platformWorkId || !publishedAt) continue;
    const work = matchDouyinWork(works, publishedAt);
    if (!work) continue;
    work.platformWorkId = platformWorkId;
    const detail = emptyWorkDetail(
      platformWorkId,
      parsed.frontmatter.captured_at ?? null,
      "official-xlsx-legacy",
    );
    detail.workId = work.id;
    detail.sourcePaths.push(toPosixPath(path.relative(vaultRoot, sourcePath)));

    let names = [];
    try {
      names = await fs.readdir(directory);
    } catch {
      continue;
    }
    for (const name of names.filter((value) => value.endsWith(".xlsx"))) {
      const absolutePath = path.join(directory, name);
      for (const sheet of await workbookSheets(absolutePath)) {
        applyDetailRows(detail, sheet.sheetName, sheet.rows);
      }
      detail.sourcePaths.push(toPosixPath(path.relative(vaultRoot, absolutePath)));
    }
    details[work.id] = detail;
  }
  return details;
}

function normalizeWorkSnapshot(row, capturedAt, sourcePath) {
  const views = csvNumber(row["播放量"]);
  if (!row["发布时间"] || views == null) return null;
  return {
    capturedAt,
    sourcePath,
    grain: "作品累计快照",
    views,
    likes: csvNumber(row["点赞量"]),
    shares: csvNumber(row["分享量"]),
    comments: csvNumber(row["评论量"]),
    saves: csvNumber(row["收藏量"]),
    profileVisits: csvNumber(row["主页访问量"]),
    followerGain: csvNumber(row["粉丝增量"]),
  };
}

async function attachWorkSnapshotHistory(vaultRoot, snapshots, works) {
  const byKey = new Map(
    works.map((work) => [douyinWorkKey(work.publishedAt, work.title), work]),
  );
  const byMinute = new Map();
  for (const work of works) {
    const minute = String(work.publishedAt ?? "").slice(0, 16);
    const list = byMinute.get(minute) ?? [];
    list.push(work);
    byMinute.set(minute, list);
  }
  const histories = new Map(works.map((work) => [work.id, []]));

  const appendRows = (rows, capturedAt, sourcePath) => {
    for (const row of rows) {
      const key = douyinWorkKey(row["发布时间"], row["作品名称"]);
      const minute = String(row["发布时间"] ?? "").slice(0, 16);
      const work = byKey.get(key) ??
        (byMinute.get(minute)?.length === 1 ? byMinute.get(minute)[0] : null);
      if (!work) continue;
      const snapshot = normalizeWorkSnapshot(row, capturedAt, sourcePath);
      if (snapshot) histories.get(work.id).push(snapshot);
    }
  };

  const legacyPath = path.join(
    vaultRoot,
    DOUYIN_RAW_ROOT,
    "20260707-work-list",
    "作品列表.xlsx",
  );
  const legacySheets = await workbookSheets(legacyPath);
  if (legacySheets[0]?.rows?.length) {
    let capturedAt = "2026-07-07";
    try {
      capturedAt = (await fs.stat(legacyPath)).mtime.toISOString();
    } catch {
      // The date in the immutable source directory remains the fallback.
    }
    appendRows(
      legacySheets[0].rows,
      capturedAt,
      toPosixPath(path.relative(vaultRoot, legacyPath)),
    );
  }

  for (const snapshot of [...snapshots].reverse()) {
    const rows = await readCsvObjectsIfAvailable(
      path.join(vaultRoot, snapshot.workListPath),
    );
    appendRows(rows, snapshot.capturedAt, snapshot.workListPath);
  }

  for (const work of works) {
    work.history = (histories.get(work.id) ?? [])
      .filter(
        (snapshot, index, list) =>
          list.findIndex(
            (candidate) => candidate.sourcePath === snapshot.sourcePath,
          ) === index,
      )
      .sort(
        (left, right) =>
          (Date.parse(left.capturedAt) || 0) - (Date.parse(right.capturedAt) || 0),
      );
  }
}

function normalizeContentOverview(row) {
  if (!row) return null;
  return {
    range: row["发布时间"] || null,
    formats: String(row["体裁"] || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    categories: String(row["垂类"] || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    publishedWorks: csvNumber(row["周期内投稿量"]),
    averageCoverClickRatePct: decimalRateToPct(row["条均点击率"]),
    averageFiveSecondCompletionRatePct: decimalRateToPct(
      row["条均5s完播率"],
    ),
    averageTwoSecondBounceRatePct: decimalRateToPct(row["条均2s跳出率"]),
    averageWatchSeconds: csvNumber(row["条均播放时长"]),
    medianViews: csvNumber(row["播放量中位数"]),
    averageLikes: csvNumber(row["条均点赞数"]),
    averageComments: csvNumber(row["条均评论量"]),
    averageShares: csvNumber(row["条均分享量"]),
  };
}

function normalizeCollectionRows(rows) {
  return rows.map((row) => ({
    name: row["合集名称"] || null,
    publishedAt: row["发布时间"] || null,
    reviewStatus: row["审核状态"] || null,
    views: csvNumber(row["播放量"]),
    completionRatePct: decimalRateToPct(row["完播率"]),
    coverClickRatePct: decimalRateToPct(row["封面点击率"]),
    twoSecondBounceRatePct: decimalRateToPct(row["2s跳出率"]),
    averageWatchSeconds: csvNumber(row["平均播放时长"]),
    likes: csvNumber(row["点赞量"]),
    shares: csvNumber(row["分享量"]),
    comments: csvNumber(row["评论量"]),
    saves: csvNumber(row["收藏量"]),
    followerGain: csvNumber(row["粉丝增量"]),
  }));
}

function detailRowCount(detail) {
  return [
    detail.hourlyViews,
    detail.hourlyFollowerGain,
    detail.dailyFollowerCumulative,
    detail.progress,
    detail.retention,
    detail.bounce,
    detail.trafficSources,
    detail.pageEvidence.chapters,
    detail.pageEvidence.incomingSearchTerms,
    detail.pageEvidence.postWatchSearchTerms,
    detail.pageEvidence.geography,
    detail.pageEvidence.interests,
    detail.pageEvidence.audienceHotWords,
    detail.pageEvidence.commentKeywords,
  ].reduce((sum, rows) => sum + (rows?.length ?? 0), 0);
}

function detailFieldNames(detail) {
  const fields = new Set(Object.keys(detail.metrics));
  const arrays = {
    hourlyViews: detail.hourlyViews,
    hourlyFollowerGain: detail.hourlyFollowerGain,
    dailyFollowerCumulative: detail.dailyFollowerCumulative,
    progress: detail.progress,
    retention: detail.retention,
    bounce: detail.bounce,
    trafficSources: detail.trafficSources,
    chapters: detail.pageEvidence.chapters,
    incomingSearchTerms: detail.pageEvidence.incomingSearchTerms,
    postWatchSearchTerms: detail.pageEvidence.postWatchSearchTerms,
    geography: detail.pageEvidence.geography,
    interests: detail.pageEvidence.interests,
    audienceHotWords: detail.pageEvidence.audienceHotWords,
    commentKeywords: detail.pageEvidence.commentKeywords,
  };
  for (const [name, rows] of Object.entries(arrays)) {
    if (rows?.length) fields.add(name);
  }
  return fields;
}

async function loadDouyinAnalytics(vaultRoot, latest, snapshots, douyin) {
  const files = await listSnapshotSheetFiles(latest);
  const findFile = (pattern) => files.find((file) => pattern.test(file.name)) ?? null;
  const contentDailyFile = findFile(DOUYIN_ACCOUNT_CONTENT_30D_PATTERN);
  const followerDailyFile = findFile(DOUYIN_ACCOUNT_FOLLOWER_30D_PATTERN);
  const contentOverviewFile = findFile(/投稿概览.*Sheet1\.csv$/);
  const collectionFile = findFile(/合集列表.*Sheet1\.csv$/);

  const [contentRows, followerRows, contentOverviewRows, collectionRows, pages] =
    await Promise.all([
      readCsvObjectsIfAvailable(contentDailyFile?.absolutePath),
      readCsvObjectsIfAvailable(followerDailyFile?.absolutePath),
      readCsvObjectsIfAvailable(contentOverviewFile?.absolutePath),
      readCsvObjectsIfAvailable(collectionFile?.absolutePath),
      loadPageSnapshots(latest, vaultRoot),
    ]);

  const accountDaily = normalizeAccountDaily(contentRows, followerRows);
  const homeSnapshot = pages.home.bodyText
    ? {
        ...parseHomePageSnapshot(pages.home.bodyText),
        capturedAt: pages.home.capturedAt,
        sourcePath: pages.home.sourcePath,
      }
    : null;

  const snapshotDetails = await loadSnapshotWorkDetails(
    latest,
    vaultRoot,
    douyin.works,
    files,
    pages,
  );
  const legacyDetails = await loadLegacyWorkDetails(vaultRoot, douyin.works);
  const workDetails = { ...legacyDetails, ...snapshotDetails };
  await attachWorkSnapshotHistory(vaultRoot, snapshots, douyin.works);

  const details = Object.values(workDetails);
  const deepFields = new Set();
  for (const detail of details) {
    for (const field of detailFieldNames(detail)) deepFields.add(field);
  }
  const historyCoveredWorks = douyin.works.filter(
    (work) => (work.history?.length ?? 0) >= 2,
  ).length;
  const pageOnlyRowCount = details.reduce(
    (sum, detail) =>
      sum +
      [
        detail.pageEvidence.chapters,
        detail.pageEvidence.incomingSearchTerms,
        detail.pageEvidence.postWatchSearchTerms,
        detail.pageEvidence.geography,
        detail.pageEvidence.interests,
        detail.pageEvidence.audienceHotWords,
        detail.pageEvidence.commentKeywords,
      ].reduce((inner, rows) => inner + (rows?.length ?? 0), 0),
    0,
  );

  const accountSummary = accountWindowSummary(accountDaily);
  const collections = normalizeCollectionRows(collectionRows);
  const assets = [
    {
      id: "account-content-daily",
      label: "账号作品日序列",
      status: contentRows.length ? "complete" : "missing",
      rowCount: contentRows.length,
      fieldCount: Object.keys(contentRows[0] ?? {}).length,
      range: accountSummary
        ? { from: accountSummary.from, to: accountSummary.to }
        : null,
      grain: "账号 × 自然日",
      sourcePath: contentDailyFile?.relativePath ?? null,
    },
    {
      id: "account-follower-daily",
      label: "粉丝日序列",
      status: followerRows.length ? "complete" : "missing",
      rowCount: followerRows.length,
      fieldCount: Object.keys(followerRows[0] ?? {}).length,
      range: accountSummary
        ? { from: accountSummary.from, to: accountSummary.to }
        : null,
      grain: "账号 × 自然日",
      sourcePath: followerDailyFile?.relativePath ?? null,
    },
    {
      id: "all-works",
      label: "当前全量作品",
      status: douyin.works.length ? "complete" : "missing",
      rowCount: douyin.works.length,
      fieldCount: 16,
      range: douyin.range,
      grain: "作品 × 采集快照",
      sourcePath: douyin.sourcePath,
    },
    {
      id: "content-analysis",
      label: "投稿分析概览",
      status: contentOverviewRows.length ? "complete" : "missing",
      rowCount: contentOverviewRows.length,
      fieldCount: Object.keys(contentOverviewRows[0] ?? {}).length,
      range: normalizeContentOverview(contentOverviewRows[0])?.range ?? null,
      grain: "账号 × 分析窗口",
      sourcePath: contentOverviewFile?.relativePath ?? null,
    },
    {
      id: "collections",
      label: "合集数据",
      status: collections.length ? "complete" : "empty",
      rowCount: collections.length,
      fieldCount: Object.keys(collectionRows[0] ?? {}).length,
      range: null,
      grain: "合集 × 采集快照",
      sourcePath: collectionFile?.relativePath ?? null,
    },
    {
      id: "deep-work",
      label: "单作品深度数据",
      status: details.length ? "partial" : "missing",
      rowCount: details.reduce((sum, detail) => sum + detailRowCount(detail), 0),
      fieldCount: deepFields.size,
      range: null,
      grain: `已采集 ${details.length} / ${douyin.works.length} 条作品`,
      sourcePath: details[0]?.sourcePaths?.[0] ?? null,
    },
    {
      id: "page-evidence",
      label: "页面限定维度",
      status: pageOnlyRowCount ? "partial" : "missing",
      rowCount: pageOnlyRowCount,
      fieldCount: [
        "chapters",
        "incomingSearchTerms",
        "postWatchSearchTerms",
        "geography",
        "interests",
        "audienceHotWords",
        "commentKeywords",
      ].filter((field) =>
        details.some((detail) => detail.pageEvidence[field]?.length),
      ).length,
      range: null,
      grain: "单作品 × 页面采集快照",
      sourcePath: pages.sourcePaths[0] ?? null,
    },
  ];

  return {
    snapshot: {
      rootPath: latest.rootPath,
      capturedAt: latest.capturedAt,
      timezone: "Asia/Shanghai",
      isRealtime: false,
      snapshotCount: snapshots.length,
    },
    account: {
      daily: accountDaily,
      summary: accountSummary,
      homeSnapshot,
      contentOverview: normalizeContentOverview(contentOverviewRows[0]),
      sourcePaths: [
        contentDailyFile?.relativePath,
        followerDailyFile?.relativePath,
        contentOverviewFile?.relativePath,
        pages.home.sourcePath,
      ].filter(Boolean),
    },
    collections,
    workDetails,
    coverage: {
      assets,
      deepWorkCount: details.length,
      totalWorkCount: douyin.works.length,
      historyCoveredWorks,
      accountDailyRows: accountDaily.length,
      pageOnlyRows: pageOnlyRowCount,
      deepFieldCount: deepFields.size,
    },
    qualityIssues: [
      {
        issue: "单作品深度数据只覆盖部分作品",
        affectedWorks: `${details.length} / ${douyin.works.length} 条有深度采集`,
        resolution:
          "未采集作品只展示当前累计快照与已有历史快照；不从发布月份聚合反推作品生命周期。",
      },
      ...(details.some((detail) => detail.pageEvidence.missingFields.length)
        ? [
            {
              issue: "部分页面画像只有图表标题，没有可审计数值",
              affectedWorks: "性别、年龄或活跃分布",
              resolution: "保持缺失，不从图形估读数值。",
            },
          ]
        : []),
    ],
  };
}

function normalizeAggregateRow(row, nameKey, includeViewShare = false) {
  const profileVisits = parseMetric(row["主页访问"]);
  const normalized = {
    name: row[nameKey] || null,
    workCount: metricValue(row["作品数"]),
    views: metricValue(row["播放"]),
    medianViews: metricValue(row["播放中位数"]),
    weightedCompletionRatePct: metricValue(row["加权完播"]),
    weightedFiveSecondCompletionRatePct: metricValue(row["加权 5s"]),
    weightedTwoSecondBounceRatePct: metricValue(row["加权 2s 跳出"]),
    weightedAverageWatchSeconds: metricValue(row["加权均播"]),
    saves: metricValue(row["收藏"]),
    saveRatePct: metricValue(row["收藏率"]),
    profileVisits: profileVisits.value,
    profileVisitsIsLowerBound: profileVisits.lowerBound,
    profileVisitRatePct: metricValue(row["主页访问率"]),
    followerGain: metricValue(row["涨粉"]),
    followerGainRatePct: metricValue(row["涨粉率"]),
  };
  if (includeViewShare) {
    normalized.viewSharePct = metricValue(row["播放占比"]);
  }
  return normalized;
}

function buildPublishedWorkLookup(documents) {
  const lookup = new Map();
  for (const document of documents) {
    if (document.frontmatter.type !== "douyin-work-raw-data") continue;
    const publishedAt = document.frontmatter.published_at;
    const workId = document.frontmatter.work_id;
    if (!publishedAt || !workId) continue;
    const minute = String(publishedAt).slice(0, 16);
    lookup.set(minute, String(workId));
  }
  return lookup;
}

function parseDouyinBoard(markdown, document, documents) {
  const frontmatter = document.frontmatter;
  const summaryRows = parseFirstMarkdownTable(
    sectionText(markdown, "当前账号总览"),
  );
  const summary = {};
  const summaryLowerBounds = {};

  for (const row of summaryRows) {
    const field = SUMMARY_FIELD_MAP[row["指标"]];
    if (!field) continue;
    const metric = parseMetric(row["数值"]);
    summary[field] = metric.value;
    if (metric.lowerBound) summaryLowerBounds[field] = true;
  }

  const publishedWorkLookup = buildPublishedWorkLookup(documents);
  const workRows = parseFirstMarkdownTable(sectionText(markdown, "全量作品底表"));
  const works = workRows.map((row) => {
    const publishedAt = row["发布时间"] || null;
    const platformWorkId = publishedAt
      ? publishedWorkLookup.get(String(publishedAt).slice(0, 16)) || null
      : null;
    const views = metricValue(row["播放"]);
    const likes = metricValue(row["赞"]);
    const shares = metricValue(row["转"]);
    const comments = metricValue(row["评"]);
    const saves = metricValue(row["藏"]);
    const profileVisitsMetric = parseMetric(row["主页访问"]);
    const followerGain = metricValue(row["涨粉"]);
    const engagements =
      [likes, shares, comments, saves].every((value) => value != null)
        ? likes + shares + comments + saves
        : null;
    const qualityFlags = [];

    if (profileVisitsMetric.value == null) {
      qualityFlags.push("missing_profile_visits");
    }
    if (metricValue(row["封面点击"]) == null) {
      qualityFlags.push("missing_cover_click_rate");
    }
    if (
      views === 0 &&
      [likes, shares, comments, saves, profileVisitsMetric.value].some(
        (value) => value != null && value > 0,
      )
    ) {
      qualityFlags.push("source_zero_views_with_other_metrics");
    }

    const identity = platformWorkId || `${publishedAt || ""}:${row["作品名称"] || ""}`;
    return {
      id: `douyin-${encodeId(identity)}`,
      platformWorkId,
      rowNumber: metricValue(row["#"]),
      publishedAt,
      title: row["作品名称"] || null,
      format: row["体裁"] || null,
      reviewStatus: null,
      contentLine: row["内容线"] || null,
      contentRole: row["内容角色"] || null,
      views,
      completionRatePct: metricValue(row["完播率"]),
      fiveSecondCompletionRatePct: metricValue(row["5s完播"]),
      coverClickRatePct: metricValue(row["封面点击"]),
      twoSecondBounceRatePct: metricValue(row["2s跳出"]),
      averageWatchSeconds: metricValue(row["均播"]),
      likes,
      shares,
      comments,
      saves,
      engagements,
      profileVisits: profileVisitsMetric.value,
      profileVisitsIsLowerBound: profileVisitsMetric.lowerBound,
      followerGain,
      likeRatePct: ratePct(likes, views),
      shareRatePct: ratePct(shares, views),
      commentRatePct: ratePct(comments, views),
      saveRatePct: ratePct(saves, views),
      engagementRatePct: ratePct(engagements, views),
      profileVisitRatePct: ratePct(profileVisitsMetric.value, views),
      followerGainRatePct: ratePct(followerGain, views),
      qualityFlags,
    };
  });

  const dataScope = sectionText(markdown, "数据口径");
  const comparableCount = Number(
    dataScope.match(/当前可比底表共\s*(\d+)\s*条/)?.[1] || summary.workCount,
  );
  const rangeMatch = dataScope.match(
    /当前可比时间范围：(.+?)\s*->\s*(.+?)(?:。|\n)/,
  );
  const reviewMatch = dataScope.match(
    /审核状态：(\d+)\s*条\s*`?公开`?[、，]\s*(\d+)\s*条\s*`?自见`?/,
  );

  const contentLines = parseFirstMarkdownTable(
    sectionText(markdown, "内容线聚合"),
  ).map((row) => normalizeAggregateRow(row, "内容线", true));
  const formats = parseFirstMarkdownTable(
    sectionText(markdown, "体裁聚合"),
  ).map((row) => normalizeAggregateRow(row, "体裁"));
  const roles = parseFirstMarkdownTable(
    sectionText(markdown, "内容角色聚合"),
  ).map((row) => normalizeAggregateRow(row, "内容角色"));
  const monthly = parseFirstMarkdownTable(
    sectionText(markdown, "月度趋势"),
  ).map((row) => {
    const profileVisits = parseMetric(row["主页访问"]);
    return {
      month: row["月份"] || null,
      workCount: metricValue(row["作品数"]),
      views: metricValue(row["播放"]),
      likes: metricValue(row["点赞"]),
      shares: metricValue(row["分享"]),
      comments: metricValue(row["评论"]),
      saves: metricValue(row["收藏"]),
      profileVisits: profileVisits.value,
      profileVisitsIsLowerBound: profileVisits.lowerBound,
      followerGain: metricValue(row["涨粉"]),
      weightedCompletionRatePct: metricValue(row["加权完播"]),
      weightedFiveSecondCompletionRatePct: metricValue(row["加权 5s"]),
      weightedTwoSecondBounceRatePct: metricValue(row["加权 2s 跳出"]),
      weightedAverageWatchSeconds: metricValue(row["加权均播"]),
    };
  });
  const qualityIssues = parseFirstMarkdownTable(
    sectionText(markdown, "数据质量提示"),
  ).map((row) => ({
    issue: row["问题"] || null,
    affectedWorks: row["涉及作品"] || null,
    resolution: row["处理方式"] || null,
  }));

  const qualityFlags = [];
  if (Number.isFinite(comparableCount) && comparableCount !== works.length) {
    qualityFlags.push("work_count_mismatch");
  }
  const available =
    works.length > 0 && Number.isFinite(summary.totalViews);
  if (!available) {
    qualityFlags.push("content_board_incomplete");
  }

  return {
    available,
    sourcePath: document.path,
    updatedAt: frontmatter.updated ?? document.updatedAt,
    comparableCount: Number.isFinite(comparableCount)
      ? comparableCount
      : works.length,
    range: {
      from: rangeMatch?.[1]?.trim() || null,
      to: rangeMatch?.[2]?.trim() || null,
    },
    reviewStatusCounts: {
      public: reviewMatch ? Number(reviewMatch[1]) : null,
      private: reviewMatch ? Number(reviewMatch[2]) : null,
    },
    summary,
    summaryLowerBounds,
    works,
    contentLines,
    formats,
    roles,
    monthly,
    qualityIssues,
    qualityFlags,
  };
}

function sortByUpdatedDescending(items) {
  return [...items].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || a.modifiedAt || 0) || 0;
    const bTime = Date.parse(b.updatedAt || b.modifiedAt || 0) || 0;
    if (bTime !== aTime) return bTime - aTime;
    return a.path.localeCompare(b.path, "zh-CN");
  });
}

function archiveList(value) {
  if (value == null || value === "") return [];
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function publishedAtKey(value) {
  return String(value ?? "").trim().slice(0, 19);
}

/**
 * Join editorial archives onto the fixed Douyin fact store without copying
 * performance metrics into 50_scripts. An exact platform id wins; otherwise
 * an exact publish timestamp is accepted only when it identifies one archive.
 */
export function attachPublishedWorkArchives(douyin, documents) {
  if (!douyin || !Array.isArray(douyin.works)) return douyin;

  const documentByPath = new Map(
    documents.map((document) => [document.path, document]),
  );
  const archives = documents.filter(
    (document) =>
      document.extension === "md" &&
      document.frontmatter.type === "published-video-script" &&
      document.frontmatter.platform === "douyin" &&
      document.frontmatter.series === "个人知识库教程" &&
      document.frontmatter.status === "published",
  );
  const byPlatformWorkId = new Map();
  const byPublishedAt = new Map();

  for (const archive of archives) {
    const platformWorkId = String(
      archive.frontmatter.platform_work_id ?? "",
    ).trim();
    if (platformWorkId) byPlatformWorkId.set(platformWorkId, archive);

    const timestamp = publishedAtKey(archive.frontmatter.published_at);
    if (!timestamp) continue;
    const matches = byPublishedAt.get(timestamp) ?? [];
    matches.push(archive);
    byPublishedAt.set(timestamp, matches);
  }

  const works = douyin.works.map((work) => {
    const platformWorkId = String(work.platformWorkId ?? "").trim();
    let archive = platformWorkId
      ? byPlatformWorkId.get(platformWorkId) ?? null
      : null;
    if (!archive) {
      const timestampMatches =
        byPublishedAt.get(publishedAtKey(work.publishedAt)) ?? [];
      if (timestampMatches.length === 1) archive = timestampMatches[0];
    }
    if (!archive) return work;

    const frontmatter = archive.frontmatter;
    const coverPath = String(frontmatter.cover_path ?? "").trim() || null;
    const coverDocument = coverPath ? documentByPath.get(coverPath) : null;
    return {
      ...work,
      contentArchive: {
        documentId: archive.id,
        path: archive.path,
        title: frontmatter.title || archive.title,
        status: frontmatter.status,
        publishedAt: frontmatter.published_at || null,
        platformWorkId: frontmatter.platform_work_id || null,
        douyinUrl: frontmatter.douyin_url || null,
        format: frontmatter.display_format || null,
        contentRole: frontmatter.content_role || null,
        scriptStatus: frontmatter.script_status || null,
        transcriptConfidence: frontmatter.transcript_confidence || null,
        coverPath,
        coverStatus: frontmatter.cover_status || null,
        coverDocumentId:
          coverDocument?.previewKind === "image" ? coverDocument.id : null,
        publishTags: archiveList(frontmatter.publish_tags),
        sourcePaths: archiveList(frontmatter.source_paths),
      },
    };
  });

  return { ...douyin, works };
}

function publicDocument(document) {
  return {
    id: document.id,
    path: document.path,
    fileName: document.fileName,
    extension: document.extension,
    sizeBytes: document.sizeBytes,
    layer: document.layer,
    section: document.section,
    kind: document.kind,
    title: document.title,
    type: document.type,
    status: document.status,
    tags: document.tags,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    modifiedAt: document.modifiedAt,
    isArchived: document.isArchived,
    previewKind: document.previewKind,
    frontmatter: document.frontmatter,
    headings: document.headings,
    wikiLinks: document.wikiLinks,
    backlinks: document.backlinks,
    excerpt: document.excerpt,
    qualityFlags: document.qualityFlags,
  };
}

/**
 * Scan an Obsidian Vault and build a serializable, read-only index.
 *
 * @param {string} vaultRoot Absolute path to the Vault root.
 * @returns {Promise<object>}
 */
export async function buildVaultIndex(vaultRoot) {
  if (!vaultRoot || typeof vaultRoot !== "string") {
    throw new TypeError("vaultRoot must be a non-empty string");
  }

  const resolvedRoot = path.resolve(vaultRoot);
  const rootStats = await fs.stat(resolvedRoot);
  if (!rootStats.isDirectory()) {
    throw new TypeError("vaultRoot must point to a directory");
  }

  let demoMode = false;
  try {
    const demoMarker = JSON.parse(
      await fs.readFile(path.join(resolvedRoot, ".workbench-demo.json"), "utf8"),
    );
    demoMode = demoMarker?.demoMode === true;
  } catch {
    // A normal user Vault has no marker and is therefore never labeled demo.
  }

  const errors = [];
  const files = await collectFiles(resolvedRoot, errors);
  const documents = [];

  for (const file of files) {
    try {
      const document = await buildDocument(file, resolvedRoot, errors);
      if (document) documents.push(document);
    } catch (error) {
      errors.push(makeError(file.relativePath, error, "PARSE_FAILED"));
    }
  }

  documents.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
  const documentMap = resolveWikiLinks(documents);
  const wikiPages = documents.filter(
    (document) =>
      document.layer === "wiki" &&
      document.kind === "knowledge" &&
      document.extension === "md",
  );
  const topicDocuments = documents.filter(
    (document) =>
      document.layer === "topics" &&
      document.extension === "md" &&
      document.path !== "40_topics/README.md",
  );
  const topics = topicDocuments.map(deriveTopic);
  const runDocuments = documents.filter(
    (document) => document.layer === "runs",
  );
  const brainstormDocuments = documents.filter(
    (document) => document.layer === "brainstorm",
  );
  const brainstormSessions = brainstormDocuments.filter(
    (document) => document.kind === "brainstorm-session",
  );
  const rawDocuments = documents.filter(
    (document) => document.layer === "raw",
  );
  const stableDouyinStore = await loadStableDouyinStore(resolvedRoot);
  const douyinSourcePath = stableDouyinStore
    ? DOUYIN_STORE_CURRENT_PATH
    : DOUYIN_WORK_LIST_SOURCE_PATH;
  let douyin = {
    available: false,
    sourcePath: douyinSourcePath,
    updatedAt: null,
    comparableCount: 0,
    range: { from: null, to: null },
    reviewStatusCounts: { public: null, private: null },
    summary: {},
    summaryLowerBounds: {},
    works: [],
    contentLines: [],
    formats: [],
    roles: [],
    monthly: [],
    qualityIssues: [],
    qualityFlags: ["douyin_work_list_missing"],
    analytics: null,
  };

  if (stableDouyinStore) {
    douyin = stableDouyinStore.douyin;
  } else {
    try {
      const { latest: latestDouyinSnapshot, snapshots: douyinSnapshots } =
        await resolveLatestDouyinSnapshot(resolvedRoot);
      const rawSourcePath = latestDouyinSnapshot.workListPath;
      const douyinCsv = await fs.readFile(
        path.join(resolvedRoot, rawSourcePath),
        "utf8",
      );
      douyin = parseDouyinWorkListCsv(
        douyinCsv,
        rawSourcePath,
        documents,
      );
      douyin.updatedAt = latestDouyinSnapshot.capturedAt ?? douyin.updatedAt;
      try {
        douyin.analytics = await loadDouyinAnalytics(
          resolvedRoot,
          latestDouyinSnapshot,
          douyinSnapshots,
          douyin,
        );
        douyin.qualityIssues.push(...douyin.analytics.qualityIssues);
      } catch (analyticsError) {
        errors.push(
          makeError(
            latestDouyinSnapshot.rootPath,
            analyticsError,
            "DOUYIN_ANALYTICS_PARSE_FAILED",
          ),
        );
        douyin.qualityFlags.push("douyin_analytics_parse_failed");
      }
    } catch (error) {
      errors.push(
        makeError(
          douyinSourcePath,
          error,
          "DOUYIN_WORK_LIST_PARSE_FAILED",
        ),
      );
      douyin.qualityFlags = ["douyin_work_list_parse_failed"];
    }
  }

  douyin = attachPublishedWorkArchives(douyin, documents);

  const publicDocuments = documents.map(publicDocument);
  const publicDocumentMap = new Map(
    publicDocuments.map((document) => [document.id, document]),
  );
  const internalMap = new Map();
  for (const document of documents) {
    internalMap.set(document.id, document);
    internalMap.set(document.path, document);
  }

  const index = {
    generatedAt: new Date().toISOString(),
    demoMode,
    stats: {
      documents: documents.length,
      rawFiles: rawDocuments.length,
      formalWikiPages: wikiPages.length,
      topics: topics.length,
      filmedTopics: topics.filter((topic) => topic.isFilmed).length,
      publishedTopics: topics.filter((topic) => topic.isPublished).length,
      runs: runDocuments.length,
      brainstormSessions: brainstormSessions.length,
      douyinWorks: douyin.works.length,
    },
    documents: publicDocuments,
    wiki: {
      pages: wikiPages.map((document) => publicDocumentMap.get(document.id)),
      countsByType: countBy(wikiPages, (document) => document.type),
      countsByStatus: countBy(wikiPages, (document) => document.status),
    },
    topics: {
      items: topics,
      countsByFolder: countBy(topics, (topic) => topic.folderStatus),
      countsByPipelineStage: countBy(
        topics,
        (topic) => topic.pipelineStage,
      ),
      filmed: topics.filter((topic) => topic.isFilmed).length,
      published: topics.filter((topic) => topic.isPublished).length,
    },
    runs: {
      items: runDocuments.map((document) => publicDocumentMap.get(document.id)),
      countsByCategory: countBy(
        runDocuments,
        (document) => document.section || "root",
      ),
    },
    brainstorm: {
      items: brainstormDocuments.map((document) => publicDocumentMap.get(document.id)),
      countsByKind: countBy(brainstormDocuments, (document) => document.kind),
      countsByStatus: countBy(brainstormSessions, (document) => document.status),
    },
    recent: sortByUpdatedDescending(publicDocuments).slice(0, 30),
    douyin,
    errors,
  };

  Object.defineProperty(index, INTERNAL_DOCUMENT_MAP, {
    value: internalMap,
    enumerable: false,
    writable: false,
  });
  Object.defineProperty(index, INTERNAL_VAULT_ROOT, {
    value: resolvedRoot,
    enumerable: false,
    writable: false,
  });

  return index;
}

function filterValues(value) {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function matchesOne(value, accepted) {
  if (accepted.length === 0) return true;
  if (Array.isArray(value)) {
    return value.some((item) => accepted.includes(String(item)));
  }
  return accepted.includes(String(value ?? ""));
}

function documentMatchesFilters(document, filters) {
  if (!matchesOne(document.layer, filterValues(filters.layer))) return false;
  if (!matchesOne(document.kind, filterValues(filters.kind))) return false;
  if (!matchesOne(document.section, filterValues(filters.section))) return false;
  if (!matchesOne(document.type, filterValues(filters.type))) return false;
  if (!matchesOne(document.status, filterValues(filters.status))) return false;
  if (!matchesOne(document.extension, filterValues(filters.extension))) {
    return false;
  }
  if (!matchesOne(document.tags, filterValues(filters.tags))) return false;
  if (!filters.includeArchived && document.isArchived) return false;

  if (
    filters.pathPrefix &&
    !document.path.startsWith(String(filters.pathPrefix))
  ) {
    return false;
  }

  const updated = Date.parse(document.updatedAt || document.modifiedAt || "");
  if (filters.updatedAfter) {
    const lower = Date.parse(filters.updatedAfter);
    if (Number.isFinite(lower) && (!Number.isFinite(updated) || updated < lower)) {
      return false;
    }
  }
  if (filters.updatedBefore) {
    const upper = Date.parse(filters.updatedBefore);
    if (Number.isFinite(upper) && (!Number.isFinite(updated) || updated > upper)) {
      return false;
    }
  }

  return true;
}

function makeSnippet(document, normalizedQuery, vaultRoot = "") {
  const raw = document[INTERNAL_CONTENT] || document.excerpt || "";
  const safeText = sanitizeTextPaths(stripMarkdownForExcerpt(raw), vaultRoot);
  if (!normalizedQuery) return safeText.slice(0, 220);

  const lower = safeText.toLocaleLowerCase("zh-CN");
  const index = lower.indexOf(normalizedQuery);
  if (index < 0) return safeText.slice(0, 220);
  const start = Math.max(0, index - 70);
  const end = Math.min(safeText.length, index + normalizedQuery.length + 130);
  return `${start > 0 ? "…" : ""}${safeText.slice(start, end)}${
    end < safeText.length ? "…" : ""
  }`;
}

/**
 * Search indexed Vault documents. Search is local substring matching over title,
 * metadata and Markdown/text content; no network or vector service is used.
 *
 * @param {object} index Result returned by buildVaultIndex.
 * @param {string} query Search query.
 * @param {object} filters Optional filters and `limit`.
 * @returns {Array<object>}
 */
export function searchIndex(index, query = "", filters = {}) {
  if (!index?.[INTERNAL_DOCUMENT_MAP]) return [];

  const normalizedQuery = String(query || "")
    .trim()
    .toLocaleLowerCase("zh-CN");
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const limit = Number.isFinite(Number(filters.limit))
    ? Math.max(1, Math.min(500, Number(filters.limit)))
    : 100;
  const results = [];

  for (const publicItem of index.documents || []) {
    const document = index[INTERNAL_DOCUMENT_MAP].get(publicItem.id);
    if (!document || !documentMatchesFilters(document, filters)) continue;

    const title = document.title.toLocaleLowerCase("zh-CN");
    const pathText = document.path.toLocaleLowerCase("zh-CN");
    const tagText = document.tags.join(" ").toLocaleLowerCase("zh-CN");
    const headingText = document.headings
      .map((heading) => heading.title)
      .join(" ")
      .toLocaleLowerCase("zh-CN");
    const contentText = String(document[INTERNAL_CONTENT] || "")
      .toLocaleLowerCase("zh-CN");
    const haystack = `${title}\n${pathText}\n${tagText}\n${headingText}\n${contentText}`;

    if (terms.length > 0 && !terms.every((term) => haystack.includes(term))) {
      continue;
    }

    let score = 0;
    if (!normalizedQuery) score = Date.parse(document.updatedAt) || 0;
    if (title === normalizedQuery) score += 120;
    else if (title.startsWith(normalizedQuery)) score += 80;
    else if (title.includes(normalizedQuery)) score += 60;
    if (tagText.includes(normalizedQuery)) score += 30;
    if (headingText.includes(normalizedQuery)) score += 20;
    if (pathText.includes(normalizedQuery)) score += 15;
    if (contentText.includes(normalizedQuery)) score += 10;

    results.push({
      id: document.id,
      path: document.path,
      title: document.title,
      layer: document.layer,
      section: document.section,
      kind: document.kind,
      type: document.type,
      status: document.status,
      tags: document.tags,
      updatedAt: document.updatedAt,
      excerpt: document.excerpt,
      snippet: makeSnippet(
        document,
        normalizedQuery,
        index[INTERNAL_VAULT_ROOT],
      ),
      score,
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const updatedDifference =
      (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
    if (updatedDifference !== 0) return updatedDifference;
    return a.path.localeCompare(b.path, "zh-CN");
  });

  return results.slice(0, limit);
}

/**
 * Return one document with sanitized text content. Accepts either the opaque id
 * or a Vault-relative path for server-side convenience.
 *
 * @param {object} index Result returned by buildVaultIndex.
 * @param {string} id Opaque document id or Vault-relative path.
 * @returns {object|null}
 */
export function getDocument(index, id) {
  const document = index?.[INTERNAL_DOCUMENT_MAP]?.get(String(id));
  if (!document) return null;

  return {
    ...publicDocument(document),
    content:
      document[INTERNAL_CONTENT] == null
        ? null
        : sanitizeTextPaths(
            document[INTERNAL_CONTENT],
            index[INTERNAL_VAULT_ROOT],
          ),
  };
}
