import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const knowledgeVaultRoot = path.resolve(repoRoot, "..", "个人知识库");
const demoPath = path.join(knowledgeVaultRoot, "30_self_media/douyin/current.json");
const templatePath = path.join(repoRoot, "templates/douyin/current.template.json");

const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
const rate = (value, total) => (total ? round((value / total) * 100) : null);
const median = (values) => {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : round((ordered[middle - 1] + ordered[middle]) / 2);
};
const weighted = (rows, key) => {
  const total = sum(rows, "views");
  return total
    ? round(rows.reduce((result, row) => result + row.views * row[key], 0) / total)
    : null;
};

function isoAt(publishedAt, hours) {
  const date = new Date(`${publishedAt.replace(" ", "T")}+08:00`);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const seeds = [
  ["2025-11-08 10:00:00", "先别总结，先把证据留住", "知识方法", "概念解释", "1min以下视频", 6400, 34],
  ["2025-11-22 10:00:00", "一条旧笔记怎样重新帮上忙", "知识方法", "案例演示", "1-5min视频", 9200, 58],
  ["2025-12-06 10:00:00", "我把会议记录变成行动清单", "工作流实践", "工作流演示", "1-5min视频", 14800, 72],
  ["2025-12-20 10:00:00", "本地 AI 工作台的三个暂停点", "本地工具", "工具演示", "1-5min视频", 11800, 66],
  ["2026-01-03 10:00:00", "用一份旧资料完成新的研究提纲", "工作流实践", "案例演示", "1-5min视频", 18000, 78],
  ["2026-01-10 10:00:00", "Raw 和 Wiki 到底有什么区别", "知识方法", "概念解释", "1min以下视频", 12600, 46],
  ["2026-01-17 10:00:00", "本地工作台怎样读取 Markdown", "本地工具", "工具演示", "1-5min视频", 9800, 64],
  ["2026-01-24 10:00:00", "开源个人系统前我检查了什么", "本地工具", "隐私边界", "1-5min视频", 15600, 70],
];

const works = seeds.map(([publishedAt, title, contentLine, contentRole, format, views, duration], index) => {
  const factor = index + 1;
  const likes = Math.round(views * (0.047 + (factor % 3) * 0.004));
  const shares = Math.round(views * (0.007 + (factor % 2) * 0.002));
  const comments = Math.round(views * (0.0045 + (factor % 4) * 0.0007));
  const saves = Math.round(views * (0.032 + (factor % 3) * 0.004));
  const profileVisits = Math.round(views * (0.016 + (factor % 2) * 0.003));
  const followerGain = Math.round(views * (0.0035 + (factor % 3) * 0.0005));
  const completionRatePct = round(14.5 + (factor % 5) * 1.7);
  const fiveSecondCompletionRatePct = round(39 + (factor % 5) * 2.1);
  const twoSecondBounceRatePct = round(36 - (factor % 5) * 1.4);
  const averageWatchSeconds = round(duration * (0.38 + (factor % 4) * 0.025));
  const coverClickRatePct = round(4.8 + (factor % 4) * 0.7);
  const engagements = likes + shares + comments + saves;
  const id = `demo-work-${String(factor).padStart(3, "0")}`;
  const platformWorkId = `synthetic-${String(factor).padStart(3, "0")}`;
  const fractions = [0.12, 0.48, 0.78, 1];
  const captureHours = [2, 24, 72, 168];
  const history = fractions.map((fraction, historyIndex) => ({
    capturedAt: isoAt(publishedAt, captureHours[historyIndex]),
    views: Math.round(views * fraction),
    likes: Math.round(likes * fraction),
    comments: Math.round(comments * fraction),
    shares: Math.round(shares * fraction),
    saves: Math.round(saves * fraction),
    followerGain: Math.round(followerGain * fraction),
    sourcePath: `30_self_media/douyin/synthetic/history/${platformWorkId}.json`,
  }));
  return {
    id,
    platformWorkId,
    rowNumber: factor,
    publishedAt,
    title,
    format,
    reviewStatus: "公开",
    durationSeconds: duration,
    views,
    likes,
    shares,
    comments,
    saves,
    engagements,
    profileVisits,
    profileVisitsIsLowerBound: false,
    followerGain,
    completionRatePct,
    fiveSecondCompletionRatePct,
    twoSecondBounceRatePct,
    averageWatchSeconds,
    likeRatePct: rate(likes, views),
    shareRatePct: rate(shares, views),
    commentRatePct: rate(comments, views),
    saveRatePct: rate(saves, views),
    engagementRatePct: rate(engagements, views),
    profileVisitRatePct: rate(profileVisits, views),
    followerGainRatePct: rate(followerGain, views),
    coverClickRatePct,
    contentLine,
    contentRole,
    history,
    qualityFlags: ["synthetic_demo"],
  };
});

function aggregate(rows, name) {
  const views = sum(rows, "views");
  const saves = sum(rows, "saves");
  const profileVisits = sum(rows, "profileVisits");
  const followerGain = sum(rows, "followerGain");
  return {
    name,
    workCount: rows.length,
    views,
    viewSharePct: rate(views, sum(works, "views")),
    medianViews: median(rows.map((row) => row.views)),
    saves,
    saveRatePct: rate(saves, views),
    profileVisits,
    profileVisitsIsLowerBound: false,
    profileVisitRatePct: rate(profileVisits, views),
    followerGain,
    followerGainRatePct: rate(followerGain, views),
    weightedCompletionRatePct: weighted(rows, "completionRatePct"),
    weightedFiveSecondCompletionRatePct: weighted(rows, "fiveSecondCompletionRatePct"),
    weightedTwoSecondBounceRatePct: weighted(rows, "twoSecondBounceRatePct"),
    weightedAverageWatchSeconds: weighted(rows, "averageWatchSeconds"),
  };
}

function groupedAggregates(key) {
  const groups = new Map();
  for (const work of works) {
    const name = work[key];
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(work);
  }
  return [...groups.entries()].map(([name, rows]) => aggregate(rows, name));
}

const monthly = groupedAggregates("publishedAt").length ? [...new Set(works.map((work) => work.publishedAt.slice(0, 7)))].map((month) => {
  const rows = works.filter((work) => work.publishedAt.startsWith(month));
  return {
    month,
    workCount: rows.length,
    views: sum(rows, "views"),
    likes: sum(rows, "likes"),
    shares: sum(rows, "shares"),
    comments: sum(rows, "comments"),
    saves: sum(rows, "saves"),
    profileVisits: sum(rows, "profileVisits"),
    profileVisitsIsLowerBound: false,
    followerGain: sum(rows, "followerGain"),
    weightedCompletionRatePct: weighted(rows, "completionRatePct"),
    weightedFiveSecondCompletionRatePct: weighted(rows, "fiveSecondCompletionRatePct"),
    weightedTwoSecondBounceRatePct: weighted(rows, "twoSecondBounceRatePct"),
    weightedAverageWatchSeconds: weighted(rows, "averageWatchSeconds"),
  };
}) : [];

function makeHourly(work, key, points, coveredFraction) {
  let cumulative = 0;
  return Array.from({ length: points }, (_, index) => {
    const curve = 1.7 - index * 0.075 + ((index + work.rowNumber) % 3) * 0.08;
    const remaining = Math.round(work[key] * coveredFraction) - cumulative;
    const value = index === points - 1
      ? Math.max(remaining, 0)
      : Math.max(Math.round((work[key] * coveredFraction * curve) / (points * 1.25)), 0);
    cumulative += value;
    return { date: isoAt(work.publishedAt, index), value, cumulative };
  });
}

function makeRanked(names, values) {
  return names.map((name, index) => ({ rank: index + 1, name, sharePct: values[index] }));
}

function makeDetail(work) {
  const index = work.rowNumber;
  const baseRetention = work.fiveSecondCompletionRatePct + 49;
  const retention = [0, 2, 5, 10, 20, 30, 45, 60, work.durationSeconds]
    .filter((value, itemIndex, rows) => value <= work.durationSeconds && rows.indexOf(value) === itemIndex)
    .map((seconds, pointIndex) => ({
      time: `${seconds}s`,
      valuePct: round(Math.max(100 - pointIndex * (8.5 + (index % 3)), work.completionRatePct)),
      peerPct: round(Math.max(98 - pointIndex * 9.2, 15)),
    }));
  const bounce = retention.map((row, pointIndex) => ({
    time: row.time,
    valuePct: round(Math.min(100 - row.valuePct + pointIndex * 0.7, 92)),
    peerPct: round(Math.min(100 - row.peerPct + pointIndex * 0.5, 94)),
  }));
  const progress = retention.map((row, pointIndex) => ({
    time: row.time,
    skipRatePct: bounce[pointIndex].valuePct,
    rewatchRatePct: round(3 + ((pointIndex + index) % 4) * 1.3),
  }));
  const dailyFollowerCumulative = Array.from({ length: 7 }, (_, dayIndex) => ({
    date: addDays(work.publishedAt.slice(0, 10), dayIndex),
    value: Math.round(work.followerGain * ((dayIndex + 1) / 7)),
    douyin: Math.round(work.followerGain * ((dayIndex + 1) / 7) * 0.88),
    douyinFeatured: Math.round(work.followerGain * ((dayIndex + 1) / 7) * 0.12),
  }));
  return {
    platformWorkId: work.platformWorkId,
    capturedAt: "2026-01-31T20:30:00+08:00",
    sourceKind: "synthetic-demo",
    sourcePaths: [
      `30_self_media/douyin/synthetic/deep/${work.platformWorkId}/metrics.json`,
      `30_self_media/douyin/synthetic/deep/${work.platformWorkId}/audience.json`,
    ],
    metrics: {
      views: work.views,
      likes: work.likes,
      shares: work.shares,
      comments: work.comments,
      saves: work.saves,
      followerGain: work.followerGain,
      completionRatePct: work.completionRatePct,
      fiveSecondCompletionRatePct: work.fiveSecondCompletionRatePct,
      twoSecondBounceRatePct: work.twoSecondBounceRatePct,
      averageWatchSeconds: work.averageWatchSeconds,
      averageWatchSharePct: rate(work.averageWatchSeconds, work.durationSeconds),
      coverClickRatePct: work.coverClickRatePct,
      saveRatePct: work.saveRatePct,
      followerGainRatePct: work.followerGainRatePct,
      notInterested: Math.round(work.views * 0.0014),
    },
    hourlyViews: makeHourly(work, "views", 12, 0.72),
    hourlyFollowerGain: makeHourly(work, "followerGain", 8, 0.7),
    dailyFollowerCumulative,
    progress,
    retention,
    bounce,
    trafficSources: [
      { name: "推荐页", sharePct: 63, comparedWithSevenDaysPct: 4.2, comparisonRaw: "+4.2%" },
      { name: "搜索", sharePct: 16, comparedWithSevenDaysPct: 2.1, comparisonRaw: "+2.1%" },
      { name: "主页", sharePct: 9, comparedWithSevenDaysPct: -0.8, comparisonRaw: "-0.8%" },
      { name: "关注", sharePct: 7, comparedWithSevenDaysPct: 0.4, comparisonRaw: "+0.4%" },
      { name: "其他", sharePct: 5, comparedWithSevenDaysPct: -1.2, comparisonRaw: "-1.2%" },
    ],
    pageEvidence: {
      chapters: [
        { rank: 1, time: "00:00", name: "问题与结果", clickRatePct: 42 },
        { rank: 2, time: "00:18", name: "实际演示", clickRatePct: 35 },
        { rank: 3, time: "00:42", name: "边界与下一步", clickRatePct: 23 },
      ],
      incomingSearchTerms: makeRanked(["个人工作台", "本地知识库", "AI 工作流"], [38, 34, 28]),
      postWatchSearchTerms: makeRanked(["Markdown 工作台", "知识库怎么搭", "本地 Agent"], [41, 33, 26]),
      geography: [
        { name: "华东示例区", sharePct: 29 },
        { name: "华南示例区", sharePct: 23 },
        { name: "华北示例区", sharePct: 21 },
        { name: "西南示例区", sharePct: 16 },
        { name: "其他示例区", sharePct: 11 },
      ],
      interests: [
        { name: "软件工具", sharePct: 32 },
        { name: "学习方法", sharePct: 26 },
        { name: "职场效率", sharePct: 23 },
        { name: "内容创作", sharePct: 19 },
      ],
      audienceHotWords: [
        { name: "知识库", heat: 92, heatRaw: "92" },
        { name: "工作流", heat: 84, heatRaw: "84" },
        { name: "本地", heat: 76, heatRaw: "76" },
        { name: "自动化", heat: 68, heatRaw: "68" },
      ],
      commentKeywords: [
        { rank: 1, name: "怎么安装" },
        { rank: 2, name: "能否开源" },
        { rank: 3, name: "数据安全" },
        { rank: 4, name: "目录模板" },
        { rank: 5, name: "完整教程" },
      ],
      missingFields: [],
    },
  };
}

const workDetails = Object.fromEntries(works.map((work) => [work.id, makeDetail(work)]));

let followerTotal = 2380;
const accountDaily = Array.from({ length: 30 }, (_, index) => {
  const date = addDays("2026-01-02", index);
  const netFollowerGain = 7 + (index % 5) * 2 + (index % 3);
  const followersLost = 2 + (index % 3);
  const followersGained = netFollowerGain + followersLost;
  followerTotal += netFollowerGain;
  return {
    date,
    posts: [2, 9, 16, 23].includes(index) ? 1 : 0,
    views: 2100 + ((index * 733) % 3100),
    likes: 110 + ((index * 37) % 190),
    comments: 18 + ((index * 11) % 43),
    fiveSecondCompletionRatePct: round(40 + (index % 7) * 1.15),
    twoSecondBounceRatePct: round(35 - (index % 6) * 0.8),
    coverClickRatePct: round(5.2 + (index % 5) * 0.45),
    averageWatchSeconds: round(23 + (index % 8) * 1.1),
    totalFollowers: followerTotal,
    netFollowerGain,
    followersGained,
    followersLost,
    returningFollowers: 48 + ((index * 13) % 72),
  };
});

const accountSummary = {
  from: accountDaily[0].date,
  to: accountDaily.at(-1).date,
  dayCount: accountDaily.length,
  posts: sum(accountDaily, "posts"),
  views: sum(accountDaily, "views"),
  likes: sum(accountDaily, "likes"),
  comments: sum(accountDaily, "comments"),
  netFollowerGain: sum(accountDaily, "netFollowerGain"),
  followersGained: sum(accountDaily, "followersGained"),
  followersLost: sum(accountDaily, "followersLost"),
  returningFollowers: sum(accountDaily, "returningFollowers"),
  latestFollowerTotal: accountDaily.at(-1).totalFollowers,
};

const summary = {
  workCount: works.length,
  totalViews: sum(works, "views"),
  medianViews: median(works.map((work) => work.views)),
  averageViews: round(sum(works, "views") / works.length),
  totalLikes: sum(works, "likes"),
  totalShares: sum(works, "shares"),
  totalComments: sum(works, "comments"),
  totalSaves: sum(works, "saves"),
  totalEngagements: sum(works, "engagements"),
  totalProfileVisits: sum(works, "profileVisits"),
  totalFollowerGain: sum(works, "followerGain"),
  weightedCompletionRatePct: weighted(works, "completionRatePct"),
  weightedFiveSecondCompletionRatePct: weighted(works, "fiveSecondCompletionRatePct"),
  weightedTwoSecondBounceRatePct: weighted(works, "twoSecondBounceRatePct"),
  weightedAverageWatchSeconds: weighted(works, "averageWatchSeconds"),
};
Object.assign(summary, {
  likeRatePct: rate(summary.totalLikes, summary.totalViews),
  shareRatePct: rate(summary.totalShares, summary.totalViews),
  commentRatePct: rate(summary.totalComments, summary.totalViews),
  saveRatePct: rate(summary.totalSaves, summary.totalViews),
  profileVisitRatePct: rate(summary.totalProfileVisits, summary.totalViews),
  followerGainRatePct: rate(summary.totalFollowerGain, summary.totalViews),
  engagementRatePct: rate(summary.totalEngagements, summary.totalViews),
});

const detailRows = Object.values(workDetails).reduce((total, detail) => total + [
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
].reduce((subtotal, rows) => subtotal + rows.length, 0), 0);
const pageRows = Object.values(workDetails).reduce((total, detail) => total + [
  detail.pageEvidence.chapters,
  detail.pageEvidence.incomingSearchTerms,
  detail.pageEvidence.postWatchSearchTerms,
  detail.pageEvidence.geography,
  detail.pageEvidence.interests,
  detail.pageEvidence.audienceHotWords,
  detail.pageEvidence.commentKeywords,
].reduce((subtotal, rows) => subtotal + rows.length, 0), 0);

const store = {
  schemaVersion: 1,
  demoMode: true,
  capturedAt: "2026-01-31T20:30:00+08:00",
  generatedAt: "2026-01-31T20:35:00+08:00",
  timezone: "Asia/Shanghai",
  source: { kind: "synthetic-demo", label: "Complete synthetic Douyin dataset" },
  dataQuality: {
    status: "passed",
    issues: [],
    notice: "All titles, ids, dates, paths and metrics are deterministic fictional demo data.",
  },
  files: [
    { id: "account-content-daily", path: "30_self_media/douyin/synthetic/account-content-daily.csv", rowCount: 30 },
    { id: "account-follower-daily", path: "30_self_media/douyin/synthetic/account-follower-daily.csv", rowCount: 30 },
    { id: "all-works", path: "30_self_media/douyin/synthetic/all-works.csv", rowCount: works.length },
    { id: "content-analysis", path: "30_self_media/douyin/synthetic/content-overview.csv", rowCount: 1 },
    { id: "collections", path: "30_self_media/douyin/synthetic/collections.csv", rowCount: 2 },
    { id: "deep-work", path: "30_self_media/douyin/synthetic/deep/", rowCount: detailRows },
    { id: "page-evidence", path: "30_self_media/douyin/synthetic/page-evidence/", rowCount: pageRows },
  ],
  history: { snapshotCount: 4 },
  douyin: {
    available: true,
    demoMode: true,
    sourcePath: "30_self_media/douyin/current.json",
    updatedAt: "2026-01-31T20:30:00+08:00",
    comparableCount: works.length,
    range: { from: works[0].publishedAt, to: works.at(-1).publishedAt },
    reviewStatusCounts: { public: works.length, private: 0 },
    summary,
    summaryLowerBounds: {},
    contentLines: groupedAggregates("contentLine"),
    formats: groupedAggregates("format"),
    roles: groupedAggregates("contentRole"),
    monthly,
    qualityIssues: [{
      issue: "当前页面展示完整 synthetic demo 数据",
      affectedWorks: `${works.length} 条作品、30 个账号日点、${works.length} 个深度包`,
      resolution: "连接自己的授权导出后替换整个 current.json；未知字段保持 null。",
    }],
    qualityFlags: ["synthetic_demo", "complete_demo_contract"],
    works,
    analytics: {
      snapshot: {
        capturedAt: "2026-01-31T20:30:00+08:00",
        timezone: "Asia/Shanghai",
        snapshotCount: 4,
        rootPath: "30_self_media/douyin",
        isRealtime: false,
      },
      coverage: {
        totalWorkCount: works.length,
        historyCoveredWorks: works.length,
        deepWorkCount: works.length,
        deepFieldCount: 27,
        accountDailyRows: accountDaily.length,
        pageOnlyRows: pageRows,
        assets: [
          { id: "account-content-daily", label: "账号内容日序列", status: "complete", rowCount: 30, fieldCount: 9, range: { from: accountSummary.from, to: accountSummary.to }, grain: "账号 × 自然日", sourcePath: "30_self_media/douyin/synthetic/account-content-daily.csv" },
          { id: "account-follower-daily", label: "粉丝日序列", status: "complete", rowCount: 30, fieldCount: 6, range: { from: accountSummary.from, to: accountSummary.to }, grain: "账号 × 自然日", sourcePath: "30_self_media/douyin/synthetic/account-follower-daily.csv" },
          { id: "all-works", label: "当前全量作品", status: "complete", rowCount: works.length, fieldCount: 31, range: { from: works[0].publishedAt, to: works.at(-1).publishedAt }, grain: "作品 × 采集快照", sourcePath: "30_self_media/douyin/current.json" },
          { id: "content-analysis", label: "投稿分析概览", status: "complete", rowCount: 1, fieldCount: 12, range: "近 30 日", grain: "账号 × 分析窗口", sourcePath: "30_self_media/douyin/synthetic/content-overview.csv" },
          { id: "collections", label: "合集数据", status: "complete", rowCount: 2, fieldCount: 13, range: null, grain: "合集 × 采集快照", sourcePath: "30_self_media/douyin/synthetic/collections.csv" },
          { id: "deep-work", label: "单作品深度数据", status: "complete", rowCount: detailRows, fieldCount: 27, range: null, grain: `已采集 ${works.length} / ${works.length} 条作品`, sourcePath: "30_self_media/douyin/synthetic/deep/" },
          { id: "page-evidence", label: "页面限定维度", status: "complete", rowCount: pageRows, fieldCount: 7, range: null, grain: "单作品 × 页面采集快照", sourcePath: "30_self_media/douyin/synthetic/page-evidence/" },
        ],
      },
      qualityIssues: [],
      account: {
        daily: accountDaily,
        summary: accountSummary,
        homeSnapshot: {
          capturedAt: "2026-01-31T20:30:00+08:00",
          sourcePath: "30_self_media/douyin/synthetic/home-snapshot.json",
          account: { following: 186, followers: accountSummary.latestFollowerTotal, totalLikes: 48600 },
          latestPeriod: {
            label: "2026-01-02 至 2026-01-31",
            views: accountSummary.views,
            profileVisits: 4280,
            likes: accountSummary.likes,
            shares: 1480,
            comments: accountSummary.comments,
            netFollowerGain: accountSummary.netFollowerGain,
          },
        },
        contentOverview: {
          range: "2026-01-02 至 2026-01-31",
          formats: ["1min以下视频", "1-5min视频"],
          categories: ["知识方法", "工作流实践", "本地工具"],
          publishedWorks: 4,
          averageCoverClickRatePct: round(works.slice(-4).reduce((total, work) => total + work.coverClickRatePct, 0) / 4),
          averageFiveSecondCompletionRatePct: round(works.slice(-4).reduce((total, work) => total + work.fiveSecondCompletionRatePct, 0) / 4),
          averageTwoSecondBounceRatePct: round(works.slice(-4).reduce((total, work) => total + work.twoSecondBounceRatePct, 0) / 4),
          averageWatchSeconds: round(works.slice(-4).reduce((total, work) => total + work.averageWatchSeconds, 0) / 4),
          medianViews: median(works.slice(-4).map((work) => work.views)),
          averageLikes: round(sum(works.slice(-4), "likes") / 4),
          averageComments: round(sum(works.slice(-4), "comments") / 4),
          averageShares: round(sum(works.slice(-4), "shares") / 4),
        },
        sourcePaths: [
          "30_self_media/douyin/synthetic/account-content-daily.csv",
          "30_self_media/douyin/synthetic/account-follower-daily.csv",
          "30_self_media/douyin/synthetic/content-overview.csv",
          "30_self_media/douyin/synthetic/home-snapshot.json",
        ],
      },
      collections: [
        { name: "本地知识工作示例", publishedAt: "2025-11-01", reviewStatus: "公开", views: 61200, completionRatePct: 18.8, coverClickRatePct: 6.2, twoSecondBounceRatePct: 31.4, averageWatchSeconds: 27.8, likes: 3210, shares: 620, comments: 390, saves: 2480, followerGain: 286 },
        { name: "AI 工具实践示例", publishedAt: "2025-12-01", reviewStatus: "公开", views: 37000, completionRatePct: 17.1, coverClickRatePct: 5.8, twoSecondBounceRatePct: 33.2, averageWatchSeconds: 25.4, likes: 1860, shares: 340, comments: 220, saves: 1410, followerGain: 154 },
      ],
      workDetails,
    },
  },
};

function templateValue(value, key = "") {
  if (Array.isArray(value)) {
    if (["qualityFlags", "qualityIssues", "issues", "missingFields", "sourcePaths"].includes(key)) return [];
    return value.length ? [templateValue(value[0])] : [];
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, templateValue(child, childKey)]));
  }
  if (typeof value === "boolean") return false;
  return null;
}

