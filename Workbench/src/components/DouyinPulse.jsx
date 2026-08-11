import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconChartBar,
  IconChartLine,
} from "@tabler/icons-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getAccentFamily, subscribeTheme } from "../lib/theme.js";

let ACCENT_STRONG = getAccentFamily().accentStrong;
let ACCENT_GLOW_STRONG = getAccentFamily().accentGlowStrong;
subscribeTheme((family) => {
  ACCENT_STRONG = family.accentStrong;
  ACCENT_GLOW_STRONG = family.accentGlowStrong;
});

export const DEFAULT_DOUYIN_PULSE_DATA = [];

export const DEFAULT_DOUYIN_METRICS = {
  totalPlays: {
    label: "总播放",
    value: null,
    change: null,
  },
  profileVisits: {
    label: "主页访问",
    value: null,
    change: null,
  },
  knowledgeContribution: {
    label: "个人知识库内容播放占比",
    value: null,
    suffix: "%",
    change: null,
  },
};

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

function formatAxisValue(value) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(Number(value))
  ) {
    return "—";
  }

  const number = Number(value);
  if (number === 0) return "0";
  if (Math.abs(number) < 1000) return number.toLocaleString("zh-CN");
  return `${Math.round(number / 1000)}K`;
}

function formatPeriodLabel(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})$/);
  return match ? `${Number(match[2])}月` : String(value ?? "");
}

function buildAxisScale(points, field) {
  const maximum = Math.max(
    0,
    ...points
      .map((point) => point?.[field])
      .filter(
        (value) =>
          value !== null &&
          value !== undefined &&
          value !== "" &&
          Number.isFinite(Number(value)),
      )
      .map(Number)
      .filter((value) => Number.isFinite(value)),
  );

  if (maximum <= 0) {
    return { domain: [0, 1], ticks: [0, 1] };
  }

  const roughStep = maximum / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const multiplier =
    normalized <= 1
      ? 1
      : normalized <= 2
        ? 2
        : normalized <= 2.5
          ? 2.5
          : normalized <= 5
            ? 5
            : 10;
  const step = multiplier * magnitude;
  const domainMaximum = Math.ceil(maximum / step) * step;
  const ticks = [];
  for (let value = 0; value <= domainMaximum + step / 2; value += step) {
    ticks.push(value);
  }
  return { domain: [0, domainMaximum], ticks };
}

function defaultFormatMetric(value, metric) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    Number.isNaN(Number(value))
  ) {
    return "—";
  }

  const formattedValue =
    typeof value === "number"
      ? value.toLocaleString("zh-CN", {
          maximumFractionDigits: 2,
        })
      : value;

  return `${metric.prefix ?? ""}${formattedValue}${metric.suffix ?? ""}`;
}

function PulseTooltip({
  active,
  barLabel,
  label,
  lineLabel,
  payload,
  numberFormatter,
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0]?.payload;

  if (!point) {
    return null;
  }

  return (
    <div
      aria-label={`${label}，${barLabel} ${numberFormatter(point.plays)}，${lineLabel} ${numberFormatter(point.cumulativePlays)}`}
      className="douyin-pulse__tooltip"
      role="status"
    >
      <strong>{numberFormatter(point.plays)}</strong>
    </div>
  );
}

function Trend({ change, comparisonLabel = "较上周期" }) {
  if (typeof change !== "number") {
    return null;
  }

  const isDown = change < 0;
  const TrendIcon = isDown ? IconArrowDownRight : IconArrowUpRight;

  return (
    <span
      className={joinClassNames(
        "douyin-pulse__trend",
        isDown
          ? "douyin-pulse__trend--down"
          : "douyin-pulse__trend--up",
      )}
    >
      <span>{comparisonLabel}</span>
      <TrendIcon aria-hidden="true" className="douyin-pulse__trend-icon" />
      <span>{Math.abs(change).toFixed(2)}%</span>
    </span>
  );
}

function Metric({ metric, formatter, featured = false }) {
  return (
    <article
      className={joinClassNames(
        "douyin-pulse__metric",
        featured && "douyin-pulse__metric--featured",
      )}
    >
      <span className="douyin-pulse__metric-label">{metric.label}</span>
      <strong className="douyin-pulse__metric-value">
        {formatter(metric.value, metric)}
      </strong>
      <Trend
        change={metric.change}
        comparisonLabel={metric.comparisonLabel}
      />
    </article>
  );
}

