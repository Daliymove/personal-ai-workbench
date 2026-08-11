const AI_HOT_ORIGIN = "https://aihot.virxact.com";
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;
const MUST_READ_LIMIT = 3;
const BROWSE_LIMIT = 8;
const OTHER_LIMIT = 12;

export const DEFAULT_ATTENTION_STRATEGY = Object.freeze({
  mustReadLimit: MUST_READ_LIMIT,
  browseLimit: BROWSE_LIMIT,
  otherLimit: OTHER_LIMIT,
  minimumIndependentSources: 2,
  question: "这条变化是否可能影响未来一周的工具选择、工作方式或风险判断？",
  rules: [
    "只从多源热点、过去 24 小时精选和最新日报取候选。",
    "多源事件命中至少一个关注领域，才进入今日必看。",
    "热点只用于阅读分层，不自动生成选题或任务。",
  ],
});

const ATTENTION_DOMAINS = [
  {
    id: "agent-work",
    label: "Agent 与工具工作流",
    patterns: [
      /\bagents?\b/i,
      /智能体|工具调用|工作流|自动化|编程助手|MCP|Codex|Claude Code|ChatGPT Work/i,
    ],
  },
  {
    id: "guardrails",
    label: "安全、版权与政策边界",
    patterns: [
      /安全|越权|攻击|泄露|隐私|版权|侵权|监管|政策|法院|禁令|对齐/i,
    ],
  },
  {
    id: "content-production",
    label: "内容生产工具",
    patterns: [
      /视频|图像|图片|音频|语音|音乐|字幕|剪辑|多模态|Sora|Seedance/i,
    ],
  },
  {
    id: "capability-shift",
    label: "AI 能力边界",
    patterns: [
      /下一代|模型发布|新模型|推理|数学|科学|基准|benchmark|能力突破|开源模型/i,
    ],
  },
  {
    id: "knowledge-work",
    label: "知识工作与研究方式",
    patterns: [
      /知识|文档|办公|研究|搜索|阅读|学习|写作|记忆|检索|上下文/i,
    ],
  },
];

const CATEGORY_LABELS = {
  "ai-models": "模型",
  "ai-products": "产品",
  industry: "行业",
  paper: "论文",
  tip: "教程与观点",
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function itemIdFromUrl(value) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.at(-1) || null;
  } catch {
    return null;
  }
}

function storyIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin !== AI_HOT_ORIGIN) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    return parts[0] === "story" && parts[1] ? parts[1] : null;
  } catch {
    return null;
  }
}

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedLimit(value, fallback, maximum = 50) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= maximum
    ? number
    : fallback;
}

function normalizeStrategy(strategy) {
  return {
    ...DEFAULT_ATTENTION_STRATEGY,
    ...(strategy && typeof strategy === "object" ? strategy : {}),
    mustReadLimit: normalizedLimit(strategy?.mustReadLimit, MUST_READ_LIMIT),
    browseLimit: normalizedLimit(strategy?.browseLimit, BROWSE_LIMIT),
    otherLimit: normalizedLimit(strategy?.otherLimit, OTHER_LIMIT),
    minimumIndependentSources: normalizedLimit(
      strategy?.minimumIndependentSources,
      2,
      20,
    ),
  };
}

function configuredAttentionDomains(strategy, haystack) {
  if (!Array.isArray(strategy?.domains) || strategy.domains.length === 0) {
    return null;
  }
  const normalizedHaystack = haystack.toLocaleLowerCase("zh-CN");
  return strategy.domains
    .filter((domain) => {
      if (!domain || typeof domain !== "object") return false;
      return (Array.isArray(domain.keywords) ? domain.keywords : []).some((keyword) => {
        const normalized = String(keyword ?? "").trim().toLocaleLowerCase("zh-CN");
        return normalized && normalizedHaystack.includes(normalized);
      });
    })
    .map((domain) => ({ id: String(domain.id), label: String(domain.label) }));
}

function attentionDomains(item, strategy) {
  const haystack = [
    item.title,
    item.summary,
    item.latest,
    item.source?.name,
    ...asArray(item.sourceNames),
  ]
    .filter(Boolean)
    .join(" ");

  const configured = configuredAttentionDomains(strategy, haystack);
  if (configured) return configured;

  return ATTENTION_DOMAINS.filter((domain) =>
    domain.patterns.some((pattern) => pattern.test(haystack)),
  ).map(({ id, label }) => ({ id, label }));
}

function evidenceFor(item) {
  if (item.sourceCount >= 2) {
    return {
      level: "multi-source",
      label: `${item.sourceCount} 个独立信源`,
    };
  }
  if (item.links?.original) {
    return {
      level: "original-linked",
      label: "可回查原文",
    };
  }
  return {
    level: "summary-only",
    label: "仅有聚合摘要",
  };
}

