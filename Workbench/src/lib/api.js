import {
  fallbackCollections,
  fallbackDouyinWorks,
  fallbackOverview,
  fallbackSearchResults,
} from "../data/fallback";
import {
  httpApiError,
  normalizeApiFailure,
} from "./api-errors";
import { createDailyHotLoader } from "../../shared/ai-hot.mjs";

const DEFAULT_TIMEOUT = 12_000;

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), options.timeout ?? DEFAULT_TIMEOUT);

  try {
    let response;
    try {
      response = await fetch(path, {
        ...options,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...options.headers,
        },
        signal: controller.signal,
      });
    } catch (error) {
      throw normalizeApiFailure(error);
    }

    if (!response.ok) {
      const body = await response.text();
      throw httpApiError(
        response.status,
        body,
        response.headers.get("content-type") || "",
      );
    }

    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

async function withFallback(loader, fallback) {
  try {
    const data = await loader();
    return { data, source: "live", error: null };
  } catch (error) {
    return {
      data: typeof fallback === "function" ? fallback() : fallback,
      source: "fallback",
      error,
    };
  }
}

export function loadOverview() {
  return withFallback(() => request("/api/overview"), fallbackOverview);
}

let dailyHotLoader = null;
let dailyHotStrategyKey = null;

async function configuredDailyHotLoader() {
  let strategy = null;
  try {
    strategy = await request("/api/config/attention");
  } catch {
    // Hosted/static builds use the shared neutral default.
  }
  const key = JSON.stringify(strategy ?? {});
  if (!dailyHotLoader || key !== dailyHotStrategyKey) {
    dailyHotLoader = createDailyHotLoader({
      requestTimeoutMs: 20_000,
      strategy,
    });
    dailyHotStrategyKey = key;
  }
  return dailyHotLoader;
}

const unavailableDailyHot = {
  schemaVersion: 1,
  status: "unavailable",
  fetchedAt: null,
  source: {
    name: "AI HOT",
    url: "https://aihot.virxact.com/agent",
  },
  policy: null,
  daily: null,
  counts: {
    upstreamHot: null,
    upstreamSelected24h: null,
    mustRead: 0,
    browse: 0,
    other: 0,
  },
  tiers: {
    mustRead: [],
    browse: [],
    other: [],
  },
  error: {
    code: "AI_HOT_DATA_SERVICE_UNAVAILABLE",
    message: "AI HOT 暂时无法读取。",
  },
};

export async function loadDailyHot({ refresh = false } = {}) {
  try {
    const loader = await configuredDailyHotLoader();
    const data = await loader({ force: refresh });
    return { data, source: "live", error: null };
  } catch (error) {
    return {
      data: unavailableDailyHot,
      source: "fallback",
      error: normalizeApiFailure(error),
    };
  }
}

export function loadCollection(kind, params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  });

  return withFallback(
    () => request(`/api/collections/${kind}?${search.toString()}`),
    () => {
      const overviewRows =
        kind === "wiki"
          ? fallbackSearchResults.filter((item) => item.layer === "wiki")
          : kind === "materials"
            ? fallbackSearchResults.filter((item) => item.layer === "raw")
            : kind === "archive"
              ? fallbackSearchResults.filter((item) => item.layer === "run")
              : fallbackSearchResults;

      return {
        items: overviewRows,
        groups: fallbackCollections[kind] ?? [],
        total: overviewRows.length,
      };
    },
  );
}

const emptyMaterialsHome = {
  generatedAt: null,
  root: null,
  folders: [],
  queue: [],
  queuePreview: [],
  recent: [],
  total: 0,
};

export function loadMaterialsHome() {
  return withFallback(() => request("/api/materials"), emptyMaterialsHome);
}

export function loadBooks() {
  return withFallback(
    () => request("/api/books"),
    { generatedAt: null, total: 0, chapterTotal: 0, books: [] },
  );
}

