import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconArrowUpRight,
  IconSearch,
  IconTopologyStar3,
  IconX,
} from "@tabler/icons-react";
import { KnowledgeGraph } from "../components/KnowledgeGraph";
import { PageHeader } from "../components/PageHeader";
import { loadGraph } from "../lib/api";
import { formatCompactDate, statusLabel } from "../lib/format";
import {
  typeCodeOf,
  typeColor,
  typeLabelOf,
} from "../lib/graph";

const isCompactViewport = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;

function edgeIds(edge) {
  return {
    source: typeof edge.source === "object" ? edge.source.id : edge.source,
    target: typeof edge.target === "object" ? edge.target.id : edge.target,
  };
}

/**
 * 知识星图主角页：全幅关系画布上叠加图谱透镜、搜索与节点检查器。
 * 画布负责空间探索，右侧检查器负责精确阅读，避免把所有文字都硬塞进网络。
 */
export function GraphPage({ onOpenDocument }) {
  const searchRef = useRef(null);
  const [result, setResult] = useState(null);
  const [activeTypes, setActiveTypes] = useState(() => new Set());
  const [activeStatuses, setActiveStatuses] = useState(() => new Set());
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState("");
  const [lensOpen, setLensOpen] = useState(() => !isCompactViewport());
  const [compact, setCompact] = useState(isCompactViewport);

  useEffect(() => {
    let cancelled = false;
    loadGraph().then((response) => {
      if (!cancelled) setResult(response);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const target = event.target;
        const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
        if (!typing) {
          event.preventDefault();
          searchRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const data = result?.data;
  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];

  const typeEntries = useMemo(() => {
    const counts = data?.typeCounts ?? {};
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const statusEntries = useMemo(() => {
    const counts = {};
    for (const node of nodes) {
      const key = node.status ?? "unknown";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  const visibleNodeCount = useMemo(
    () =>
      nodes.filter((node) => {
        if (activeTypes.size > 0 && !activeTypes.has(node.type)) return false;
        if (activeStatuses.size > 0 && !activeStatuses.has(node.status ?? "unknown")) {
          return false;
        }
        return true;
      }).length,
    [nodes, activeTypes, activeStatuses],
  );

  const searchResults = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return [];
    return nodes
      .filter((node) => {
        if (activeTypes.size > 0 && !activeTypes.has(node.type)) return false;
        if (activeStatuses.size > 0 && !activeStatuses.has(node.status ?? "unknown")) {
          return false;
        }
        const searchable = [node.title, node.type, node.section, ...(node.tags || [])]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("zh-CN");
        return searchable.includes(normalized);
      })
      .sort((a, b) => {
        const aStarts = a.title.toLocaleLowerCase("zh-CN").startsWith(normalized) ? 1 : 0;
        const bStarts = b.title.toLocaleLowerCase("zh-CN").startsWith(normalized) ? 1 : 0;
        return bStarts - aStarts || (b.degree || 0) - (a.degree || 0);
      })
      .slice(0, 7);
  }, [query, nodes, activeTypes, activeStatuses]);

  const neighborRelations = useMemo(() => {
    if (!selected) return [];
    const relationships = new Map();
    for (const edge of edges) {
      const { source, target } = edgeIds(edge);
      let neighborId = null;
      let direction = null;
      if (source === selected.id) {
        neighborId = target;
        direction = "outgoing";
      } else if (target === selected.id) {
        neighborId = source;
        direction = "incoming";
      }
      if (!neighborId) continue;
      const relationship = relationships.get(neighborId) ?? {
        id: neighborId,
        incoming: false,
        outgoing: false,
        weight: 0,
      };
      relationship[direction] = true;
      relationship.weight += Math.max(1, Number(edge.weight) || 1);
      relationships.set(neighborId, relationship);
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return [...relationships.values()]
      .map((relationship) => ({ ...relationship, node: byId.get(relationship.id) }))
      .filter((relationship) => relationship.node)
      .sort(
        (a, b) =>
          Number(b.incoming && b.outgoing) - Number(a.incoming && a.outgoing) ||
          b.weight - a.weight ||
          (b.node.degree || 0) - (a.node.degree || 0),
      );
  }, [selected, nodes, edges]);

  const graphInsets = useMemo(
    () => ({
      top: 84,
      left: !compact && lensOpen ? 286 : 24,
      right: !compact && selected ? 372 : 24,
      bottom: compact && selected ? 330 : 78,
    }),
    [compact, lensOpen, selected],
  );

  useEffect(() => {
    if (!selected) return;
    const matchesType = activeTypes.size === 0 || activeTypes.has(selected.type);
    const matchesStatus =
      activeStatuses.size === 0 || activeStatuses.has(selected.status ?? "unknown");
    if (!matchesType || !matchesStatus) setSelected(null);
  }, [activeTypes, activeStatuses, selected]);

  const toggleType = (type) => {
    setActiveTypes((previous) => {
      const next = new Set(previous);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const toggleStatus = (status) => {
    setActiveStatuses((previous) => {
      const next = new Set(previous);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const selectNode = (node) => {
    setSelected(node);
    setQuery("");
  };

  const clearFilters = () => {
    setActiveTypes(new Set());
    setActiveStatuses(new Set());
  };

  if (!result) {
    return (
      <div className="graph-page-shell">
        <PageHeader eyebrow="KNOWLEDGE GRAPH" title="知识星图" />
        <div className="skeleton graph-loading" />
      </div>
    );
  }

  if (result.error && nodes.length === 0) {
    return (
      <div className="graph-page-shell">
        <PageHeader eyebrow="KNOWLEDGE GRAPH" title="知识星图" />
        <div className="error-note">
          图谱数据不可用：{String(result.error.message || result.error)}。请确认本地开发服务器正在运行。
        </div>
      </div>
    );
  }

  return (
    <div className="graph-page-shell">
      <PageHeader
        aside={
          <span className="collection-count mono">
            LIVE VAULT · {formatCompactDate(data.generatedAt, true)}
          </span>
        }
        description="像在 Obsidian 里一样探索真实双链：悬停看关系，点击聚焦邻居，双击进入文档。"
        eyebrow="KNOWLEDGE GRAPH"
        title="知识星图"
      />

      <div className={`graph-page graph-page--immersive${selected ? " graph-stage--selected" : ""}`}>
        <KnowledgeGraph
          activeStatuses={activeStatuses}
          activeTypes={activeTypes}
          edges={edges}
          nodes={nodes}
          onActivate={(node) => onOpenDocument?.(node.id)}
          onSelect={setSelected}
          selectedId={selected?.id ?? null}
          viewportInsets={graphInsets}
        />

        <div className="graph-stage__identity">
          <div className="graph-stage__live-row mono">
            <span className="graph-live-dot" aria-hidden="true" />
            GLOBAL GRAPH / LINK INDEX
          </div>
          <div className="graph-stage__totals">
            <span><b>{data.stats.nodeCount}</b> 页面</span>
            <span><b>{data.stats.edgeCount}</b> 双链</span>
            <span><b>{data.stats.isolatedCount}</b> 孤岛</span>
          </div>
          <p>拖拽 · 滚轮缩放 · 双击阅读</p>
        </div>

        <div className="graph-search-shell">
          <IconSearch aria-hidden="true" />
          <input
            aria-label="搜索图谱节点"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && searchResults[0]) selectNode(searchResults[0]);
              if (event.key === "Escape") {
                setQuery("");
                event.currentTarget.blur();
              }
            }}
            placeholder={`搜索 ${nodes.length} 个知识页…`}
            ref={searchRef}
            type="search"
            value={query}
          />
          <kbd>/</kbd>
          {query ? (
            <button aria-label="清空搜索" onClick={() => setQuery("")} type="button">
              <IconX aria-hidden="true" />
            </button>
          ) : null}

          {query ? (
            <div className="graph-search-results">
              {searchResults.length > 0 ? (
                searchResults.map((node) => (
                  <button key={node.id} onClick={() => selectNode(node)} type="button">
                    <span
                      className="graph-node-dot"
                      style={{ "--node-color": typeColor(node.type) }}
                    />
                    <span className="graph-search-result__copy">
                      <strong>{node.title}</strong>
                      <small>
                        {typeLabelOf(node.type)} · {node.degree || 0} 个连接
                      </small>
                    </span>
                    <IconArrowUpRight aria-hidden="true" />
                  </button>
                ))
              ) : (
                <div className="graph-search-results__empty">当前筛选内没有匹配页面</div>
              )}
            </div>
          ) : null}
        </div>

        {lensOpen ? (
          <aside aria-label="图谱筛选" className="graph-lens graph-overlay">
            <div className="graph-overlay__head">
              <div>
                <span className="graph-overlay__kicker mono">GRAPH LENS</span>
                <strong>图谱透镜</strong>
              </div>
              <button aria-label="收起图谱透镜" onClick={() => setLensOpen(false)} type="button">
                <IconX aria-hidden="true" />
              </button>
            </div>

            <div className="graph-lens__summary mono">
              SHOWING {visibleNodeCount} / {nodes.length}
              {activeTypes.size + activeStatuses.size > 0 ? (
                <button onClick={clearFilters} type="button">全部显示</button>
              ) : null}
            </div>

            <div className="graph-lens__section">
              <span className="graph-lens__label mono">PAGE TYPE</span>
              <div className="graph-lens__options">
                {typeEntries.map(([type, count]) => (
                  <button
                    aria-pressed={activeTypes.has(type)}
                    className={activeTypes.has(type) ? "is-active" : ""}
                    key={type}
                    onClick={() => toggleType(type)}
                    type="button"
                  >
                    <span
                      className="graph-node-dot"
                      style={{ "--node-color": typeColor(type) }}
                    />
                    <span>{typeLabelOf(type)}</span>
                    <small className="mono">{count}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="graph-lens__section">
              <span className="graph-lens__label mono">KNOWLEDGE STATUS</span>
              <div className="graph-lens__status-options">
                {statusEntries.map(([status, count]) => (
                  <button
                    aria-pressed={activeStatuses.has(status)}
                    className={activeStatuses.has(status) ? "is-active" : ""}
                    key={status}
                    onClick={() => toggleStatus(status)}
                    type="button"
                  >
                    {statusLabel(status)} <small className="mono">{count}</small>
                  </button>
                ))}
              </div>
            </div>

            <p className="graph-lens__footnote">节点大小代表连接数；筛选仅改变视图，不修改 Wiki。</p>
          </aside>
        ) : (
          <button className="graph-lens-toggle graph-overlay" onClick={() => setLensOpen(true)} type="button">
            <IconAdjustmentsHorizontal aria-hidden="true" />
            <span>图谱透镜</span>
            {activeTypes.size + activeStatuses.size > 0 ? (
              <b className="mono">{activeTypes.size + activeStatuses.size}</b>
            ) : null}
          </button>
        )}

        {selected ? (
          <aside aria-label="选中节点详情" className="graph-inspector graph-overlay">
            <div className="graph-overlay__head">
              <div>
                <span className="graph-overlay__kicker mono">
                  {typeCodeOf(selected.type)} / NODE FOCUS
                </span>
                <span className="graph-inspector__type">
                  <span
                    className="graph-node-dot"
                    style={{ "--node-color": typeColor(selected.type) }}
                  />
                  {typeLabelOf(selected.type)}
                </span>
              </div>
              <button aria-label="取消选择" onClick={() => setSelected(null)} type="button">
                <IconX aria-hidden="true" />
              </button>
            </div>

            <h2>{selected.title}</h2>
            <div className="graph-inspector__meta">
              <span>{statusLabel(selected.status)}</span>
              <span>{formatCompactDate(selected.updatedAt, false)} 更新</span>
              {selected.section ? <span>{selected.section}</span> : null}
            </div>

            <div className="graph-inspector__stats">
              <div><b>{selected.degree || 0}</b><span>连接</span></div>
              <div><b>{selected.inDegree || 0}</b><span>入链</span></div>
              <div><b>{selected.outDegree || 0}</b><span>出链</span></div>
            </div>

            {(selected.tags || []).length > 0 ? (
              <div className="graph-inspector__tags">
                {selected.tags.slice(0, 6).map((tag) => <span key={tag}>#{tag}</span>)}
              </div>
            ) : null}

            <button
              className="graph-inspector__open"
              onClick={() => onOpenDocument?.(selected.id)}
              type="button"
            >
              阅读完整文档 <IconArrowUpRight aria-hidden="true" />
            </button>

            <div className="graph-inspector__relations-head">
              <div>
                <span className="mono">LOCAL GRAPH</span>
                <strong>相邻页面</strong>
              </div>
              <b className="mono">{neighborRelations.length}</b>
            </div>

            <div className="graph-inspector__relations">
              {neighborRelations.length > 0 ? (
                neighborRelations.map((relationship) => {
                  const relationLabel =
                    relationship.incoming && relationship.outgoing
                      ? "双向"
                      : relationship.outgoing
                        ? "出链"
                        : "入链";
                  return (
                    <button
                      key={relationship.id}
                      onClick={() => selectNode(relationship.node)}
                      type="button"
                    >
                      <span
                        className="graph-node-dot"
                        style={{ "--node-color": typeColor(relationship.node.type) }}
                      />
                      <span className="graph-relation__copy">
                        <strong>{relationship.node.title}</strong>
                        <small>{typeLabelOf(relationship.node.type)}</small>
                      </span>
                      <span className={`graph-relation__direction graph-relation__direction--${relationLabel}`}>
                        {relationLabel}
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="graph-inspector__empty">这是一座孤岛，目前没有可追踪的双链。</p>
              )}
            </div>
          </aside>
        ) : null}

        {!selected ? (
          <div className="graph-stage__prompt">
            <IconTopologyStar3 aria-hidden="true" />
            <span>选择一个节点，展开它的局部知识网络</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
