import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconBook2,
  IconBrandTiktok,
  IconBrandWeibo,
  IconBulb,
  IconCalendar,
  IconCheck,
  IconCircleCheck,
  IconCopy,
  IconCornerDownRight,
  IconDatabase,
  IconDownload,
  IconExternalLink,
  IconFileText,
  IconFocus2,
  IconGitBranch,
  IconLock,
  IconMessage2,
  IconMessageCircle,
  IconPresentation,
  IconQuote,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconSocial,
  IconTargetArrow,
} from "@tabler/icons-react";

import { PageHeader } from "../components/PageHeader";
import { SocialInsightPresentation } from "../components/social-insights/SocialInsightPresentation";
import {
  loadSocialInsight,
  loadSocialInsights,
  loadSocialTrend,
  loadSocialTrends,
} from "../lib/api";
import { launchCodexClient } from "../lib/reader-ui";
import {
  buildSocialResearchHandoff,
  filterSocialInsights,
  presentationProjection,
  SOCIAL_RESEARCH_DEPTHS,
  SOCIAL_RESEARCH_WINDOWS,
} from "../lib/social-insights";
import {
  buildSocialInsightStandaloneHtml,
  buildSocialTrendStandaloneHtml,
  downloadStandaloneSocialHtml,
  standaloneSocialHtmlFilename,
} from "../lib/social-insights-html";
import "../components/social-insights/social-insights.css";

const EMPTY_FILTERS = {
  query: "",
  primaryPlatform: "all",
  auxiliaryPlatform: "all",
  status: "all",
  dateRange: "all",
};

const DETAIL_VIEWS = [
  ["needs", "需求", IconMessageCircle],
  ["camps", "观点", IconSocial],
  ["chains", "评论回复", IconGitBranch],
  ["platforms", "平台差异", IconSocial],
  ["evidence", "证据摘录", IconShieldCheck],
  ["method", "样本与边界", IconDatabase],
];

function dateOnly(value) {
  if (!value) return "未提供";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed).replaceAll("/", "-");
}

function displayValue(value) {
  return value == null ? "未提供" : Number(value).toLocaleString("zh-CN");
}

function PlatformIcon({ platform }) {
  const value = String(platform || "").toLowerCase();
  if (value.includes("小红书") || value.includes("xiaohongshu")) return <IconBook2 aria-hidden="true" />;
  if (value.includes("抖音") || value.includes("douyin") || value.includes("tiktok")) return <IconBrandTiktok aria-hidden="true" />;
  if (value.includes("微博") || value.includes("weibo")) return <IconBrandWeibo aria-hidden="true" />;
  return <IconSocial aria-hidden="true" />;
}

function detailViewCount(report, view) {
  const counts = {
    needs: report.needs?.length,
    camps: report.camps?.length,
    chains: report.commentReplyChains?.length,
    platforms: report.platformDifferences?.length,
    evidence: report.evidence?.length,
    method: report.sampleRows?.length,
  };
  return counts[view] ?? 0;
}

function statusText(status) {
  const labels = {
    complete: "研究完成",
    partial: "部分完成",
    "needs-review": "需要复查",
  };
  return labels[status] || status || "未标注状态";
}

function warningSummary(warnings) {
  const errorCount = (warnings ?? []).filter((item) => item.severity === "error").length;
  if (errorCount) return `${errorCount} 项结构问题`;
  if (warnings?.length) return `${warnings.length} 项解析提醒`;
  return "结构校验通过";
}

function compactText(value, limit = 108) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const draft = text.slice(0, limit);
  const stop = Math.max(draft.lastIndexOf("。"), draft.lastIndexOf("；"), draft.lastIndexOf("，"));
  return `${draft.slice(0, stop > limit * 0.55 ? stop + 1 : limit)}…`;
}

function findingPreview(finding) {
  const body = (finding?.body ?? []).filter(Boolean);
  const first = body[0] || "未提供判断摘要";
  const candidate = /[：:]$/.test(first) || first.length < 28 ? body.at(-1) || first : first;
  return compactText(candidate, 96);
}