function attentionReason(item, domains) {
  const domainLabel = domains[0]?.label;
  if (item.sourceCount >= 2 && domainLabel) {
    return `${item.sourceCount} 个独立信源正在跟进，可能影响${domainLabel}。`;
  }
  if (domainLabel) {
    return `与${domainLabel}相关，值得快速了解事实与当前边界。`;
  }
  if (item.sourceCount >= 2) {
    return `${item.sourceCount} 个独立信源正在跟进，但暂未发现明确的近期行动关联。`;
  }
  return "已进入 AI HOT 精选，可按兴趣浏览，不占用今日必看名额。";
}

function decorateItem(item, strategy) {
  const domains = attentionDomains(item, strategy);
  return {
    ...item,
    attention: {
      domains,
      reason: attentionReason(item, domains),
    },
    categoryLabel: CATEGORY_LABELS[item.category] || item.category || null,
    evidence: evidenceFor(item),
  };
}

function normalizeHotTopic(raw, story, strategy) {
  const storyValue = story?.story;
  return decorateItem({
    id: String(raw?.id || storyValue?.publicId || raw?.title || "hot-topic"),
    kind: "hot-topic",
    title: compactText(raw?.title || storyValue?.title || "未命名热点"),
    summary: compactText(storyValue?.digest) || null,
    latest: compactText(storyValue?.latest) || null,
    source: {
      name: compactText(raw?.source?.name) || "AI HOT",
    },
    sourceNames: asArray(raw?.sourceNames).map(compactText).filter(Boolean),
    sourceCount: finiteNumber(raw?.sourceCount),
    signalCount: finiteNumber(raw?.signalCount),
    latestAt: raw?.latestAt || storyValue?.latestAt || null,
    publishedAt: storyValue?.firstReportAt || null,
    discoveredAt: storyValue?.firstReportAt || null,
    category: null,
    score: null,
    links: {
      aihot: raw?.links?.aihot || storyValue?.links?.aihot || null,
      original: raw?.links?.original || null,
      story: raw?.links?.story || storyValue?.links?.aihot || null,
    },
    reportIds: asArray(storyValue?.reports)
      .map((report) => String(report?.id || ""))
      .filter(Boolean),
    storyStatus: storyValue?.status || null,
  }, strategy);
}

function normalizeSelectedItem(raw, kind = "selected", strategy) {
  return decorateItem({
    id: String(raw?.id || itemIdFromUrl(raw?.links?.aihot) || raw?.title || kind),
    kind,
    title: compactText(raw?.title || "未命名动态"),
    summary: compactText(raw?.summary) || null,
    latest: null,
    source: {
      name: compactText(raw?.source?.name) || "未知来源",
    },
    sourceNames: [],
    sourceCount: 1,
    signalCount: 0,
    latestAt: raw?.discoveredAt || raw?.publishedAt || null,
    publishedAt: raw?.publishedAt || null,
    discoveredAt: raw?.discoveredAt || null,
    category: raw?.category || null,
    score: Number.isFinite(Number(raw?.score)) ? Number(raw.score) : null,
    links: {
      aihot: raw?.links?.aihot || null,
      original: raw?.links?.original || null,
      story: null,
    },
    reportIds: [],
    storyStatus: null,
  }, strategy);
}

function normalizeDailyItems(report, strategy) {
  return asArray(report?.sections).flatMap((section) =>
    asArray(section?.items).map((item) =>
      normalizeSelectedItem(
        {
          ...item,
          id: itemIdFromUrl(item?.links?.aihot),
          category: null,
          discoveredAt: report?.generatedAt || null,
          publishedAt: null,
          score: null,
        },
        "daily",
        strategy,
      ),
    ),
  );
}

