import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion } from "motion/react";
import {
  IconAlertTriangle,
  IconBookUpload,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconLoader2,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconNotes,
  IconPlus,
  IconQuote,
  IconSend,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import {
  deleteReaderNote,
  loadReaderNotes,
  saveReaderNote,
} from "../../lib/api";
import {
  buildManualWikiIngestPackage,
  launchCodexClient,
} from "../../lib/reader-ui";
import { ReaderExplanationPanel } from "./ReaderExplanationPanel";

const SAVE_DELAY = 650;

function clientKey() {
  return globalThis.crypto?.randomUUID?.() || `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function unwrapNotes(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : payload?.notes ?? payload?.items ?? payload?.data?.notes ?? [];
  return Array.isArray(rows) ? rows : [];
}

function unwrapNote(payload) {
  return payload?.note ?? payload?.data?.note ?? payload?.data ?? payload;
}

function asMessage(error, fallback) {
  if (!error) return fallback;
  try {
    const parsed = JSON.parse(error.message);
    return parsed?.error?.message || parsed?.message || fallback;
  } catch {
    return error.message || fallback;
  }
}

function normalizeNote(note, index = 0) {
  return {
    ...note,
    id: note?.id ?? null,
    type: note?.type === "quote" ? "quote" : "free",
    body: String(note?.body ?? ""),
    quoteText: note?.quoteText ? String(note.quoteText) : null,
    anchor: note?.anchor ?? null,
    _key: note?._key || note?.id || `loaded-${index}`,
    _revision: Number(note?._revision) || 0,
    _savedRevision: Number(note?._savedRevision) || 0,
    _saveState: note?._saveState || "saved",
  };
}

function notePayload(note) {
  return {
    ...(note.id ? { id: note.id } : {}),
    type: note.type,
    body: note.body,
    ...(note.type === "quote"
      ? {
          quoteText: note.quoteText,
          anchor: note.anchor,
        }
      : {}),
  };
}

function noteNeedsSave(note) {
  if (!note) return false;
  if (note.type === "free" && !note.body.trim() && !note.id) return false;
  return (
    note._revision > note._savedRevision ||
    note._saveState === "pending" ||
    note._saveState === "failed" ||
    note._saveState === "saving"
  );
}

function noteStatusLabel(note) {
  if (note._saveState === "saving") return "保存中";
  if (note._saveState === "pending") return "等待保存";
  if (note._saveState === "failed") return "保存失败";
  return "已保存";
}

function NotesPanel({
  notes,
  loading,
  error,
  pendingDelete,
  onAdd,
  onChange,
  onBlur,
  onJump,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}) {
  return (
    <div className="reader-notes">
      <div className="reader-workspace__section-head">
        <div>
          <span className="reader-workspace__eyebrow">READER NOTES</span>
          <h2>文档笔记</h2>
        </div>
        <button
          type="button"
          className="reader-workspace__quiet-button"
          onClick={onAdd}
          disabled={loading}
        >
          <IconPlus aria-hidden="true" />
          自由笔记
        </button>
      </div>

      <p className="reader-workspace__hint">选中正文可创建带原文锚点的引用笔记。</p>

      {error ? (
        <div className="reader-workspace__error" role="status">
          <IconAlertTriangle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="reader-notes__loading" aria-label="正在读取笔记">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : notes.length ? (
        <div className="reader-notes__list">
          {notes.map((note, index) => (
            <motion.article
              className={`reader-note-card reader-note-card--${note.type}`}
              data-note-key={note._key}
              key={note._key}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: Math.min(index, 4) * 0.025 }}
            >
              <header className="reader-note-card__head">
                <span>
                  {note.origin === "codex-explanation"
                    ? <IconSparkles aria-hidden="true" />
                    : note.type === "quote"
                      ? <IconQuote aria-hidden="true" />
                      : <IconNotes aria-hidden="true" />}
                  {note.origin === "codex-explanation"
                    ? "AI 阅读辅助"
                    : note.type === "quote"
                      ? "引用笔记"
                      : "自由笔记"}
                </span>
                <span
                  className={`reader-note-card__save reader-note-card__save--${note._saveState}`}
                  aria-live="polite"
                >
                  {note._saveState === "saving" ? <IconLoader2 aria-hidden="true" /> : null}
                  {noteStatusLabel(note)}
                </span>
              </header>

              {note.type === "quote" ? (
                <button
                  type="button"
                  className="reader-note-card__quote"
                  onClick={() => onJump({
                    ...note.anchor,
                    quoteText: note.anchor?.quoteText || note.quoteText,
                  })}
                  title="回到原文位置"
                >
                  “{note.quoteText}”
                </button>
              ) : null}

              {note.origin === "codex-explanation" ? (
                <p className="reader-note-card__origin">
                  Codex 原始解释保持只读；你的核对、反对或补充请另建自由笔记。
                </p>
              ) : null}

              <label className="reader-note-card__editor">
                <span className="sr-only">
                  {note.type === "quote" ? "补充引用笔记" : "自由笔记内容"}
                </span>
                <textarea
                  autoFocus={note._focus === true}
                  value={note.body}
                  onChange={(event) => onChange(note._key, event.target.value)}
                  onBlur={() => onBlur(note._key)}
                  readOnly={note.origin === "codex-explanation"}
                  placeholder={note.origin === "codex-explanation"
                    ? "补充你的核对、反对或个人判断…"
                    : note.type === "quote"
                      ? "补充你为什么标记这段…"
                      : "写下想法、疑问或下一步…"}
                  rows={note.type === "quote" ? 3 : 4}
                />
              </label>

              {note._saveState === "failed" && note._saveError ? (
                <p className="reader-note-card__error">{note._saveError}</p>
              ) : null}

              <footer className="reader-note-card__footer">
                {pendingDelete === note._key ? (
                  <div className="reader-note-card__confirm">
                    <span>删除后不可恢复</span>
                    <button type="button" onClick={() => onConfirmDelete(note)}>确认删除</button>
                    <button type="button" onClick={onCancelDelete}>取消</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="reader-note-card__delete"
                    onClick={() => onRequestDelete(note._key)}
                    aria-label="删除这条笔记"
                  >
                    <IconTrash aria-hidden="true" />
                    删除
                  </button>
                )}
              </footer>
            </motion.article>
          ))}
        </div>
      ) : (
        <div className="reader-notes__empty">
          <IconNotes aria-hidden="true" />
          <strong>这篇文档还没有笔记</strong>
          <span>自由记录，或从正文中选择一句话开始。</span>
        </div>
      )}
    </div>
  );
}


function ManualIngestPanel({
  document,
  notes,
  notesVersion,
  notesLoading,
  notesError,
  onBeforePrepare,
  getNotes,
}) {
  const [action, setAction] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [copyState, setCopyState] = useState("idle");
  const [error, setError] = useState(null);

  useEffect(() => {
    setPrepared(null);
    setCopyState("idle");
    setError(null);
  }, [document.id, notesVersion]);

  const counts = useMemo(() => {
    const rows = Array.isArray(notes) ? notes : [];
    return {
      free: rows.filter((note) => note?.type !== "quote" && String(note?.body || "").trim()).length,
      quote: rows.filter((note) => note?.type === "quote" && (String(note?.quoteText || "").trim() || String(note?.body || "").trim())).length,
    };
  }, [notes]);

  const copyAndOpen = async () => {
    if (action || notesLoading || notesError) return;
    setAction("prepare");
    setError(null);
    setCopyState("idle");

    try {
      await onBeforePrepare?.();
      const nextPackage = buildManualWikiIngestPackage({
        document,
        notes: getNotes?.() ?? notes,
      });
      setPrepared(nextPackage);

      if (!globalThis.navigator?.clipboard?.writeText) {
        throw new Error("当前浏览器不能直接写入剪贴板，请从下方材料包手动复制。");
      }

      await globalThis.navigator.clipboard.writeText(nextPackage.prompt);
      setCopyState("copied");
      if (!launchCodexClient(globalThis.location)) {
        throw new Error("材料已复制，但当前页面无法唤起 Codex；请手动打开 Codex 后粘贴。");
      }
    } catch (requestError) {
      setCopyState((current) => current === "copied" ? current : "failed");
      setError(asMessage(requestError, "无法整理入库审查材料。"));
    } finally {
      setAction(null);
    }
  };

  return (
    <div className="reader-ingest reader-ingest--manual">
      <div className="reader-workspace__section-head">
        <div>
          <span className="reader-workspace__eyebrow">MANUAL WIKI REVIEW</span>
          <h2>手动入库审查</h2>
        </div>
      </div>

      <p className="reader-workspace__hint">
        Workbench 只整理材料，不再后台生成方案。复制后在当前 Codex 任务中粘贴并发送。
      </p>

      <div className="reader-ingest__manual-card">
        <div className="reader-ingest__manual-intro">
          <span><IconBookUpload aria-hidden="true" /></span>
          <div>
            <h3>三项材料，一次打包</h3>
            <p>先保存当前笔记，再把全文路径、全文笔记和引用笔记合并成一段可审计文本。</p>
          </div>
        </div>

        <ol className="reader-ingest__manual-list">
          <li>
            <span>01</span>
            <div><strong>来源全文</strong><code>{document.relativePath ?? document.path}</code></div>
            <IconCheck aria-hidden="true" />
          </li>
          <li>
            <span>02</span>
            <div><strong>全文笔记</strong><small>{notesLoading ? "读取中" : `${counts.free} 条`}</small></div>
            <IconNotes aria-hidden="true" />
          </li>
          <li>
            <span>03</span>
            <div><strong>引用笔记</strong><small>{notesLoading ? "读取中" : `${counts.quote} 条`}</small></div>
            <IconQuote aria-hidden="true" />
          </li>
        </ol>

        <button
          type="button"
          className="reader-ingest__manual-action"
          onClick={copyAndOpen}
          disabled={Boolean(action) || notesLoading || Boolean(notesError)}
        >
          {action === "prepare"
            ? <IconLoader2 aria-hidden="true" />
            : copyState === "copied"
              ? <IconCheck aria-hidden="true" />
              : <IconCopy aria-hidden="true" />}
          {action === "prepare"
            ? "正在保存并整理…"
            : copyState === "copied"
              ? "再次复制并打开 Codex"
              : "整理、复制并打开 Codex"}
        </button>

        <small className="reader-ingest__manual-boundary">
          这一步不会写入 Wiki，也不会替你发送消息；Codex 给出入库前方案后仍会等待你的确认。
        </small>
      </div>

      {notesError ? (
        <div className="reader-workspace__error" role="alert">
          <IconAlertTriangle aria-hidden="true" />
          <span>笔记没有可靠读取，已停止打包：{notesError}</span>
        </div>
      ) : null}

      {error ? (
        <div className="reader-workspace__error" role="alert">
          <IconAlertTriangle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {prepared ? (
        <section className="reader-ingest__manual-ready" aria-live="polite">
          <div className="reader-ingest__manual-ready-head">
            <span>{copyState === "copied" ? <IconCheck aria-hidden="true" /> : <IconSend aria-hidden="true" />}</span>
            <div>
              <strong>{copyState === "copied" ? "材料已复制，Codex 已尝试打开" : "材料包已整理"}</strong>
              <p>在 Codex 输入框按 ⌘V 并发送；下方保留完整文本，复制失败时可手动选择。</p>
            </div>
          </div>
          <textarea
            className="reader-ingest__manual-preview"
            value={prepared.prompt}
            readOnly
            rows={14}
            aria-label="可复制的 Wiki 入库前审查材料包"
            onFocus={(event) => event.currentTarget.select()}
          />
        </section>
      ) : null}
    </div>
  );
}

export const ReaderWorkspace = forwardRef(function ReaderWorkspace({
  document,
  contentHash,
  canExplain,
  quoteDraft,
  explanationDraft,
  onQuoteConsumed,
  onExplanationConsumed,
  onJumpToAnchor,
  collapsed = false,
  onToggleCollapsed,
}, ref) {
  const readableBody = document.body ?? document.bodyText;
  const eligibleForExplanation = Boolean(canExplain);
  const eligibleForIngest =
    document.layer === "raw" &&
    typeof readableBody === "string" &&
    Boolean(readableBody.trim());
  const [tab, setTab] = useState("notes");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notes, setNotes] = useState([]);
  const [notesVersion, setNotesVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const notesRef = useRef([]);
  const timersRef = useRef(new Map());
  const inFlightRef = useRef(new Map());
  const identityRef = useRef(null);
  const consumedQuotesRef = useRef(new Set());

  const identity = useMemo(
    () => ({
      documentId: document.id,
      relativePath: document.relativePath ?? document.path,
      title: document.title,
      contentHash: contentHash || document.contentHash || null,
    }),
    [contentHash, document.contentHash, document.id, document.path, document.relativePath, document.title],
  );
  identityRef.current = identity;

  const updateNotes = useCallback((updater) => {
    const next = typeof updater === "function" ? updater(notesRef.current) : updater;
    notesRef.current = next;
    setNotes(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    notesRef.current = [];
    setNotes([]);
    setNotesVersion(0);
    setLoading(true);
    setLoadError(null);
    setPendingDelete(null);
    setTab("notes");

    loadReaderNotes(document.id)
      .then((payload) => {
        if (cancelled) return;
        updateNotes(unwrapNotes(payload).map(normalizeNote));
      })
      .catch((requestError) => {
        if (!cancelled) setLoadError(asMessage(requestError, "笔记服务暂时不可用。"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current.clear();
    };
  }, [document.id, updateNotes]);

  const persistNote = useCallback((key) => {
    const existing = inFlightRef.current.get(key);
    if (existing) return existing;
    const snapshot = notesRef.current.find((note) => note._key === key);
    if (!noteNeedsSave(snapshot)) return Promise.resolve({ ok: true, skipped: true });
    const identity = { ...identityRef.current };

    const task = (async () => {
      updateNotes((current) => current.map((note) =>
        note._key === key
          ? { ...note, _saveState: "saving", _saveError: null }
          : note,
      ));

      try {
        const response = await saveReaderNote({
          ...identity,
          note: notePayload(snapshot),
        });
        const saved = normalizeNote(unwrapNote(response) || snapshot);
        updateNotes((current) => current.map((note) => {
          if (note._key !== key) return note;
          const changedWhileSaving = note._revision > snapshot._revision;
          return {
            ...note,
            id: saved.id || note.id,
            createdAt: saved.createdAt || note.createdAt,
            updatedAt: saved.updatedAt || note.updatedAt,
            _savedRevision: snapshot._revision,
            _saveState: changedWhileSaving ? "pending" : "saved",
            _focus: false,
          };
        }));
        return { ok: true };
      } catch (requestError) {
        const message = asMessage(requestError, "保存失败，请稍后重试。");
        updateNotes((current) => current.map((note) =>
          note._key === key
            ? { ...note, _saveState: "failed", _saveError: message }
            : note,
        ));
        return { ok: false, error: new Error(message) };
      } finally {
        inFlightRef.current.delete(key);
        const latest = notesRef.current.find((note) => note._key === key);
        if (latest && latest._revision > snapshot._revision) {
          const timer = window.setTimeout(() => {
            timersRef.current.delete(key);
            persistNote(key);
          }, SAVE_DELAY);
          timersRef.current.set(key, timer);
        }
      }
    })();

    inFlightRef.current.set(key, task);
    return task;
  }, [updateNotes]);

  const scheduleSave = useCallback((key, delay = SAVE_DELAY) => {
    const previous = timersRef.current.get(key);
    if (previous) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      timersRef.current.delete(key);
      persistNote(key);
    }, delay);
    timersRef.current.set(key, timer);
  }, [persistNote]);

  const flush = useCallback(async () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();

    for (let pass = 0; pass < 8; pass += 1) {
      const keys = new Set([
        ...inFlightRef.current.keys(),
        ...notesRef.current.filter(noteNeedsSave).map((note) => note._key),
      ]);
      if (!keys.size) return;

      const results = await Promise.all(
        [...keys].map((key) => inFlightRef.current.get(key) || persistNote(key)),
      );
      const failure = results.find((result) => result?.ok === false);
      if (failure) throw failure.error || new Error("笔记保存失败。");

      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current.clear();
    }

    if (notesRef.current.some(noteNeedsSave) || inFlightRef.current.size) {
      throw new Error("笔记仍在持续更新，请稍后再试。");
    }
  }, [persistNote]);

  useImperativeHandle(ref, () => ({ flush }), [flush]);

  useEffect(() => {
    if (loading || !quoteDraft || consumedQuotesRef.current.has(quoteDraft.clientKey)) return;
    consumedQuotesRef.current.add(quoteDraft.clientKey);
    const next = normalizeNote({
      _key: quoteDraft.clientKey,
      type: "quote",
      body: "",
      quoteText: quoteDraft.quoteText,
      anchor: quoteDraft.anchor,
      _saveState: "pending",
      _revision: 1,
      _focus: true,
    });
    updateNotes((current) => [next, ...current]);
    setNotesVersion((current) => current + 1);
    setTab("notes");
    setMobileOpen(true);
    onQuoteConsumed?.(quoteDraft.clientKey);
    const frame = window.requestAnimationFrame(() => scheduleSave(next._key));
    return () => window.cancelAnimationFrame(frame);
  }, [loading, onQuoteConsumed, quoteDraft, scheduleSave, updateNotes]);

  useEffect(() => {
    if (!explanationDraft || !eligibleForExplanation) return;
    setTab("explain");
    setMobileOpen(true);
  }, [eligibleForExplanation, explanationDraft]);

  useEffect(() => {
    if (tab === "explain" && !eligibleForExplanation) {
      setTab("notes");
    } else if (tab === "ingest" && !eligibleForIngest) {
      setTab("notes");
    }
  }, [eligibleForExplanation, eligibleForIngest, tab]);

  const addFreeNote = () => {
    const next = normalizeNote({
      _key: clientKey(),
      type: "free",
      body: "",
      _saveState: "pending",
      _revision: 0,
      _focus: true,
    });
    updateNotes((current) => [next, ...current.map((note) => ({ ...note, _focus: false }))]);
    setNotesVersion((current) => current + 1);
    setMobileOpen(true);
  };

  const changeNote = (key, body) => {
    updateNotes((current) => current.map((note) =>
      note._key === key
        ? {
            ...note,
            body,
            _revision: note._revision + 1,
            _saveState: "pending",
            _focus: false,
          }
        : note,
    ));
    setNotesVersion((current) => current + 1);
    scheduleSave(key);
  };

  const blurNote = (key) => {
    const note = notesRef.current.find((item) => item._key === key);
    if (note?._saveState === "pending" || note?._saveState === "failed") scheduleSave(key, 0);
  };

  const confirmDelete = async (note) => {
    const key = note._key;
    const timer = timersRef.current.get(key);
    if (timer) window.clearTimeout(timer);
    timersRef.current.delete(key);
    const currentSave = inFlightRef.current.get(key);
    if (currentSave) await currentSave;
    const latestNote = notesRef.current.find((item) => item._key === key) || note;
    if (!latestNote.id) {
      updateNotes((current) => current.filter((item) => item._key !== key));
      setNotesVersion((current) => current + 1);
      setPendingDelete(null);
      return;
    }

    updateNotes((current) => current.map((item) =>
      item._key === key ? { ...item, _saveState: "saving" } : item,
    ));
    try {
      await deleteReaderNote(latestNote.id, document.id);
      updateNotes((current) => current.filter((item) => item._key !== key));
      setNotesVersion((current) => current + 1);
      setPendingDelete(null);
    } catch (requestError) {
      updateNotes((current) => current.map((item) =>
        item._key === key
          ? { ...item, _saveState: "failed", _saveError: asMessage(requestError, "删除失败。") }
          : item,
      ));
    }
  };

  const switchTab = (nextTab) => {
    setTab(nextTab);
    setMobileOpen(true);
  };

  const handleTabKeyDown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const availableTabs = [
      "notes",
      ...(eligibleForExplanation ? ["explain"] : []),
      ...(eligibleForIngest ? ["ingest"] : []),
    ];
    if (availableTabs.length < 2) return;
    event.preventDefault();
    const currentIndex = Math.max(0, availableTabs.indexOf(tab));
    const nextTab = event.key === "Home"
      ? availableTabs[0]
      : event.key === "End"
        ? availableTabs.at(-1)
        : availableTabs[
            (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + availableTabs.length) %
              availableTabs.length
          ];
    const tablist = event.currentTarget;
    switchTab(nextTab);
    window.requestAnimationFrame(() => {
      tablist.querySelector(`[data-reader-tab="${nextTab}"]`)?.focus();
    });
  };

  return (
    <aside className={`reader-workspace${mobileOpen ? " reader-workspace--open" : ""}${collapsed ? " reader-workspace--desktop-collapsed" : ""}`} aria-label="编辑批注台">
      <button
        type="button"
        className="reader-workspace__collapse-toggle"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? "展开右侧工具栏" : "收起右侧工具栏"}
        aria-pressed={collapsed}
        title={collapsed ? "展开右侧工具栏" : "收起右侧工具栏"}
      >
        {collapsed ? (
          <IconLayoutSidebarRightExpand aria-hidden="true" />
        ) : (
          <IconLayoutSidebarRightCollapse aria-hidden="true" />
        )}
      </button>
      <div className="reader-workspace__topbar">
        <div className="reader-workspace__desk-label">
          <span>ANNOTATION DESK</span>
          <small>编辑批注台</small>
        </div>
        <div className="reader-workspace__tabs" role="tablist" aria-label="阅读工作台功能" onKeyDown={handleTabKeyDown}>
          <button
            id="reader-notes-tab"
            type="button"
            role="tab"
            aria-selected={tab === "notes"}
            aria-controls="reader-notes-panel"
            data-reader-tab="notes"
            tabIndex={tab === "notes" ? 0 : -1}
            className={tab === "notes" ? "reader-workspace__tab reader-workspace__tab--active" : "reader-workspace__tab"}
            onClick={() => switchTab("notes")}
          >
            <IconNotes aria-hidden="true" />
            笔记
            {notes.length ? <span>{notes.length}</span> : null}
          </button>
          {eligibleForExplanation ? (
            <button
              id="reader-explain-tab"
              type="button"
              role="tab"
              aria-selected={tab === "explain"}
              aria-controls="reader-explain-panel"
              data-reader-tab="explain"
              tabIndex={tab === "explain" ? 0 : -1}
              className={tab === "explain" ? "reader-workspace__tab reader-workspace__tab--active" : "reader-workspace__tab"}
              onClick={() => switchTab("explain")}
            >
              <IconSparkles aria-hidden="true" />
              理解
            </button>
          ) : null}
          {eligibleForIngest ? (
            <button
              id="reader-ingest-tab"
              type="button"
              role="tab"
              aria-selected={tab === "ingest"}
              aria-controls="reader-ingest-panel"
              data-reader-tab="ingest"
              tabIndex={tab === "ingest" ? 0 : -1}
              className={tab === "ingest" ? "reader-workspace__tab reader-workspace__tab--active" : "reader-workspace__tab"}
              onClick={() => switchTab("ingest")}
            >
              <IconBookUpload aria-hidden="true" />
              入库
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="reader-workspace__mobile-toggle"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "收起阅读工作台" : "展开阅读工作台"}
        >
          {mobileOpen ? <IconChevronDown aria-hidden="true" /> : <IconChevronUp aria-hidden="true" />}
        </button>
      </div>

      <div className="reader-workspace__body">
        <section
          id="reader-notes-panel"
          role="tabpanel"
          aria-labelledby="reader-notes-tab"
          hidden={tab !== "notes"}
        >
          <NotesPanel
            notes={notes}
            loading={loading}
            error={loadError}
            pendingDelete={pendingDelete}
            onAdd={addFreeNote}
            onChange={changeNote}
            onBlur={blurNote}
            onJump={onJumpToAnchor}
            onRequestDelete={setPendingDelete}
            onConfirmDelete={confirmDelete}
            onCancelDelete={() => setPendingDelete(null)}
          />
        </section>
        {eligibleForExplanation ? (
          <section
            id="reader-explain-panel"
            role="tabpanel"
            aria-labelledby="reader-explain-tab"
            hidden={tab !== "explain"}
          >
            <ReaderExplanationPanel
              document={document}
              contentHash={contentHash}
              explanationDraft={explanationDraft}
              onDraftConsumed={onExplanationConsumed}
              onJumpToAnchor={onJumpToAnchor}
              onCloseForJump={() => setMobileOpen(false)}
              onSavedNote={(savedNote) => {
                const next = normalizeNote(savedNote);
                updateNotes((current) => {
                  const existingIndex = current.findIndex((note) => note.id === next.id);
                  if (existingIndex < 0) return [next, ...current];
                  return current.map((note, index) => index === existingIndex ? next : note);
                });
                setNotesVersion((current) => current + 1);
              }}
            />
          </section>
        ) : null}
        {eligibleForIngest ? (
          <section
            id="reader-ingest-panel"
            role="tabpanel"
            aria-labelledby="reader-ingest-tab"
            hidden={tab !== "ingest"}
          >
            <ManualIngestPanel
              document={{ ...document, contentHash: identity.contentHash }}
              notes={notes}
              notesVersion={notesVersion}
              notesLoading={loading}
              notesError={loadError}
              onBeforePrepare={flush}
              getNotes={() => notesRef.current}
            />
          </section>
        ) : null}
      </div>
    </aside>
  );
});
