import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  IconArrowUpRight,
  IconBulb,
  IconCamera,
  IconCircleCheck,
  IconFilter,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import { loadCollection } from "../lib/api";
import { formatCompactDate, statusLabel } from "../lib/format";

const VIEW_FILTERS = [
  { key: "pending", label: "未发布" },
  { key: "idea", label: "灵感" },
  { key: "selected", label: "已确认" },
  { key: "all", label: "全部" },
];

const STAGE_LABELS = {
  idea: "灵感",
  selected: "已确认",
  topic_selected: "已选题",
  material_validating: "素材验证",
  framework_ready: "框架完成",
  ready_to_shoot: "准备完成",
  filmed: "已拍",
  published: "已发布",
};

function isPending(item) {
  return !item.isPublished && item.pipelineStage !== "published";
}

function stageLabel(value) {
  return STAGE_LABELS[value] || statusLabel(value);
}

function seriesName(item) {
  return item.series || "未记录系列";
}

function TopicCard({ item, onOpen }) {
  const details = [
    item.journeyStage ? { label: "环节", value: item.journeyStage } : null,
    item.contentFormat ? { label: "形态", value: item.contentFormat } : null,
    item.displayFormat ? { label: "画幅", value: item.displayFormat } : null,
  ].filter(Boolean);

  return (
    <motion.button
      type="button"
      className="topic-card"
      onClick={() => onOpen?.(item)}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="topic-card__topline">
        <span className={`topic-stage topic-stage--${item.pipelineStage || "unknown"}`}>
          <span aria-hidden="true" />
          {stageLabel(item.pipelineStage)}
        </span>
        <span className="topic-card__episode">
          {item.episode != null ? `EP.${String(item.episode).padStart(2, "0")}` : "NO EP."}
        </span>
      </div>

      <h2 className="topic-card__title">{item.title}</h2>

      {details.length > 0 ? (
        <dl className="topic-card__details">
          {details.map((detail) => (
            <div key={`${detail.label}-${detail.value}`}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="topic-card__missing">尚未记录环节、内容形态或画幅</p>
      )}

      <div className="topic-card__footer">
        <span>{formatCompactDate(item.updatedAt, false)} 更新</span>
        <span className="topic-card__open">
          阅读选题 <IconArrowUpRight aria-hidden="true" />
        </span>
      </div>
    </motion.button>
  );
}

export function TopicsPage({ onOpenDocument }) {
  const [result, setResult] = useState({ data: null, source: "loading", error: null });
  const [view, setView] = useState("idea");
  const [series, setSeries] = useState("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadCollection("content").then((response) => {
      if (!cancelled) setResult(response);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const live = result.source === "live";
  const items = live ? result.data?.items || [] : [];
  const seriesOptions = useMemo(
    () => [...new Set(items.map(seriesName))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    [items],
  );
  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return items
      .filter((item) => {
        if (view === "pending" && !isPending(item)) return false;
        if (view === "idea" && item.folderStatus !== "idea") return false;
        if (view === "selected" && item.folderStatus !== "selected") return false;
        if (series !== "all" && seriesName(item) !== series) return false;
        if (!needle) return true;
        return [item.title, item.series, item.journeyStage, item.contentFormat]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(needle);
      })
      .sort((left, right) => {
        const leftEpisode = Number(left.episode);
        const rightEpisode = Number(right.episode);
        if (series !== "all" && Number.isFinite(leftEpisode) && Number.isFinite(rightEpisode)) {
          return leftEpisode - rightEpisode;
        }
        return (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
      });
  }, [items, query, series, view]);

  const groups = useMemo(() => {
    const grouped = new Map();
    for (const item of filteredItems) {
      const key = seriesName(item);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    }
    return [...grouped.entries()];
  }, [filteredItems]);

  const metrics = [
    { label: "全部记录", value: items.length, icon: IconSparkles },
    {
      label: "灵感池",
      value: items.filter((item) => item.folderStatus === "idea").length,
      icon: IconBulb,
    },
    {
      label: "已确认",
      value: items.filter((item) => item.folderStatus === "selected").length,
      icon: IconCircleCheck,
    },
    {
      label: "未发布记录",
      value: items.filter(isPending).length,
      icon: IconCamera,
    },
  ];

  const loading = result.source === "loading";
  const unavailable = !loading && !live;

  return (
    <div className="page topics-page">
      <PageHeader
        eyebrow="IDEA LIBRARY · 40"
        title="灵感库"
      />

      <section className="topic-metrics" aria-label="选题概览">
        {metrics.map(({ label, value, icon: Icon }) => (
          <div className="topic-metric" key={label}>
            <Icon aria-hidden="true" />
            <div>
              <strong>{loading ? "…" : unavailable ? "—" : value}</strong>
              <span>{label}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="topic-toolbar" aria-label="筛选选题">
        <div className="topic-tabs">
          {VIEW_FILTERS.map((filter) => (
            <button
              type="button"
              key={filter.key}
              className={view === filter.key ? "topic-tab topic-tab--active" : "topic-tab"}
              onClick={() => setView(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <label className="topic-select-wrap">
          <IconFilter aria-hidden="true" />
          <span className="sr-only">按系列筛选</span>
          <select value={series} onChange={(event) => setSeries(event.target.value)}>
            <option value="all">全部系列</option>
            {seriesOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="topic-search">
          <IconSearch aria-hidden="true" />
          <span className="sr-only">搜索选题</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、环节、形态"
          />
        </label>
      </section>

      {loading ? (
        <div className="topic-loading" aria-label="正在读取 40_topics">
          {[0, 1, 2].map((key) => <div className="skeleton" key={key} />)}
        </div>
      ) : unavailable ? (
        <div className="error-note">
          <strong>40_topics 暂时无法读取</strong><br />
          {result.error?.message || "本地索引服务不可用"}
        </div>
      ) : groups.length > 0 ? (
        <div className="topic-series-list">
          {groups.map(([name, seriesItems]) => (
            <section className="topic-series" key={name}>
              <header className="topic-series__header">
                <div>
                  <span className="topic-series__index">{String(seriesItems.length).padStart(2, "0")}</span>
                  <h2>{name}</h2>
                </div>
                <span>{seriesItems.length} 条当前结果</span>
              </header>
              <div className="topic-card-grid">
                {seriesItems.map((item) => (
                  <TopicCard key={item.id} item={item} onOpen={onOpenDocument} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="collection-empty">当前筛选下没有记录</div>
      )}
    </div>
  );
}