export function loadMaterialFolder(relativePath) {
  const search = new URLSearchParams({ path: relativePath });
  return withFallback(
    () => request(`/api/materials/folder?${search.toString()}`),
    {
      generatedAt: null,
      folder: null,
      breadcrumbs: [],
      folders: [],
      items: [],
    },
  );
}

export function loadMaterialReadingQueue() {
  return withFallback(
    () => request("/api/material-reading-queue"),
    { updatedAt: null, total: 0, items: [] },
  );
}

export function addMaterialToReadingQueue(documentId, contentHash = undefined) {
  return request("/api/material-reading-queue", {
    method: "POST",
    body: JSON.stringify({
      documentId,
      ...(contentHash ? { contentHash } : {}),
    }),
  });
}

export function removeMaterialFromReadingQueue(documentId) {
  return request(`/api/material-reading-queue/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
    body: JSON.stringify({}),
  });
}

export function searchVault(query, filters = {}) {
  const search = new URLSearchParams({ q: query });
  Object.entries(filters).forEach(([key, value]) => {
    if (value) search.set(key, String(value));
  });

  return withFallback(
    () => request(`/api/search?${search.toString()}`),
    () => ({
      query,
      total: fallbackSearchResults.filter((item) => {
        const haystack = `${item.title} ${item.section} ${item.excerpt ?? ""}`.toLowerCase();
        return !query || haystack.includes(query.toLowerCase());
      }).length,
      items: fallbackSearchResults.filter((item) => {
        const haystack = `${item.title} ${item.section} ${item.excerpt ?? ""}`.toLowerCase();
        return !query || haystack.includes(query.toLowerCase());
      }),
    }),
  );
}

export function loadDocument(id) {
  return withFallback(
    () => request(`/api/documents/${encodeURIComponent(id)}`),
    null,
  );
}

export function loadReaderNotes(documentId) {
  const search = new URLSearchParams({ documentId: String(documentId) });
  return request(`/api/reader-notes?${search.toString()}`);
}

export function saveReaderNote(payload) {
  return request("/api/reader-notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteReaderNote(noteId, documentId) {
  const search = new URLSearchParams({ documentId: String(documentId) });
  return request(
    `/api/reader-notes/${encodeURIComponent(noteId)}?${search.toString()}`,
    { method: "DELETE" },
  );
}

export function loadReaderExplanations(documentId) {
  const search = new URLSearchParams({ documentId: String(documentId) });
  return request(`/api/reader-explanations?${search.toString()}`);
}

export function loadReaderExplanation(analysisId, documentId) {
  const search = new URLSearchParams({ documentId: String(documentId) });
  return request(
    `/api/reader-explanations/${encodeURIComponent(analysisId)}?${search.toString()}`,
  );
}

export function startReaderExplanation(payload) {
  return request("/api/reader-explanations", {
    method: "POST",
    body: JSON.stringify(payload),
    timeout: 30_000,
  });
}

export function followUpReaderExplanation(analysisId, payload) {
  return request(
    `/api/reader-explanations/${encodeURIComponent(analysisId)}/follow-up`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      timeout: 30_000,
    },
  );
}

export function saveReaderExplanationToNote(analysisId, payload) {
  return request(
    `/api/reader-explanations/${encodeURIComponent(analysisId)}/save-note`,
    {
      method: "POST",
      body: JSON.stringify(payload),
      timeout: 30_000,
    },
  );
}

export function startWikiIngest(documentId) {
  return request("/api/wiki-ingest", {
    method: "POST",
    body: JSON.stringify({ documentId }),
    timeout: 30_000,
  });
}

export function loadWikiIngestJob(jobId) {
  return request(`/api/wiki-ingest/jobs/${encodeURIComponent(jobId)}`);
}

export function loadWikiIngestRecovery(documentId) {
  return request(`/api/wiki-ingest/recovery?documentId=${encodeURIComponent(documentId)}`);
}

export function sendWikiIngestMessage(jobId, message, kind = "query") {
  return request(`/api/wiki-ingest/jobs/${encodeURIComponent(jobId)}/message`, {
    method: "POST",
    body: JSON.stringify({ message, kind }),
    timeout: 30_000,
  });
}

export function confirmWikiIngestJob(jobId, expectedReviewVersion) {
  return request(`/api/wiki-ingest/jobs/${encodeURIComponent(jobId)}/confirm`, {
    method: "POST",
    body: JSON.stringify({ expectedReviewVersion }),
    timeout: 30_000,
  });
}

export function createWikiIngestClientHandoff(jobId, expectedReviewVersion) {
  return request(`/api/wiki-ingest/jobs/${encodeURIComponent(jobId)}/handoff`, {
    method: "POST",
    body: JSON.stringify({ expectedReviewVersion }),
    timeout: 30_000,
  });
}

export function cancelWikiIngestJob(jobId) {
  return request(`/api/wiki-ingest/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    timeout: 30_000,
  });
}

