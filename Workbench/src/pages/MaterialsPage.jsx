import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { useSearchParams } from "react-router-dom";
import {
  IconBookmark,
  IconChevronRight,
  IconFolder,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { MaterialDocumentRow } from "../components/materials/MaterialDocumentRow";
import { PageHeader } from "../components/PageHeader";
import {
  addMaterialToReadingQueue,
  loadMaterialFolder,
  loadMaterialReadingQueue,
  loadMaterialsHome,
  removeMaterialFromReadingQueue,
} from "../lib/api";

const ROOT_PATH = "10_raw";

function loadingResult() {
  return { data: null, source: "loading", error: null };
}

function FolderCard({ folder, onOpen }) {
  return (
    <button className="material-folder" onClick={() => onOpen(folder.relativePath)} type="button">
      <span className="material-folder__icon" aria-hidden="true">
        <IconFolder size={20} stroke={1.7} />
      </span>
      <span className="material-folder__body">
        <strong>{folder.displayName || folder.name}</strong>
        <span className="mono">{folder.relativePath}</span>
      </span>
      <span className="material-folder__stats">
        <span>{folder.descendantFileCount} 份素材</span>
        {folder.childFolderCount > 0 ? <span>{folder.childFolderCount} 个子目录</span> : null}
        {folder.queuedCount > 0 ? <em>{folder.queuedCount} 待看</em> : null}
      </span>
      <IconChevronRight aria-hidden="true" className="material-folder__arrow" size={18} />
    </button>
  );
}

function EmptyState({ queue = false }) {
  return (
    <div className="materials-empty">
      <span className="materials-empty__mark" aria-hidden="true">
        {queue ? <IconBookmark size={22} /> : <IconFolder size={22} />}
      </span>
      <strong>{queue ? "待看队列还是空的" : "这个文件夹暂时没有素材"}</strong>
      <span>
        {queue
          ? "在任意素材行点击“待看”，它会留在这里等你回来。"
          : "新增到真实 Vault 文件夹的内容会自动出现在这里。"}
      </span>
    </div>
  );
}

export function MaterialsPage({ onOpenDocument }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [result, setResult] = useState(loadingResult);
  const [query, setQuery] = useState("");
  const [queuedOnly, setQueuedOnly] = useState(false);
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const [mutationError, setMutationError] = useState(null);
  const folderPath = searchParams.get("folder") || ROOT_PATH;
  const view = searchParams.get("view") === "queue"
    ? "queue"
    : folderPath === ROOT_PATH
      ? "home"
      : "folder";

  const reload = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setResult(loadingResult());
    const response = view === "queue"
      ? await loadMaterialReadingQueue()
      : view === "folder"
        ? await loadMaterialFolder(folderPath)
        : await loadMaterialsHome();
    setResult(response);
  }, [folderPath, view]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setResult(loadingResult());
      const response = view === "queue"
        ? await loadMaterialReadingQueue()
        : view === "folder"
          ? await loadMaterialFolder(folderPath)
          : await loadMaterialsHome();
      if (!cancelled) setResult(response);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [folderPath, view]);

  const openFolder = (path) => {
    setSearchParams(path === ROOT_PATH ? {} : { folder: path });
    setQuery("");
    setQueuedOnly(false);
  };

  const openQueue = () => {
    setSearchParams({ view: "queue" });
    setQuery("");
    setQueuedOnly(false);
  };

  const toggleQueue = async (item) => {
    if (!item?.id || pendingIds.has(item.id)) return;
    setMutationError(null);
    setPendingIds((current) => new Set(current).add(item.id));
    try {
      if (item.isQueued) {
        await removeMaterialFromReadingQueue(item.id);
      } else {
        await addMaterialToReadingQueue(item.id, item.contentHash);
      }
      await reload({ quiet: true });
    } catch (error) {
      setMutationError(error);
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const data = result.data;
  const isLoading = result.source === "loading";
  const hasError = Boolean(result.error && !data);
  const isHome = view === "home";
  const isQueue = view === "queue";
  const folders = data?.folders ?? [];
  const homeQueue = data?.queuePreview ?? [];
  const sourceItems = isQueue ? data?.items ?? [] : data?.items ?? [];
  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return sourceItems.filter((item) => {
      if (queuedOnly && !item.isQueued) return false;
      if (!normalizedQuery) return true;
      const haystack = `${item.title ?? ""} ${item.path ?? item.relativePath ?? ""}`
        .toLocaleLowerCase("zh-CN");
      return haystack.includes(normalizedQuery);
    });
  }, [query, queuedOnly, sourceItems]);

  const title = isHome
    ? "素材层"
    : isQueue
      ? "我的待看"
      : data?.folder?.displayName || folderPath.split("/").pop();
  const description = isHome
    ? "原始证据按真实文件夹归位；待看只是阅读安排，不改变素材，也不代表已经入库。"
    : isQueue
      ? "你亲自留下的阅读队列。打开不会自动移除，读完后再明确处理。"
      : `${data?.folder?.directFileCount ?? 0} 份直属素材 · ${data?.folder?.descendantFileCount ?? 0} 份含子目录`;

  return (
    <div className="page page--materials">
      <PageHeader
        eyebrow="RAW SOURCES"
        title={title}
        description={description}
        aside={
          <div className="materials-total mono">
            <span>{isQueue ? data?.total ?? 0 : data?.total ?? data?.folder?.descendantFileCount ?? 0}</span>
            <small>{isQueue ? "TO READ" : "FILES"}</small>
          </div>
        }
      />

      {!isHome ? (
        <nav aria-label="素材路径" className="materials-breadcrumbs">
          <button onClick={() => openFolder(ROOT_PATH)} type="button">素材</button>
          {isQueue ? (
            <>
              <IconChevronRight aria-hidden="true" size={14} />
              <span>我的待看</span>
            </>
          ) : (
            (data?.breadcrumbs ?? []).slice(1).map((crumb, index, crumbs) => (
              <span className="materials-breadcrumbs__part" key={crumb.id}>
                <IconChevronRight aria-hidden="true" size={14} />
                {index === crumbs.length - 1 ? (
                  <span>{crumb.displayName}</span>
                ) : (
                  <button onClick={() => openFolder(crumb.relativePath)} type="button">
                    {crumb.displayName}
                  </button>
                )}
              </span>
            ))
          )}
        </nav>
      ) : null}

      {mutationError ? (
        <div className="materials-notice materials-notice--error" role="alert">
          <span>待看状态未更新：{mutationError.message || "请稍后重试"}</span>
          <button aria-label="关闭错误提示" onClick={() => setMutationError(null)} type="button">
            <IconX size={15} />
          </button>
        </div>
      ) : null}

      {result.error && data ? (
        <div className="materials-notice" role="status">
          本地 Workbench 暂未连接，当前不展示模拟素材数据。
        </div>
      ) : null}

      {isLoading ? (
        <div className="materials-loading" aria-label="素材加载中">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : hasError ? (
        <div className="error-note">加载失败：{result.error?.message || "未知错误"}</div>
      ) : isHome ? (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="materials-home"
          initial={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.28 }}
        >
          <section className="materials-section materials-section--queue">
            <div className="materials-section__head">
              <div>
                <span className="eyebrow">READING QUEUE</span>
                <h2>我的待看</h2>
              </div>
              <button className="materials-section__link" onClick={openQueue} type="button">
                查看全部 <IconChevronRight size={15} />
              </button>
            </div>
            {homeQueue.length > 0 ? (
              <div className="material-list">
                {homeQueue.map((item) => (
                  <MaterialDocumentRow
                    item={item}
                    key={item.id}
                    onOpen={onOpenDocument}
                    onToggleQueue={toggleQueue}
                    pending={pendingIds.has(item.id)}
                    showQueuedAt
                  />
                ))}
              </div>
            ) : <EmptyState queue />}
          </section>

          <section className="materials-section">
            <div className="materials-section__head">
              <div>
                <span className="eyebrow">REAL FOLDERS</span>
                <h2>按文件夹浏览</h2>
              </div>
              <span className="materials-section__meta mono">10_raw/ · {folders.length} folders</span>
            </div>
            {folders.length > 0 ? (
              <div className="material-folder-grid">
                {folders.map((folder) => <FolderCard folder={folder} key={folder.id} onOpen={openFolder} />)}
              </div>
            ) : <EmptyState />}
          </section>

          <section className="materials-section">
            <div className="materials-section__head">
              <div>
                <span className="eyebrow">RECENTLY CHANGED</span>
                <h2>最近变化</h2>
              </div>
              <span className="materials-section__meta">最近新增不等于待看</span>
            </div>
            {(data?.recent ?? []).length > 0 ? (
              <div className="material-list">
                {data.recent.map((item) => (
                  <MaterialDocumentRow
                    item={item}
                    key={item.id}
                    onOpen={onOpenDocument}
                    onToggleQueue={toggleQueue}
                    pending={pendingIds.has(item.id)}
                  />
                ))}
              </div>
            ) : <EmptyState />}
          </section>
        </motion.div>
      ) : (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="materials-browser"
          initial={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.24 }}
        >
          {!isQueue && folders.length > 0 ? (
            <section className="materials-section">
              <div className="materials-section__head">
                <div>
                  <span className="eyebrow">SUBFOLDERS</span>
                  <h2>下一层</h2>
                </div>
              </div>
              <div className="material-folder-grid">
                {folders.map((folder) => <FolderCard folder={folder} key={folder.id} onOpen={openFolder} />)}
              </div>
            </section>
          ) : null}

          <section className="materials-section materials-section--files">
            <div className="materials-section__head materials-section__head--files">
              <div>
                <span className="eyebrow">{isQueue ? "QUEUE" : "DIRECT FILES"}</span>
                <h2>{isQueue ? "全部待看" : "当前文件夹"}</h2>
              </div>
              <div className="materials-tools">
                <label className="materials-search">
                  <IconSearch aria-hidden="true" size={16} />
                  <span className="sr-only">搜索当前素材</span>
                  <input
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索当前列表"
                    type="search"
                    value={query}
                  />
                </label>
                {!isQueue ? (
                  <button
                    aria-pressed={queuedOnly}
                    className={`materials-filter${queuedOnly ? " materials-filter--on" : ""}`}
                    onClick={() => setQueuedOnly((current) => !current)}
                    type="button"
                  >
                    <IconBookmark size={15} /> 只看待看
                  </button>
                ) : null}
              </div>
            </div>

            {visibleItems.length > 0 ? (
              <div className="material-list">
                {visibleItems.map((item) => (
                  <MaterialDocumentRow
                    item={item}
                    key={item.id}
                    onOpen={onOpenDocument}
                    onToggleQueue={toggleQueue}
                    pending={pendingIds.has(item.id)}
                    showQueuedAt={isQueue}
                  />
                ))}
              </div>
            ) : (
              query || queuedOnly
                ? <div className="materials-empty materials-empty--compact">没有符合当前筛选的素材</div>
                : <EmptyState queue={isQueue} />
            )}
          </section>
        </motion.div>
      )}
    </div>
  );
}