function ArchiveCard({ onOpenDocument, report }) {
  return (
    <article className="social-archive-card social-archive-card--compact">
      <div className="social-archive-card__copy">
        <h2>{report.title || "未提供标题"}</h2>
        <p className="social-archive-card__question">{report.question || "未提供研究问题"}</p>
      </div>
      <div className="social-archive-card__actions">
        <button onClick={() => onOpenDocument(report.sourceDocumentId)} type="button">
          <IconFileText aria-hidden="true" /> 原报告
        </button>
        <Link to={`/social-insights/${encodeURIComponent(report.id)}`}>
          查看洞察 <IconArrowRight aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

function ArchiveLoading() {
  return (
    <div className="social-archive-loading" aria-label="正在读取社媒洞察">
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}

function ResearchTriggerDialog({ initialMode, onClose }) {
  const [mode, setMode] = useState(initialMode);
  const [scope, setScope] = useState("AI");
  const [topic, setTopic] = useState("");
  const [question, setQuestion] = useState("");
  const [timeWindow, setTimeWindow] = useState(
    initialMode === "trend-scan" ? "7d" : "30d",
  );
  const [depth, setDepth] = useState("standard");
  const [handoffState, setHandoffState] = useState("idle");
  const prompt = useMemo(
    () => buildSocialResearchHandoff({
      mode,
      scope,
      topic,
      question,
      timeWindow,
      depth,
    }),
    [depth, mode, question, scope, timeWindow, topic],
  );
  const topicMissing = mode === "topic-deep-dive" && !topic.trim();

  const copyAndLaunch = async () => {
    if (topicMissing) return;
    try {
      await navigator.clipboard.writeText(prompt);
      const launched = launchCodexClient(globalThis.location);
      setHandoffState(launched ? "launched" : "copied");
    } catch {
      setHandoffState("failed");
    }
  };

  return (
    <div className="social-trigger-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section aria-labelledby="social-trigger-title" aria-modal="true" className="social-trigger-dialog" role="dialog">
        <header>
          <div>
            <span>主动研究</span>
            <h2 id="social-trigger-title">{mode === "trend-scan" ? "扫描近期风向" : "深挖一个主题"}</h2>
          </div>
          <button aria-label="关闭" onClick={onClose} type="button">×</button>
        </header>

        <div className="social-trigger-mode" role="group" aria-label="选择研究模式">
          <button aria-pressed={mode === "trend-scan"} onClick={() => {
            setMode("trend-scan");
            setTimeWindow("7d");
          }} type="button">风向扫描</button>
          <button aria-pressed={mode === "topic-deep-dive"} onClick={() => {
            setMode("topic-deep-dive");
            setTimeWindow("30d");
          }} type="button">主题深挖</button>
        </div>

        <div className="social-trigger-fields">
          {mode === "trend-scan" ? (
            <label>
              <span>扫描范围</span>
              <input onChange={(event) => setScope(event.target.value)} placeholder="例如：AI、Agent、AI 编程" value={scope} />
            </label>
          ) : (
            <>
              <label>
                <span>研究主题</span>
                <input aria-invalid={topicMissing} autoFocus onChange={(event) => setTopic(event.target.value)} placeholder="例如：个人 AI 工作台" value={topic} />
              </label>
              <label>
                <span>最想回答的问题 <i>可选</i></span>
                <textarea onChange={(event) => setQuestion(event.target.value)} placeholder="例如：人们做完后为什么会弃用？" rows="3" value={question} />
              </label>
            </>
          )}

          <div className="social-trigger-field-row">
            <label>
              <span>时间范围</span>
              <select onChange={(event) => setTimeWindow(event.target.value)} value={timeWindow}>
                {Object.entries(SOCIAL_RESEARCH_WINDOWS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span>研究深度</span>
              <select onChange={(event) => setDepth(event.target.value)} value={depth}>
                {Object.entries(SOCIAL_RESEARCH_DEPTHS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
        </div>

        <label className="social-trigger-prompt">
          <span>交给 Codex 的完整任务</span>
          <textarea readOnly rows="9" value={prompt} />
        </label>

        {handoffState !== "idle" ? (
          <p className={`social-trigger-feedback social-trigger-feedback--${handoffState}`} role="status">
            {handoffState === "launched" ? "任务已复制。请在 Codex 输入框按 ⌘V，并自行发送。" : null}
            {handoffState === "copied" ? "任务已复制。请手动打开 Codex，粘贴并发送。" : null}
            {handoffState === "failed" ? "无法写入剪贴板。请从上方文本框全选复制，再打开 Codex。" : null}
          </p>
        ) : null}

        <footer>
          <span>研究完成后，报告会自动出现在这里。</span>
          <div>
            <button onClick={onClose} type="button">取消</button>
            <button className="is-primary" disabled={topicMissing} onClick={() => void copyAndLaunch()} type="button">
              <IconCopy aria-hidden="true" />复制并打开 Codex
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function TrendArchiveList({ reports }) {
  return (
    <section className="social-trend-index" aria-labelledby="social-trend-index-title">
      <header className="social-trend-index__heading">
        <div>
          <span>RECENT SIGNALS</span>
          <h2 id="social-trend-index-title">近期风向</h2>
        </div>
        <p>{reports.length} 份快照 · 按采集时间倒序</p>
      </header>

      <div className="social-trend-index__list">
        {reports.map((report, index) => {
          const windowLabel = report.timeWindow?.start && report.timeWindow?.end
            ? `${dateOnly(report.timeWindow.start)} — ${dateOnly(report.timeWindow.end)}`
            : "时间范围未提供";
          return (
            <Link
              className="social-trend-index__row"
              key={report.id}
              to={`/social-insights/trends/${encodeURIComponent(report.id)}`}
            >
              <div className="social-trend-index__issue">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <time dateTime={report.capturedAt || undefined}>{dateOnly(report.capturedAt)}</time>
              </div>
              <div className="social-trend-index__copy">
                <p>{windowLabel}</p>
                <h3>{readerFacingTrendTitle(report.title)}</h3>
                <div>
                  {(report.clusterOutline ?? []).slice(0, 3).map((cluster) => (
                    <span key={cluster.id || cluster.topic}>{cluster.topic}</span>
                  ))}
                </div>
              </div>
              <dl>
                <div><dt>风向</dt><dd>{report.clusterCount ?? 0}</dd></div>
                <div><dt>范围</dt><dd>{report.scope || "未提供"}</dd></div>
              </dl>
              <IconArrowRight aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function ArchivePage({ onOpenDocument, syncRevision }) {
  const [view, setView] = useState("trends");
  const [result, setResult] = useState({ data: null, source: "loading", error: null });
  const [trendResult, setTrendResult] = useState({ data: null, source: "loading", error: null });
  const [triggerMode, setTriggerMode] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const refresh = useCallback(async () => {
    setResult((current) => ({ ...current, source: current.data ? current.source : "loading" }));
    setTrendResult((current) => ({ ...current, source: current.data ? current.source : "loading" }));
    const [nextInsights, nextTrends] = await Promise.all([
      loadSocialInsights(),
      loadSocialTrends(),
    ]);
    setResult(nextInsights);
    setTrendResult(nextTrends);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, syncRevision]);

  const trendItems = useMemo(
    () => trendResult.data?.items ?? [],
    [trendResult.data],
  );

  const items = result.data?.items ?? [];
  const filtered = useMemo(
    () => filterSocialInsights(items, filters),
    [filters, items],
  );
  const primaryPlatforms = useMemo(
    () => [...new Set(items.map((item) => item.primaryPlatform).filter(Boolean))],
    [items],
  );
  const auxiliaryPlatforms = useMemo(
    () => [...new Set(items.flatMap((item) => item.auxiliaryPlatforms ?? []).filter(Boolean))],
    [items],
  );
  const latestCapturedAt = view === "trends"
    ? trendItems[0]?.capturedAt ?? null
    : items[0]?.capturedAt ?? null;
  const hasFilters = Object.entries(filters).some(
    ([key, value]) => value !== EMPTY_FILTERS[key],
  );

  const headerAside = (
    <div className="social-archive-summary">
      <div><strong>{result.data?.total ?? "—"}</strong><span>研究档案</span></div>
      <div><strong>{trendResult.data?.total ?? "—"}</strong><span>风向快照</span></div>
      <div><strong>{latestCapturedAt ? dateOnly(latestCapturedAt) : "—"}</strong><span>最近更新</span></div>
    </div>
  );

  return (
    <div className="page page--social-insights">
      <PageHeader
        aside={headerAside}
        description="主动扫描近期 AI 风向，或围绕一个主题深挖讨论、评论回复、需求与分歧。"
        eyebrow="SOCIAL INSIGHTS · LOCAL EVIDENCE"
        title="社媒洞察"
      />

      <section className="social-research-actions" aria-label="社媒研究入口">
        <div className="social-research-tabs" role="tablist">
          <button aria-selected={view === "trends"} onClick={() => setView("trends")} role="tab" type="button">近期风向</button>
          <button aria-selected={view === "archive"} onClick={() => setView("archive")} role="tab" type="button">主题档案</button>
        </div>
        <div>
          <button onClick={() => setTriggerMode("trend-scan")} type="button"><IconRefresh aria-hidden="true" />扫描近期风向</button>
          <button className="is-primary" onClick={() => setTriggerMode("topic-deep-dive")} type="button"><IconFocus2 aria-hidden="true" />深挖一个主题</button>
        </div>
      </section>

      {view === "archive" ? <section className="social-filters" aria-label="筛选社媒洞察">
        <label className="social-filter-search">
          <IconSearch aria-hidden="true" />
          <span className="sr-only">搜索研究档案</span>
          <input
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
            placeholder="搜索标题、话题或研究问题"
            type="search"
            value={filters.query}
          />
        </label>
        <label>
          <span>主平台</span>
          <select onChange={(event) => setFilters((current) => ({ ...current, primaryPlatform: event.target.value }))} value={filters.primaryPlatform}>
            <option value="all">全部主平台</option>
            {primaryPlatforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
          </select>
        </label>
        <label>
          <span>辅助平台</span>
          <select onChange={(event) => setFilters((current) => ({ ...current, auxiliaryPlatform: event.target.value }))} value={filters.auxiliaryPlatform}>
            <option value="all">全部辅助平台</option>
            {auxiliaryPlatforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
          </select>
        </label>
        <label>
          <span>状态</span>
          <select onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} value={filters.status}>
            <option value="all">全部状态</option>
            <option value="complete">研究完成</option>
            <option value="partial">部分完成</option>
            <option value="needs-review">需要复查</option>
          </select>
        </label>
        <label>
          <span>时间</span>
          <select onChange={(event) => setFilters((current) => ({ ...current, dateRange: event.target.value }))} value={filters.dateRange}>
            <option value="all">全部时间</option>
            <option value="30">最近 30 天</option>
            <option value="90">最近 90 天</option>
            <option value="365">最近一年</option>
          </select>
        </label>
        <button disabled={!hasFilters} onClick={() => setFilters(EMPTY_FILTERS)} type="button">重置</button>
      </section> : null}

      <div className="social-archive-result-line">
        <span>{(view === "trends" ? trendResult.source : result.source) === "live" ? "本地报告已连接" : (view === "trends" ? trendResult.source : result.source) === "loading" ? "正在连接本地报告" : "本地报告不可用"}</span>
        <strong>{view === "trends" ? `${trendItems.length} 个快照` : `${filtered.length} / ${items.length}`}</strong>
      </div>

      {view === "trends" ? (
        trendResult.source === "loading" ? (
          <ArchiveLoading />
        ) : trendResult.source !== "live" ? (
          <div className="social-empty social-empty--error">
            <IconAlertTriangle aria-hidden="true" />
            <strong>暂时无法读取近期风向</strong>
            <span>{trendResult.error?.message || "请确认本地 Workbench 数据服务已启动。"}</span>
            <button onClick={() => void refresh()} type="button"><IconRefresh aria-hidden="true" />重新连接</button>
          </div>
        ) : trendItems.length === 0 ? (
          <div className="social-empty social-empty--trend">
            <IconSocial aria-hidden="true" />
            <strong>还没有风向快照</strong>
            <span>选择时间范围和研究深度，复制任务到 Codex。研究完成后会自动显示。</span>
            <button onClick={() => setTriggerMode("trend-scan")} type="button"><IconRefresh aria-hidden="true" />开始第一次扫描</button>
          </div>
        ) : <TrendArchiveList reports={trendItems} />
      ) : result.source === "loading" ? (
        <ArchiveLoading />
      ) : result.source !== "live" ? (
        <div className="social-empty social-empty--error">
          <IconAlertTriangle aria-hidden="true" />
          <strong>暂时无法读取社媒洞察</strong>
          <span>{result.error?.message || "请确认本地 Workbench 数据服务已启动。"}</span>
          <button onClick={() => void refresh()} type="button"><IconRefresh aria-hidden="true" />重新连接</button>
        </div>
      ) : items.length === 0 ? (
        <div className="social-empty">
          <IconDatabase aria-hidden="true" />
          <strong>还没有主题研究</strong>
          <span>输入一个主题，复制任务到 Codex。研究完成后会自动显示。</span>
          <button onClick={() => setTriggerMode("topic-deep-dive")} type="button"><IconFocus2 aria-hidden="true" />深挖一个主题</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="social-empty">
          <IconSearch aria-hidden="true" />
          <strong>没有匹配的研究</strong>
          <span>当前筛选条件保留着，可以修改关键词或清除全部筛选。</span>
          <button onClick={() => setFilters(EMPTY_FILTERS)} type="button">清除筛选</button>
        </div>
      ) : (
        <div className="social-archive-grid">
          {filtered.map((report) => (
            <ArchiveCard
              key={report.id}
              onOpenDocument={onOpenDocument}
              report={report}
            />
          ))}
        </div>
      )}

      {triggerMode ? <ResearchTriggerDialog initialMode={triggerMode} onClose={() => setTriggerMode(null)} /> : null}
    </div>
  );
}

function groupPrivateSources(sources = []) {
  const groups = new Map();
  for (const source of sources) {
    const group = source.platform || "其他来源";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(source);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}

function readerFacingTrendTitle(value) {
  const title = String(value || "未提供标题").trim();
  return title
    .replace(/\s*[｜|]\s*\d{4}-\d{2}-\d{2}\s*$/u, "")
    .replace(/\s*[｜|]\s*(?:X\s*)?源测试\s*$/iu, "")
    .trim() || "未提供标题";
}

function readerFacingTrendConclusion(value) {
  return String(value || "")
    .split(/(?<=[。！？])/u)
    .filter((sentence) => {
      const mentionsXAsMethod = /X\s*(?:在|作为|用于|的)/iu.test(sentence);
      const describesMethod = /(本轮|作用|补充|补出|链接|来源|研究策略)/u.test(sentence);
      return !(mentionsXAsMethod && describesMethod);
    })
    .join("")
    .trim();
}

function readerFacingTrendDepth(value) {
  const depth = String(value || "").trim().toLowerCase();
  if (depth === "standard") return "标准扫描";
  if (depth === "deep") return "深度扫描";
  if (depth === "quick") return "快速扫描";
  return value || "深度未提供";
}

function readerFacingTrendScope(value) {
  const scope = String(value || "").trim();
  const parenthetical = scope.match(/^AI[（(](.+)[）)]$/u);
  return parenthetical?.[1] || scope || "范围未提供";
}

function trendWindowDays(report) {
  const start = Date.parse(report?.timeWindow?.start || "");
  const end = Date.parse(report?.timeWindow?.end || "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

function trendHeroTitle(report) {
  const days = trendWindowDays(report);
  return days ? `近 ${days} 天，大家在聊哪些 AI 话题` : "最近，大家在聊哪些 AI 话题";
}

function trendHeroIntro(report) {
  const count = report?.clusters?.length ?? 0;
  if (!count) return "本次扫描尚未整理出可展开的讨论焦点。";
  return `本次扫描整理出 ${count} 个反复出现的讨论，下面按话题展开主要声音、需求与分歧。`;
}

function trendConclusionPoints(report) {
  const clusterTopics = (report?.clusters ?? [])
    .map((cluster) => String(cluster.topic || "").trim())
    .filter(Boolean);
  if (clusterTopics.length) return clusterTopics.slice(0, 6);

  const conclusion = readerFacingTrendConclusion(report?.conclusion);
  const colonIndex = conclusion.indexOf("：");
  if (colonIndex < 0) return [];
  return conclusion
    .slice(colonIndex + 1)
    .split(/[；;、]/u)
    .map((item) => item.replace(/[。！？]+$/u, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function ReadableTrendText({ value, fallback = "未提供" }) {
  const text = String(value || "").trim();
  if (!text) return fallback;
  const points = text
    .split(/[；;]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (points.length < 2) return text;
  return <ul className="social-trend-readable-points">{points.map((point, index) => <li key={`${point}-${index}`}>{point}</li>)}</ul>;
}

function TrendDetailLoading() {
  return (
    <div className="page page--social-trend-detail social-detail-loading" aria-label="正在解析近期风向">
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}

function TrendDetailPage({ onOpenDocument, syncRevision, trendId }) {
  const navigate = useNavigate();
  const [result, setResult] = useState({ data: null, source: "loading", error: null });
  const [pendingReport, setPendingReport] = useState(null);
  const [removed, setRemoved] = useState(false);
  const reportRef = useRef(null);
  const handledRevision = useRef(syncRevision);

  useEffect(() => {
    document.documentElement.classList.add("social-detail-open");
    return () => document.documentElement.classList.remove("social-detail-open");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setResult({ data: null, source: "loading", error: null });
    setPendingReport(null);
    setRemoved(false);
    void loadSocialTrend(trendId).then((next) => {
      if (cancelled) return;
      setResult(next);
      reportRef.current = next.data;
      handledRevision.current = syncRevision;
    });
    return () => { cancelled = true; };
  }, [trendId]);

  useEffect(() => {
    reportRef.current = result.data;
  }, [result.data]);

  useEffect(() => {
    if (!reportRef.current || syncRevision <= handledRevision.current) return;
    handledRevision.current = syncRevision;
    let cancelled = false;
    void loadSocialTrend(trendId).then((next) => {
      if (cancelled) return;
      if (next.source !== "live" || !next.data) {
        if (next.error?.status === 404) setRemoved(true);
        return;
      }
      if (next.data.contentHash !== reportRef.current?.contentHash) {
        setPendingReport(next.data);
      }
    });
    return () => { cancelled = true; };
  }, [syncRevision, trendId]);

  const report = result.data;
  const sourceGroups = useMemo(
    () => groupPrivateSources(report?.privateSources),
    [report?.privateSources],
  );
  const maxSourceSamples = Math.max(
    1,
    ...(report?.sourceCoverage ?? []).map((item) => Number(item.contentSamples) || 0),
  );

  if (result.source === "loading") return <TrendDetailLoading />;
  if (result.source !== "live" || !report) {
    return (
      <div className="page page--social-trend-detail">
        <button className="social-back-link" onClick={() => navigate("/social-insights")} type="button"><IconArrowLeft aria-hidden="true" />返回近期风向</button>
        <div className="social-empty social-empty--error">
          <IconAlertTriangle aria-hidden="true" />
          <strong>风向快照无法打开</strong>
          <span>{result.error?.message || "报告不存在、已移动，或本地服务暂时不可用。"}</span>
        </div>
      </div>
    );
  }

  const windowLabel = report.timeWindow?.start && report.timeWindow?.end
    ? `${dateOnly(report.timeWindow.start)} — ${dateOnly(report.timeWindow.end)}`
    : "时间范围未提供";
  const conclusionPoints = trendConclusionPoints(report);
  const exportTrendHtml = () => {
    const title = trendHeroTitle(report);
    downloadStandaloneSocialHtml(
      buildSocialTrendStandaloneHtml(report, {
        intro: trendHeroIntro(report),
        title,
      }),
      standaloneSocialHtmlFilename("近期风向", title, report.capturedAt),
    );
  };

  return (
    <div className="page page--social-trend-detail">
      <div className="social-detail-topbar social-trend-detail__topbar">
        <button className="social-back-link" onClick={() => navigate("/social-insights")} type="button"><IconArrowLeft aria-hidden="true" />近期风向</button>
        <div>
          <button onClick={() => onOpenDocument(report.sourceDocumentId)} type="button"><IconFileText aria-hidden="true" />阅读原报告</button>
          <button aria-label="导出当前近期风向为独立 HTML" onClick={exportTrendHtml} type="button"><IconDownload aria-hidden="true" />导出 HTML</button>
        </div>
      </div>

      {removed ? (
        <div className="social-update-notice social-update-notice--removed" role="status">
          <IconAlertTriangle aria-hidden="true" />
          <div><strong>原报告已不存在</strong><span>当前页面保留打开时的内容，返回列表后不会再显示它。</span></div>
          <button onClick={() => navigate("/social-insights")} type="button">返回列表</button>
        </div>
      ) : pendingReport ? (
        <div className="social-update-notice" role="status">
          <IconRefresh aria-hidden="true" />
          <div><strong>报告已有新版本</strong><span>为了不打断当前阅读，页面尚未静默替换内容。</span></div>
          <button onClick={() => {
            setResult({ data: pendingReport, source: "live", error: null });
            reportRef.current = pendingReport;
            setPendingReport(null);
          }} type="button">刷新报告</button>
        </div>
      ) : null}

      <header className="social-trend-editorial-hero">
        <div className="social-trend-editorial-hero__title">
          <div className="social-trend-editorial-hero__eyebrow">
            <span>AI 风向快照</span>
            <b>更新于 {dateOnly(report.capturedAt)}</b>
          </div>
          <h1>{trendHeroTitle(report)}</h1>
          <div className="social-trend-editorial-hero__meta">
            <span>观察区间 {windowLabel}</span>
            <span>{readerFacingTrendScope(report.scope)}</span>
            <span>{readerFacingTrendDepth(report.depth)}</span>
          </div>
        </div>
        <aside className="social-trend-editorial-hero__summary">
          <span>本期导读</span>
          <div className="social-trend-editorial-hero__brief">
            <p>{trendHeroIntro(report)}</p>
            {conclusionPoints.length ? (
              <ol>{conclusionPoints.map((point, index) => <li key={`${point}-${index}`}>{point}</li>)}</ol>
            ) : null}
          </div>
          <dl>
            <div><dt>讨论焦点</dt><dd>{report.clusters?.length ?? 0}</dd></div>
            <div><dt>来源组</dt><dd>{report.sourceCoverage?.length ?? 0}</dd></div>
            <div><dt>原文链接</dt><dd>{report.privateSources?.length ?? 0}</dd></div>
          </dl>
        </aside>
      </header>

      {report.parseWarnings?.length ? (
        <details className="social-quality-warning">
          <summary><IconAlertTriangle aria-hidden="true" />{warningSummary(report.parseWarnings)}</summary>
          <ul>{report.parseWarnings.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}</ul>
        </details>
      ) : null}

      <section className="social-trend-narrative" aria-labelledby="social-trend-narrative-title">
        <header className="social-trend-section-heading">
          <div><span>01 / SIGNAL INDEX</span><h2 id="social-trend-narrative-title">大家最近在聊什么</h2></div>
          <p>{report.clusters?.length ?? 0} 个讨论，按报告顺序展开</p>
        </header>

        <div className="social-trend-narrative__list">
          {(report.clusters ?? []).map((cluster, index) => {
            const clusterEvidence = (report.evidence ?? []).filter((item) => item.clusterId === cluster.id);
            return (
              <article className="social-trend-story" key={cluster.id || `${cluster.topic}-${index}`}>
                <div className="social-trend-story__folio">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>{cluster.stage ? <b>{cluster.stage}</b> : null}{cluster.evidenceStrength ? <i>{cluster.evidenceStrength}证据</i> : null}</div>
                </div>
                <div className="social-trend-story__main">
                  <span>观察到的行动</span>
                  <h3>{cluster.topic || "未命名风向"}</h3>
                  <div className="social-trend-story__action"><ReadableTrendText value={cluster.action} fallback="未提供可观察行动" /></div>
                  <footer><span>{cluster.platforms || "平台未提供"}</span><b>{cluster.independentSources == null ? "来源数未提供" : `${cluster.independentSources} 个独立来源`}</b></footer>
                </div>
                <div className="social-trend-story__analysis">
                  <dl>
                    <div><dt>为什么现在</dt><dd><ReadableTrendText value={cluster.trigger} /></dd></div>
                    <div><dt>主要声音</dt><dd><ReadableTrendText value={cluster.voices} /></dd></div>
                    <div><dt>需求与摩擦</dt><dd><ReadableTrendText value={cluster.needsAndFriction} /></dd></div>
                  </dl>
                  {cluster.branches ? <div className="social-trend-story__branches"><span>讨论分支</span><ReadableTrendText value={cluster.branches} /></div> : null}
                  {clusterEvidence[0] ? <blockquote><IconQuote aria-hidden="true" /><p>{clusterEvidence[0].excerpt}</p><cite>{clusterEvidence[0].source} · {clusterEvidence[0].publishedAt}</cite></blockquote> : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="social-trend-source-ledger" aria-labelledby="social-trend-source-ledger-title">
        <header className="social-trend-section-heading">
          <div><span>02 / SOURCE LEDGER</span><h2 id="social-trend-source-ledger-title">来源覆盖</h2></div>
          <p>柱长只表示本轮各来源内容样本的相对数量</p>
        </header>
        <div className="social-trend-source-ledger__list">
          {(report.sourceCoverage ?? []).map((source, index) => {
            const fill = Math.max(2, ((Number(source.contentSamples) || 0) / maxSourceSamples) * 100);
            return (
              <article key={`${source.sourceType}-${source.source}-${index}`} style={{ "--source-fill": `${fill}%` }}>
                <div className="social-trend-source-ledger__identity"><span>{String(index + 1).padStart(2, "0")}</span><div><b>{source.source || "来源未提供"}</b><i>{source.sourceType || "类型未提供"}</i></div></div>
                <div className="social-trend-source-ledger__bar" aria-hidden="true"><span /></div>
                <dl><div><dt>内容</dt><dd>{displayValue(source.contentSamples)}</dd></div><div><dt>评论 / 回复</dt><dd>{displayValue(source.commentReplyNodes)}</dd></div></dl>
                <p>{source.purpose || "未提供主要用途"}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="social-trend-evidence-ledger" aria-labelledby="social-trend-evidence-ledger-title">
        <header className="social-trend-section-heading">
          <div><span>03 / EVIDENCE</span><h2 id="social-trend-evidence-ledger-title">重点证据</h2></div>
          <p>{report.evidence?.length ?? 0} 条脱敏证据</p>
        </header>
        <div className="social-trend-evidence-ledger__grid">
          {(report.evidence ?? []).map((item, index) => (
            <article key={item.id || `${item.excerpt}-${index}`}>
              <header><span>{item.id || String(index + 1).padStart(2, "0")}</span><b>{item.clusterId || "未归类"}</b></header>
              <blockquote>{item.excerpt || "未提供证据表达"}</blockquote>
              <footer><span>{item.type || "类型未提供"}</span><span>{item.source || "来源未提供"}</span><time>{item.publishedAt || "时间未提供"}</time></footer>
            </article>
          ))}
        </div>
      </section>

      {sourceGroups.length ? (
        <section className="social-trend-originals" aria-labelledby="social-trend-originals-title">
          <header className="social-trend-section-heading">
            <div><span>04 / ORIGINALS</span><h2 id="social-trend-originals-title">原文与资料</h2></div>
            <p>{report.privateSources.length} 条 · 仅本地复查</p>
          </header>
          <div className="social-trend-originals__groups">
            {sourceGroups.map((group, groupIndex) => (
              <article key={group.label}>
                <header><span>{String(groupIndex + 1).padStart(2, "0")}</span><h3>{group.label}</h3><b>{group.items.length}</b></header>
                <div>
                  {group.items.map((source, index) => (
                    <a href={source.url} key={`${source.url}-${index}`} rel="noreferrer noopener" target="_blank">
                      <span>{source.label || "打开原文"}</span><IconExternalLink aria-hidden="true" />
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="social-trend-method" aria-labelledby="social-trend-method-title">
        <header className="social-trend-section-heading">
          <div><span>05 / METHOD</span><h2 id="social-trend-method-title">范围与边界</h2></div>
        </header>
        <div className="social-trend-method__grid">
          <article><h3>扫描范围</h3><ul>{report.scanScope?.length ? report.scanScope.map((item) => <li key={item}>{item}</li>) : <li>未提供扫描范围。</li>}</ul></article>
          <article><h3>证据边界</h3><ul>{report.boundaries?.length ? report.boundaries.map((item) => <li key={item}>{item}</li>) : <li>未提供证据边界。</li>}</ul></article>
        </div>
      </section>
    </div>
  );
}

function FindingsWorkspace({ findings = [], onSelect, selectedIndex }) {
  const active = findings[selectedIndex] ?? findings[0];

  return (
    <section className="social-findings-workspace" aria-labelledby="social-findings" id="social-findings-section">
      <header className="social-compact-heading">
        <div>
          <span>核心内容</span>
          <h2 id="social-findings">主要发现</h2>
        </div>
        <p>先扫完五个判断，再选择一个查看完整依据。</p>
      </header>

      {active ? (
        <div className="social-findings-board">
          <div className="social-finding-index" aria-label="选择主要发现">
            {findings.map((finding, index) => (
              <button
                aria-pressed={index === selectedIndex}
                className={index === selectedIndex ? "is-active" : ""}
                key={finding.title}
                onClick={() => onSelect(index)}
                type="button"
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{finding.title}</h3>
                  <p>{findingPreview(finding)}</p>
                </div>
                <IconArrowRight aria-hidden="true" />
              </button>
            ))}
          </div>

          <article className="social-finding-focus" aria-live="polite">
            <header>
              <span>判断 {String(selectedIndex + 1).padStart(2, "0")}</span>
              <strong>{selectedIndex + 1} / {findings.length}</strong>
            </header>
            <h3>{active.title}</h3>
            {active.body?.[0] ? <p className="social-finding-focus__lead">{active.body[0]}</p> : null}
            {active.body?.length > 1 ? (
              <div className="social-finding-focus__signals">
                <span>支持信号</span>
                <ul>{active.body.slice(1).map((paragraph, index) => <li key={`${active.title}-${index}`}>{paragraph}</li>)}</ul>
              </div>
            ) : null}
          </article>
        </div>
      ) : <div className="social-missing">报告未提供主要发现。</div>}
    </section>
  );
}

function DetailLoading() {
  return (
    <div className="page page--social-detail social-detail-loading" aria-label="正在解析社媒洞察">
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}

function DetailPage({ onOpenDocument, reportId, syncRevision }) {
  const navigate = useNavigate();
  const [result, setResult] = useState({ data: null, source: "loading", error: null });
  const [pendingReport, setPendingReport] = useState(null);
  const [removed, setRemoved] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [selectedFinding, setSelectedFinding] = useState(0);
  const [detailView, setDetailView] = useState("needs");
  const [needConfidence, setNeedConfidence] = useState("all");
  const [evidencePlatform, setEvidencePlatform] = useState("all");
  const [evidenceType, setEvidenceType] = useState("all");
  const [copiedEvidence, setCopiedEvidence] = useState(null);
  const reportRef = useRef(null);
  const handledRevision = useRef(syncRevision);

  useEffect(() => {
    document.documentElement.classList.add("social-detail-open");
    return () => document.documentElement.classList.remove("social-detail-open");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setResult({ data: null, source: "loading", error: null });
    setPendingReport(null);
    setRemoved(false);
    void loadSocialInsight(reportId).then((next) => {
      if (cancelled) return;
      setResult(next);
      reportRef.current = next.data;
      handledRevision.current = syncRevision;
      setSelectedFinding(0);
    });
    return () => { cancelled = true; };
  }, [reportId]);

  useEffect(() => {
    reportRef.current = result.data;
  }, [result.data]);

  useEffect(() => {
    if (!reportRef.current || syncRevision <= handledRevision.current) return;
    handledRevision.current = syncRevision;
    let cancelled = false;
    void loadSocialInsight(reportId).then((next) => {
      if (cancelled) return;
      if (next.source !== "live" || !next.data) {
        if (next.error?.status === 404) setRemoved(true);
        return;
      }
      if (next.data.contentHash !== reportRef.current?.contentHash) {
        setPendingReport(next.data);
      }
    });
    return () => { cancelled = true; };
  }, [reportId, syncRevision]);

  const report = result.data;
  const confidences = [...new Set((report?.needs ?? []).map((item) => item.confidence).filter(Boolean))];
  const filteredNeeds = (report?.needs ?? []).filter(
    (item) => needConfidence === "all" || item.confidence === needConfidence,
  );
  const evidencePlatforms = [...new Set((report?.evidence ?? []).map((item) => item.platform).filter(Boolean))];
  const evidenceTypes = [...new Set((report?.evidence ?? []).map((item) => item.type).filter(Boolean))];
  const filteredEvidence = (report?.evidence ?? []).filter(
    (item) =>
      (evidencePlatform === "all" || item.platform === evidencePlatform) &&
      (evidenceType === "all" || item.type === evidenceType),
  );

  const copyEvidence = async (item) => {
    try {
      await navigator.clipboard.writeText(item.excerpt);
      setCopiedEvidence(item.id);
      window.setTimeout(() => setCopiedEvidence(null), 1600);
    } catch {
      setCopiedEvidence(null);
    }
  };

  const enterPresentation = () => {
    if (!report?.presentation?.eligible) return;
    setPresenting(true);
    void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const exportInsightHtml = () => {
    downloadStandaloneSocialHtml(
      buildSocialInsightStandaloneHtml(report),
      standaloneSocialHtmlFilename("主题档案", report.title, report.capturedAt),
    );
  };

  if (result.source === "loading") return <DetailLoading />;
  if (result.source !== "live" || !report) {
    return (
      <div className="page page--social-detail">
        <button className="social-back-link" onClick={() => navigate("/social-insights")} type="button"><IconArrowLeft aria-hidden="true" />返回社媒洞察</button>
        <div className="social-empty social-empty--error">
          <IconAlertTriangle aria-hidden="true" />
          <strong>报告无法打开</strong>
          <span>{result.error?.message || "报告不存在、已移动，或本地服务暂时不可用。"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page page--social-detail">
      <div className="social-detail-topbar">
        <button className="social-back-link" onClick={() => navigate("/social-insights")} type="button"><IconArrowLeft aria-hidden="true" />研究档案</button>
        <div>
          <button onClick={() => onOpenDocument(report.sourceDocumentId)} type="button"><IconFileText aria-hidden="true" />阅读原报告</button>
          <button aria-label="导出当前主题档案为独立 HTML" onClick={exportInsightHtml} type="button"><IconDownload aria-hidden="true" />导出 HTML</button>
          <button
            aria-describedby={!report.presentation?.eligible ? "presentation-gate-reasons" : undefined}
            className="social-present-button"
            disabled={!report.presentation?.eligible}
            onClick={enterPresentation}
            type="button"
          >
            <IconPresentation aria-hidden="true" />进入演示模式
          </button>
        </div>
      </div>

      {removed ? (
        <div className="social-update-notice social-update-notice--removed" role="status">
          <IconAlertTriangle aria-hidden="true" />
          <div><strong>原报告已不存在</strong><span>当前页面保留打开时的内容，返回档案后不会再显示它。</span></div>
          <button onClick={() => navigate("/social-insights")} type="button">返回档案</button>
        </div>
      ) : pendingReport ? (
        <div className="social-update-notice" role="status">
          <IconRefresh aria-hidden="true" />
          <div><strong>报告已有新版本</strong><span>为了不打断当前阅读，页面尚未静默替换内容。</span></div>
          <button onClick={() => {
            setResult({ data: pendingReport, source: "live", error: null });
            reportRef.current = pendingReport;
            setPendingReport(null);
          }} type="button">刷新报告</button>
        </div>
      ) : null}

      <header className="social-brief-header">
        <div className="social-brief-header__copy">
          <div className="social-detail-hero__meta">
            <span className={`social-status social-status--${report.status || "unknown"}`}><i aria-hidden="true" />{statusText(report.status)}</span>
            <span><IconCalendar aria-hidden="true" />{dateOnly(report.capturedAt)}</span>
            <span><IconLock aria-hidden="true" />{report.privacyLevel === "deidentified" ? "已脱敏" : "隐私未确认"}</span>
          </div>
          <h1>{report.title}</h1>
          <p>{report.question || "未提供研究问题"}</p>
        </div>
        <div className="social-brief-header__platforms">
          {(report.platforms ?? []).map((platform, index) => <span className={index === 0 ? "is-primary" : ""} key={platform}>{platform}{index === 0 ? " · 主" : ""}</span>)}
        </div>
      </header>

      <section className="social-executive-summary" aria-labelledby="social-executive-summary-title">
        <div>
          <span>一句话结论</span>
          <h2 className="sr-only" id="social-executive-summary-title">一句话结论</h2>
          <p>{report.conclusion || "未提供一句话结论"}</p>
        </div>
        <dl>
          <div><dt>搜索结果</dt><dd>{displayValue(report.sampleTotals?.searchResults)}</dd></div>
          <div><dt>评论 / 回复</dt><dd>{displayValue(report.sampleTotals?.visibleNodes)}</dd></div>
          <div><dt>纳入分析</dt><dd>{displayValue(report.sampleTotals?.usableUnits)}</dd></div>
        </dl>
      </section>

      {report.parseWarnings?.length ? (
        <details className="social-quality-warning">
          <summary><IconAlertTriangle aria-hidden="true" />{warningSummary(report.parseWarnings)}</summary>
          <ul>{report.parseWarnings.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}</ul>
        </details>
      ) : null}

      {!report.presentation?.eligible ? (
        <div className="social-presentation-gate" id="presentation-gate-reasons">
          <strong>演示模式暂不可用</strong>
          <span>{report.presentation?.reasons?.join("；")}</span>
        </div>
      ) : null}

      <FindingsWorkspace findings={report.findings} onSelect={setSelectedFinding} selectedIndex={selectedFinding} />

      <section className="social-evidence-explorer" aria-labelledby="social-evidence-explorer-title">
        <header className="social-compact-heading">
          <div><span>继续核对</span><h2 id="social-evidence-explorer-title">证据与解释</h2></div>
          <p>按问题切换视图，不让辅助材料抢走主要发现的注意力。</p>
        </header>

        <div className="social-explorer-tabs" aria-label="选择证据视图" role="tablist">
          {DETAIL_VIEWS.map(([id, label, Icon]) => (
            <button aria-selected={detailView === id} className={detailView === id ? "is-active" : ""} key={id} onClick={() => setDetailView(id)} role="tab" type="button">
              <Icon aria-hidden="true" /><span>{label}</span><b>{detailViewCount(report, id)}</b>
            </button>
          ))}
        </div>

        <div className="social-explorer-panel" role="tabpanel">
          {detailView === "needs" ? (
            <>
              <div className="social-explorer-toolbar"><p>评论背后的任务、支持证据与常见失败。</p>{confidences.length ? <select aria-label="按置信度筛选需求" onChange={(event) => setNeedConfidence(event.target.value)} value={needConfidence}><option value="all">全部置信度</option>{confidences.map((item) => <option key={item} value={item}>{item}</option>)}</select> : null}</div>
              {filteredNeeds.length ? (
                <div className="social-needs-matrix">
                  {filteredNeeds.map((need) => (
                    <article key={need.cluster}>
                      <header>
                        <div className="social-module-icon"><IconTargetArrow aria-hidden="true" /></div>
                        <div><span>用户需求</span><h3>{need.cluster}</h3></div>
                        <b>{need.confidence || "未标注"}</b>
                      </header>
                      <p className="social-need-task">{need.task}</p>
                      <div className="social-need-outcomes">
                        <section>
                          <div><IconCircleCheck aria-hidden="true" /><span>证据点</span></div>
                          <p>{need.evidence}</p>
                        </section>
                        <section>
                          <div><IconAlertTriangle aria-hidden="true" /><span>失败点</span></div>
                          <p>{need.failure}</p>
                        </section>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <div className="social-missing">报告未提供匹配的需求簇。</div>}
            </>
          ) : null}

          {detailView === "camps" ? (
            report.camps?.length ? (
              <div className="social-camp-board">
                {report.camps.map((camp) => (
                  <article key={camp.name}>
                    <header>
                      <div className="social-module-icon"><IconSocial aria-hidden="true" /></div>
                      <div><span>观点阵营</span><h3>{camp.name}</h3></div>
                    </header>
                    <blockquote>{camp.judgment}</blockquote>
                    <div className="social-camp-evaluation">
                      <section><div><IconCircleCheck aria-hidden="true" /><span>代表证据</span></div><p>{camp.evidence}</p></section>
                      <section><div><IconFocus2 aria-hidden="true" /><span>可能盲点</span></div><p>{camp.blindSpot}</p></section>
                    </div>
                  </article>
                ))}
              </div>
            ) : <div className="social-missing">报告未提供观点阵营。</div>
          ) : null}

          {detailView === "chains" ? (
            report.commentReplyChains?.length ? (
              <div className="social-conversation-board">
                {report.commentReplyChains.map((chain, index) => (
                  <article key={`${chain.question}-${index}`}>
                    <div className="social-conversation-step social-conversation-step--comment">
                      <div><IconMessage2 aria-hidden="true" /><span>一级评论</span><b>{String(index + 1).padStart(2, "0")}</b></div>
                      <p>{chain.question}</p>
                    </div>
                    <div className="social-conversation-connector" aria-hidden="true"><IconCornerDownRight /></div>
                    <div className="social-conversation-step social-conversation-step--reply">
                      <div><IconGitBranch aria-hidden="true" /><span>二级回复修正</span></div>
                      <p>{chain.reply}</p>
                    </div>
                    <div className="social-conversation-insight">
                      <IconBulb aria-hidden="true" />
                      <div><span>研究价值</span><p>{chain.value}</p></div>
                    </div>
                  </article>
                ))}
              </div>
            ) : <div className="social-missing">报告未提供评论回复链。</div>
          ) : null}

          {detailView === "platforms" ? (
            report.platformDifferences?.length ? (
              <div className="social-platform-board">
                {report.platformDifferences.map((item, index) => (
                  <article key={item.platform}>
                    <header>
                      <div className="social-platform-icon"><PlatformIcon platform={item.platform} /></div>
                      <div><span>平台观察</span><h3>{item.platform}</h3></div>
                      {index === 0 ? <b>主平台</b> : null}
                    </header>
                    <div className="social-platform-dimensions">
                      <section><div><IconTargetArrow aria-hidden="true" /><span>主导表达</span></div><p>{item.expression}</p></section>
                      <section><div><IconMessageCircle aria-hidden="true" /><span>评论信号</span></div><p>{item.signal}</p></section>
                      <section><div><IconAlertTriangle aria-hidden="true" /><span>本轮局限</span></div><p>{item.limitation}</p></section>
                    </div>
                  </article>
                ))}
              </div>
            ) : <div className="social-missing">报告未提供跨平台差异。</div>
          ) : null}

          {detailView === "evidence" ? (
            <>
              <div className="social-explorer-toolbar"><p>全部内容已脱敏，可复制用于后续写作核对。</p><div className="social-evidence-filters"><select aria-label="按证据平台筛选" onChange={(event) => setEvidencePlatform(event.target.value)} value={evidencePlatform}><option value="all">全部平台</option>{evidencePlatforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}</select><select aria-label="按证据类型筛选" onChange={(event) => setEvidenceType(event.target.value)} value={evidenceType}><option value="all">全部类型</option>{evidenceTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></div></div>
              {filteredEvidence.length ? (
                <div className="social-quote-board">
                  {filteredEvidence.map((item) => (
                    <article key={item.id}>
                      <header>
                        <div className="social-quote-source"><span className="social-platform-icon"><PlatformIcon platform={item.platform} /></span><div><b>{item.platform}</b><span>{item.type}</span></div></div>
                        <button aria-label={`复制证据 ${item.id}`} onClick={() => void copyEvidence(item)} type="button">{copiedEvidence === item.id ? <IconCheck aria-hidden="true" /> : <IconCopy aria-hidden="true" />}</button>
                      </header>
                      <blockquote><IconQuote aria-hidden="true" /><p>{item.excerpt}</p></blockquote>
                      <footer>{item.id} · 已脱敏</footer>
                    </article>
                  ))}
                </div>
              ) : <div className="social-missing">没有匹配的脱敏证据。</div>}
            </>
          ) : null}

          {detailView === "method" ? (
            <div className="social-method-view">
              {report.sampleRows?.length ? <div className="social-table-wrap"><table className="social-data-table"><thead><tr><th>平台</th><th>角色</th><th>搜索结果</th><th>可见节点</th><th>纳入分析</th><th>主要用途</th></tr></thead><tbody>{report.sampleRows.map((row) => <tr key={row.platform}><th><span className="social-table-platform"><PlatformIcon platform={row.platform} />{row.platform}</span></th><td>{row.role || "未提供"}</td><td>{displayValue(row.searchResults)}</td><td>{displayValue(row.visibleNodes)}</td><td>{displayValue(row.usableUnits)}</td><td>{row.purpose || "未提供"}</td></tr>)}</tbody></table></div> : <div className="social-missing">报告未提供可解析的样本概览。</div>}
              <div className="social-boundary-grid">
                <article><div className="social-boundary-title"><IconShieldCheck aria-hidden="true" /><span>证据边界</span></div><ul>{report.boundaries?.length ? report.boundaries.map((item) => <li key={item}>{item}</li>) : <li>报告未提供证据边界。</li>}</ul></article>
                <article><div className="social-boundary-title"><IconBulb aria-hidden="true" /><span>继续验证</span></div><ol>{report.questions?.length ? report.questions.map((item) => <li key={item}>{item}</li>) : <li>报告未提供可继续验证的问题。</li>}</ol></article>
              </div>
              {report.privateSources?.length ? <details className="social-private-sources"><summary><IconLock aria-hidden="true" />私有来源索引 · 仅本地复查 · {report.privateSources.length} 条</summary><div>{report.privateSources.map((source, index) => <a href={source.url} key={`${source.url}-${index}`} rel="noreferrer noopener" target="_blank"><span>{source.platform || "来源"}</span>{source.label}</a>)}</div></details> : null}
            </div>
          ) : null}
        </div>
      </section>

      {presenting ? (
        <SocialInsightPresentation
          onClose={() => setPresenting(false)}
          report={presentationProjection(report)}
        />
      ) : null}
    </div>
  );
}

export function SocialInsightsPage({ onOpenDocument, syncRevision = 0 }) {
  const { reportId } = useParams();
  return reportId ? (
    <DetailPage
      onOpenDocument={onOpenDocument}
      reportId={reportId}
      syncRevision={syncRevision}
    />
  ) : (
    <ArchivePage onOpenDocument={onOpenDocument} syncRevision={syncRevision} />
  );
}

export function SocialTrendDetailPage({ onOpenDocument, syncRevision = 0 }) {
  const { trendId } = useParams();
  return (
    <TrendDetailPage
      onOpenDocument={onOpenDocument}
      syncRevision={syncRevision}
      trendId={trendId}
    />
  );
}