const template = templateValue(store);
template.schemaVersion = 1;
template.demoMode = false;
template.timezone = "Asia/Shanghai";
template.source = { kind: "authorized-local-export", label: null };
template.dataQuality.status = "passed";
template.history.snapshotCount = 0;
template.douyin.available = true;
template.douyin.demoMode = false;
template.douyin.sourcePath = "30_self_media/douyin/current.json";
template.douyin.comparableCount = 0;
template.douyin.reviewStatusCounts = { public: null, private: null };
template.douyin.works[0].id = "local-work-id";
template.douyin.works[0].rowNumber = 1;
template.douyin.works[0].profileVisitsIsLowerBound = false;
template.douyin.works[0].contentLine = "未分类";
template.douyin.works[0].contentRole = "未分类";
template.douyin.works[0].qualityFlags = [];
template.douyin.analytics.snapshot.timezone = "Asia/Shanghai";
template.douyin.analytics.snapshot.rootPath = "30_self_media/douyin";
template.douyin.analytics.snapshot.snapshotCount = 0;
template.douyin.analytics.snapshot.isRealtime = false;
const firstTemplateDetail = template.douyin.analytics.workDetails[works[0].id];
firstTemplateDetail.platformWorkId = null;
firstTemplateDetail.sourceKind = "authorized-local-export";
firstTemplateDetail.sourcePaths = [];
template.douyin.analytics.workDetails = { "local-work-id": firstTemplateDetail };
template.douyin.analytics.coverage.totalWorkCount = 0;
template.douyin.analytics.coverage.historyCoveredWorks = 0;
template.douyin.analytics.coverage.deepWorkCount = 0;
template.douyin.analytics.coverage.deepFieldCount = 0;
template.douyin.analytics.coverage.accountDailyRows = 0;
template.douyin.analytics.coverage.pageOnlyRows = 0;
template.douyin.analytics.account.homeSnapshot.sourcePath = null;
template.douyin.analytics.account.sourcePaths = [];

await fs.writeFile(demoPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
await fs.writeFile(templatePath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
console.log(`Generated ${path.relative(repoRoot, demoPath)} and ${path.relative(repoRoot, templatePath)}.`);
