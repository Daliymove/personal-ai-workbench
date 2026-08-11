import { createHash } from "node:crypto";

import matter from "gray-matter";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { getDocument } from "./vault-index.mjs";

export const SOCIAL_INSIGHT_ROOT = "10_raw/social-insights/";
export const SOCIAL_INSIGHT_TYPE = "social-insight-report";
export const SOCIAL_INSIGHT_SCHEMA_VERSION = 1;
export const SOCIAL_TREND_TYPE = "social-trend-report";
export const SOCIAL_TREND_SCHEMA_VERSION = 1;

const REQUIRED_SECTIONS = [
  "样本概览",
  "一页结论",
  "评论区需求地图",
  "跨平台差异",
  "脱敏证据摘录",
  "证据边界与已排除内容",
];

const REQUIRED_TREND_SECTIONS = [
  "扫描范围",
  "风向簇",
  "来源覆盖",
  "重点证据",
  "证据边界与已排除内容",
];

const PLATFORM_KEYS = new Map([
  ["小红书", "xiaohongshu"],
  ["抖音", "douyin"],
  ["微博", "weibo"],
  ["知乎", "zhihu"],
  ["X", "x"],
  ["Twitter", "x"],
  ["Reddit", "reddit"],
]);

function textOf(node) {
  return toString(node).replace(/\s+/g, " ").trim();
}

function visit(node, callback) {
  callback(node);
  for (const child of node?.children ?? []) visit(child, callback);
}

function normalizeDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return String(value);
}

function stringList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return value == null || value === "" ? [] : [String(value)];
}

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value.replaceAll(",", "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function numericObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, finiteNumber(item)])
      .filter(([, item]) => item != null),
  );
}

function sumValues(value) {
  const values = Object.values(numericObject(value));
  return values.length ? values.reduce((total, item) => total + item, 0) : null;
}

function sectionMap(tree) {
  const sections = new Map();
  let active = null;
  for (const node of tree.children ?? []) {
    if (node.type === "heading" && node.depth === 2) {
      active = { title: textOf(node), nodes: [] };
      sections.set(active.title, active);
      continue;
    }
    if (active) active.nodes.push(node);
  }
  return sections;
}

function firstTable(section) {
  const table = section?.nodes.find((node) => node.type === "table");
  if (!table?.children?.length) return [];
  const headers = table.children[0].children.map(textOf);
  return table.children.slice(1).map((row) =>
    Object.fromEntries(
      headers.map((header, index) => [header, textOf(row.children[index])]),
    ),
  );
}

function sectionList(section) {
  const values = [];
  for (const node of section?.nodes ?? []) {
    if (node.type !== "list") continue;
    for (const item of node.children ?? []) {
      const value = textOf(item);
      if (value) values.push(value);
    }
  }
  return values;
}

function sectionParagraphs(section) {
  return (section?.nodes ?? [])
    .filter((node) => ["paragraph", "blockquote"].includes(node.type))
    .map(textOf)
    .filter(Boolean);
}

function summaryFromTree(tree) {
  for (const node of tree.children ?? []) {
    if (node.type !== "blockquote") continue;
    const raw = toString(node).trim();
    const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines[0]?.toLowerCase().startsWith("[!summary]")) continue;
    const firstLine = lines[0].replace(/^\[!summary\]\s*/i, "").trim();
    const content = [firstLine === "一句话结论" ? null : firstLine, ...lines.slice(1)]
      .filter(Boolean)
      .join(" ")
      .trim();
    return content || null;
  }
  return null;
}

function findingsFromSection(section) {
  const findings = [];
  let active = null;
  for (const node of section?.nodes ?? []) {
    if (node.type === "heading" && node.depth === 3) {
      active = { title: textOf(node).replace(/^\d+\.\s*/, ""), body: [] };
      findings.push(active);
      continue;
    }
    if (!active || node.type === "table") continue;
    if (node.type === "list") {
      for (const item of node.children ?? []) {
        const value = textOf(item);
        if (value) active.body.push(value);
      }
      continue;
    }
    if (["paragraph", "blockquote"].includes(node.type)) {
      const value = textOf(node);
      if (value) active.body.push(value);
    }
  }
  return findings;
}

