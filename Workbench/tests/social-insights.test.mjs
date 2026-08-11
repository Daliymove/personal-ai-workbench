import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  listSocialTrends,
  parseSocialInsightDocument,
  parseSocialTrendDocument,
} from "../server/social-insights.mjs";
import { buildVaultIndex } from "../server/vault-index.mjs";

const REPORT_PATH = new URL(
  "../../个人知识库/10_raw/social-insights/20260120-公开示例/社媒话题研究.md",
  import.meta.url,
);
const EXAMPLE_VAULT_PATH = new URL("../../个人知识库/", import.meta.url);

function reportDocument(content, overrides = {}) {
  return {
    id: "report-1",
    path: "10_raw/social-insights/20260120-公开示例/社媒话题研究.md",
    extension: "md",
    type: "social-insight-report",
    title: "公开示例：本地知识工作",
    updatedAt: "2026-01-20T00:00:00.000Z",
    content,
    ...overrides,
  };
}

test("parses the synthetic public social insight report into one auditable projection", async () => {
  const content = await readFile(REPORT_PATH, "utf8");
  const report = parseSocialInsightDocument(reportDocument(content));

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.primaryPlatform, "小红书");
  assert.deepEqual(report.auxiliaryPlatforms, ["知乎"]);
  assert.deepEqual(report.sampleTotals, {
    searchResults: 8,
    visibleNodes: 13,
    usableUnits: 10,
  });
  assert.equal(report.sampleRows.length, 2);
  assert.equal(report.findings.length, 3);
  assert.equal(report.needs.length, 2);
  assert.equal(report.camps.length, 2);
  assert.equal(report.commentReplyChains.length, 2);
  assert.equal(report.platformDifferences.length, 2);
  assert.equal(report.validIndicators.length, 3);
  assert.equal(report.evidence.length, 3);
  assert.equal(report.privateSources.length, 0);
  assert.equal(report.presentation.eligible, true);
  assert.equal(
    report.parseWarnings.some((item) => item.severity === "error"),
    false,
  );
});

test("example Vault contains two eligible synthetic trend snapshots", async () => {
  const index = await buildVaultIndex(fileURLToPath(EXAMPLE_VAULT_PATH));
  const trends = listSocialTrends(index);

  assert.equal(trends.total, 2);
  assert.ok(trends.items.every((item) => item.presentation.eligible));
  assert.ok(trends.items.every((item) => item.clusterCount === 3));
  assert.ok(trends.items.every((item) => item.privacyLevel === "deidentified"));
  assert.match(trends.items[0].title, /公开示例/);
});

test("fails the presentation gate when privacy or visual evidence is insufficient", () => {
  const content = `---
type: social-insight-report
schema_version: 1
status: needs-review
title: 测试报告
topic: 测试
research_question: 测试问题
captured_at: 2026-08-02
primary_platform: 小红书
privacy_level: private
sample:
  search_results:
    xiaohongshu: 1
---

# 测试报告

> [!summary] 一句话结论
> 只用于测试。

## 样本概览

| 平台 | 角色 | 搜索结果样本 | 可见评论 / 回复节点 | 纳入分析 | 主要用途 |
|---|---|---:|---:|---:|---|
| 小红书 | 主平台 | 2 | 1 | 1 | 测试 |

## 一页结论
### 结论
测试。

## 评论区需求地图
| 需求簇 | 用户想完成的任务 | 可见证据 | 常见失败 | 置信度 |
|---|---|---|---|---|
| 测试 | 测试 | 测试 | 测试 | 中 |

## 跨平台差异
| 平台 | 主导表达 | 评论区的信号 | 本轮局限 |
|---|---|---|---|
| 小红书 | 测试 | 测试 | 测试 |

## Workbench 可视化指标
| dimension_key | 维度 | 分数 | 评分依据 |
|---|---|---:|---|
| attention | 关注强度 | 5 | 测试 |

## 脱敏证据摘录
| 证据编号 | 脱敏表达 | 类型 | 所在平台 |
|---|---|---|---|
| E01 | 测试 | 测试 | 小红书 |

## 证据边界与已排除内容
- 测试。
`;

  const report = parseSocialInsightDocument(reportDocument(content));
  assert.equal(report.presentation.eligible, false);
  assert.match(report.presentation.reasons.join(" "), /deidentified/);
  assert.match(report.presentation.reasons.join(" "), /三个有效可视化指标/);
  assert.equal(
    report.parseWarnings.some((item) => item.code === "SAMPLE_DATA_CONFLICT"),
    true,
  );
});

test("ignores markdown outside the dedicated report root", () => {
  const report = parseSocialInsightDocument(
    reportDocument("# Not a report", {
      path: "10_raw/web-search/not-a-report.md",
    }),
  );
  assert.equal(report, null);
});

test("parses a trend scan as clusters while keeping private sources separate", () => {
  const content = `---
type: social-trend-report
schema_version: 1
status: complete
title: 最近 7 天 AI 风向扫描
captured_at: 2026-08-04T18:00:00+08:00
timezone: Asia/Shanghai
time_window:
  start: 2026-07-29
  end: 2026-08-04
scope: AI
depth: standard
privacy_level: deidentified
---

# 最近 7 天 AI 风向扫描

> [!summary] 一句话结论
> 多个团队正在把 Agent 从演示推进到可复查的日常任务。

## 扫描范围
- 最近 7 天，覆盖官方、新闻和社媒。

## 风向簇
| 风向编号 | 主题 | 大家在做什么 | 为什么现在 | 阶段 | 讨论分支 | 主要声音 | 需求与摩擦 | 独立来源数 | 覆盖平台 | 证据强度 |
|---|---|---|---|---|---|---|---|---:|---|---|
| T01 | Agent 工作台 | 把重复任务放进本地 Agent | 新工具集中发布 | 扩散 | 部署；权限 | 支持；条件支持 | 登录态；可审计 | 4 | 小红书 / X / 新闻 | 高 |

## 来源覆盖
| 来源类型 | 来源 / 平台 | 内容样本 | 评论 / 回复节点 | 主要用途 |
|---|---|---:|---:|---|
| 社媒 | 小红书 / X | 8 | 21 | 行动与摩擦 |

## 重点证据
| 证据编号 | 风向编号 | 脱敏表达 | 类型 | 来源 / 平台 | 发布时间 |
|---|---|---|---|---|---|
| E01 | T01 | 用户把每日报表改成本地 Agent 执行。 | 实践 | 小红书 | 2026-08-03 |

## 证据边界与已排除内容
- 搜索排序不是概率抽样。

## 私有来源索引
### 小红书
- [复查链接](https://example.test/private)
`;
  const report = parseSocialTrendDocument(
    reportDocument(content, {
      id: "trend-1",
      type: "social-trend-report",
      path: "10_raw/social-insights/20260804-AI风向扫描/近期风向.md",
    }),
  );

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.clusters.length, 1);
  assert.equal(report.clusters[0].independentSources, 4);
  assert.equal(report.sourceCoverage[0].commentReplyNodes, 21);
  assert.equal(report.privateSources.length, 1);
  assert.deepEqual(report.timeWindow, {
    start: "2026-07-29",
    end: "2026-08-04",
  });
  assert.equal(report.presentation.eligible, true);
});
