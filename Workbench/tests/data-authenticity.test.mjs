import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildVaultIndex } from "../server/vault-index.mjs";
import {
  fallbackDouyinWorks,
  fallbackOverview,
  fallbackSearchResults,
} from "../src/data/fallback.js";

const vaultRoot = fileURLToPath(new URL("../../个人知识库/", import.meta.url));

test("Douyin aggregates remain traceable and internally consistent", async () => {
  const stableStore = JSON.parse(await readFile(
    new URL("../../个人知识库/30_self_media/douyin/current.json", import.meta.url),
    "utf8",
  ));
  assert.equal(stableStore.schemaVersion, 1);
  assert.notEqual(stableStore.dataQuality.status, "failed");
  assert.equal(stableStore.demoMode, true);
  assert.equal(stableStore.source.kind, "synthetic-demo");

  const index = await buildVaultIndex(vaultRoot);
  const { douyin } = index;
  const worksViews = douyin.works.reduce(
    (sum, work) => sum + (Number.isFinite(work.views) ? work.views : 0),
    0,
  );
  const knownProfileVisits = douyin.works.reduce(
    (sum, work) =>
      sum + (Number.isFinite(work.profileVisits) ? work.profileVisits : 0),
    0,
  );
  const missingProfileVisits = douyin.works.filter(
    (work) => work.profileVisits == null,
  ).length;
  const monthlyViews = douyin.monthly.reduce(
    (sum, month) => sum + (Number.isFinite(month.views) ? month.views : 0),
    0,
  );
  const contentLineViews = douyin.contentLines.reduce(
    (sum, contentLine) =>
      sum + (Number.isFinite(contentLine.views) ? contentLine.views : 0),
    0,
  );
  const contentLineSaves = douyin.contentLines.reduce(
    (sum, contentLine) =>
      sum + (Number.isFinite(contentLine.saves) ? contentLine.saves : 0),
    0,
  );
  const contentLineFollowerGain = douyin.contentLines.reduce(
    (sum, contentLine) =>
      sum +
      (Number.isFinite(contentLine.followerGain)
        ? contentLine.followerGain
        : 0),
    0,
  );
  const knowledgeLine = douyin.contentLines.find((line) =>
    String(line.name ?? "").includes("知识方法"),
  );

  assert.equal(douyin.available, true);
  assert.equal(douyin.sourcePath, "30_self_media/douyin/current.json");
  assert.equal(douyin.comparableCount, douyin.works.length);
  assert.ok(douyin.comparableCount > 0);
  assert.equal(douyin.summary.totalViews, worksViews);
  assert.ok(douyin.summary.totalViews > 0);
  assert.ok(douyin.summary.totalSaves >= 0);
  assert.ok(douyin.summary.totalFollowerGain >= 0);
  assert.equal(douyin.summary.totalProfileVisits, knownProfileVisits);
  assert.equal(missingProfileVisits, 0);
  assert.equal(monthlyViews, worksViews);
  assert.equal(contentLineViews, worksViews);
  assert.equal(contentLineSaves, douyin.summary.totalSaves);
  assert.equal(
    contentLineFollowerGain,
    douyin.summary.totalFollowerGain,
  );
  assert.equal(
    douyin.works.filter((work) =>
      work.qualityFlags.includes("missing_profile_visits"),
    ).length,
    missingProfileVisits,
  );
  assert.ok(knowledgeLine);
  assert.equal(
    knowledgeLine.viewSharePct,
    Number(((knowledgeLine.views / worksViews) * 100).toFixed(2)),
  );

  assert.equal(douyin.works.some((work) => work.contentArchive), false);

  const analytics = douyin.analytics;
  assert.ok(analytics);
  assert.equal(analytics.snapshot.rootPath, "30_self_media/douyin");
  assert.equal(analytics.snapshot.isRealtime, false);
  assert.equal(analytics.snapshot.timezone, "Asia/Shanghai");
  assert.ok(analytics.account);
  assert.equal(analytics.account.daily.length, 30);
  assert.ok(analytics.account.summary.views > 0);
  assert.ok(analytics.account.summary.latestFollowerTotal > 0);
  assert.ok(analytics.account.homeSnapshot.latestPeriod.views > 0);
  assert.ok(analytics.account.contentOverview.publishedWorks > 0);
  assert.equal(analytics.coverage.deepWorkCount, douyin.works.length);
  assert.equal(analytics.coverage.totalWorkCount, douyin.works.length);
  assert.equal(analytics.coverage.historyCoveredWorks, douyin.works.length);
  assert.ok(analytics.coverage.deepFieldCount >= 20);
  assert.ok(analytics.coverage.pageOnlyRows > 0);
  assert.ok(analytics.coverage.deepWorkCount <= analytics.coverage.totalWorkCount);
  assert.ok(Array.isArray(analytics.collections));
  assert.ok(analytics.collections.length >= 1);
  assert.equal(Object.keys(analytics.workDetails).length, douyin.works.length);
  assert.ok(douyin.monthly.length >= 3);
  assert.ok(douyin.formats.length >= 2);
  assert.ok(douyin.roles.length >= 3);
  for (const work of douyin.works) {
    assert.ok(work.history.length >= 4, `${work.id} history`);
    const detail = analytics.workDetails[work.id];
    assert.ok(detail, `${work.id} detail`);
    assert.ok(detail.hourlyViews.length >= 8, `${work.id} hourly views`);
    assert.ok(detail.hourlyFollowerGain.length >= 6, `${work.id} hourly followers`);
    assert.ok(detail.dailyFollowerCumulative.length >= 7, `${work.id} daily followers`);
    assert.ok(detail.retention.length >= 5, `${work.id} retention`);
    assert.ok(detail.bounce.length >= 5, `${work.id} bounce`);
    assert.ok(detail.trafficSources.length >= 4, `${work.id} traffic sources`);
    assert.ok(detail.pageEvidence.incomingSearchTerms.length >= 3, `${work.id} search terms`);
    assert.ok(detail.pageEvidence.geography.length >= 4, `${work.id} geography`);
    assert.ok(detail.pageEvidence.interests.length >= 4, `${work.id} interests`);
    assert.ok(detail.pageEvidence.commentKeywords.length >= 4, `${work.id} comments`);
    assert.deepEqual(detail.pageEvidence.missingFields, []);
  }
  assert.equal(
    new Set(
      Object.values(analytics.workDetails).map((detail) => detail.platformWorkId),
    ).size,
    Object.values(analytics.workDetails).length,
  );
  assert.ok(
    analytics.coverage.assets.every(
      (asset) =>
        asset.sourcePath === null ||
        asset.sourcePath.startsWith("30_self_media/douyin/"),
    ),
  );
  assert.equal(JSON.stringify(douyin).includes("creator-collector"), false);
  assert.equal(JSON.stringify(douyin).includes("synthetic_demo"), true);
});