function privateSourcesFromSection(section) {
  const sources = [];
  let platform = null;
  for (const node of section?.nodes ?? []) {
    if (node.type === "heading" && node.depth === 3) {
      platform = textOf(node);
      continue;
    }
    visit(node, (child) => {
      if (child.type !== "link" || !child.url) return;
      sources.push({
        platform,
        label: textOf(child) || "原始来源",
        url: String(child.url),
      });
    });
  }
  return sources;
}

function warning(code, message, { field = null, severity = "warning" } = {}) {
  return { code, message, field, severity };
}

function sampleConflictWarnings(frontmatterSample, sampleRows) {
  const warnings = [];
  const sourceMaps = {
    search_results: numericObject(frontmatterSample?.search_results),
    visible_comment_reply_nodes: numericObject(
      frontmatterSample?.visible_comment_reply_nodes,
    ),
    analysis_usable_comment_reply_units: numericObject(
      frontmatterSample?.analysis_usable_comment_reply_units,
    ),
  };

  for (const row of sampleRows) {
    const platform = String(row.platform || "");
    const key = PLATFORM_KEYS.get(platform);
    if (!key) continue;
    const comparisons = [
      ["search_results", "searchResults", "搜索结果样本"],
      ["visible_comment_reply_nodes", "visibleNodes", "可见评论 / 回复节点"],
      ["analysis_usable_comment_reply_units", "usableUnits", "纳入分析"],
    ];
    for (const [frontmatterKey, rowKey, label] of comparisons) {
      const declared = sourceMaps[frontmatterKey][key];
      const displayed = row[rowKey];
      if (declared == null || displayed == null || declared === displayed) continue;
      warnings.push(
        warning(
          "SAMPLE_DATA_CONFLICT",
          `${platform}的${label}在 Frontmatter 中为 ${declared}，正文表格中为 ${displayed}。`,
          { field: `sample.${frontmatterKey}.${key}`, severity: "error" },
        ),
      );
    }
  }
  return warnings;
}

function mapSampleRows(rows) {
  return rows.map((row) => ({
    platform: row["平台"] || null,
    role: row["角色"] || null,
    searchResults: finiteNumber(row["搜索结果样本"]),
    visibleNodes: finiteNumber(row["可见评论 / 回复节点"]),
    usableUnits: finiteNumber(row["纳入分析"]),
    purpose: row["主要用途"] || null,
  }));
}

