import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import gsap from "gsap";
import { IconArrowUpRight } from "@tabler/icons-react";
import { DecryptedText } from "../components/DecryptedText";
import { DotEyes } from "../components/DotEyes";
import { KnowledgeGraph } from "../components/KnowledgeGraph";
import { MetricStat } from "../components/MetricStat";
import { loadGraph, loadOverview } from "../lib/api";
import { formatCompactDate } from "../lib/format";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const REFRESH_INTERVAL_MS = 60_000;

let overviewEntranceHasCompleted = false;

const STAGE_LABELS = {
  filmed: "已拍",
  material_validating: "素材验证",
  framework_ready: "框架就绪",
  ready_to_shoot: "准备完成",
  published: "已发布",
  selected: "已确认",
  idea: "候选",
};

export function OverviewPage({ onOpenDocument }) {
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [graph, setGraph] = useState(null);
  const rootRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const refreshOverview = () => {
      loadOverview().then((res) => {
        if (!cancelled) setOverview(res);
      });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshOverview();
    };
    refreshOverview();
    loadGraph().then((res) => {
      if (!cancelled) setGraph(res);
    });
    const interval = window.setInterval(refreshOverview, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshOverview);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOverview);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  // 入场编排：hero → 指标条 → 面板，GSAP 一次性时间线
  useEffect(() => {
    if (!overview || overviewEntranceHasCompleted) return undefined;
    if (prefersReducedMotion()) {
      overviewEntranceHasCompleted = true;
      return undefined;
    }
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from("[data-hero] > div > *", { y: 18, opacity: 0, duration: 0.5, stagger: 0.07 })
        .from(".metric-strip", { y: 16, opacity: 0, duration: 0.45 }, "-=0.25")
        .from(
          "[data-panel]",
          { y: 20, opacity: 0, duration: 0.5, stagger: 0.08 },
          "-=0.2",
        );
      tl.eventCallback("onComplete", () => {
        overviewEntranceHasCompleted = true;
      });
    }, rootRef);
    return () => ctx.revert();
  }, [overview]);

  const metrics = overview?.data?.metrics ?? {};
  const demoMode = overview?.data?.demoMode === true;
  const recent = overview?.data?.recent ?? [];
  const activity = overview?.data?.activity ?? [];
  const provenance = overview?.data?.qualityNotices ?? [];
  const graphData = graph?.data;

  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("zh-CN", {
        month: "long",
        day: "numeric",
        weekday: "long",
      }).format(new Date()),
    [],
  );

  const fromFallback = overview?.source === "fallback";
  const overviewLoading = !overview;
  const liveDataReady = Boolean(overview && !fromFallback);
  const overviewSettled = Boolean(overview);

  return (
    <div ref={rootRef}>
      <section className="hero" data-hero>
        <div>
          <span className="eyebrow">
            <DecryptedText
              active={liveDataReady}
              settleWithoutAnimation={overviewSettled && !liveDataReady}
              text="PERSONAL AI WORKBENCH"
            />
            <span aria-hidden="true">·</span>
            <span>{today}</span>
          </span>
          <h1 className="hero__title">工作台总览</h1>
          <div className="hero__meta">
            <span className="badge">
              <span className="status-dot status-dot--ok" /> {demoMode ? "示例 Vault" : "本地 Vault"}
            </span>
            {overviewLoading ? (
              <span className="badge">
                <span className="status-dot" /> 索引连接中
              </span>
            ) : fromFallback ? (
              <span className="badge">
                <span className="status-dot status-dot--warn" /> 数据服务离线
              </span>
            ) : (
              <span className="badge badge--accent">索引实时</span>
            )}
          </div>
        </div>
        <DotEyes awake={liveDataReady} />
      </section>

      <div className="metric-strip">
        <MetricStat label="RAW 素材" value={metrics.raw ?? null} hint="原始证据层" />
        <MetricStat label="WIKI 页面" value={metrics.wiki ?? null} hint="知识层" accent />
        <MetricStat
          label="选题"
          value={metrics.topics ?? null}
          hint={`候选 ${metrics.candidates ?? "—"}`}
        />
        <MetricStat label="已发布作品" value={metrics.publishedWorks ?? null} hint="抖音" />
        <MetricStat
          label="总播放"
          value={metrics.totalPlays ?? null}
          hint="全部作品累计"
          accent
        />
        <MetricStat
          label="知识链接"
          value={graphData?.stats?.edgeCount ?? null}
          hint="Wiki 双向关系"
        />
      </div>

      <div className="overview-grid">
        <div className="overview-stack">
          <section className="panel graph-preview panel--hover" data-panel>
            <div className="graph-preview__overlay">
              <span className="eyebrow">KNOWLEDGE GRAPH</span>
            </div>
            {graphData && graphData.nodes.length > 0 ? (
              <>
                <KnowledgeGraph
                  edges={graphData.edges}
                  nodes={graphData.nodes}
                  preview
                />
                <span className="graph-preview__stats">
                  {graphData.stats.nodeCount} nodes · {graphData.stats.edgeCount} links
                </span>
              </>
            ) : (
              <div className="collection-empty">图谱数据加载中…</div>
            )}
            <button
              className="graph-preview__cta graph-filter graph-filter--on"
              onClick={() => navigate("/graph")}
              type="button"
            >
              进入星图 <IconArrowUpRight size={14} />
            </button>
          </section>

          <section className="panel" data-panel>
            <div className="panel__head">
              <div>
                <span className="eyebrow">RECENT</span>
                <h2 className="panel__title" style={{ marginTop: 8 }}>
                  最近更新
                </h2>
              </div>
            </div>
            <div className="recent-list">
              {recent.length === 0 ? (
                <div className="collection-empty">暂无记录</div>
              ) : (
                recent.map((item) => (
                  <div
                    className="recent-item"
                    key={item.id}
                    onClick={() => onOpenDocument?.(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onOpenDocument?.(item);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span
                      className={`status-dot${item.type === "Wiki" ? " status-dot--accent" : ""}`}
                    />
                    <span className="recent-item__title">{item.title}</span>
                    <span className="recent-item__meta">{item.section}</span>
                    <span className="recent-item__meta">
                      {formatCompactDate(item.updatedAt, false)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="overview-stack">
          <section className="panel" data-panel>
            <div className="panel__head">
              <div>
                <span className="eyebrow">PIPELINE</span>
                <h2 className="panel__title" style={{ marginTop: 8 }}>
                  生产动态
                </h2>
              </div>
              <button
                className="graph-filter"
                onClick={() => navigate("/content")}
                type="button"
              >
                内容中心
              </button>
            </div>
            <div className="pipeline">
              {activity.length === 0 ? (
                <div className="collection-empty">暂无拍摄动态</div>
              ) : (
                activity.map((item) => (
                  <div
                    className="pipeline__row"
                    key={item.id}
                    onClick={() => onOpenDocument?.(item.documentId)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onOpenDocument?.(item.documentId);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="status-dot status-dot--accent status-dot--pulse" />
                    <span className="pipeline__title">{item.title}</span>
                    <span className="pipeline__stage">
                      {STAGE_LABELS[item.status] ?? item.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="panel" data-panel>
            <div className="panel__head">
              <div>
                <span className="eyebrow">WIKI STATUS</span>
                <h2 className="panel__title" style={{ marginTop: 8 }}>
                  知识层健康度
                </h2>
              </div>
            </div>
            <div className="pipeline">
              {[
                ["active", "活跃", overview?.data?.wikiStatus?.active],
                ["needsReview", "待复核", overview?.data?.wikiStatus?.needsReview],
                ["deprecated", "已弃用", overview?.data?.wikiStatus?.deprecated],
              ].map(([key, label, count]) => (
                <div className="pipeline__row" key={key}>
                  <span
                    className={`status-dot${
                      key === "active"
                        ? " status-dot--ok"
                        : key === "needsReview"
                          ? " status-dot--warn"
                          : ""
                    }`}
                  />
                  <span className="pipeline__title">{label}</span>
                  <span className="pipeline__stage mono">{count ?? "—"}</span>
                </div>
              ))}
            </div>
            {provenance.length > 0 ? (
              <div className="provenance">
                {provenance.slice(0, 2).map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