test("Douyin template exposes every full-demo contract branch without demo values", async () => {
  const template = JSON.parse(await readFile(
    new URL("../templates/douyin/current.template.json", import.meta.url),
    "utf8",
  ));
  const analytics = template.douyin.analytics;
  const detail = analytics.workDetails["local-work-id"];

  assert.equal(template.demoMode, false);
  assert.equal(template.source.kind, "authorized-local-export");
  assert.equal(template.douyin.sourcePath, "30_self_media/douyin/current.json");
  assert.ok(Array.isArray(analytics.account.daily));
  assert.ok(analytics.account.daily[0]);
  assert.ok(analytics.account.homeSnapshot);
  assert.ok(analytics.account.contentOverview);
  assert.ok(analytics.collections[0]);
  assert.ok(detail);
  assert.ok(detail.metrics);
  assert.ok(detail.hourlyViews[0]);
  assert.ok(detail.retention[0]);
  assert.ok(detail.bounce[0]);
  assert.ok(detail.trafficSources[0]);
  assert.ok(detail.pageEvidence.incomingSearchTerms[0]);
  assert.ok(detail.pageEvidence.commentKeywords[0]);
});

test("runtime fallbacks contain no business or identity fixtures", () => {
  assert.deepEqual(fallbackSearchResults, []);
  assert.deepEqual(fallbackDouyinWorks, []);
  assert.deepEqual(fallbackOverview.recent, []);
  assert.deepEqual(fallbackOverview.activity, []);
  assert.deepEqual(fallbackOverview.douyinTrend, []);
  assert.equal(fallbackOverview.douyinAvailable, false);
  for (const value of Object.values(fallbackOverview.metrics)) {
    assert.ok(value === null || value === false);
  }
});

test("product source excludes the rejected visual-reference fixtures", async () => {
  const paths = [
    "../src/components/AppShell.jsx",
    "../src/components/ActivityTimeline.jsx",
    "../src/components/DouyinAnalyticsDashboard.jsx",
    "../src/components/DouyinPulse.jsx",
    "../src/pages/OverviewPage.jsx",
    "../src/pages/DouyinPage.jsx",
    "../src/pages/WorkflowPage.jsx",
    "../src/data/fallback.js",
    "../server/vite-plugin-workbench.mjs",
  ];
  const source = (
    await Promise.all(
      paths.map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    )
  ).join("\n");
  const rejectedFixtures = [
    "林澈",
    "812.4 GB",
    "2 TB",
    "18.72",
    "9.31",
    "12.64",
    "25,364",
    "160,400",
    "近 7 天",
    "如何建立长期写作习惯",
    "一周阅读复盘",
  ];

  for (const fixture of rejectedFixtures) {
    assert.equal(source.includes(fixture), false, `rejected fixture: ${fixture}`);
  }
  assert.equal(source.includes('useState("把个人知识库变成可复用的学习系统")'), false);
  assert.equal(source.includes('useState("正在用 Obsidian，但资料越存越多的人")'), false);
});