function reportProjection(document) {
  const parsed = matter(String(document.content || ""));
  const frontmatter = parsed.data ?? {};
  const tree = unified().use(remarkParse).use(remarkGfm).parse(parsed.content);
  const sections = sectionMap(tree);
  const summary = summaryFromTree(tree);
  const sampleRows = mapSampleRows(firstTable(sections.get("样本概览")));
  const indicators = firstTable(sections.get("Workbench 可视化指标")).map(
    (row) => {
      const score = finiteNumber(row["分数"]);
      return {
        key: row.dimension_key || null,
        label: row["维度"] || null,
        score,
        rationale: row["评分依据"] || null,
        valid: Boolean(row.dimension_key && row["维度"] && score >= 1 && score <= 5),
      };
    },
  );
  const needs = firstTable(sections.get("评论区需求地图")).map((row) => ({
    cluster: row["需求簇"] || null,
    task: row["用户想完成的任务"] || null,
    evidence: row["可见证据"] || null,
    failure: row["常见失败"] || null,
    confidence: row["置信度"] || null,
  }));
  const camps = firstTable(sections.get("观点阵营")).map((row) => ({
    name: row["阵营"] || null,
    judgment: row["核心判断"] || null,
    evidence: row["代表证据"] || null,
    blindSpot: row["盲点"] || null,
  }));
  const commentReplyChains = firstTable(
    sections.get("一级评论与二级回复"),
  ).map((row) => ({
    question: row["一级评论中的问题"] || null,
    reply: row["二级回复带来的信息"] || null,
    value: row["研究价值"] || null,
  }));
  const platformDifferences = firstTable(sections.get("跨平台差异")).map(
    (row) => ({
      platform: row["平台"] || null,
      expression: row["主导表达"] || null,
      signal: row["评论区的信号"] || null,
      limitation: row["本轮局限"] || null,
    }),
  );
  const evidence = firstTable(sections.get("脱敏证据摘录")).map((row) => ({
    id: row["证据编号"] || null,
    excerpt: row["脱敏表达"] || null,
    type: row["类型"] || null,
    platform: row["所在平台"] || null,
  }));
  const frontmatterSample = frontmatter.sample ?? {};
  const warnings = [];

  const requiredFields = [
    ["title", frontmatter.title],
    ["topic", frontmatter.topic],
    ["research_question", frontmatter.research_question],
    ["captured_at", frontmatter.captured_at],
    ["primary_platform", frontmatter.primary_platform],
    ["privacy_level", frontmatter.privacy_level],
    ["sample", frontmatter.sample],
  ];
  for (const [field, value] of requiredFields) {
    if (value != null && value !== "") continue;
    warnings.push(
      warning("MISSING_REQUIRED_FIELD", `报告缺少必填字段：${field}。`, {
        field,
        severity: "error",
      }),
    );
  }
  if (Number(frontmatter.schema_version) !== SOCIAL_INSIGHT_SCHEMA_VERSION) {
    warnings.push(
      warning(
        "UNSUPPORTED_SCHEMA_VERSION",
        `当前只支持 schema_version ${SOCIAL_INSIGHT_SCHEMA_VERSION}。`,
        { field: "schema_version", severity: "error" },
      ),
    );
  }
  if (!summary) {
    warnings.push(
      warning("MISSING_SUMMARY", "报告缺少一句话结论。", {
        field: "summary",
        severity: "error",
      }),
    );
  }
  for (const title of REQUIRED_SECTIONS) {
    if (sections.has(title)) continue;
    warnings.push(
      warning("MISSING_REQUIRED_SECTION", `报告缺少章节：${title}。`, {
        field: title,
        severity: "error",
      }),
    );
  }
  for (const indicator of indicators) {
    if (indicator.valid) continue;
    warnings.push(
      warning(
        "INVALID_VISUAL_INDICATOR",
        `可视化指标“${indicator.label || indicator.key || "未命名"}”缺少有效的 1–5 分数或维度字段。`,
        { field: indicator.key || "visual_indicator" },
      ),
    );
  }
  warnings.push(...sampleConflictWarnings(frontmatterSample, sampleRows));

  const validIndicators = indicators.filter((item) => item.valid);
  const presentationReasons = [];
  if (frontmatter.privacy_level !== "deidentified") {
    presentationReasons.push("报告 privacy_level 必须为 deidentified。");
  }
  if (!summary) presentationReasons.push("缺少一句话结论。");
  if (!sampleRows.length) presentationReasons.push("缺少可解析的样本概览。");
  if (validIndicators.length < 3) {
    presentationReasons.push("至少需要三个有效可视化指标。");
  }
  if (warnings.some((item) => item.code === "SAMPLE_DATA_CONFLICT")) {
    presentationReasons.push("报告存在关键样本数据冲突。");
  }
  if (Number(frontmatter.schema_version) !== SOCIAL_INSIGHT_SCHEMA_VERSION) {
    presentationReasons.push("报告结构版本不受支持。");
  }

  const primaryPlatform = frontmatter.primary_platform
    ? String(frontmatter.primary_platform)
    : null;
  const auxiliaryPlatforms = stringList(frontmatter.auxiliary_platforms);
  const sampleTotals = {
    searchResults: sumValues(frontmatterSample.search_results),
    visibleNodes: sumValues(frontmatterSample.visible_comment_reply_nodes),
    usableUnits: sumValues(
      frontmatterSample.analysis_usable_comment_reply_units,
    ),
  };
  const title = frontmatter.title ? String(frontmatter.title) : document.title;

  return {
    id: document.id,
    sourceDocumentId: document.id,
    title,
    topic: frontmatter.topic ? String(frontmatter.topic) : null,
    question: frontmatter.research_question
      ? String(frontmatter.research_question)
      : null,
    researchType: frontmatter.research_type
      ? String(frontmatter.research_type)
      : null,
    conclusion: summary,
    capturedAt: normalizeDate(frontmatter.captured_at),
    timezone: frontmatter.timezone ? String(frontmatter.timezone) : null,
    primaryPlatform,
    auxiliaryPlatforms,
    platforms: [primaryPlatform, ...auxiliaryPlatforms].filter(Boolean),
    searchTerms: stringList(frontmatter.search_terms),
    status: frontmatter.status ? String(frontmatter.status) : null,
    privacyLevel: frontmatter.privacy_level
      ? String(frontmatter.privacy_level)
      : null,
    schemaVersion: finiteNumber(frontmatter.schema_version),
    sampleTotals,
    sampleRows,
    researchQuestionBody: sectionParagraphs(sections.get("研究问题")),
    researchQuestionItems: sectionList(sections.get("研究问题")),
    findings: findingsFromSection(sections.get("一页结论")),
    needs,
    camps,
    commentReplyChains,
    platformDifferences,
    indicators,
    validIndicators,
    questions: sectionList(sections.get("可继续验证的内容问题")),
    evidence,
    boundaries: sectionList(sections.get("证据边界与已排除内容")),
    privateSources: privateSourcesFromSection(sections.get("私有来源索引")),
    repeatResearchSuggestions: [
      ...sectionParagraphs(sections.get("后续重复研究建议")),
      ...sectionList(sections.get("后续重复研究建议")),
    ],
    parseWarnings: warnings,
    presentation: {
      eligible: presentationReasons.length === 0,
      reasons: presentationReasons,
    },
    contentHash: createHash("sha256")
      .update(String(document.content || ""), "utf8")
      .digest("hex"),
    documentUpdatedAt: document.updatedAt,
  };
}

