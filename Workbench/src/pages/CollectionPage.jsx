import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import gsap from "gsap";
import { PageHeader } from "../components/PageHeader";
import { loadCollection } from "../lib/api";
import { collectionItemMatchesGroup } from "../lib/collection-filter";
import { formatCompactDate, statusLabel } from "../lib/format";

export function CollectionPage({
  kind,
  eyebrow,
  title,
  description,
  onOpenDocument,
}) {
  const [result, setResult] = useState({ data: null, source: "loading", error: null });
  const [selectedGroup, setSelectedGroup] = useState(null);
  const groupRefs = useRef({});

  useEffect(() => {
    let cancelled = false;
    loadCollection(kind).then((response) => {
      if (!cancelled) setResult(response);
    });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  // GSAP count animation on mount
  useEffect(() => {
    if (result.source !== "loading" && result.data?.groups) {
      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      result.data.groups.forEach((group) => {
        const el = groupRefs.current[group.key];
        if (el && !prefersReducedMotion) {
          gsap.fromTo(
            el,
            { textContent: 0 },
            {
              textContent: group.count,
              duration: 1.2,
              ease: "power2.out",
              snap: { textContent: 1 },
              onUpdate: function () {
                el.textContent = Math.round(this.targets()[0].textContent);
              },
            }
          );
        }
      });
    }
  }, [result.data?.groups, result.source]);

  const isLoading = result.source === "loading";
  const hasError = result.error && !result.data;
  const groups = result.data?.groups ?? [];
  const allItems = result.data?.items ?? [];
  const total = result.data?.total ?? allItems.length;

  // Filter logic
  const filteredItems = selectedGroup
    ? allItems.filter((item) =>
        collectionItemMatchesGroup(kind, item, selectedGroup))
    : allItems;

  // Sort by updatedAt descending
  const sortedItems = [...filteredItems].sort((a, b) => {
    const dateA = new Date(a.updatedAt || 0);
    const dateB = new Date(b.updatedAt || 0);
    return dateB - dateA;
  });

  // Limit to 80 items
  const displayItems = sortedItems.slice(0, 80);
  const remainingCount = sortedItems.length - displayItems.length;

  const handleGroupClick = (key) => {
    setSelectedGroup(selectedGroup === key ? null : key);
  };

  const getSubtitle = (item) => {
    if (item.path) {
      const parts = item.path.split("/");
      if (parts.length > 1) {
        return parts[parts.length - 2] + "/";
      }
    }
    if (item.section) {
      const tagsPart = item.tags?.slice(0, 2).join(", ") || "";
      return tagsPart ? `${item.section} · ${tagsPart}` : item.section;
    }
    return item.tags?.slice(0, 2).join(", ") || "";
  };

  return (
    <div className="page page--collection">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        aside={
          <div className="collection-count">
            {isLoading ? "…" : `${total} ITEMS`}
          </div>
        }
      />

      {/* Group cards */}
      {groups.length > 0 && (
        <div className="collection-groups">
          {groups.map((group) => (
            <button
              key={group.key}
              type="button"
              className={`group-card${selectedGroup === group.key ? " group-card--on" : ""}`}
              onClick={() => handleGroupClick(group.key)}
            >
              <div
                ref={(el) => {
                  if (el) groupRefs.current[group.key] = el;
                }}
                className="group-card__count"
              >
                {group.count}
              </div>
              <div className="group-card__label">{group.label}</div>
              {group.description && (
                <div className="group-card__desc">{group.description}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div>
          <div className="skeleton" style={{ height: "56px", marginBottom: "8px" }} />
          <div className="skeleton" style={{ height: "56px", marginBottom: "8px" }} />
          <div className="skeleton" style={{ height: "56px" }} />
        </div>
      )}

      {/* Error state */}
      {hasError && (
        <div className="error-note">
          加载失败：{result.error?.message || "未知错误"}
        </div>
      )}

      {/* Document list */}
      {!isLoading && !hasError && (
        <>
          {displayItems.length > 0 ? (
            <motion.div
              className="doc-table"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              {displayItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="doc-row"
                  onClick={() => onOpenDocument(item)}
                >
                  <div>
                    <div className="doc-row__title">{item.title}</div>
                    <div className="doc-row__sub">{getSubtitle(item)}</div>
                  </div>
                  <div className="doc-row__cell">
                    {item.type || item.section || "—"}
                  </div>
                  <div className="doc-row__cell">
                    {statusLabel(item.status)}
                  </div>
                  <div className="doc-row__date">
                    {formatCompactDate(item.updatedAt, false)}
                  </div>
                </button>
              ))}
            </motion.div>
          ) : (
            <div className="collection-empty">这一层还没有内容</div>
          )}

          {/* Overflow message */}
          {remainingCount > 0 && (
            <div className="collection-empty">
              还有 {remainingCount} 条，用 ⌘K 搜索定位
            </div>
          )}
        </>
      )}
    </div>
  );
}
