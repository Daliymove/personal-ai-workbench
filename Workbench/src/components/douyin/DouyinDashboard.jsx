import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  IconAdjustmentsHorizontal,
  IconArrowDown,
  IconArrowUp,
  IconChartLine,
  IconChevronRight,
  IconClockHour4,
  IconDatabase,
  IconExternalLink,
  IconFileAnalytics,
  IconPhoto,
  IconQuote,
  IconSearch,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { formatCompactDate, formatNumber } from "../../lib/format";
import { getAccentFamily, subscribeTheme } from "../../lib/theme.js";
import { loadDocument } from "../../lib/api";

let ACCENT = getAccentFamily().accent;
let ACCENT_SOFT = getAccentFamily().accentSoft;
let ACCENT_WASH = getAccentFamily().accentWash;
subscribeTheme((family) => {
  ACCENT = family.accent;
  ACCENT_SOFT = family.accentSoft;
  ACCENT_WASH = family.accentWash;
});
const INK = "#0a0a0a";
const INK_SOFT = "#71717a";
const LINE = "#e4e4e7";

function isKnown(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function displayTitle(value) {
  const title = String(value ?? "未命名作品")
    .split("\n")[0]
    .split(/\s+#/)[0]
    .trim();
  return title || "未命名作品";
}

function formatPercent(value, digits = 1) {
  return isKnown(value) ? `${formatNumber(value, digits)}%` : "—";
}

function formatSeconds(value) {
  return isKnown(value) ? `${formatNumber(value, 1)} 秒` : "—";
}

function formatDateTime(value) {
  if (!value) return "采样时间未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replaceAll("/", "-");
}

function chartDate(value, withTime = false) {
  if (!value) return "—";
  const text = String(value);
  if (withTime) return `${text.slice(5, 10)} ${text.slice(11, 16)}`;
  return text.slice(5, 10);
}

function valueFormatter(value, type = "number") {
  if (type === "percent") return formatPercent(value, 2);
  if (type === "seconds") return formatSeconds(value);
  return formatNumber(value, 2);
}

function ChartTooltip({ active, payload, label, labelFormatter, units = {} }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dy-tooltip">
      <div className="dy-tooltip__date">
        {labelFormatter ? labelFormatter(label) : label}
      </div>
      {payload
        .filter((item) => isKnown(item.value))
        .map((item) => (
          <div className="dy-tooltip__row" key={item.dataKey}>
            <span className="dy-tooltip__dot" style={{ background: item.color }} />
            <span>{item.name}</span>
            <strong>{valueFormatter(item.value, units[item.dataKey])}</strong>
          </div>
        ))}
    </div>
  );
}

function SectionHeading({ eyebrow, title, description, aside }) {
  return (
    <div className="dy-section-heading">
      <div>
        <span className="dy-section-heading__eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {aside ? <div>{aside}</div> : null}
    </div>
  );
}

function KpiCard({ label, value, type = "number", hint, accent = false }) {
  return (
    <article className={`dy-kpi${accent ? " dy-kpi--accent" : ""}`}>
      <div className="dy-kpi__label">{label}</div>
      <div className="dy-kpi__value">{valueFormatter(value, type)}</div>
      <div className="dy-kpi__hint">{hint}</div>
    </article>
  );
}

function AccountKpis({ summary, account }) {
  const accountSummary = account?.summary ?? {};
  const home = account?.homeSnapshot ?? {};
  const currentFollowers = home.account?.followers ?? accountSummary.latestFollowerTotal;
  return (
    <div className="dy-kpis">
      <KpiCard
        label="当前公开作品"
        value={summary.workCount}
        hint="作品列表 · 当前累计快照"
      />
      <KpiCard
        label="当前累计播放"
        value={summary.totalViews}
        hint={`${formatNumber(summary.workCount)} 条作品累计值，不是周期新增`}
        accent
      />
      <KpiCard
        label="近 30 日播放"
        value={accountSummary.views}
        hint={`${accountSummary.from ?? "—"} 至 ${accountSummary.to ?? "—"}`}
      />
      <KpiCard
        label="当前粉丝"
        value={currentFollowers}
        hint={
          home.account?.followers != null
            ? `首页快照 · ${formatDateTime(home.capturedAt)}`
            : `日表截止 ${accountSummary.to ?? "—"}`
        }
      />
      <KpiCard
        label="近 30 日净增粉"
        value={accountSummary.netFollowerGain}
        hint={`吸粉 ${formatNumber(accountSummary.followersGained)} / 脱粉 ${formatNumber(accountSummary.followersLost)}`}
      />
      <KpiCard
        label="累计收藏率"
        value={summary.saveRatePct}
        type="percent"
        hint="收藏 ÷ 当前作品累计播放"
      />
    </div>
  );
}

function WindowCard({ eyebrow, title, range, metrics, note, sourcePath }) {
  return (
    <section className="dy-window-card">
      <div className="dy-window-card__head">
        <div>
          <span className="dy-panel__eyebrow">{eyebrow}</span>
          <h3>{title}</h3>
          <p>{range ?? "周期未记录"}</p>
        </div>
        <span className="dy-status dy-status--complete">官方口径</span>
      </div>
      <div className="dy-window-card__metrics">
        {metrics.map(([label, value, type = "number"]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{valueFormatter(value, type)}</strong>
          </div>
        ))}
      </div>
      <div className="dy-window-card__foot">
        <span>{note}</span>
        {sourcePath ? <code title={sourcePath}>{sourcePath}</code> : null}
      </div>
    </section>
  );
}

function AccountWindows({ account }) {
  const home = account?.homeSnapshot;
  const latest = home?.latestPeriod;
  const overview = account?.contentOverview;
  if (!latest && !overview) return null;
  return (
    <div className="dy-window-grid">
      {latest ? (
        <WindowCard
          eyebrow="HOME SNAPSHOT"
          title="首页周期概览"
          range={latest.label}
          metrics={[
            ["播放", latest.views],
            ["主页访问", latest.profileVisits],
            ["点赞", latest.likes],
            ["分享", latest.shares],
            ["评论", latest.comments],
            ["净增粉", latest.netFollowerGain],
          ]}
          note="首页采用平台简写数值，播放量存在展示精度边界。"
          sourcePath={home.sourcePath}
        />
      ) : null}
      {overview ? (
        <WindowCard
          eyebrow="CONTENT OVERVIEW"
          title="投稿分析概览"
          range={overview.range}
          metrics={[
            ["周期投稿", overview.publishedWorks],
            ["播放中位", overview.medianViews],
            ["条均封面点击", overview.averageCoverClickRatePct, "percent"],
            ["条均 5 秒完播", overview.averageFiveSecondCompletionRatePct, "percent"],
            ["条均 2 秒跳出", overview.averageTwoSecondBounceRatePct, "percent"],
            ["条均播放时长", overview.averageWatchSeconds, "seconds"],
            ["条均点赞", overview.averageLikes],
            ["条均分享", overview.averageShares],
          ]}
          note={`${overview.formats?.join("、") || "体裁未记录"} · ${overview.categories?.join("、") || "垂类未记录"}`}
          sourcePath={account?.sourcePaths?.find((value) => value.includes("投稿概览"))}
        />
      ) : null}
    </div>
  );
}

const trendModes = [
  { id: "traffic", label: "流量" },
  { id: "followers", label: "粉丝" },
  { id: "retention", label: "开头留存" },
  { id: "depth", label: "观看深度" },
];

function AccountTrend({ daily, summary }) {
  const [mode, setMode] = useState("traffic");
  if (!daily?.length) {
    return <EmptyState title="账号日序列未接入" detail="当前没有可审计的自然日数据。" />;
  }

  const chart = {
    traffic: {
      lines: [
        { key: "views", name: "播放", type: "area", color: ACCENT, yAxisId: "left" },
        { key: "likes", name: "点赞", type: "line", color: INK, yAxisId: "right" },
      ],
      units: {},
    },
    followers: {
      lines: [
        { key: "totalFollowers", name: "总粉丝", type: "line", color: ACCENT, yAxisId: "left" },
        { key: "netFollowerGain", name: "净增粉", type: "bar", color: INK, yAxisId: "right" },
      ],
      units: {},
    },
    retention: {
      lines: [
        {
          key: "fiveSecondCompletionRatePct",
          name: "5 秒完播率",
          type: "line",
          color: ACCENT,
          yAxisId: "left",
        },
        {
          key: "twoSecondBounceRatePct",
          name: "2 秒跳出率",
          type: "line",
          color: INK,
          yAxisId: "left",
        },
      ],
      units: {
        fiveSecondCompletionRatePct: "percent",
        twoSecondBounceRatePct: "percent",
      },
    },
    depth: {
      lines: [
        {
          key: "averageWatchSeconds",
          name: "平均播放时长",
          type: "line",
          color: ACCENT,
          yAxisId: "left",
        },
        {
          key: "coverClickRatePct",
          name: "封面点击率",
          type: "line",
          color: INK,
          yAxisId: "right",
        },
      ],
      units: { averageWatchSeconds: "seconds", coverClickRatePct: "percent" },
    },
  }[mode];

  return (
    <section className="dy-panel dy-trend-panel">
      <div className="dy-panel__head">
        <div>
          <span className="dy-panel__eyebrow">ACCOUNT · DAILY</span>
          <h3>账号 30 日真实趋势</h3>
          <p>
            自然日新增口径 · {summary?.from} 至 {summary?.to} · {daily.length} 个数据点
          </p>
        </div>
        <div className="dy-tabs" role="tablist" aria-label="趋势指标">
          {trendModes.map((item) => (
            <button
              key={item.id}
              className={mode === item.id ? "dy-tab dy-tab--active" : "dy-tab"}
              onClick={() => setMode(item.id)}
              role="tab"
              aria-selected={mode === item.id}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="dy-chart" aria-label="抖音账号 30 日趋势图">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={daily} margin={{ top: 12, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid stroke={LINE} strokeDasharray="2 6" vertical={false} />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: INK_SOFT, fontSize: 10 }}
              tickFormatter={(value) => chartDate(value)}
              minTickGap={32}
            />
            <YAxis
              yAxisId="left"
              axisLine={false}
              tickLine={false}
              tick={{ fill: INK_SOFT, fontSize: 10 }}
              width={54}
            />
            {chart.lines.some((line) => line.yAxisId === "right") ? (
              <YAxis
                yAxisId="right"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fill: INK_SOFT, fontSize: 10 }}
                width={48}
              />
            ) : null}
            <Tooltip
              content={<ChartTooltip labelFormatter={(value) => String(value)} units={chart.units} />}
            />
            {chart.lines.map((line) => {
              if (line.type === "area") {
                return (
                  <Area
                    key={line.key}
                    yAxisId={line.yAxisId}
                    type="monotone"
                    dataKey={line.key}
                    name={line.name}
                    stroke={line.color}
                    strokeWidth={2}
                    fill={ACCENT_WASH}
                    fillOpacity={0.9}
                    connectNulls
                    isAnimationActive={false}
                  />
                );
              }
              if (line.type === "bar") {
                return (
                  <Bar
                    key={line.key}
                    yAxisId={line.yAxisId}
                    dataKey={line.key}
                    name={line.name}
                    fill={line.color}
                    opacity={0.72}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={16}
                    isAnimationActive={false}
                  />
                );
              }
              return (
                <Line
                  key={line.key}
                  yAxisId={line.yAxisId}
                  type="monotone"
                  dataKey={line.key}
                  name={line.name}
                  stroke={line.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: line.color, stroke: "#fff", strokeWidth: 2 }}
                  connectNulls
                  isAnimationActive={false}
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="dy-chart-legend">
        {chart.lines.map((line) => (
          <span key={line.key}>
            <i style={{ background: line.color }} /> {line.name}
          </span>
        ))}
        <span className="dy-chart-legend__note">悬停查看日值</span>
      </div>
    </section>
  );
}

function DistributionPanel({ title, eyebrow, items, totalViews }) {
  const rows = (items ?? []).map((item) => ({
    ...item,
    share: isKnown(item.viewSharePct)
      ? item.viewSharePct
      : totalViews > 0
        ? (item.views / totalViews) * 100
        : null,
  }));
  return (
    <section className="dy-panel dy-distribution">
      <div className="dy-panel__head">
        <div>
          <span className="dy-panel__eyebrow">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
      </div>
      <div className="dy-distribution__list">
        {rows.map((item) => (
          <div className="dy-distribution__item" key={item.name}>
            <div className="dy-distribution__row">
              <div>
                <strong>{item.name}</strong>
                <span>{formatNumber(item.workCount)} 条 · 中位 {formatNumber(item.medianViews)}</span>
              </div>
              <div className="dy-distribution__metric">
                {formatPercent(item.share)}
                <span>{formatNumber(item.views)} 播放</span>
              </div>
            </div>
            <div className="dy-distribution__track">
              <motion.div
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45 }}
                style={{ width: `${Math.max(0, Math.min(100, item.share ?? 0))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CollectionCard({ collections }) {
  const collection = collections?.[0];
  return (
    <section className="dy-panel dy-collection-card">
      <div className="dy-panel__head">
        <div>
          <span className="dy-panel__eyebrow">COLLECTION</span>
          <h3>合集表现</h3>
        </div>
        <span className="dy-status dy-status--complete">官方导出</span>
      </div>
      {collection ? (
        <>
          <div className="dy-collection-card__name">{collection.name}</div>
          <div className="dy-collection-card__hero">
            <strong>{formatNumber(collection.views)}</strong>
            <span>累计播放</span>
          </div>
          <div className="dy-mini-metrics">
            <div><span>收藏</span><strong>{formatNumber(collection.saves)}</strong></div>
            <div><span>涨粉</span><strong>{formatNumber(collection.followerGain)}</strong></div>
            <div><span>完播率</span><strong>{formatPercent(collection.completionRatePct)}</strong></div>
            <div><span>2 秒跳出</span><strong>{formatPercent(collection.twoSecondBounceRatePct)}</strong></div>
          </div>
        </>
      ) : (
        <EmptyState title="暂无合集数据" detail="当前导出中没有合集记录。" compact />
      )}
    </section>
  );
}

function DataAssets({ coverage }) {
  const labels = { complete: "完整", partial: "部分", missing: "缺失", empty: "为空" };
  return (
    <section className="dy-assets">
      <SectionHeading
        eyebrow="DATA COVERAGE"
        title="数据资产与覆盖边界"
        description="这里直接回答“数据为什么看起来少”：已有数据按真实粒度接入，未采集维度保持空白。"
        aside={
          <div className="dy-assets__summary">
            <IconDatabase size={17} />
            <strong>{formatNumber(coverage?.deepFieldCount)}</strong> 个深度字段
          </div>
        }
      />
      <div className="dy-assets__table-wrap">
        <table className="dy-assets__table">
          <thead>
            <tr>
              <th>数据层</th>
              <th>状态</th>
              <th>记录</th>
              <th>字段</th>
              <th>粒度 / 范围</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            {(coverage?.assets ?? []).map((asset) => (
              <tr key={asset.id}>
                <td><strong>{asset.label}</strong></td>
                <td>
                  <span className={`dy-status dy-status--${asset.status}`}>
                    {labels[asset.status] ?? asset.status}
                  </span>
                </td>
                <td className="mono">{formatNumber(asset.rowCount)}</td>
                <td className="mono">{formatNumber(asset.fieldCount)}</td>
                <td>
                  <span>{asset.grain}</span>
                  {asset.range ? (
                    <small>
                      {typeof asset.range === "string"
                        ? asset.range
                        : `${asset.range.from ?? "—"} → ${asset.range.to ?? "—"}`}
                    </small>
                  ) : null}
                </td>
                <td><code title={asset.sourcePath ?? ""}>{asset.sourcePath ?? "未接入"}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const sortableColumns = [
  ["publishedAt", "发布"],
  ["views", "播放"],
  ["fiveSecondCompletionRatePct", "5 秒完播"],
  ["twoSecondBounceRatePct", "2 秒跳出"],
  ["averageWatchSeconds", "均播"],
  ["likes", "点赞"],
  ["shares", "分享"],
  ["comments", "评论"],
  ["saves", "收藏"],
  ["profileVisits", "主页访问"],
  ["followerGain", "涨粉"],
];

function SortButton({ id, label, sort, onSort }) {
  const active = sort.key === id;
  return (
    <button className={active ? "dy-sort dy-sort--active" : "dy-sort"} onClick={() => onSort(id)}>
      {label}
      {active ? (sort.direction === "asc" ? <IconArrowUp /> : <IconArrowDown />) : null}
    </button>
  );
}

function WorksExplorer({ works, details, onSelect }) {
  const [query, setQuery] = useState("");
  const [contentLine, setContentLine] = useState("all");
  const [format, setFormat] = useState("all");
  const [depthOnly, setDepthOnly] = useState(false);
  const [sort, setSort] = useState({ key: "views", direction: "desc" });

  const contentLines = [...new Set(works.map((work) => work.contentLine).filter(Boolean))];
  const formats = [...new Set(works.map((work) => work.format).filter(Boolean))];
  const filtered = useMemo(() => {
    const lowered = query.trim().toLocaleLowerCase("zh-CN");
    return works
      .filter((work) => {
        if (lowered && !String(work.title).toLocaleLowerCase("zh-CN").includes(lowered)) return false;
        if (contentLine !== "all" && work.contentLine !== contentLine) return false;
        if (format !== "all" && work.format !== format) return false;
        if (depthOnly && !details[work.id]) return false;
        return true;
      })
      .sort((left, right) => {
        const leftValue = left[sort.key];
        const rightValue = right[sort.key];
        if (leftValue == null && rightValue == null) return 0;
        if (leftValue == null) return 1;
        if (rightValue == null) return -1;
        const comparison =
          typeof leftValue === "string"
            ? leftValue.localeCompare(rightValue, "zh-CN")
            : Number(leftValue) - Number(rightValue);
        return sort.direction === "asc" ? comparison : -comparison;
      });
  }, [works, query, contentLine, format, depthOnly, details, sort]);

  const onSort = (key) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  };

  return (
    <section className="dy-works">
      <SectionHeading
        eyebrow="ALL WORKS"
        title="完整作品明细"
        description={`${formatNumber(works.length)} 条作品完整展示；筛选、排序后点击任意作品进入详情与历史采样。`}
        aside={<span className="dy-count">{filtered.length} / {works.length} 条</span>}
      />
      <div className="dy-filters">
        <label className="dy-search">
          <IconSearch size={16} />
          <span className="sr-only">搜索作品</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索作品标题…" />
          {query ? <button onClick={() => setQuery("")} aria-label="清空搜索"><IconX size={14} /></button> : null}
        </label>
        <label className="dy-select">
          <span>内容线</span>
          <select value={contentLine} onChange={(event) => setContentLine(event.target.value)}>
            <option value="all">全部</option>
            {contentLines.map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
        </label>
        <label className="dy-select">
          <span>体裁</span>
          <select value={format} onChange={(event) => setFormat(event.target.value)}>
            <option value="all">全部</option>
            {formats.map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
        </label>
        <label className="dy-check">
          <input type="checkbox" checked={depthOnly} onChange={(event) => setDepthOnly(event.target.checked)} />
          <span>仅看有深度数据</span>
        </label>
      </div>
      <div className="dy-work-table-wrap">
        <table className="dy-work-table">
          <thead>
            <tr>
              <th className="dy-work-table__title-head">作品</th>
              {sortableColumns.map(([id, label]) => (
                <th key={id}><SortButton id={id} label={label} sort={sort} onSort={onSort} /></th>
              ))}
              <th><span className="dy-sort">数据</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((work) => {
              const hasDetail = Boolean(details[work.id]);
              return (
                <tr key={work.id} onClick={() => onSelect(work)} tabIndex={0} onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelect(work);
                }}>
                  <td className="dy-work-table__title">
                    <div>
                      <strong>{displayTitle(work.title)}</strong>
                      <span>{work.contentLine} · {work.format}</span>
                    </div>
                    <IconChevronRight size={16} />
                  </td>
                  <td>{formatCompactDate(work.publishedAt, false)}</td>
                  <td className="dy-work-table__strong">{formatNumber(work.views)}</td>
                  <td>{formatPercent(work.fiveSecondCompletionRatePct)}</td>
                  <td>{formatPercent(work.twoSecondBounceRatePct)}</td>
                  <td>{formatSeconds(work.averageWatchSeconds)}</td>
                  <td>{formatNumber(work.likes)}</td>
                  <td>{formatNumber(work.shares)}</td>
                  <td>{formatNumber(work.comments)}</td>
                  <td>{formatNumber(work.saves)}</td>
                  <td>{formatNumber(work.profileVisits)}</td>
                  <td>{formatNumber(work.followerGain)}</td>
                  <td>
                    <span className={hasDetail ? "dy-depth-badge dy-depth-badge--yes" : "dy-depth-badge"}>
                      {hasDetail ? "深度" : `${work.history?.length ?? 0} 快照`}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered.length ? <EmptyState title="没有匹配作品" detail="清除筛选条件后可查看全部作品。" /> : null}
      </div>
    </section>
  );
}

function EmptyState({ title, detail, compact = false }) {
  return (
    <div className={`dy-empty${compact ? " dy-empty--compact" : ""}`}>
      <IconChartLine size={compact ? 20 : 28} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function SnapshotHistoryChart({ history }) {
  if (!history?.length) return null;
  return (
    <div className="dy-detail-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={history} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid stroke={LINE} strokeDasharray="2 6" vertical={false} />
          <XAxis
            dataKey="capturedAt"
            tickFormatter={(value) => chartDate(String(value).replace("T", " "), true)}
            axisLine={false}
            tickLine={false}
            minTickGap={30}
            tick={{ fill: INK_SOFT, fontSize: 10 }}
          />
          <YAxis axisLine={false} tickLine={false} width={54} tick={{ fill: INK_SOFT, fontSize: 10 }} />
          <Tooltip content={<ChartTooltip labelFormatter={formatDateTime} />} />
          <Line type="monotone" dataKey="views" name="累计播放" stroke={ACCENT} strokeWidth={2.4} dot={{ r: 3, fill: ACCENT }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function HourlyGrowthChart({ rows, barName = "小时新增", lineName = "累计" }) {
  return (
    <div className="dy-detail-chart dy-detail-chart--large">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid stroke={LINE} strokeDasharray="2 6" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(value) => chartDate(value, true)} axisLine={false} tickLine={false} minTickGap={42} tick={{ fill: INK_SOFT, fontSize: 10 }} />
          <YAxis yAxisId="left" axisLine={false} tickLine={false} width={56} tick={{ fill: INK_SOFT, fontSize: 10 }} />
          <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} width={46} tick={{ fill: INK_SOFT, fontSize: 10 }} />
          <Tooltip content={<ChartTooltip labelFormatter={(value) => value} />} />
          <Bar yAxisId="right" dataKey="value" name={barName} fill={ACCENT_SOFT} opacity={0.54} maxBarSize={16} radius={[3, 3, 0, 0]} />
          <Line yAxisId="left" type="monotone" dataKey="cumulative" name={lineName} stroke={ACCENT} strokeWidth={2.4} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function DailyFollowerChart({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="dy-detail-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid stroke={LINE} strokeDasharray="2 6" vertical={false} />
          <XAxis dataKey="date" tickFormatter={(value) => chartDate(value, true)} axisLine={false} tickLine={false} minTickGap={42} tick={{ fill: INK_SOFT, fontSize: 10 }} />
          <YAxis axisLine={false} tickLine={false} width={52} tick={{ fill: INK_SOFT, fontSize: 10 }} />
          <Tooltip content={<ChartTooltip labelFormatter={(value) => value} />} />
          <Line type="monotone" dataKey="value" name="累计涨粉" stroke={ACCENT} strokeWidth={2.3} dot={{ r: 2, fill: ACCENT }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RetentionChart({ detail }) {
  const rows = detail?.retention?.length
    ? detail.retention
    : detail?.progress?.length
      ? detail.progress
      : [];
  if (!rows.length) {
    return <EmptyState title="没有逐段留存曲线" detail="当前作品未采集进度、留存或跳出曲线，不能由完播率反推。" />;
  }
  const retentionMode = Boolean(detail.retention?.length);
  return (
    <div className="dy-detail-chart dy-detail-chart--large">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid stroke={LINE} strokeDasharray="2 6" vertical={false} />
          <XAxis dataKey="time" axisLine={false} tickLine={false} minTickGap={44} tick={{ fill: INK_SOFT, fontSize: 10 }} />
          <YAxis domain={[0, 100]} axisLine={false} tickLine={false} width={48} tickFormatter={(value) => `${value}%`} tick={{ fill: INK_SOFT, fontSize: 10 }} />
          <Tooltip
            content={
              <ChartTooltip
                units={
                  retentionMode
                    ? { valuePct: "percent", peerPct: "percent" }
                    : { skipRatePct: "percent", rewatchRatePct: "percent" }
                }
              />
            }
          />
          <Line type="monotone" dataKey={retentionMode ? "valuePct" : "skipRatePct"} name={retentionMode ? "本条留存" : "跳过率"} stroke={ACCENT} strokeWidth={2.2} dot={false} connectNulls />
          <Line type="monotone" dataKey={retentionMode ? "peerPct" : "rewatchRatePct"} name={retentionMode ? "同类作品" : "回看率"} stroke={INK} strokeWidth={1.5} strokeDasharray="5 5" dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function BounceChart({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="dy-detail-chart dy-detail-chart--large">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid stroke={LINE} strokeDasharray="2 6" vertical={false} />
          <XAxis dataKey="time" axisLine={false} tickLine={false} minTickGap={44} tick={{ fill: INK_SOFT, fontSize: 10 }} />
          <YAxis domain={[0, 100]} axisLine={false} tickLine={false} width={48} tickFormatter={(value) => `${value}%`} tick={{ fill: INK_SOFT, fontSize: 10 }} />
          <Tooltip content={<ChartTooltip units={{ valuePct: "percent", peerPct: "percent" }} />} />
          <Line type="monotone" dataKey="valuePct" name="本条跳出" stroke={ACCENT} strokeWidth={2.2} dot={false} connectNulls />
          <Line type="monotone" dataKey="peerPct" name="同类作品" stroke={INK} strokeWidth={1.5} strokeDasharray="5 5" dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function MetricGrid({ work, detail }) {
  const metrics = [
    ["播放", detail?.metrics?.views ?? work.views, "number"],
    ["点赞", detail?.metrics?.likes ?? work.likes, "number"],
    ["分享", detail?.metrics?.shares ?? work.shares, "number"],
    ["评论", detail?.metrics?.comments ?? work.comments, "number"],
    ["收藏", detail?.metrics?.saves ?? work.saves, "number"],
    ["主页访问", work.profileVisits, "number"],
    ["涨粉", detail?.metrics?.followerGain ?? work.followerGain, "number"],
    ["完播率", detail?.metrics?.completionRatePct ?? work.completionRatePct, "percent"],
    ["5 秒完播", detail?.metrics?.fiveSecondCompletionRatePct ?? work.fiveSecondCompletionRatePct, "percent"],
    ["2 秒跳出", detail?.metrics?.twoSecondBounceRatePct ?? work.twoSecondBounceRatePct, "percent"],
    ["平均播放", detail?.metrics?.averageWatchSeconds ?? work.averageWatchSeconds, "seconds"],
    ["封面点击", detail?.metrics?.coverClickRatePct ?? work.coverClickRatePct, "percent"],
    ["收藏率", detail?.metrics?.saveRatePct ?? work.saveRatePct, "percent"],
    ["涨粉率", detail?.metrics?.followerGainRatePct ?? work.followerGainRatePct, "percent"],
    ["不感兴趣", detail?.metrics?.notInterested, "number"],
  ];
  return (
    <div className="dy-detail-metrics">
      {metrics.map(([label, value, type]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{valueFormatter(value, type)}</strong>
        </div>
      ))}
    </div>
  );
}

function EvidenceBars({ title, rows, valueKey = "sharePct", limit = 10 }) {
  if (!rows?.length) return null;
  const shown = rows.slice(0, limit);
  const max = Math.max(...shown.map((row) => Number(row[valueKey]) || 0), 1);
  return (
    <section className="dy-evidence-block">
      <h4>{title}</h4>
      <div className="dy-evidence-bars">
        {shown.map((row, index) => (
          <div key={`${row.name}-${index}`}>
            <div><span>{row.name}</span><strong>{valueKey === "heat" ? row.heatRaw : formatPercent(row[valueKey])}</strong></div>
            <i><b style={{ width: `${((Number(row[valueKey]) || 0) / max) * 100}%` }} /></i>
          </div>
        ))}
      </div>
    </section>
  );
}

function TermList({ title, rows }) {
  if (!rows?.length) return null;
  return (
    <section className="dy-evidence-block">
      <h4>{title}</h4>
      <div className="dy-term-list">
        {rows.map((row) => <span key={`${row.rank}-${row.name}`}><b>{row.rank}</b>{row.name}<em>{formatPercent(row.sharePct)}</em></span>)}
      </div>
    </section>
  );
}

function DetailOverview({ work, detail }) {
  return (
    <div className="dy-detail-stack">
      <MetricGrid work={work} detail={detail} />
      <div className="dy-detail-two-col">
        <section className="dy-detail-card">
          <h4>作品口径</h4>
          <dl>
            <div><dt>发布时间</dt><dd>{work.publishedAt}</dd></div>
            <div><dt>体裁</dt><dd>{work.format ?? "—"}</dd></div>
            <div><dt>内容线</dt><dd>{work.contentLine ?? "未分类"}</dd></div>
            <div><dt>审核状态</dt><dd>{work.reviewStatus ?? "—"}</dd></div>
            <div><dt>作品 ID</dt><dd className="mono">{work.platformWorkId ?? "未映射"}</dd></div>
          </dl>
        </section>
        <section className="dy-detail-card">
          <h4>采样覆盖</h4>
          <dl>
            <div><dt>累计快照</dt><dd>{formatNumber(work.history?.length ?? 0)} 个</dd></div>
            <div><dt>小时播放点</dt><dd>{formatNumber(detail?.hourlyViews?.length ?? 0)} 个</dd></div>
            <div><dt>留存 / 进度点</dt><dd>{formatNumber((detail?.retention?.length ?? 0) + (detail?.progress?.length ?? 0))} 个</dd></div>
            <div><dt>详情采样</dt><dd>{detail?.capturedAt ? formatDateTime(detail.capturedAt) : "未采集"}</dd></div>
          </dl>
        </section>
      </div>
      {work.history?.length ? (
        <section className="dy-detail-card">
          <div className="dy-detail-card__head"><h4>累计播放快照</h4><span>非等间隔采样</span></div>
          <SnapshotHistoryChart history={work.history} />
        </section>
      ) : null}
    </div>
  );
}

function DetailGrowth({ work, detail }) {
  const hasHourly = detail?.hourlyViews?.length > 0;
  const hasSnapshots = work.history?.length > 1;
  return (
    <div className="dy-detail-stack">
      {hasHourly ? (
        <section className="dy-detail-card">
          <div className="dy-detail-card__head">
            <div><h4>发布后播放生命周期</h4><p>小时新增柱 + 小时累计线</p></div>
            <span>{detail.hourlyViews.length} 个小时点</span>
          </div>
          <HourlyGrowthChart rows={detail.hourlyViews} barName="小时新增播放" lineName="累计播放" />
          <p className="dy-boundary-note">
            <IconClockHour4 size={15} />
            真实小时增量只覆盖 {detail.hourlyViews[0]?.date} 至 {detail.hourlyViews.at(-1)?.date}；之后未采样的时段不补线。
          </p>
        </section>
      ) : hasSnapshots ? (
        <section className="dy-detail-card">
          <div className="dy-detail-card__head">
            <div><h4>累计播放快照</h4><p>不同采集时点的作品累计值</p></div>
            <span>{work.history.length} 个快照</span>
          </div>
          <SnapshotHistoryChart history={work.history} />
          <p className="dy-boundary-note">
            <IconClockHour4 size={15} />
            这是非等间隔累计快照，不能当作连续播放曲线；两次快照之间的分发过程未知。
          </p>
        </section>
      ) : (
        <EmptyState
          title="该作品没有历史播放采集"
          detail="作品列表只保存当前累计值，无法还原发布后的增长过程。后续需要在 T+1 / T+3 / T+7 / T+30 追加快照。"
        />
      )}
      {detail?.hourlyFollowerGain?.length ? (
        <section className="dy-detail-card">
          <div className="dy-detail-card__head"><h4>小时涨粉</h4><span>{detail.hourlyFollowerGain.length} 个小时点</span></div>
          <HourlyGrowthChart rows={detail.hourlyFollowerGain} barName="小时新增涨粉" lineName="累计涨粉" />
        </section>
      ) : null}
      {detail?.dailyFollowerCumulative?.length ? (
        <section className="dy-detail-card">
          <div className="dy-detail-card__head"><h4>每日累计涨粉</h4><span>{detail.dailyFollowerCumulative.length} 个自然日点</span></div>
          <DailyFollowerChart rows={detail.dailyFollowerCumulative} />
        </section>
      ) : null}
    </div>
  );
}

function DetailRetention({ work, detail }) {
  return (
    <div className="dy-detail-stack">
      <div className="dy-detail-retention-kpis">
        <KpiCard label="2 秒跳出" value={detail?.metrics?.twoSecondBounceRatePct ?? work.twoSecondBounceRatePct} type="percent" hint="越低越好 · 平台原始指标" />
        <KpiCard label="5 秒完播" value={detail?.metrics?.fiveSecondCompletionRatePct ?? work.fiveSecondCompletionRatePct} type="percent" hint="开头承接 · 平台原始指标" />
        <KpiCard label="整体完播" value={detail?.metrics?.completionRatePct ?? work.completionRatePct} type="percent" hint="全片完成 · 平台原始指标" />
        <KpiCard label="平均播放" value={detail?.metrics?.averageWatchSeconds ?? work.averageWatchSeconds} type="seconds" hint="观看深度 · 平台原始指标" />
      </div>
      <section className="dy-detail-card">
        <div className="dy-detail-card__head">
          <div><h4>{detail?.retention?.length ? "逐秒留存" : "观看进度"}</h4><p>不使用插值补齐未采集区间</p></div>
          <span>{formatNumber((detail?.retention?.length ?? 0) + (detail?.progress?.length ?? 0))} 个点</span>
        </div>
        <RetentionChart detail={detail} />
      </section>
      {detail?.bounce?.length ? (
        <section className="dy-detail-card">
          <div className="dy-detail-card__head">
            <div><h4>逐秒跳出</h4><p>本条与同类作品对比</p></div>
            <span>{detail.bounce.length} 个点</span>
          </div>
          <BounceChart rows={detail.bounce} />
        </section>
      ) : null}
      {detail?.pageEvidence?.chapters?.length ? (
        <section className="dy-detail-card">
          <h4>章节点击</h4>
          <div className="dy-chapters">
            {detail.pageEvidence.chapters.map((chapter) => (
              <div key={chapter.rank}><b>{chapter.time}</b><span>{chapter.name}</span><strong>{formatPercent(chapter.clickRatePct)}</strong></div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DetailAudience({ detail }) {
  const evidence = detail?.pageEvidence;
  const hasEvidence =
    detail?.trafficSources?.length ||
    evidence?.incomingSearchTerms?.length ||
    evidence?.geography?.length ||
    evidence?.interests?.length;
  if (!hasEvidence) {
    return <EmptyState title="该作品没有来源与观众维度" detail="当前只采集到作品累计指标，没有可审计的流量来源、搜索词或受众分布。" />;
  }
  return (
    <div className="dy-evidence-grid">
      <EvidenceBars title="流量来源" rows={detail.trafficSources} />
      <TermList title="通过这些词看到作品" rows={evidence.incomingSearchTerms} />
      <TermList title="看完后常搜" rows={evidence.postWatchSearchTerms} />
      <EvidenceBars title="地区 Top 10" rows={evidence.geography} />
      <EvidenceBars title="兴趣分布" rows={evidence.interests} />
      <EvidenceBars title="关注热词" rows={evidence.audienceHotWords} valueKey="heat" />
      {evidence.commentKeywords?.length ? (
        <section className="dy-evidence-block dy-evidence-block--wide">
          <h4>评论热词</h4>
          <div className="dy-keywords">{evidence.commentKeywords.map((item) => <span key={item.rank}><b>{item.rank}</b>{item.name}</span>)}</div>
        </section>
      ) : null}
      {evidence.missingFields?.length ? (
        <div className="dy-missing-note dy-evidence-block--wide">
          <strong>明确缺失</strong>
          <span>{evidence.missingFields.join("、")}只有页面区块，没有可审计数值，因此不展示估读结果。</span>
        </div>
      ) : null}
    </div>
  );
}

function markdownSection(body, heading) {
  const lines = String(body ?? "").replace(/\r/g, "").split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return "";
  const end = lines.findIndex(
    (line, index) => index > start && /^##\s+/.test(line.trim()),
  );
  return lines.slice(start + 1, end < 0 ? lines.length : end).join("\n").trim();
}

function archiveLabel(value, labels) {
  if (!value) return null;
  return labels[value] || value;
}

function DetailContent({ archive }) {
  const [state, setState] = useState({
    loading: true,
    document: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, document: null, error: null });
    loadDocument(archive.documentId).then((response) => {
      if (cancelled) return;
      setState({
        loading: false,
        document: response.data,
        error: response.error,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [archive.documentId]);

  if (state.loading) {
    return (
      <EmptyState
        title="正在读取作品档案"
        detail="从本地知识库载入最终标题、发布标签、封面和口播稿。"
      />
    );
  }
  if (state.error || !state.document) {
    return (
      <EmptyState
        title="作品档案暂时无法读取"
        detail="数据面板仍然可用；请刷新本地索引后重试。"
      />
    );
  }

  const script = markdownSection(state.document.body, "口播稿");
  const statusLabel = archiveLabel(archive.status, {
    published: "已发布",
    ready_to_publish: "待发布",
  });
  const scriptStatusLabel = archiveLabel(archive.scriptStatus, {
    "final-shooting-script": "最终拍摄稿",
    "cleaned-transcript": "清理后转写稿",
    "transcript-only": "字幕转写稿",
  });
  const confidenceLabel = archiveLabel(archive.transcriptConfidence, {
    high: "高",
    medium: "中",
    low: "低",
  });
  const coverStatusLabel = archiveLabel(archive.coverStatus, {
    "archive-reconstruction": "归档重建封面 · 非原始发布封面",
    "local-published-cover": "本地发布封面",
    "local-release-cover": "本地待发布封面",
  });
  const douyinUrl = /^https:\/\/(?:www\.)?douyin\.com\//.test(
    archive.douyinUrl || "",
  )
    ? archive.douyinUrl
    : null;

  return (
    <div className="dy-content-archive">
      <section className="dy-content-archive__hero">
        {archive.coverDocumentId ? (
          <figure className="dy-content-cover">
            <img
              src={`/api/vault-images/${encodeURIComponent(archive.coverDocumentId)}`}
              alt={`${archive.title}封面`}
            />
            <figcaption>
              <IconPhoto size={15} />
              {coverStatusLabel || "本地归档封面"}
            </figcaption>
          </figure>
        ) : null}

        <div className="dy-content-summary">
          <span className="dy-content-summary__eyebrow">PUBLISHED PACKAGE</span>
          <h3>{archive.title}</h3>
          {archive.publishTags?.length ? (
            <div className="dy-content-tags" aria-label="发布标签">
              {archive.publishTags.map((tag) => <span key={tag}>#{tag}</span>)}
            </div>
          ) : null}
          <dl className="dy-content-meta">
            {statusLabel ? <div><dt>状态</dt><dd>{statusLabel}</dd></div> : null}
            {archive.format ? <div><dt>体裁</dt><dd>{archive.format}</dd></div> : null}
            {archive.contentRole ? <div><dt>内容角色</dt><dd>{archive.contentRole}</dd></div> : null}
            {scriptStatusLabel ? <div><dt>稿件证据</dt><dd>{scriptStatusLabel}</dd></div> : null}
            {confidenceLabel ? <div><dt>转写置信度</dt><dd>{confidenceLabel}</dd></div> : null}
            {coverStatusLabel ? <div><dt>封面证据</dt><dd>{coverStatusLabel}</dd></div> : null}
            {archive.platformWorkId ? (
              <div><dt>作品 ID</dt><dd><code>{archive.platformWorkId}</code></dd></div>
            ) : null}
          </dl>
          {douyinUrl ? (
            <a
              className="dy-content-link"
              href={douyinUrl}
              target="_blank"
              rel="noreferrer"
            >
              打开抖音作品 <IconExternalLink size={15} />
            </a>
          ) : null}
        </div>
      </section>

      {script ? (
        <section className="dy-content-script">
          <header>
            <div>
              <span>FINAL ORAL SCRIPT</span>
              <h4><IconQuote size={17} /> 口播稿</h4>
            </div>
            <code>{archive.path}</code>
          </header>
          <div className="dy-content-script__body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{script}</ReactMarkdown>
          </div>
        </section>
      ) : (
        <EmptyState
          title="这条档案暂时没有口播正文"
          detail="保留现有作品数据，不显示空的稿件占位。"
        />
      )}
    </div>
  );
}

const detailTabs = [
  ["overview", "总览"],
  ["growth", "播放历史"],
  ["retention", "留存与进度"],
  ["audience", "来源与受众"],
];

function WorkDetail({ work, detail, onClose }) {
  const [tab, setTab] = useState("overview");
  const tabs = work.contentArchive
    ? [
        detailTabs[0],
        ["content", "标题与口播"],
        ...detailTabs.slice(1),
      ]
    : detailTabs;
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const sources = detail?.sourcePaths?.length
    ? detail.sourcePaths
    : [...new Set((work.history ?? []).map((item) => item.sourcePath).filter(Boolean))];

  return (
    <>
      <motion.button
        className="dy-detail-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        aria-label="关闭作品详情"
      />
      <motion.section
        className="dy-detail"
        role="dialog"
        aria-modal="true"
        aria-label={`${displayTitle(work.title)} 数据详情`}
        initial={{ opacity: 0, y: 24, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.99 }}
        transition={{ duration: 0.2 }}
      >
        <header className="dy-detail__header">
          <div>
            <span className="dy-detail__eyebrow">WORK ANALYTICS · {work.format}</span>
            <h2>{displayTitle(work.title)}</h2>
            <div className="dy-detail__meta">
              <span>{work.publishedAt}</span>
              <span>{work.contentLine}</span>
              <span className={detail ? "dy-depth-badge dy-depth-badge--yes" : "dy-depth-badge"}>
                {detail ? "深度数据已接入" : "仅累计快照"}
              </span>
              {work.contentArchive ? (
                <span className="dy-content-badge">作品档案已归档</span>
              ) : null}
            </div>
          </div>
          <button className="dy-detail__close" onClick={onClose} aria-label="关闭"><IconX /></button>
        </header>
        <nav className="dy-detail__tabs" aria-label="作品详情栏目">
          {tabs.map(([id, label]) => (
            <button key={id} className={tab === id ? "dy-detail__tab dy-detail__tab--active" : "dy-detail__tab"} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
        <div className="dy-detail__body">
          {tab === "overview" ? <DetailOverview work={work} detail={detail} /> : null}
          {tab === "growth" ? <DetailGrowth work={work} detail={detail} /> : null}
          {tab === "retention" ? <DetailRetention work={work} detail={detail} /> : null}
          {tab === "audience" ? <DetailAudience detail={detail} /> : null}
          {tab === "content" && work.contentArchive ? (
            <DetailContent archive={work.contentArchive} />
          ) : null}
          {tab !== "content" ? (
            <section className="dy-sources">
              <div>
                <IconFileAnalytics size={17} />
                <div>
                  <strong>来源与采样边界</strong>
                  <span>
                    {detail?.capturedAt
                      ? `详情采样：${formatDateTime(detail.capturedAt)}`
                      : "没有独立详情采样；仅保留作品列表累计快照。"}
                  </span>
                </div>
              </div>
              {sources.length ? (
                <details>
                  <summary>{sources.length} 个来源文件</summary>
                  <ul>{sources.map((source) => <li key={source}><code>{source}</code></li>)}</ul>
                </details>
              ) : null}
            </section>
          ) : null}
        </div>
      </motion.section>
    </>
  );
}

function QualityNotes({ issues }) {
  if (!issues?.length) return null;
  return (
    <section className="dy-quality">
      <IconAdjustmentsHorizontal size={18} />
      <div>
        <strong>数据质量说明</strong>
        <ul>
          {issues.map((issue, index) => (
            <li key={`${issue.issue}-${index}`}>
              {issue.issue}{issue.affectedWorks ? ` · ${issue.affectedWorks}` : ""}
              {issue.resolution ? <span>{issue.resolution}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function DouyinDashboard({ data }) {
  const [selectedWork, setSelectedWork] = useState(null);
  const analytics = data.analytics ?? {};
  const works = data.items ?? [];
  const details = analytics.workDetails ?? {};
  const capturedAt = analytics.snapshot?.capturedAt ?? data.sourceUpdatedAt;

  return (
    <div className="dy-dashboard">
      {data.demoMode ? (
        <div className="dy-quality" role="status">
          <IconAdjustmentsHorizontal size={18} />
          <div>
            <strong>当前为 synthetic demo 数据</strong>
            <span>标题、作品 ID、日期与指标均为人工虚构，只用于展示数据契约和页面结构。</span>
          </div>
        </div>
      ) : null}
      <div className="dy-snapshot-bar">
        <div>
          <span className="dy-snapshot-bar__pulse" />
          <strong>{data.demoMode ? "虚构演示快照" : "官方本地快照"}</strong>
          <span>{formatDateTime(capturedAt)} · Asia/Shanghai</span>
        </div>
        <div>
          <span><IconSparkles size={14} /> 非实时</span>
          <span>{formatNumber(analytics.snapshot?.snapshotCount)} 个采集批次</span>
          <span>{formatNumber(analytics.coverage?.deepWorkCount)} / {formatNumber(analytics.coverage?.totalWorkCount)} 条有深度包</span>
        </div>
      </div>

      <AccountKpis summary={data.summary ?? {}} account={analytics.account} />

      <AccountWindows account={analytics.account} />

      <div className="dy-primary-grid">
        <AccountTrend daily={analytics.account?.daily} summary={analytics.account?.summary} />
        <CollectionCard collections={analytics.collections} />
      </div>

      <SectionHeading
        eyebrow="CONTENT MIX"
        title="内容分布"
        description="同一份当前作品事实表聚合；按播放贡献观察结构，再回到作品明细验证。"
      />
      <div className="dy-mix-grid">
        <DistributionPanel title="内容线贡献" eyebrow="CONTENT LINE" items={data.contentLines} totalViews={data.summary?.totalViews} />
        <DistributionPanel title="体裁贡献" eyebrow="FORMAT" items={data.formats} totalViews={data.summary?.totalViews} />
      </div>

      <DataAssets coverage={analytics.coverage} />
      <WorksExplorer works={works} details={details} onSelect={setSelectedWork} />
      <QualityNotes issues={data.qualityIssues} />

      <footer className="dy-provenance">
        <span>PRIMARY SOURCE</span>
        <code>{data.sourcePath}</code>
        <span>作品发布时间范围 {data.range?.from} → {data.range?.to}</span>
      </footer>

      <AnimatePresence>
        {selectedWork ? (
          <WorkDetail
            key={selectedWork.id}
            work={selectedWork}
            detail={details[selectedWork.id]}
            onClose={() => setSelectedWork(null)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