function summaryProjection(report) {
  return {
    id: report.id,
    sourceDocumentId: report.sourceDocumentId,
    title: report.title,
    topic: report.topic,
    question: report.question,
    conclusion: report.conclusion,
    capturedAt: report.capturedAt,
    timezone: report.timezone,
    primaryPlatform: report.primaryPlatform,
    auxiliaryPlatforms: report.auxiliaryPlatforms,
    platforms: report.platforms,
    searchTerms: report.searchTerms,
    status: report.status,
    privacyLevel: report.privacyLevel,
    schemaVersion: report.schemaVersion,
    sampleTotals: report.sampleTotals,
    parseWarnings: report.parseWarnings,
    presentation: report.presentation,
    indicatorOutline: report.validIndicators.map((item) => ({
      key: item.key,
      label: item.label,
      score: item.score,
    })),
    documentUpdatedAt: report.documentUpdatedAt,
  };
}

function eligibleDocument(item) {
  return (
    item?.path?.startsWith(SOCIAL_INSIGHT_ROOT) &&
    item.extension === "md" &&
    item.type === SOCIAL_INSIGHT_TYPE
  );
}

export function parseSocialInsightDocument(document) {
  if (!document || !eligibleDocument(document)) return null;
  return reportProjection(document);
}

export function listSocialInsights(index) {
  const items = [];
  for (const document of index?.documents ?? []) {
    if (!eligibleDocument(document)) continue;
    const fullDocument = getDocument(index, document.id);
    if (!fullDocument?.content) continue;
    try {
      const report = reportProjection(fullDocument);
      items.push(summaryProjection(report));
    } catch (error) {
      items.push({
        id: document.id,
        sourceDocumentId: document.id,
        title: document.title,
        topic: document.frontmatter?.topic ?? null,
        question: document.frontmatter?.research_question ?? null,
        conclusion: null,
        capturedAt: normalizeDate(document.frontmatter?.captured_at),
        timezone: document.frontmatter?.timezone ?? null,
        primaryPlatform: document.frontmatter?.primary_platform ?? null,
        auxiliaryPlatforms: stringList(document.frontmatter?.auxiliary_platforms),
        platforms: [
          document.frontmatter?.primary_platform,
          ...stringList(document.frontmatter?.auxiliary_platforms),
        ].filter(Boolean),
        searchTerms: stringList(document.frontmatter?.search_terms),
        status: document.status,
        privacyLevel: document.frontmatter?.privacy_level ?? null,
        schemaVersion: finiteNumber(document.frontmatter?.schema_version),
        sampleTotals: {
          searchResults: null,
          visibleNodes: null,
          usableUnits: null,
        },
        parseWarnings: [
          warning("REPORT_PARSE_FAILED", "报告正文无法解析。", {
            severity: "error",
          }),
        ],
        presentation: {
          eligible: false,
          reasons: ["报告正文无法解析。"],
        },
        indicatorOutline: [],
        documentUpdatedAt: document.updatedAt,
        errorCode: error?.code || "REPORT_PARSE_FAILED",
      });
    }
  }
  items.sort((left, right) => {
    const dateDifference =
      (Date.parse(right.capturedAt || "") || 0) -
      (Date.parse(left.capturedAt || "") || 0);
    return dateDifference || left.title.localeCompare(right.title, "zh-CN");
  });
  return {
    generatedAt: index?.generatedAt ?? null,
    total: items.length,
    items,
  };
}

export function getSocialInsight(index, id) {
  const document = getDocument(index, id);
  if (!document || !eligibleDocument(document) || !document.content) return null;
  return reportProjection(document);
}