function uniqueItems(items, excludedIds = new Set()) {
  const seen = new Set();
  return items.filter((item) => {
    if (excludedIds.has(String(item.id))) return false;
    const key = item.links?.original || item.links?.aihot || String(item.id);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function classifyDailyHot({ hotTopics, selectedItems, dailyReport, strategy }) {
  const resolvedStrategy = normalizeStrategy(strategy);
  const hot = asArray(hotTopics).map((entry) =>
    normalizeHotTopic(entry.item ?? entry, entry.story ?? null, resolvedStrategy),
  );
  const hotReportIds = new Set([
    ...hot.map((item) => String(item.id)),
    ...hot.flatMap((item) => item.reportIds),
  ]);
  const selected = uniqueItems(
    asArray(selectedItems).map((item) => normalizeSelectedItem(item, "selected", resolvedStrategy)),
    hotReportIds,
  );
  const selectedIds = new Set(selected.map((item) => String(item.id)));
  const daily = uniqueItems(normalizeDailyItems(dailyReport, resolvedStrategy), new Set([
    ...hotReportIds,
    ...selectedIds,
  ]));

  const mustRead = hot
    .filter(
      (item) =>
        item.sourceCount >= resolvedStrategy.minimumIndependentSources &&
        item.attention.domains.length > 0,
    )
    .slice(0, resolvedStrategy.mustReadLimit);
  const usedIds = new Set(mustRead.map((item) => String(item.id)));
  const browse = [...hot, ...selected]
    .filter((item) => !usedIds.has(String(item.id)))
    .slice(0, resolvedStrategy.browseLimit);
  browse.forEach((item) => usedIds.add(String(item.id)));
  const other = [...hot, ...selected, ...daily]
    .filter((item) => !usedIds.has(String(item.id)))
    .slice(0, resolvedStrategy.otherLimit);

  return {
    mustRead,
    browse,
    other,
  };
}

async function fetchJson(fetchImpl, path, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${AI_HOT_ORIGIN}${path}`, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`AI HOT ${path} 返回 HTTP ${response.status}`);
      error.code = "AI_HOT_UPSTREAM_ERROR";
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStory(fetchImpl, storyUrl, timeoutMs) {
  const publicId = storyIdFromUrl(storyUrl);
  if (!publicId) return null;
  return fetchJson(fetchImpl, `/api/v1/stories/${encodeURIComponent(publicId)}`, timeoutMs);
}

function dailyMeta(report) {
  const items = asArray(report?.sections).flatMap((section) => asArray(section?.items));
  return {
    date: report?.date || null,
    generatedAt: report?.generatedAt || null,
    itemCount: items.length,
    sectionCount: asArray(report?.sections).length,
    links: {
      aihot: report?.links?.aihot || `${AI_HOT_ORIGIN}/daily`,
    },
  };
}

export function createDailyHotLoader({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  strategy = null,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("AI HOT loader requires a fetch implementation.");
  }

  let cache = null;

  return async function loadDailyHot({ force = false } = {}) {
    const requestedAt = now();
    if (!force && cache && requestedAt < cache.expiresAt) {
      return cache.payload;
    }

    try {
      const [hotResponse, selectedResponse, dailyResponse] = await Promise.all([
        fetchJson(fetchImpl, "/api/v1/hot-topics", requestTimeoutMs),
        fetchJson(
          fetchImpl,
          "/api/v1/items?mode=selected&window=24h&limit=20",
          requestTimeoutMs,
        ),
        fetchJson(fetchImpl, "/api/v1/dailies/latest", requestTimeoutMs),
      ]);

      const hotItems = asArray(hotResponse?.items);
      const storyResults = await Promise.allSettled(
        hotItems.map((item) => fetchStory(fetchImpl, item?.links?.story, requestTimeoutMs)),
      );
      const hotTopics = hotItems.map((item, index) => ({
        item,
        story: storyResults[index]?.status === "fulfilled"
          ? storyResults[index].value
          : null,
      }));
      const tiers = classifyDailyHot({
        hotTopics,
        selectedItems: selectedResponse?.items,
        dailyReport: dailyResponse?.report,
        strategy,
      });
      const resolvedStrategy = normalizeStrategy(strategy);
      const fetchedAt = new Date(requestedAt).toISOString();
      const payload = {
        schemaVersion: 1,
        status: "live",
        fetchedAt,
        expiresAt: new Date(requestedAt + cacheTtlMs).toISOString(),
        source: {
          name: "AI HOT",
          url: `${AI_HOT_ORIGIN}/agent`,
          attributionRequired: false,
        },
        policy: {
          question: resolvedStrategy.question,
          mustReadLimit: resolvedStrategy.mustReadLimit,
          rules: Array.isArray(resolvedStrategy.rules)
            ? resolvedStrategy.rules.map(String)
            : DEFAULT_ATTENTION_STRATEGY.rules,
          source: strategy?.source || "built-in",
        },
        daily: dailyMeta(dailyResponse?.report),
        counts: {
          upstreamHot: hotItems.length,
          upstreamSelected24h: asArray(selectedResponse?.items).length,
          mustRead: tiers.mustRead.length,
          browse: tiers.browse.length,
          other: tiers.other.length,
        },
        tiers,
      };

      cache = {
        expiresAt: requestedAt + cacheTtlMs,
        payload,
      };
      return payload;
    } catch (error) {
      if (cache?.payload) {
        return {
          ...cache.payload,
          status: "stale",
          staleAt: new Date(requestedAt).toISOString(),
          error: {
            code: error?.code || "AI_HOT_REFRESH_FAILED",
            message: error?.message || "AI HOT 刷新失败。",
          },
        };
      }
      error.code ||= "AI_HOT_UNAVAILABLE";
      throw error;
    }
  };
}

export const loadDailyHot = createDailyHotLoader();
