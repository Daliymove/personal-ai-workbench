import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildSocialResearchHandoff,
  filterSocialInsights,
  presentationProjection,
} from "../src/lib/social-insights.js";
import {
  buildSocialInsightStandaloneHtml,
  buildSocialTrendStandaloneHtml,
  standaloneSocialHtmlFilename,
} from "../src/lib/social-insights-html.js";

const reports = [
  {
    title: "个人工作台",
    topic: "个人工作台",
    question: "为什么会留下来？",
    primaryPlatform: "小红书",
    auxiliaryPlatforms: ["抖音", "微博"],
    status: "complete",
    capturedAt: "2026-08-02",
  },
  {
    title: "另一个研究",
    topic: "别的话题",
    question: "发生了什么？",
    primaryPlatform: "知乎",
    auxiliaryPlatforms: ["微博"],
    status: "needs-review",
    capturedAt: "2026-04-01",
  },
];

test("filters reports without manufacturing missing metadata", () => {
  const result = filterSocialInsights(
    reports,
    {
      query: "留下来",
      primaryPlatform: "小红书",
      auxiliaryPlatform: "抖音",
      status: "complete",
      dateRange: "30",
    },
    new Date("2026-08-02T12:00:00+08:00"),
  );
  assert.deepEqual(result.map((item) => item.title), ["个人工作台"]);
});

test("presentation projection cannot carry private source links or Vault paths", () => {
  const projection = presentationProjection({
    ...reports[0],
    conclusion: "结论",
    privateSources: [{ url: "https://example.test/private" }],
    sourceDocumentId: "private-document-id",
    path: "10_raw/social-insights/private.md",
  });
  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes("example.test"), false);
  assert.equal(serialized.includes("10_raw"), false);
  assert.equal(serialized.includes("private-document-id"), false);
});

test("exports a topic archive as one self-contained HTML document without local path data", () => {
  const html = buildSocialInsightStandaloneHtml({
    ...reports[0],
    conclusion: "真正的需求是完成一个反复任务。",
    sampleTotals: { searchResults: 12, visibleNodes: 8, usableUnits: 6 },
    findings: [{ title: "需求先于界面", body: ["先确认任务，再决定工具。"] }],
    needs: [],
    camps: [],
    commentReplyChains: [],
    platformDifferences: [],
    validIndicators: [],
    evidence: [{ id: "E01", excerpt: "脱敏证据", type: "反馈", platform: "小红书" }],
    sampleRows: [],
    boundaries: ["单次横截面。"],
    privateSources: [{ url: "https://example.test/private" }],
    sourceDocumentId: "private-document-id",
    path: "10_raw/social-insights/private.md",
  });

  assert.match(html, /^<!doctype html>/);
  assert.match(html, /需求先于界面/);
  assert.match(html, /脱敏证据/);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<link\b|<script\b[^>]*\bsrc=/i);
  assert.doesNotMatch(html, /\/api\/|10_raw|private-document-id|example\.test/);
});

test("exports a trend snapshot without Vault identifiers or runtime dependencies", () => {
  const html = buildSocialTrendStandaloneHtml({
    title: "内部标题",
    conclusion: "当前风向以真实行动为主。",
    capturedAt: "2026-08-04",
    scope: "AI",
    depth: "standard",
    timeWindow: { start: "2026-07-29", end: "2026-08-04" },
    clusters: [{ id: "T01", topic: "本地 Agent", action: "开始处理真实任务", platforms: "小红书 / X" }],
    sourceCoverage: [{ sourceType: "社媒", source: "小红书", contentSamples: 3, commentReplyNodes: 5 }],
    evidence: [{ id: "E01", clusterId: "T01", excerpt: "一条脱敏证据", source: "小红书" }],
    scanScope: ["最近 7 天。"],
    boundaries: ["不是概率抽样。"],
    privateSources: [{ url: "https://example.test/private" }],
    sourceDocumentId: "vault-document-id",
  }, { title: "近 7 天，大家在聊哪些 AI 话题", intro: "本期导读" });

  assert.match(html, /近 7 天，大家在聊哪些 AI 话题/);
  assert.match(html, /本地 Agent/);
  assert.match(html, /独立副本说明/);
  assert.doesNotMatch(html, /\/api\/|vault-document-id|example\.test|sourceDocumentId/);
  assert.equal(standaloneSocialHtmlFilename("近期风向", "AI / Agent?", "2026-08-04"), "近期风向-AI-Agent-20260804.html");
});

test("builds an explicit active handoff for a trend scan", () => {
  const prompt = buildSocialResearchHandoff({
    mode: "trend-scan",
    scope: "AI Agent",
    timeWindow: "7d",
    depth: "standard",
  });
  assert.match(prompt, /\$research-social-insights/);
  assert.match(prompt, /`trend-scan`/);
  assert.match(prompt, /AI Agent/);
  assert.match(prompt, /只生成该模式的脱敏 Raw 报告/);
  assert.match(prompt, /按 Skill 当前的来源策略/);
  assert.doesNotMatch(prompt, /必须把 X 作为一级来源|X 的技术圈|Ego Lite/);
  assert.doesNotMatch(prompt, /普通人最近在尝试、模仿、抱怨、放弃或持续使用/);
});

test("builds a topic handoff without claiming it has been sent", () => {
  const prompt = buildSocialResearchHandoff({
    mode: "topic-deep-dive",
    topic: "个人 AI 工作台",
    question: "为什么做完后弃用？",
    timeWindow: "30d",
    depth: "deep",
  });
  assert.match(prompt, /`topic-deep-dive`/);
  assert.match(prompt, /个人 AI 工作台/);
  assert.match(prompt, /为什么做完后弃用/);
  assert.match(prompt, /只生成该模式的脱敏 Raw 报告/);
  assert.match(prompt, /按 Skill 当前的来源策略/);
  assert.doesNotMatch(prompt, /主题在 X 有实质性讨论|X 技术圈|Ego Lite/);
  assert.doesNotMatch(prompt, /已经提交|已经运行|已经生成/);
});

test("keeps trend snapshots in a list and exposes local originals on detail", async () => {
  const [pageSource, appSource, cssSource] = await Promise.all([
    readFile(new URL("../src/pages/SocialInsightsPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/social-insights/social-insights.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /className="social-trend-index__list"/);
  assert.ok(pageSource.includes('to={`/social-insights/trends/${encodeURIComponent(report.id)}`}'));
  assert.match(pageSource, /className="social-trend-originals"/);
  assert.match(pageSource, /导出当前近期风向为独立 HTML/);
  assert.match(pageSource, /导出当前主题档案为独立 HTML/);
  assert.match(pageSource, /href={source\.url}/);
  assert.match(pageSource, /readerFacingTrendTitle\(report\.title\)/);
  assert.match(pageSource, /trendHeroTitle\(report\)/);
  assert.match(pageSource, /trendHeroIntro\(report\)/);
  assert.match(pageSource, /className="social-trend-editorial-hero__brief"/);
  assert.match(pageSource, /<ReadableTrendText value={cluster\.voices}/);
  assert.match(pageSource, />大家最近在聊什么<\/h2>/);
  assert.match(cssSource, /\.social-trend-editorial-hero \{[\s\S]*?background: transparent/);
  assert.doesNotMatch(pageSource, /<h1>{report\.title \|\| "未提供标题"}<\/h1>/);
  assert.match(appSource, /path="\/social-insights\/trends\/:trendId"/);
  assert.doesNotMatch(pageSource, /function TrendReport\(/);
});