function eligibleTrendDocument(item) {
  return (
    item?.path?.startsWith(SOCIAL_INSIGHT_ROOT) &&
    item.extension === "md" &&
    item.type === SOCIAL_TREND_TYPE
  );
}

function mapTrendClusters(rows) {
  return rows.map((row) => ({
    id: row["风向编号"] || null,
    topic: row["主题"] || null,
    action: row["大家在做什么"] || null,
    trigger: row["为什么现在"] || null,
    stage: row["阶段"] || null,
    branches: row["讨论分支"] || null,
    voices: row["主要声音"] || null,
    needsAndFriction: row["需求与摩擦"] || null,
    independentSources: finiteNumber(row["独立来源数"]),
    platforms: row["覆盖平台"] || null,
    evidenceStrength: row["证据强度"] || null,
  }));
}

function trendProjection(document) {
  const parsed = matter(String(document.content || ""));
  const frontmatter = parsed.data ?? {};
  const tree = unified().use(remarkParse).use(remarkGfm).parse(parsed.content);
  const sections = sectionMap(tree);
  const summary = summaryFromTree(tree);
  const clusters = mapTrendClusters(firstTable(sections.get("风向簇")));
  const sourceCoverage = firstTable(sections.get("来源覆盖")).map((row) => ({
    sourceType: row["来源类型"] || null,
    source: row["来源 / 平台"] || row["来源/平台"] || null,
    contentSamples: finiteNumber(row["内容样本"]),
    commentReplyNodes: finiteNumber(
      row["评论 / 回复节点"] || row["评论/回复节点"],
    ),
    purpose: row["主要用途"] || null,
  }));
  const evidence = firstTable(sections.get("重点证据")).map((row) => ({
    id: row["证据编号"] || null,
    clusterId: row["风向编号"] || null,
    excerpt: row["脱敏表达"] || null,
    type: row["类型"] || null,
    source: row["来源 / 平台"] || row["来源/平台"] || null,
    publishedAt: row["发布时间"] || null,
  }));
  const warnings = [];
  const requiredFields = [
    ["title", frontmatter.title],
    ["captured_at", frontmatter.captured_at],
    ["timezone", frontmatter.timezone],
    ["time_window", frontmatter.time_window],
    ["scope", frontmatter.scope],
    ["privacy_level", frontmatter.privacy_level],
  ];
  for (const [field, value] of requiredFields) {
    if (value != null && value !== "") continue;
    warnings.push(
      warning("MISSING_REQUIRED_FIELD", `报告缺少必填字段：${field}。`, {
        field,
        severity: "error",
      }),
    );
  }
  if (Number(frontmatter.schema_version) !== SOCIAL_TREND_SCHEMA_VERSION) {
    warnings.push(
      warning(
        "UNSUPPORTED_SCHEMA_VERSION",
        `当前只支持 schema_version ${SOCIAL_TREND_SCHEMA_VERSION}。`,
        { field: "schema_version", severity: "error" },
      ),
    );
  }
  if (!summary) {
    warnings.push(
      warning("MISSING_SUMMARY", "报告缺少一句话结论。", {
        field: "summary",
        severity: "error",
      }),
    );
  }
  for (const title of REQUIRED_TREND_SECTIONS) {
    if (sections.has(title)) continue;
    warnings.push(
      warning("MISSING_REQUIRED_SECTION", `报告缺少章节：${title}。`, {
        field: title,
        severity: "error",
      }),
    );
  }
  if (!clusters.length) {
    warnings.push(
      warning("MISSING_TREND_CLUSTERS", "风向簇表格中没有可解析的条目。", {
        field: "风向簇",
        severity: "error",
      }),
    );
  }

  const timeWindow = frontmatter.time_window;
  const normalizedWindow =
    timeWindow && typeof timeWindow === "object" && !Array.isArray(timeWindow)
      ? {
          start: normalizeDate(timeWindow.start),
          end: normalizeDate(timeWindow.end),
        }
      : { start: null, end: null };
  const presentationReasons = [];
  if (frontmatter.privacy_level !== "deidentified") {
    presentationReasons.push("报告 privacy_level 必须为 deidentified。");
  }
  if (!summary) presentationReasons.push("缺少一句话结论。");
  if (!clusters.length) presentationReasons.push("缺少可解析的风向簇。");
  if (warnings.some((item) => item.severity === "error")) {
    presentationReasons.push("报告存在结构错误。");
  }

  return {
    id: document.id,
    sourceDocumentId: document.id,
    title: frontmatter.title ? String(frontmatter.title) : document.title,
    conclusion: summary,
    capturedAt: normalizeDate(frontmatter.captured_at),
    timezone: frontmatter.timezone ? String(frontmatter.timezone) : null,
    timeWindow: normalizedWindow,
    scope: frontmatter.scope ? String(frontmatter.scope) : null,
    depth: frontmatter.depth ? String(frontmatter.depth) : null,
    status: frontmatter.status ? String(frontmatter.status) : null,
    privacyLevel: frontmatter.privacy_level
      ? String(frontmatter.privacy_level)
      : null,
    schemaVersion: finiteNumber(frontmatter.schema_version),
    scanScope: [
      ...sectionParagraphs(sections.get("扫描范围")),
      ...sectionList(sections.get("扫描范围")),
    ],
    clusters,
    sourceCoverage,
    evidence,
    boundaries: sectionList(sections.get("证据边界与已排除内容")),
    privateSources: privateSourcesFromSection(sections.get("私有来源索引")),
    parseWarnings: warnings,
    presentation: {
      eligible: presentationReasons.length === 0,
      reasons: [...new Set(presentationReasons)],
    },
    contentHash: createHash("sha256")
      .update(String(document.content || ""), "utf8")
      .digest("hex"),
    documentUpdatedAt: document.updatedAt,
  };
}

