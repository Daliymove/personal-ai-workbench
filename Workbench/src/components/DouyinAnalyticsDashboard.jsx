import { useState } from "react";
import { getAccentFamily, subscribeTheme } from "../lib/theme.js";
import { IconChartBar, IconInfoCircle } from "@tabler/icons-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

let ACCENT = getAccentFamily().accent;
let ACCENT_SOFT = getAccentFamily().accentLight;
subscribeTheme((family) => {
  ACCENT = family.accent;
  ACCENT_SOFT = family.accentLight;
});
const NEUTRAL_BAR = "#b9b7bf";
const GRID = "#ecebf0";
const TEXT = "#55545a";

const MONTH_METRICS = {
  views: {
    key: "views",
    label: "播放",
    chartLabel: "当前累计播放",
    format: formatNumber,
    compactFormat: formatCompactNumber,
  },
  saves: {
    key: "saves",
    label: "收藏",
    chartLabel: "当前累计收藏",
    format: formatNumber,
    compactFormat: formatCompactNumber,
  },
  followerGain: {
    key: "followerGain",
    label: "涨粉",
    chartLabel: "当前累计涨粉",
    format: formatNumber,
    compactFormat: formatCompactNumber,
  },
  profileVisits: {
    key: "profileVisits",
    label: "主页访问",
    chartLabel: "已知主页访问",
    format: formatNumber,
    compactFormat: formatCompactNumber,
    lowerBoundField: "profileVisitsIsLowerBound",
  },
};

const CONTENT_LINE_METRICS = {
  viewSharePct: {
    key: "viewSharePct",
    label: "播放占比",
    chartLabel: "播放占比",
    format: formatPercent,
    compactFormat: formatPercent,
  },
  saveRatePct: {
    key: "saveRatePct",
    label: "收藏率",
    chartLabel: "收藏率",
    format: formatPercent,
    compactFormat: formatPercent,
  },
  profileVisitRatePct: {
    key: "profileVisitRatePct",
    label: "主页访问率",
    chartLabel: "已知主页访问率",
    format: formatPercent,
    compactFormat: formatPercent,
    lowerBoundField: "profileVisitsIsLowerBound",
  },
  followerGainRatePct: {
    key: "followerGainRatePct",
    label: "涨粉率",
    chartLabel: "涨粉率",
    format: formatPercent,
    compactFormat: formatPercent,
  },
};

const TOP_WORK_METRICS = {
  views: MONTH_METRICS.views,
  saves: MONTH_METRICS.saves,
  followerGain: MONTH_METRICS.followerGain,
};

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

function finiteNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(Number(value))
  ) {
    return null;
  }
  return Number(value);
}

function formatNumber(value) {
  const number = finiteNumber(value);
  return number === null ? "—" : number.toLocaleString("zh-CN");
}

function formatCompactNumber(value) {
  const number = finiteNumber(value);
  if (number === null) return "—";
  if (Math.abs(number) < 1000) return number.toLocaleString("zh-CN");
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(number);
}

function formatPercent(value) {
  const number = finiteNumber(value);
  return number === null
    ? "—"
    : `${number.toLocaleString("zh-CN", {
        maximumFractionDigits: 2,
      })}%`;
}

function formatMonth(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})$/);
  return match ? `${Number(match[2])}月` : String(value ?? "月份未记录");
}