export function DouyinPulse({
  title = "抖音作品数据",
  data = DEFAULT_DOUYIN_PULSE_DATA,
  metrics = DEFAULT_DOUYIN_METRICS,
  barLabel = "当月发布作品的当前累计播放",
  lineLabel = "截至该发布月累计播放",
  viewDataLabel = "查看数据",
  emptyLabel = "暂无按作品发布月份汇总的数据",
  onPointClick,
  onViewData,
  reducedMotion = false,
  formatMetric = defaultFormatMetric,
  formatNumber = (value) =>
    value === null ||
    value === undefined ||
    value === "" ||
    Number.isNaN(Number(value))
      ? "—"
      : Number(value).toLocaleString("zh-CN"),
  className,
}) {
  const points = Array.isArray(data) ? data : [];
  const playsScale = buildAxisScale(points, "plays");
  const cumulativeScale = buildAxisScale(points, "cumulativePlays");
  const normalizedMetrics = {
    totalPlays: {
      ...DEFAULT_DOUYIN_METRICS.totalPlays,
      ...metrics?.totalPlays,
    },
    profileVisits: {
      ...DEFAULT_DOUYIN_METRICS.profileVisits,
      ...metrics?.profileVisits,
    },
    knowledgeContribution: {
      ...DEFAULT_DOUYIN_METRICS.knowledgeContribution,
      ...metrics?.knowledgeContribution,
    },
  };

  const handleChartClick = (state) => {
    const point = state?.activePayload?.[0]?.payload;

    if (!point || typeof onPointClick !== "function") {
      return;
    }

    const index = Number(state.activeTooltipIndex);
    onPointClick(point, Number.isNaN(index) ? -1 : index, state);
  };

  return (
    <section
      className={joinClassNames(
        "douyin-pulse",
        reducedMotion && "douyin-pulse--reduced-motion",
        className,
      )}
      aria-labelledby="douyin-pulse-title"
    >
      <div className="douyin-pulse__visual">
        <header className="douyin-pulse__header">
          <h2 className="douyin-pulse__title" id="douyin-pulse-title">
            {title}
          </h2>
          <div className="douyin-pulse__legend" aria-label="图例">
            <span className="douyin-pulse__legend-item douyin-pulse__legend-item--bar">
              <IconChartBar
                aria-hidden="true"
                className="douyin-pulse__legend-icon"
              />
              {barLabel}
            </span>
            <span className="douyin-pulse__legend-item douyin-pulse__legend-item--line">
              <IconChartLine
                aria-hidden="true"
                className="douyin-pulse__legend-icon"
              />
              {lineLabel}
            </span>
          </div>
        </header>

        <div
          className="douyin-pulse__chart"
          aria-label="抖音作品播放汇总，按作品发布月份统计"
        >
          {points.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%" debounce={40}>
              <ComposedChart
                accessibilityLayer
                data={points}
                margin={{ top: 18, right: 2, bottom: 0, left: 0 }}
                onClick={handleChartClick}
              >
                <CartesianGrid
                  className="douyin-pulse__grid"
                  stroke="currentColor"
                  vertical={false}
                />
                <XAxis
                  axisLine={false}
                  className="douyin-pulse__axis douyin-pulse__axis--x"
                  dataKey="date"
                  tickFormatter={formatPeriodLabel}
                  tickLine={false}
                />
                <YAxis
                  axisLine={false}
                  className="douyin-pulse__axis douyin-pulse__axis--plays"
                  domain={playsScale.domain}
                  tickFormatter={formatAxisValue}
                  tickLine={false}
                  ticks={playsScale.ticks}
                  width={42}
                  yAxisId="plays"
                />
                <YAxis
                  axisLine={false}
                  className="douyin-pulse__axis douyin-pulse__axis--cumulative"
                  domain={cumulativeScale.domain}
                  orientation="right"
                  tickFormatter={formatAxisValue}
                  tickLine={false}
                  ticks={cumulativeScale.ticks}
                  width={48}
                  yAxisId="cumulative"
                />
                <Tooltip
                  content={
                    <PulseTooltip
                      barLabel={barLabel}
                      lineLabel={lineLabel}
                      numberFormatter={formatNumber}
                    />
                  }
                  cursor={false}
                />
                <Bar
                  barSize={22}
                  className="douyin-pulse__series douyin-pulse__series--bar"
                  dataKey="plays"
                  fill="currentColor"
                  isAnimationActive={!reducedMotion}
                  name={barLabel}
                  radius={[4, 4, 0, 0]}
                  yAxisId="plays"
                >
                  {points.map((point, index) => (
                    <Cell
                      fill={
                        index === points.length - 1
                          ? ACCENT_STRONG
                          : ACCENT_GLOW_STRONG
                      }
                      key={`${point.date}-${index}`}
                    />
                  ))}
                </Bar>
                <Line
                  activeDot={{
                    className: "douyin-pulse__active-dot",
                  }}
                  className="douyin-pulse__series douyin-pulse__series--line"
                  dataKey="cumulativePlays"
                  dot={{
                    className: "douyin-pulse__dot",
                  }}
                  isAnimationActive={!reducedMotion}
                  name={lineLabel}
                  stroke="currentColor"
                  strokeWidth={2}
                  type="monotone"
                  yAxisId="cumulative"
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <p className="douyin-pulse__empty">{emptyLabel}</p>
          )}
        </div>
      </div>

      <aside className="douyin-pulse__summary" aria-label="抖音数据摘要">
        <div className="douyin-pulse__summary-primary">
          <Metric
            formatter={formatMetric}
            metric={normalizedMetrics.totalPlays}
          />
          <Metric
            formatter={formatMetric}
            metric={normalizedMetrics.profileVisits}
          />
        </div>
        <div className="douyin-pulse__summary-featured">
          <Metric
            featured
            formatter={formatMetric}
            metric={normalizedMetrics.knowledgeContribution}
          />
          <button
            className="douyin-pulse__view-button"
            onClick={onViewData}
            type="button"
          >
            {viewDataLabel}
          </button>
        </div>
      </aside>
    </section>
  );
}

export default DouyinPulse;
