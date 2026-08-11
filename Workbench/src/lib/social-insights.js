function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN");
}

export const SOCIAL_RESEARCH_DEPTHS = {
  quick: "快速",
  standard: "标准",
  deep: "深度",
};

export const SOCIAL_RESEARCH_WINDOWS = {
  "24h": "最近 24 小时",
  "7d": "最近 7 天",
  "30d": "最近 30 天",
};

function cleanLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function buildSocialResearchHandoff({
  mode,
  scope = "AI",
  topic,
  question,
  timeWindow,
  depth = "standard",
} = {}) {
  const selectedMode = mode === "topic-deep-dive" ? mode : "trend-scan";
  const selectedWindow =
    SOCIAL_RESEARCH_WINDOWS[timeWindow] ||
    SOCIAL_RESEARCH_WINDOWS[selectedMode === "trend-scan" ? "7d" : "30d"];
  const selectedDepth = SOCIAL_RESEARCH_DEPTHS[depth] || SOCIAL_RESEARCH_DEPTHS.standard;

  if (selectedMode === "topic-deep-dive") {
    const selectedTopic = cleanLine(topic);
    const selectedQuestion = cleanLine(question);
    return [
      "请使用 $research-social-insights 执行一次主动社媒研究。",
      "",
      "- 模式：`topic-deep-dive`",
      `- 主题：${selectedTopic || "（请先向我确认主题）"}`,
      `- 时间范围：${selectedWindow}`,
      `- 研究深度：${selectedDepth}`,
      selectedQuestion
        ? `- 我最想回答的问题：${selectedQuestion}`
        : "- 我最想回答的问题：未单独指定，请按该模式的默认问题推进。",
      "",
      "- 产出边界：只生成该模式的脱敏 Raw 报告，不写 Wiki、选题或内容生产层。",
      "",
      "请按 Skill 当前的来源策略、评论分析规则、质量门禁、报告契约和校验流程执行。完成后说明实际覆盖、排除项、证据边界和报告路径。",
    ].join("\n");
  }

  return [
    "请使用 $research-social-insights 执行一次主动社媒研究。",
    "",
    "- 模式：`trend-scan`",
    `- 扫描范围：${cleanLine(scope) || "AI"}`,
    `- 时间范围：${selectedWindow}`,
    `- 研究深度：${selectedDepth}`,
    "- 研究问题：按该模式的默认问题推进。",
    "",
    "- 产出边界：只生成该模式的脱敏 Raw 报告，不写 Wiki、选题或内容生产层。",
    "",
    "请按 Skill 当前的来源策略、评论分析规则、质量门禁、报告契约和校验流程执行。完成后说明实际覆盖、排除项、证据边界和报告路径。",
  ].join("\n");
}

function withinDateRange(capturedAt, range, now = new Date()) {
  if (!range || range === "all") return true;
  const captured = Date.parse(capturedAt || "");
  if (!Number.isFinite(captured)) return false;
  const days = Number(range);
  if (!Number.isFinite(days)) return true;
  return captured >= now.getTime() - days * 24 * 60 * 60 * 1000;
}

export function filterSocialInsights(items, filters, now = new Date()) {
  const query = normalized(filters?.query);
  return (items ?? []).filter((item) => {
    const haystack = normalized(
      [item.title, item.topic, item.question, item.conclusion, ...(item.searchTerms ?? [])]
        .filter(Boolean)
        .join(" "),
    );
    if (query && !haystack.includes(query)) return false;
    if (
      filters?.primaryPlatform &&
      filters.primaryPlatform !== "all" &&
      item.primaryPlatform !== filters.primaryPlatform
    ) {
      return false;
    }
    if (
      filters?.auxiliaryPlatform &&
      filters.auxiliaryPlatform !== "all" &&
      !(item.auxiliaryPlatforms ?? []).includes(filters.auxiliaryPlatform)
    ) {
      return false;
    }
    if (
      filters?.status &&
      filters.status !== "all" &&
      item.status !== filters.status
    ) {
      return false;
    }
    return withinDateRange(item.capturedAt, filters?.dateRange, now);
  });
}

export function presentationProjection(report) {
  if (!report) return null;
  return {
    title: report.title,
    topic: report.topic,
    question: report.question,
    conclusion: report.conclusion,
    capturedAt: report.capturedAt,
    primaryPlatform: report.primaryPlatform,
    auxiliaryPlatforms: [...(report.auxiliaryPlatforms ?? [])],
    platforms: [...(report.platforms ?? [])],
    sampleTotals: { ...(report.sampleTotals ?? {}) },
    sampleRows: (report.sampleRows ?? []).map((item) => ({ ...item })),
    validIndicators: (report.validIndicators ?? []).map((item) => ({ ...item })),
    needs: (report.needs ?? []).map((item) => ({ ...item })),
    camps: (report.camps ?? []).map((item) => ({ ...item })),
    commentReplyChains: (report.commentReplyChains ?? []).map((item) => ({ ...item })),
    boundaries: [...(report.boundaries ?? [])],
  };
}