function trendSummaryProjection(report) {
  return {
    id: report.id,
    sourceDocumentId: report.sourceDocumentId,
    title: report.title,
    conclusion: report.conclusion,
    capturedAt: report.capturedAt,
    timezone: report.timezone,
    timeWindow: report.timeWindow,
    scope: report.scope,
    depth: report.depth,
    status: report.status,
    privacyLevel: report.privacyLevel,
    schemaVersion: report.schemaVersion,
    clusterCount: report.clusters.length,
    clusterOutline: report.clusters.map((cluster) => ({
      id: cluster.id,
      topic: cluster.topic,
      action: cluster.action,
      stage: cluster.stage,
      evidenceStrength: cluster.evidenceStrength,
    })),
    parseWarnings: report.parseWarnings,
    presentation: report.presentation,
    documentUpdatedAt: report.documentUpdatedAt,
  };
}

export function parseSocialTrendDocument(document) {
  if (!document || !eligibleTrendDocument(document)) return null;
  return trendProjection(document);
}

export function listSocialTrends(index) {
  const items = [];
  for (const document of index?.documents ?? []) {
    if (!eligibleTrendDocument(document)) continue;
    const fullDocument = getDocument(index, document.id);
    if (!fullDocument?.content) continue;
    try {
      items.push(trendSummaryProjection(trendProjection(fullDocument)));
    } catch (error) {
      items.push({
        id: document.id,
        sourceDocumentId: document.id,
        title: document.title,
        conclusion: null,
        capturedAt: normalizeDate(document.frontmatter?.captured_at),
        timezone: document.frontmatter?.timezone ?? null,
        timeWindow: { start: null, end: null },
        scope: document.frontmatter?.scope ?? null,
        depth: document.frontmatter?.depth ?? null,
        status: document.status,
        privacyLevel: document.frontmatter?.privacy_level ?? null,
        schemaVersion: finiteNumber(document.frontmatter?.schema_version),
        clusterCount: 0,
        clusterOutline: [],
        parseWarnings: [
          warning("REPORT_PARSE_FAILED", "报告正文无法解析。", {
            severity: "error",
          }),
        ],
        presentation: { eligible: false, reasons: ["报告正文无法解析。"] },
        documentUpdatedAt: document.updatedAt,
        errorCode: error?.code || "REPORT_PARSE_FAILED",
      });
    }
  }
  items.sort((left, right) => {
    const dateDifference =
      (Date.parse(right.capturedAt || "") || 0) -
      (Date.parse(left.capturedAt || "") || 0);
    return dateDifference || left.title.localeCompare(right.title, "zh-CN");
  });
  return {
    generatedAt: index?.generatedAt ?? null,
    total: items.length,
    items,
  };
}

export function getSocialTrend(index, id) {
  const document = getDocument(index, id);
  if (!document || !eligibleTrendDocument(document) || !document.content) {
    return null;
  }
  return trendProjection(document);
}
