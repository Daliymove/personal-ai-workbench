import { useCallback, useEffect, useState } from "react";
import {
  IconArrowUpRight,
  IconClock,
  IconExternalLink,
  IconEye,
  IconRefresh,
  IconShieldCheck,
  IconStack2,
} from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { loadDailyHot } from "../lib/api";
import { formatCompactDate, formatFullDate } from "../lib/format";
import "../components/daily-hot/daily-hot.css";

function ExternalNewsLink({ children, className = "", href, label }) {
  if (!href) return null;
  return (
    <a
      aria-label={label}
      className={className}
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}

function ItemMeta({ item }) {
  return (
    <div className="daily-hot-card__meta">
      <span>{item.evidence?.label || "来源待核对"}</span>
      {item.categoryLabel ? <span>{item.categoryLabel}</span> : null}
      <span>{formatCompactDate(item.latestAt || item.discoveredAt || item.publishedAt)}</span>
    </div>
  );
}

function HotCard({ item, index, featured = false }) {
  const primaryLink = item.links?.story || item.links?.aihot;
  const domain = item.attention?.domains?.[0]?.label;

  return (
    <article
      className={`daily-hot-card${featured ? " daily-hot-card--featured" : ""}`}
    >
      <div className="daily-hot-card__index" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="daily-hot-card__body">
        <div className="daily-hot-card__eyebrow">
          <span>{item.kind === "hot-topic" ? "MULTI-SOURCE EVENT" : "AI HOT SELECTED"}</span>
          {domain ? <span className="daily-hot-card__domain">{domain}</span> : null}
        </div>
        <h3>{item.title}</h3>
        <p className="daily-hot-card__reason">{item.attention?.reason}</p>
        {item.summary ? (
          <div className="daily-hot-card__summary">
            <span>AI HOT 综述</span>
            <p>{item.summary}</p>
          </div>
        ) : null}
        {item.latest ? (
          <p className="daily-hot-card__latest">
            <strong>最新进展</strong>
            {item.latest}
          </p>
        ) : null}
        <ItemMeta item={item} />
        <div className="daily-hot-card__actions">
          <ExternalNewsLink
            className="daily-hot-link daily-hot-link--primary"
            href={primaryLink}
            label={`在 AI HOT 查看：${item.title}`}
          >
            查看事件 <IconArrowUpRight aria-hidden="true" />
          </ExternalNewsLink>
          <ExternalNewsLink
            className="daily-hot-link"
            href={item.links?.original}
            label={`查看原始来源：${item.title}`}
          >
            原始来源 <IconExternalLink aria-hidden="true" />
          </ExternalNewsLink>
        </div>
      </div>
    </article>
  );
}

function CompactHotRow({ item }) {
  const primaryLink = item.links?.story || item.links?.aihot;
  return (
    <article className="daily-hot-row">
      <div>
        <span className="daily-hot-row__kind">
          {item.kind === "hot-topic" ? item.evidence?.label : "24 小时精选"}
        </span>
        <h3>{item.title}</h3>
        <p>{item.attention?.reason}</p>
      </div>
      <div className="daily-hot-row__aside">
        <time>{formatCompactDate(item.latestAt || item.discoveredAt || item.publishedAt)}</time>
        <ExternalNewsLink
          className="daily-hot-row__open"
          href={primaryLink}
          label={`打开：${item.title}`}
        >
          阅读 <IconArrowUpRight aria-hidden="true" />
        </ExternalNewsLink>
      </div>
    </article>
  );
}

function LoadingState() {
  return (
    <div className="daily-hot-loading" aria-label="正在读取 AI HOT">
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}

export function DailyHotPage() {
  const [result, setResult] = useState({ data: null, source: "loading", error: null });
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (force = false) => {
    setRefreshing(true);
    try {
      setResult(await loadDailyHot({ refresh: force }));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  const loading = result.source === "loading";
  const live = result.source === "live";
  const data = result.data;
  const unavailable = !loading && !live;
  const stale = data?.status === "stale";
  const mustRead = data?.tiers?.mustRead || [];
  const browse = data?.tiers?.browse || [];
  const other = data?.tiers?.other || [];

  const sourceAside = (
    <div className="daily-hot-source">
      <div>
        <span className={`status-dot${stale ? " status-dot--warn" : " status-dot--ok"}`} />
        <strong>{stale ? "上一版有效数据" : live ? "AI HOT 已连接" : "连接中"}</strong>
      </div>
      <span>{data?.fetchedAt ? formatFullDate(data.fetchedAt) : "等待首次刷新"}</span>
    </div>
  );

  return (
    <div className="page page--daily-hot">
      <PageHeader
        eyebrow="EXTERNAL SIGNALS · AI HOT"
        title="每日热点"
        aside={sourceAside}
      />

      <section className="daily-hot-summary" aria-label="热点概览">
        <div>
          <strong>{loading ? "…" : data?.counts?.upstreamHot ?? "—"}</strong>
          <span>多源热点</span>
        </div>
        <div>
          <strong>{loading ? "…" : mustRead.length}</strong>
          <span>今日必看</span>
        </div>
        <div>
          <strong>{loading ? "…" : data?.counts?.upstreamSelected24h ?? "—"}</strong>
          <span>24H 精选</span>
        </div>
      </section>

      <div className="daily-hot-toolbar">
        <div className="daily-hot-daily">
          <IconClock aria-hidden="true" />
          <span>
            AI 日报 {data?.daily?.date || "—"} · {data?.daily?.itemCount ?? "—"} 条 · 北京时间 08:00 发布
          </span>
          <ExternalNewsLink
            className="daily-hot-inline-link"
            href={data?.daily?.links?.aihot}
            label="打开 AI HOT 日报"
          >
            打开日报 <IconArrowUpRight aria-hidden="true" />
          </ExternalNewsLink>
        </div>
        <button
          className="daily-hot-refresh"
          disabled={refreshing}
          onClick={() => void refresh(true)}
          type="button"
        >
          <IconRefresh aria-hidden="true" />
          {refreshing ? "刷新中" : "刷新"}
        </button>
      </div>

      {stale ? (
        <div className="daily-hot-warning" role="status">
          当前刷新失败，正在展示 {formatFullDate(data?.fetchedAt)} 的上一版有效结果。{data?.error?.message}
        </div>
      ) : null}

      {loading ? (
        <LoadingState />
      ) : unavailable ? (
        <div className="error-note daily-hot-unavailable">
          <strong>AI HOT 暂时无法读取</strong>
          <p>{result.error?.message || data?.error?.message || "本地数据服务或外部来源不可用。"}</p>
          <button onClick={() => void refresh(true)} type="button">重新连接</button>
        </div>
      ) : (
        <>
          <section className="daily-hot-section" aria-labelledby="must-read-title">
            <header className="daily-hot-section__head">
              <div>
                <span className="daily-hot-section__icon"><IconEye aria-hidden="true" /></span>
                <div>
                  <span className="eyebrow">MUST READ</span>
                  <h2 id="must-read-title">今日必看</h2>
                </div>
              </div>
            </header>

            {mustRead.length > 0 ? (
              <div className="daily-hot-featured-grid">
                {mustRead.map((item, index) => (
                  <HotCard featured index={index} item={item} key={item.id} />
                ))}
              </div>
            ) : (
              <div className="daily-hot-calm">
                <IconShieldCheck aria-hidden="true" />
                <div>
                  <strong>今天没有必看热点</strong>
                  <span>仍可查看值得浏览和其余动态。</span>
                </div>
              </div>
            )}
          </section>

          <section className="daily-hot-section" aria-labelledby="browse-title">
            <header className="daily-hot-section__head">
              <div>
                <span className="daily-hot-section__icon"><IconStack2 aria-hidden="true" /></span>
                <div>
                  <span className="eyebrow">WORTH BROWSING</span>
                  <h2 id="browse-title">值得浏览</h2>
                </div>
              </div>
            </header>
            <div className="daily-hot-browse-list">
              {browse.length > 0 ? (
                browse.map((item) => <CompactHotRow item={item} key={item.id} />)
              ) : (
                <div className="collection-empty">当前没有更多值得浏览的动态。</div>
              )}
            </div>
          </section>

          {other.length > 0 ? (
            <details className="daily-hot-other">
              <summary>
                <span>其余动态</span>
                <span>{other.length} 条低优先级候选</span>
              </summary>
              <div className="daily-hot-other__list">
                {other.map((item) => <CompactHotRow item={item} key={item.id} />)}
              </div>
            </details>
          ) : null}

          <footer className="daily-hot-footnote">
            <span>数据来源：AI HOT</span>
            <span>标题、摘要与事件综述可能由 AI 生成；数字、政策与原话请回第三方原文核对。</span>
          </footer>
        </>
      )}
    </div>
  );
}