export function createWikiIngestEventSource(jobId) {
  return new EventSource(`/api/wiki-ingest/jobs/${encodeURIComponent(jobId)}/events`);
}

export function loadGraph() {
  return withFallback(() => request("/api/graph"), {
    generatedAt: null,
    stats: { nodeCount: 0, edgeCount: 0, isolatedCount: 0 },
    typeCounts: {},
    nodes: [],
    edges: [],
  });
}

export function loadDouyinWorks(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, String(value));
  });

  return withFallback(
    () => request(`/api/douyin/works?${search.toString()}`),
    {
      generatedAt: null,
      total: fallbackDouyinWorks.length,
      items: fallbackDouyinWorks,
      comparableCount: null,
      summary: {},
      summaryLowerBounds: {},
      contentLines: [],
      formats: [],
      roles: [],
      monthly: [],
      reviewStatusCounts: {
        public: null,
        private: null,
      },
      available: false,
      sourcePath: null,
      sourceUpdatedAt: null,
      range: {
        from: null,
        to: null,
      },
      qualityIssues: [],
      qualityFlags: ["data_service_unavailable"],
      analytics: null,
    },
  );
}

export function loadSocialInsights() {
  return withFallback(
    () => request("/api/social-insights"),
    {
      available: false,
      generatedAt: null,
      total: null,
      items: [],
    },
  );
}

export function loadSocialInsight(reportId) {
  return withFallback(
    () => request(`/api/social-insights/${encodeURIComponent(reportId)}`),
    null,
  );
}

export function loadSocialTrends() {
  return withFallback(
    () => request("/api/social-trends"),
    {
      available: false,
      generatedAt: null,
      total: null,
      items: [],
    },
  );
}

export function loadSocialTrend(reportId) {
  return withFallback(
    () => request(`/api/social-trends/${encodeURIComponent(reportId)}`),
    null,
  );
}

export function refreshVault() {
  return request("/api/refresh", { method: "POST" });
}

export function openLocalTarget(id, target = "obsidian") {
  return request("/api/open", {
    method: "POST",
    body: JSON.stringify({ id, target }),
  });
}

export function getRuntimeStatus() {
  return withFallback(
    () => request("/api/runtime"),
    {
      codex: {
        available: false,
        authenticated: null,
        version: null,
        path: null,
      },
      vault: {
        connected: null,
        label: "本地 Vault",
        documents: null,
        generatedAt: null,
        errors: null,
      },
    },
  );
}

export function startWorkflow(payload) {
  return request("/api/workflows/xiaohongshu", {
    method: "POST",
    body: JSON.stringify(payload),
    timeout: 30_000,
  });
}

export function loadWorkflowJob(jobId) {
  return request(`/api/workflows/jobs/${encodeURIComponent(jobId)}`);
}

export function cancelWorkflowJob(jobId) {
  return request(`/api/workflows/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  });
}

export function confirmWorkflowJob(jobId) {
  return request(`/api/workflows/jobs/${encodeURIComponent(jobId)}/confirm`, {
    method: "POST",
  });
}

export function createJobEventSource(jobId) {
  return new EventSource(`/api/workflows/jobs/${encodeURIComponent(jobId)}/events`);
}