function formatDate(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function truncateLabel(value, maximum = 15) {
  const text = String(value ?? "未命名");
  return text.length > maximum ? `${text.slice(0, maximum)}…` : text;
}

function sumFinite(rows, field) {
  const values = rows.map((row) => finiteNumber(row?.[field]));
  const knownValues = values.filter((value) => value !== null);
  if (!knownValues.length) return null;
  return knownValues.reduce((sum, value) => sum + value, 0);
}

function metricIsLowerBound(metric, point) {
  return Boolean(metric?.lowerBoundField && point?.[metric.lowerBoundField]);
}

function formatMetricValue(metric, point, compact = false) {
  const formatter = compact ? metric.compactFormat : metric.format;
  const formatted = formatter(point?.[metric.key]);
  if (formatted === "—") return formatted;
  return `${metricIsLowerBound(metric, point) ? "≥ " : ""}${formatted}`;
}

function MetricSwitch({ label, metrics, onChange, value }) {
  return (
    <div aria-label={label} className="douyin-chart-card__switch" role="group">
      {Object.entries(metrics).map(([key, metric]) => (
        <button
          aria-pressed={value === key}
          className={joinClassNames(
            "douyin-chart-card__switch-button",
            value === key && "douyin-chart-card__switch-button--active",
          )}
          key={key}
          onClick={() => onChange(key)}
          type="button"
        >
          {metric.label}
        </button>
      ))}
    </div>
  );
}

function ChartCard({
  children,
  className,
  empty,
  meta,
  subtitle,
  title,
}) {
  return (
    <article
      className={joinClassNames("douyin-chart-card", className)}
      style={{ backgroundColor: "#ffffff" }}
    >
      <header className="douyin-chart-card__header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        {meta ? <span className="douyin-chart-card__sample">{meta}</span> : null}
      </header>
      {empty ? (
        <div className="douyin-chart-card__empty">
          <IconChartBar aria-hidden="true" />
          <span>当前快照没有足够的可绘制数据</span>
        </div>
      ) : (
        children
      )}
    </article>
  );
}

function TooltipShell({ active, children, title }) {
  if (!active) return null;
  return (
    <div className="douyin-chart-tooltip" role="status">
      <strong>{title || "未命名"}</strong>
      <dl>{children}</dl>
    </div>
  );
}

function TooltipRow({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function MonthlyTooltip({ active, metric, payload }) {
  const point = payload?.[0]?.payload;
  return (
    <TooltipShell active={active && Boolean(point)} title={formatMonth(point?.month)}>
      <TooltipRow
        label={metric.chartLabel}
        value={formatMetricValue(metric, point)}
      />
      <TooltipRow label="该月发布作品" value={`${formatNumber(point?.workCount)} 条`} />
    </TooltipShell>
  );
}

function ContentLineTooltip({ active, metric, payload }) {
  const point = payload?.[0]?.payload;
  return (
    <TooltipShell active={active && Boolean(point)} title={point?.name}>
      <TooltipRow
        label={metric.chartLabel}
        value={formatMetricValue(metric, point)}
      />
      <TooltipRow label="当前累计播放" value={formatNumber(point?.views)} />
      <TooltipRow label="播放占比" value={formatPercent(point?.viewSharePct)} />
      <TooltipRow label="作品数" value={`${formatNumber(point?.workCount)} 条`} />
      <TooltipRow label="播放中位数" value={formatNumber(point?.medianViews)} />
    </TooltipShell>
  );
}

function WorkTooltip({ active, metric, payload }) {
  const work = payload?.[0]?.payload;
  return (
    <TooltipShell active={active && Boolean(work)} title={work?.title}>
      <TooltipRow
        label={metric.chartLabel}
        value={formatMetricValue(metric, work)}
      />
      {metric.key === "views" ? null : (
        <TooltipRow label="当前累计播放" value={formatNumber(work?.views)} />
      )}
      <TooltipRow label="内容线" value={work?.contentLine || "未分类"} />
      <TooltipRow label="发布时间" value={work?.publishedAt || "未记录"} />
    </TooltipShell>
  );
}

function RetentionTooltip({ active, payload }) {
  const point = payload?.[0]?.payload;
  return (
    <TooltipShell active={active && Boolean(point)} title={point?.name}>
      <TooltipRow
        label="加权 5 秒完播"
        value={formatPercent(point?.weightedFiveSecondCompletionRatePct)}
      />
      <TooltipRow
        label="加权 2 秒跳出"
        value={formatPercent(point?.weightedTwoSecondBounceRatePct)}
      />
      <TooltipRow label="作品数" value={`${formatNumber(point?.workCount)} 条`} />
    </TooltipShell>
  );
}

function InteractionTooltip({ active, payload }) {
  const point = payload?.[0]?.payload;
  return (
    <TooltipShell active={active && Boolean(point)} title={point?.name}>
      <TooltipRow label="行为次数" value={formatNumber(point?.value)} />
      <TooltipRow label="占总播放" value={formatPercent(point?.ratePct)} />
    </TooltipShell>
  );
}

function MonthViewsChart({ asOf, monthly, reducedMotion }) {
  const [metricKey, setMetricKey] = useState("views");
  const metric = MONTH_METRICS[metricKey];
  const allRows = (Array.isArray(monthly) ? monthly : [])
    .filter((row) => row?.month)
    .map((row) => ({
      ...row,
      views: finiteNumber(row.views),
      saves: finiteNumber(row.saves),
      followerGain: finiteNumber(row.followerGain),
      profileVisits: finiteNumber(row.profileVisits),
      workCount: finiteNumber(row.workCount),
    }))
    .sort((left, right) => String(left.month).localeCompare(String(right.month)));
  const rows = allRows;
  const knownWorks = sumFinite(allRows, "workCount");
  const datedThrough = formatDate(asOf);
  const hasLowerBounds = rows.some((row) => metricIsLowerBound(metric, row));
  const chartTitle = `按发布月份归组的作品${metric.label}${hasLowerBounds ? "（下限）" : ""}`;

  return (
    <ChartCard
      empty={!rows.some((row) => row[metric.key] !== null)}
      meta={`${formatNumber(knownWorks)} 条作品 · ${rows.length} 个发布月`}
      subtitle={`作品按发布时间归月；指标为${datedThrough ? `截至 ${datedThrough}` : "当前快照中"} 的当前累计值，不是月度新增。${hasLowerBounds ? "主页访问存在缺失，图中以已知下限展示。" : ""}`}
      title={chartTitle}
    >
      <MetricSwitch
        label="切换月份图表指标"
        metrics={MONTH_METRICS}
        onChange={setMetricKey}
        value={metricKey}
      />
      <div
        aria-label={`${chartTitle}柱状图`}
        className="douyin-chart-card__chart douyin-chart-card__chart--monthly"
        role="img"
      >
        <ResponsiveContainer height="100%" width="100%">
          <BarChart
            accessibilityLayer
            data={rows}
            margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="month"
              tick={{ fill: TEXT, fontSize: 12 }}
              tickFormatter={formatMonth}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={{ fill: TEXT, fontSize: 12 }}
              tickFormatter={metric.compactFormat}
              tickLine={false}
              width={48}
            />
            <Tooltip
              content={<MonthlyTooltip metric={metric} />}
              cursor={{ fill: "#f5f3ff" }}
            />
            <Bar
              animationDuration={220}
              dataKey={metric.key}
              fill={ACCENT}
              isAnimationActive={!reducedMotion}
              maxBarSize={48}
              name={metric.chartLabel}
              radius={[5, 5, 0, 0]}
            >
              <LabelList
                dataKey={metric.key}
                fill={TEXT}
                fontSize={11}
                formatter={metric.compactFormat}
                position="top"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function ContentLineViewsChart({ contentLines, reducedMotion }) {
  const [metricKey, setMetricKey] = useState("viewSharePct");
  const metric = CONTENT_LINE_METRICS[metricKey];
  const allRows = (Array.isArray(contentLines) ? contentLines : [])
    .filter((row) => row?.name)
    .map((row) => ({
      ...row,
      views: finiteNumber(row.views),
      workCount: finiteNumber(row.workCount),
      viewSharePct: finiteNumber(row.viewSharePct),
      saveRatePct: finiteNumber(row.saveRatePct),
      profileVisitRatePct: finiteNumber(row.profileVisitRatePct),
      followerGainRatePct: finiteNumber(row.followerGainRatePct),
    }));
  const rows = allRows
    .filter((row) => row[metric.key] !== null)
    .sort((left, right) => right[metric.key] - left[metric.key]);
  const knownWorks = sumFinite(allRows, "workCount");
  const chartHeight = Math.max(220, rows.length * 52 + 48);
  const hasLowerBounds = rows.some((row) => metricIsLowerBound(metric, row));
  const chartTitle = `内容线${metric.label}${hasLowerBounds ? "（下限）" : ""}`;

  return (
    <ChartCard
      empty={!rows.length}
      meta={`${formatNumber(knownWorks)} 条作品 · ${rows.length} 条内容线`}
      subtitle={`基于内容板中的人工分类；效率指标以播放为分母。${hasLowerBounds ? "主页访问存在缺失，图中以已知下限展示。" : ""}`}
      title={chartTitle}
    >
      <MetricSwitch
        label="切换内容线图表指标"
        metrics={CONTENT_LINE_METRICS}
        onChange={setMetricKey}
        value={metricKey}
      />
      <div
        aria-label={`${chartTitle}横向条形图`}
        className="douyin-chart-card__chart douyin-chart-card__chart--horizontal"
        role="img"
        style={{ height: chartHeight }}
      >
        <ResponsiveContainer height="100%" width="100%">
          <BarChart
            accessibilityLayer
            data={rows}
            layout="vertical"
            margin={{ top: 4, right: 54, bottom: 0, left: 4 }}
          >
            <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="3 3" />
            <XAxis
              axisLine={false}
              tick={{ fill: TEXT, fontSize: 12 }}
              tickFormatter={metric.compactFormat}
              tickLine={false}
              type="number"
            />
            <YAxis
              axisLine={false}
              dataKey="name"
              tick={{ fill: TEXT, fontSize: 12 }}
              tickFormatter={(value) => truncateLabel(value, 10)}
              tickLine={false}
              type="category"
              width={94}
            />
            <Tooltip
              content={<ContentLineTooltip metric={metric} />}
              cursor={{ fill: "#fafafa" }}
            />
            <Bar
              animationDuration={220}
              dataKey={metric.key}
              fill={ACCENT}
              isAnimationActive={!reducedMotion}
              maxBarSize={24}
              name={metric.chartLabel}
              radius={[0, 5, 5, 0]}
            >
              <LabelList
                dataKey={metric.key}
                fill={TEXT}
                fontSize={11}
                formatter={metric.compactFormat}
                position="right"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function TopWorksChart({ onSelectWork, reducedMotion, works }) {
  const [metricKey, setMetricKey] = useState("views");
  const metric = TOP_WORK_METRICS[metricKey];
  const allWorks = Array.isArray(works) ? works : [];
  const normalizedWorks = allWorks.map((work) => ({
    ...work,
    views: finiteNumber(work?.views),
    saves: finiteNumber(work?.saves),
    followerGain: finiteNumber(work?.followerGain),
  }));
  const knownWorks = normalizedWorks.filter(
    (work) => work[metric.key] !== null,
  );
  const rows = [...knownWorks]
    .sort((left, right) => right[metric.key] - left[metric.key])
    .slice(0, 8)
    .reverse();
  const chartHeight = Math.max(300, rows.length * 46 + 44);
  const chartTitle = `作品${metric.label} Top 8`;

  const handleClick = (entry) => {
    const work = entry?.payload ?? entry;
    if (work && typeof onSelectWork === "function") onSelectWork(work);
  };

  return (
    <ChartCard
      className="douyin-chart-card--wide"
      empty={!rows.length}
      meta={`Top ${rows.length} / ${knownWorks.length} 条有${metric.label}记录作品`}
      subtitle={`按单条作品当前累计${metric.label}排序；图中仅展示前 8，完整数据见作品库。`}
      title={chartTitle}
    >
      <MetricSwitch
        label="切换 Top 作品图表指标"
        metrics={TOP_WORK_METRICS}
        onChange={setMetricKey}
        value={metricKey}
      />
      <div
        aria-label={`${chartTitle}横向条形图`}
        className="douyin-chart-card__chart douyin-chart-card__chart--top-works"
        role="img"
        style={{ height: chartHeight }}
      >
        <ResponsiveContainer height="100%" width="100%">
          <BarChart
            accessibilityLayer
            data={rows}
            layout="vertical"
            margin={{ top: 2, right: 66, bottom: 0, left: 6 }}
          >
            <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="3 3" />
            <XAxis
              axisLine={false}
              tick={{ fill: TEXT, fontSize: 12 }}
              tickFormatter={metric.compactFormat}
              tickLine={false}
              type="number"
            />
            <YAxis
              axisLine={false}
              dataKey="title"
              tick={{ fill: TEXT, fontSize: 12 }}
              tickFormatter={(value) => truncateLabel(value, 16)}
              tickLine={false}
              type="category"
              width={148}
            />
            <Tooltip
              content={<WorkTooltip metric={metric} />}
              cursor={{ fill: "#fafafa" }}
            />
            <Bar
              animationDuration={220}
              cursor={typeof onSelectWork === "function" ? "pointer" : "default"}
              dataKey={metric.key}
              fill={ACCENT}
              isAnimationActive={!reducedMotion}
              maxBarSize={22}
              name={metric.chartLabel}
              onClick={handleClick}
              radius={[0, 5, 5, 0]}
            >
              <LabelList
                dataKey={metric.key}
                fill={TEXT}
                fontSize={11}
                formatter={metric.compactFormat}
                position="right"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function RetentionQualityChart({ contentLines, reducedMotion }) {
  const rows = (Array.isArray(contentLines) ? contentLines : [])
    .filter((row) => row?.name)
    .map((row) => ({
      ...row,
      weightedFiveSecondCompletionRatePct: finiteNumber(
        row.weightedFiveSecondCompletionRatePct,
      ),
      weightedTwoSecondBounceRatePct: finiteNumber(
        row.weightedTwoSecondBounceRatePct,
      ),
      workCount: finiteNumber(row.workCount),
    }))
    .filter(
      (row) =>
        row.weightedFiveSecondCompletionRatePct !== null ||
        row.weightedTwoSecondBounceRatePct !== null,
    );
  const knownWorks = sumFinite(rows, "workCount");
  const chartHeight = Math.max(250, rows.length * 64 + 56);

  return (
    <ChartCard
      empty={!rows.length}
      meta={`${formatNumber(knownWorks)} 条作品 · ${rows.length} 条内容线`}
      subtitle="两项均按内容线加权；5 秒完播越高越好，2 秒跳出越低越好。缺失项留空。"
      title="内容线留存质量对比"
    >
      <div
        aria-label="各内容线加权五秒完播率与加权两秒跳出率的对比图"
        className="douyin-chart-card__chart douyin-chart-card__chart--retention"
        role="img"
        style={{ height: chartHeight }}
      >
        <ResponsiveContainer height="100%" width="100%">
          <BarChart
            accessibilityLayer
            barCategoryGap="24%"
            data={rows}
            layout="vertical"
            margin={{ top: 8, right: 24, bottom: 0, left: 4 }}
          >
            <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="3 3" />
            <XAxis
              axisLine={false}
              domain={[0, 100]}
              tick={{ fill: TEXT, fontSize: 12 }}
              tickFormatter={(value) => `${value}%`}
              tickLine={false}
              type="number"
            />
            <YAxis
              axisLine={false}
              dataKey="name"
              tick={{ fill: TEXT, fontSize: 12 }}
              tickFormatter={(value) => truncateLabel(value, 10)}
              tickLine={false}
              type="category"
              width={94}
            />
            <Tooltip content={<RetentionTooltip />} cursor={{ fill: "#fafafa" }} />
            <Legend
              formatter={(value) => (
                <span className="douyin-chart-card__legend-label">{value}</span>
              )}
              iconSize={9}
              iconType="square"
              verticalAlign="top"
            />
            <Bar
              animationDuration={220}
              dataKey="weightedFiveSecondCompletionRatePct"
              fill={ACCENT}
              isAnimationActive={!reducedMotion}
              maxBarSize={15}
              name="加权 5 秒完播"
              radius={[0, 4, 4, 0]}
            />
            <Bar
              animationDuration={220}
              dataKey="weightedTwoSecondBounceRatePct"
              fill={NEUTRAL_BAR}
              isAnimationActive={!reducedMotion}
              maxBarSize={15}
              name="加权 2 秒跳出"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

function InteractionTotalsChart({ reducedMotion, summary }) {
  const rows = [
    ["点赞", "totalLikes", "likeRatePct"],
    ["分享", "totalShares", "shareRatePct"],
    ["评论", "totalComments", "commentRatePct"],
    ["收藏", "totalSaves", "saveRatePct"],
  ]
    .map(([name, key, rateKey]) => ({
      key,
      name,
      value: finiteNumber(summary?.[key]),
      ratePct: finiteNumber(summary?.[rateKey]),
    }))
    .filter((row) => row.value !== null);
  const family = getAccentFamily();
  const fills = [family.accent, family.accentMid, family.accentSoft, ACCENT_SOFT];

  return (
    <ChartCard
      empty={!rows.length}
      meta={`${rows.length} / 4 个行为指标有记录`}
      subtitle="各行为为独立计数，同一作品可以产生多种行为；柱高不代表独立用户数。"
      title="互动行为总量"
    >
      <div
        aria-label="点赞、分享、评论和收藏行为总量柱状图"
        className="douyin-chart-card__chart douyin-chart-card__chart--interactions"
        role="img"
      >
        <ResponsiveContainer height="100%" width="100%">
          <BarChart
            accessibilityLayer
            data={rows}
            margin={{ top: 16, right: 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="name"
              tick={{ fill: TEXT, fontSize: 12 }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={{ fill: TEXT, fontSize: 12 }}
              tickFormatter={formatCompactNumber}
              tickLine={false}
              width={48}
            />
            <Tooltip
              content={<InteractionTooltip />}
              cursor={{ fill: "#f5f3ff" }}
            />
            <Bar
              animationDuration={220}
              dataKey="value"
              isAnimationActive={!reducedMotion}
              maxBarSize={46}
              name="行为次数"
              radius={[5, 5, 0, 0]}
            >
              {rows.map((row, index) => (
                <Cell fill={fills[index]} key={row.key} />
              ))}
              <LabelList
                dataKey="value"
                fill={TEXT}
                fontSize={11}
                formatter={formatCompactNumber}
                position="top"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function DouyinAnalyticsDashboard({
  asOf: asOfProp,
  className,
  contentLines: contentLinesProp,
  monthly: monthlyProp,
  onSelectWork,
  payload,
  qualityIssues: qualityIssuesProp,
  reducedMotion = false,
  sourceNote: sourceNoteProp,
  summary: summaryProp,
  works: worksProp,
}) {
  const data = payload ?? {};
  const summary = summaryProp ?? data.summary ?? {};
  const works = worksProp ?? data.works ?? data.items ?? [];
  const contentLines = contentLinesProp ?? data.contentLines ?? [];
  const monthly = monthlyProp ?? data.monthly ?? [];
  const qualityIssues = qualityIssuesProp ?? data.qualityIssues ?? [];
  const asOf = asOfProp ?? data.asOf ?? data.sourceUpdatedAt ?? data.updatedAt ?? null;
  const sourceNote =
    sourceNoteProp ?? data.sourceNote ?? data.sourcePath ?? null;
  const sampleSize =
    finiteNumber(summary?.workCount) ??
    finiteNumber(data.comparableCount) ??
    (Array.isArray(works) ? works.length : null);

  return (
    <section
      aria-labelledby="douyin-analytics-title"
      className={joinClassNames("douyin-analytics", className)}
    >
      <header className="douyin-analytics__header">
        <div>
          <span className="eyebrow">SNAPSHOT ANALYSIS</span>
          <h2 id="douyin-analytics-title">账号数据图表</h2>
          <p>用同一份本地作品快照查看发布分布、内容构成、头部作品与留存质量。</p>
        </div>
        <div className="douyin-analytics__scope" aria-label="图表数据口径">
          {sampleSize !== null ? <span>{formatNumber(sampleSize)} 条可比作品</span> : null}
          {asOf ? <span>快照更新 {formatDate(asOf)}</span> : null}
          {sourceNote ? <span title={sourceNote}>{sourceNote}</span> : null}
        </div>
      </header>

      <div className="douyin-analytics__grid">
        <MonthViewsChart
          asOf={asOf}
          monthly={monthly}
          reducedMotion={reducedMotion}
        />
        <ContentLineViewsChart
          contentLines={contentLines}
          reducedMotion={reducedMotion}
        />
        <RetentionQualityChart
          contentLines={contentLines}
          reducedMotion={reducedMotion}
        />
        <InteractionTotalsChart
          reducedMotion={reducedMotion}
          summary={summary}
        />
        <TopWorksChart
          onSelectWork={onSelectWork}
          reducedMotion={reducedMotion}
          works={works}
        />
      </div>

      {Array.isArray(qualityIssues) && qualityIssues.length ? (
        <aside className="douyin-analytics__quality" role="note">
          <IconInfoCircle aria-hidden="true" />
          <div>
            <strong>图表沿用当前快照的数据边界</strong>
            <p>
              {qualityIssues
                .slice(0, 2)
                .map((item) =>
                  typeof item === "string"
                    ? item
                    : [item?.issue, item?.affectedWorks]
                        .filter(Boolean)
                        .join("："),
                )
                .filter(Boolean)
                .join("；")}
            </p>
          </div>
        </aside>
      ) : null}
    </section>
  );
}

export default DouyinAnalyticsDashboard;
