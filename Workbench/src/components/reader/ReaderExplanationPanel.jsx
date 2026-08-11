import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconDeviceFloppy,
  IconLoader2,
  IconLock,
  IconQuote,
  IconRefresh,
  IconSend,
  IconShieldCheck,
  IconSparkles,
} from "@tabler/icons-react";
import {
  followUpReaderExplanation,
  loadReaderExplanation,
  loadReaderExplanations,
  saveReaderExplanationToNote,
  startReaderExplanation,
} from "../../lib/api";
import {
  apiErrorMessage,
  isLocalOnlyApiError,
  LOCAL_API_UNAVAILABLE_MESSAGE,
} from "../../lib/api-errors";
import {
  readerExplanationPollRetry,
  readerExplanationRequiresReselection,
  READER_EXPLANATION_POLL_RETRY_LIMIT,
} from "../../lib/reader-ui";
import {
  readerExplanationChain,
  readerExplanationFollowUpState,
  readerExplanationThreadSaveState,
  readerExplanationThreads,
} from "../../lib/reader-explanation-thread";
import "./reader-explanation.css";

const DISCLOSURE_STORAGE_KEY = "workbench:reader-explanation-disclosure:v1";
const ACTIVE_STATUSES = new Set(["queued", "planning", "processing", "running"]);

function normalizeRecord(record) {
  if (!record || typeof record !== "object") return null;
  const id = record.id ?? record.analysisId;
  if (!id) return null;
  return {
    ...record,
    id: String(id),
    status: String(record.status || "running").toLowerCase(),
  };
}

function unwrapRecord(payload) {
  return normalizeRecord(
    payload?.explanation ??
      payload?.job ??
      payload?.data?.explanation ??
      payload?.data?.job ??
      payload?.data ??
      payload,
  );
}

function unwrapRecords(payload) {
  const records = Array.isArray(payload)
    ? payload
    : payload?.explanations ??
      payload?.items ??
      payload?.data?.explanations ??
      payload?.data?.items ??
      payload?.data ??
      [];
  if (!Array.isArray(records)) return [];
  return records.map(normalizeRecord).filter(Boolean);
}

function recordTime(record) {
  const value = new Date(record?.updatedAt || record?.createdAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function mergeRecords(current, incoming) {
  const records = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) {
    if (!record?.id) continue;
    records.set(record.id, { ...(records.get(record.id) || {}), ...record });
  }
  return [...records.values()].sort((left, right) => recordTime(right) - recordTime(left));
}

function disclosureAccepted() {
  try {
    return globalThis.localStorage?.getItem(DISCLOSURE_STORAGE_KEY) === "accepted";
  } catch {
    return false;
  }
}

function rememberDisclosure() {
  try {
    globalThis.localStorage?.setItem(DISCLOSURE_STORAGE_KEY, "accepted");
  } catch {
    // The request can proceed for this session when private storage is unavailable.
  }
}

function formatHistoryTime(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function answerOf(record) {
  return record?.result?.answer || record?.result?.plainLanguage || "";
}

function ConversationThreadCard({
  thread,
  index,
  active,
  action,
  reduceMotion,
  onActivate,
  onJump,
  onSave,
}) {
  const completed = thread.records.filter((record) => record.status === "completed");
  const latest = thread.latest || thread.records.at(-1) || thread.root;
  const followUpState = readerExplanationFollowUpState(latest);
  const saveState = readerExplanationThreadSaveState(thread);
  const saving = action === `saving:${thread.root.id}`;
  const working = ACTIVE_STATUSES.has(latest?.status);

  return (
    <motion.article
      className={`reader-explain__thread-card${active ? " reader-explain__thread-card--active" : ""}`}
      data-thread-root={thread.root.id}
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.18, delay: reduceMotion ? 0 : Math.min(index, 4) * 0.025 }}
    >
      <header className="reader-explain__thread-head">
        <div>
          <span className="reader-explain__eyebrow">CONVERSATION {String(index + 1).padStart(2, "0")}</span>
          <strong>{completed.length ? `${completed.length} 轮问答` : "正在形成首轮回答"}</strong>
        </div>
        <time>{formatHistoryTime(latest?.updatedAt || latest?.createdAt)}</time>
      </header>

      <button
        type="button"
        className="reader-explain__thread-quote"
        onClick={() => onJump({
          quoteText: thread.root.quoteText,
          anchor: thread.root.anchor,
        })}
      >
        <IconQuote aria-hidden="true" />
        <span>{thread.root.quoteText}</span>
        <IconArrowLeft aria-hidden="true" />
      </button>

      <div className="reader-explain__thread-turns">
        {completed.map((record, turnIndex) => (
          <section className="reader-explain__thread-turn" key={record.id}>
            <div className="reader-explain__thread-question">
              <span>{turnIndex === 0 ? "我的问题" : `我的追问 · ${turnIndex}`}</span>
              <p>{record.question?.trim() || (turnIndex === 0 ? "直接理解这段原文" : "未记录问题")}</p>
            </div>
            <div className="reader-explain__thread-answer">
              <span>CODEX · {turnIndex === 0 ? "回答" : `继续回答 · ${turnIndex}`}</span>
              <p>{answerOf(record) || "本轮没有生成可显示的回答。"}</p>
            </div>
          </section>
        ))}
        {working ? (
          <div className="reader-explain__thread-working" role="status">
            <IconLoader2 className="reader-explain__spin" aria-hidden="true" />
            <span>Codex 正在继续这轮对话…</span>
          </div>
        ) : null}
      </div>

      {completed.length ? (
        <footer className="reader-explain__thread-actions">
          {followUpState.canFollowUp && !active && onActivate ? (
            <button type="button" className="reader-explain__thread-continue" onClick={onActivate}>
              继续这轮
            </button>
          ) : active && followUpState.canFollowUp ? (
            <span>当前对话 · 还可追问 {followUpState.remaining} 轮</span>
          ) : (
            <span>本轮对话已结束</span>
          )}
          <button
            type="button"
            className={`reader-explain__save${saveState.consolidated ? " reader-explain__save--saved" : ""}`}
            disabled={Boolean(action) || working || saveState.consolidated}
            onClick={onSave}
          >
            {saving
              ? <IconLoader2 className="reader-explain__spin" aria-hidden="true" />
              : saveState.consolidated
                ? <IconCheck aria-hidden="true" />
                : <IconDeviceFloppy aria-hidden="true" />}
            {saving
              ? "正在保存整轮"
              : saveState.consolidated
                ? "整轮已保存到笔记"
                : saveState.isUpdate
                  ? "更新整轮到笔记"
                  : "保存整轮到笔记"}
          </button>
        </footer>
      ) : null}
    </motion.article>
  );
}

export function ReaderExplanationPanel({
  document,
  contentHash,
  explanationDraft,
  onDraftConsumed,
  onJumpToAnchor,
  onSavedNote,
  onCloseForJump,
}) {
  const documentId = document?.id;
  const reduceMotion = useReducedMotion();
  const [records, setRecords] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [serviceUnavailable, setServiceUnavailable] = useState(false);
  const [liveContext, setLiveContext] = useState(null);
  const [disclosurePending, setDisclosurePending] = useState(false);
  const [action, setAction] = useState(null);
  const [actionError, setActionError] = useState("");
  const [actionErrorCode, setActionErrorCode] = useState("");
  const [pollIssue, setPollIssue] = useState(null);
  const [pollEpoch, setPollEpoch] = useState(0);
  const [question, setQuestion] = useState("");
  const [followUpQuestion, setFollowUpQuestion] = useState("");
  const consumedDraftsRef = useRef(new Set());
  const documentEpochRef = useRef(0);
  const actionEpochRef = useRef(0);
  const focusResultRef = useRef(false);
  const retryFollowUpRef = useRef(null);
  const resultRef = useRef(null);
  const consentButtonRef = useRef(null);
  const questionRef = useRef(null);
  const followUpRef = useRef(null);

  const active = useMemo(
    () => records.find((record) => record.id === activeId) || null,
    [activeId, records],
  );
  const conversationThreads = useMemo(
    () => readerExplanationThreads(records),
    [records],
  );
  const activeChain = useMemo(
    () => readerExplanationChain(records, activeId),
    [activeId, records],
  );
  const followUpState = readerExplanationFollowUpState(active);
  const activePollIssue = pollIssue?.analysisId === active?.id ? pollIssue : null;
  const isGenerating =
    action === "starting" ||
    action === "following" ||
    action === "retrying" ||
    (ACTIVE_STATUSES.has(active?.status) && !activePollIssue?.exhausted);
  const displayedContext = liveContext || (active
    ? {
        quoteText: active.quoteText,
        anchor: active.anchor,
        contentHash: active.contentHash,
      }
    : null);
  const displayedQuestion = liveContext ? question.trim() : String(active?.question || "").trim();

  const mergeOne = useCallback((record) => {
    if (!record) return;
    setRecords((current) => mergeRecords(current, [record]));
    setActiveId(record.id);
  }, []);

  useEffect(() => {
    const epoch = ++documentEpochRef.current;
    actionEpochRef.current += 1;
    setRecords([]);
    setActiveId(null);
    setHistoryLoading(Boolean(documentId));
    setHistoryError("");
    setServiceUnavailable(false);
    setLiveContext(null);
    setDisclosurePending(false);
    setAction(null);
    setActionError("");
    setActionErrorCode("");
    setPollIssue(null);
    setPollEpoch(0);
    setQuestion("");
    setFollowUpQuestion("");
    retryFollowUpRef.current = null;

    if (!documentId) {
      setHistoryLoading(false);
      return undefined;
    }

    let cancelled = false;
    loadReaderExplanations(documentId)
      .then((payload) => {
        if (cancelled || epoch !== documentEpochRef.current) return;
        const loaded = unwrapRecords(payload);
        const threads = readerExplanationThreads(loaded);
        setRecords((current) => mergeRecords(current, loaded));
        setActiveId((current) => current || threads[0]?.latest?.id || null);
      })
      .catch((error) => {
        if (!cancelled && epoch === documentEpochRef.current) {
          if (isLocalOnlyApiError(error)) setServiceUnavailable(true);
          setHistoryError(apiErrorMessage(error, "理解记录暂时无法读取。"));
        }
      })
      .finally(() => {
        if (!cancelled && epoch === documentEpochRef.current) {
          setHistoryLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const beginExplanation = useCallback(async (context, actionName = "starting") => {
    if (!documentId || !context?.quoteText || !context?.anchor) return;
    if (serviceUnavailable) {
      setActionError(LOCAL_API_UNAVAILABLE_MESSAGE);
      setActionErrorCode("LOCAL_API_UNAVAILABLE");
      return;
    }
    const boundHash = context.contentHash || contentHash;
    if (!boundHash) {
      setActionError("正文版本尚未就绪，请重新选择后再试。");
      setActionErrorCode("CONTENT_HASH_MISMATCH");
      return;
    }

    const epoch = documentEpochRef.current;
    const operation = ++actionEpochRef.current;
    const submitted = {
      ...context,
      contentHash: boundHash,
      mode: "understand",
      question: String(context.question || "").trim(),
    };
    focusResultRef.current = true;
    setAction(actionName);
    setActionError("");
    setActionErrorCode("");
    setPollIssue(null);
    setLiveContext(submitted);

    try {
      const payload = await startReaderExplanation({
        documentId,
        contentHash: boundHash,
        quoteText: submitted.quoteText,
        anchor: submitted.anchor,
        mode: "understand",
        question: submitted.question,
      });
      if (epoch !== documentEpochRef.current || operation !== actionEpochRef.current) return;
      const created = unwrapRecord(payload);
      if (!created) throw new Error("理解服务没有返回可追踪的任务。");
      mergeOne(created);
      setLiveContext(null);
      setQuestion("");
    } catch (error) {
      if (epoch === documentEpochRef.current && operation === actionEpochRef.current) {
        if (isLocalOnlyApiError(error)) setServiceUnavailable(true);
        setActionError(apiErrorMessage(error, "理解请求失败，请稍后重试。"));
        setActionErrorCode(error?.code || "");
      }
    } finally {
      if (epoch === documentEpochRef.current && operation === actionEpochRef.current) {
        setAction(null);
      }
    }
  }, [contentHash, documentId, mergeOne, serviceUnavailable]);

  useEffect(() => {
    if (!explanationDraft) return;
    const clientKey =
      explanationDraft.clientKey ||
      `${explanationDraft.quoteText || ""}:${explanationDraft.anchor?.startBlock || 0}:${explanationDraft.anchor?.startOffset || 0}`;
    if (consumedDraftsRef.current.has(clientKey)) return;
    consumedDraftsRef.current.add(clientKey);

    const context = {
      quoteText: String(explanationDraft.quoteText || "").trim(),
      anchor: explanationDraft.anchor,
      contentHash: explanationDraft.contentHash || contentHash,
      mode: "understand",
      question: String(explanationDraft.question || "").trim(),
    };
    setLiveContext(context);
    setDisclosurePending(false);
    setActionError("");
    setActionErrorCode("");
    setQuestion(context.question);
    setFollowUpQuestion("");
    retryFollowUpRef.current = null;
    onDraftConsumed?.(explanationDraft.clientKey || clientKey);

    if (!context.quoteText || !context.anchor) {
      setActionError("当前选段缺少可验证的引用信息，请重新选择。");
      setActionErrorCode("INVALID_QUOTE_ANCHOR");
      return;
    }
    if (serviceUnavailable) {
      setActionError(LOCAL_API_UNAVAILABLE_MESSAGE);
      setActionErrorCode("LOCAL_API_UNAVAILABLE");
    }
  }, [
    contentHash,
    explanationDraft,
    onDraftConsumed,
    serviceUnavailable,
  ]);

  useEffect(() => {
    if (serviceUnavailable) setDisclosurePending(false);
  }, [serviceUnavailable]);

  useEffect(() => {
    if (!disclosurePending) return undefined;
    const frame = window.requestAnimationFrame(() => consentButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [disclosurePending]);

  useEffect(() => {
    if (!liveContext || disclosurePending || isGenerating || serviceUnavailable) return undefined;
    const frame = window.requestAnimationFrame(() => questionRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [disclosurePending, isGenerating, liveContext, serviceUnavailable]);

  useEffect(() => {
    if (!active?.id || !ACTIVE_STATUSES.has(active.status)) return undefined;
    const epoch = documentEpochRef.current;
    let cancelled = false;
    let timer = null;
    let failures = 0;

    const poll = async () => {
      try {
        const payload = await loadReaderExplanation(active.id, documentId);
        if (cancelled || epoch !== documentEpochRef.current) return;
        const updated = unwrapRecord(payload);
        if (!updated) throw new Error("理解服务没有返回可识别的进度。");
        failures = 0;
        setPollIssue(null);
        mergeOne(updated);
        if (ACTIVE_STATUSES.has(updated.status)) {
          timer = window.setTimeout(poll, 1_200);
        }
      } catch (error) {
        if (!cancelled && epoch === documentEpochRef.current) {
          const localOnly = isLocalOnlyApiError(error);
          failures += 1;
          const retryState = localOnly
            ? {
                attempt: READER_EXPLANATION_POLL_RETRY_LIMIT + 1,
                exhausted: true,
                delay: null,
              }
            : readerExplanationPollRetry(failures);
          setPollIssue({
            analysisId: active.id,
            message: apiErrorMessage(error, "理解进度读取失败。"),
            attempt: retryState.attempt,
            exhausted: retryState.exhausted,
          });
          if (localOnly) setServiceUnavailable(true);
          if (!retryState.exhausted) {
            timer = window.setTimeout(poll, retryState.delay);
          }
        }
      }
    };

    timer = window.setTimeout(poll, 850);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [active?.id, active?.status, documentId, mergeOne, pollEpoch]);

  useEffect(() => {
    if (active?.status !== "completed" || !focusResultRef.current) return undefined;
    focusResultRef.current = false;
    const frame = window.requestAnimationFrame(() => resultRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [active?.id, active?.status]);

  const submitExplanation = () => {
    if (!liveContext || action || question.length > 500) return;
    const context = { ...liveContext, question: question.trim() };
    setLiveContext(context);
    if (disclosureAccepted()) {
      void beginExplanation(context);
    } else {
      setDisclosurePending(true);
    }
  };

  const acceptDisclosure = () => {
    if (!liveContext) return;
    rememberDisclosure();
    setDisclosurePending(false);
    void beginExplanation(liveContext);
  };

  const declineDisclosure = () => {
    setDisclosurePending(false);
  };

  const beginFollowUp = useCallback(async (
    parent,
    nextQuestion,
    actionName = "following",
  ) => {
    const trimmed = String(nextQuestion || "").trim();
    if (
      !parent?.id ||
      parent.status !== "completed" ||
      !trimmed ||
      trimmed.length > 500 ||
      action
    ) return;
    if (serviceUnavailable) {
      setActionError(LOCAL_API_UNAVAILABLE_MESSAGE);
      setActionErrorCode("LOCAL_API_UNAVAILABLE");
      return;
    }

    const boundHash = parent.contentHash || contentHash;
    if (!boundHash) {
      setActionError("正文版本尚未就绪，请重新选择后再试。");
      setActionErrorCode("CONTENT_HASH_MISMATCH");
      return;
    }

    const epoch = documentEpochRef.current;
    const operation = ++actionEpochRef.current;
    const retryContext = { parentId: parent.id, question: trimmed };
    retryFollowUpRef.current = retryContext;
    focusResultRef.current = true;
    setAction(actionName);
    setActionError("");
    setActionErrorCode("");
    setPollIssue(null);

    try {
      const payload = await followUpReaderExplanation(parent.id, {
        documentId,
        contentHash: boundHash,
        mode: "understand",
        question: trimmed,
      });
      if (epoch !== documentEpochRef.current || operation !== actionEpochRef.current) return;
      const created = unwrapRecord(payload);
      if (!created) throw new Error("追问没有返回可追踪的任务。");
      mergeOne(created);
      setFollowUpQuestion("");
      retryFollowUpRef.current = null;
    } catch (error) {
      if (epoch === documentEpochRef.current && operation === actionEpochRef.current) {
        if (isLocalOnlyApiError(error)) setServiceUnavailable(true);
        setActionError(apiErrorMessage(error, "追问失败，请稍后重试。"));
        setActionErrorCode(error?.code || "");
      }
    } finally {
      if (epoch === documentEpochRef.current && operation === actionEpochRef.current) {
        setAction(null);
      }
    }
  }, [action, contentHash, documentId, mergeOne, serviceUnavailable]);

  const submitFollowUp = () => {
    if (!active || !followUpState.canFollowUp || action) return;
    void beginFollowUp(active, followUpQuestion);
  };

  const retry = () => {
    if (serviceUnavailable) {
      setActionError(LOCAL_API_UNAVAILABLE_MESSAGE);
      setActionErrorCode("LOCAL_API_UNAVAILABLE");
      return;
    }
    if (active?.id && ACTIVE_STATUSES.has(active.status) && activePollIssue?.exhausted) {
      setActionError("");
      setActionErrorCode("");
      setPollIssue(null);
      setPollEpoch((current) => current + 1);
      return;
    }
    const failedFollowUp = retryFollowUpRef.current;
    if (failedFollowUp) {
      const parent = records.find((record) => record.id === failedFollowUp.parentId);
      if (parent) {
        void beginFollowUp(parent, failedFollowUp.question, "retrying");
        return;
      }
    }
    if (active?.parentId) {
      const parent = records.find((record) => record.id === active.parentId);
      if (parent) {
        void beginFollowUp(parent, active.question, "retrying");
        return;
      }
    }
    const context = active
      ? {
          quoteText: active.quoteText,
          anchor: active.anchor,
          contentHash: active.contentHash || contentHash,
          mode: "understand",
          question: active.question || "",
        }
      : liveContext;
    if (context) void beginExplanation(context, "retrying");
  };

  const saveConversation = async (thread) => {
    const target = thread?.root;
    const saveState = readerExplanationThreadSaveState(thread);
    if (!target?.id || !saveState.completedCount || saveState.consolidated || action) return;
    const epoch = documentEpochRef.current;
    const operation = ++actionEpochRef.current;
    setAction(`saving:${thread.root.id}`);
    setActionError("");
    setActionErrorCode("");
    try {
      const payload = await saveReaderExplanationToNote(target.id, {
        documentId,
        contentHash: target.contentHash || contentHash,
      });
      if (epoch !== documentEpochRef.current || operation !== actionEpochRef.current) return;
      const note = payload?.note ?? payload?.data?.note ?? null;
      const updated = unwrapRecords(payload);
      if (updated.length) {
        setRecords((current) => mergeRecords(current, updated));
      } else {
        const savedNoteId = payload?.savedNoteId ?? payload?.data?.savedNoteId ?? note?.id ?? null;
        const ids = new Set(thread.records.map((record) => record.id));
        setRecords((current) => current.map((record) =>
          ids.has(record.id) ? { ...record, savedNoteId } : record
        ));
      }
      if (note) onSavedNote?.(note, target);
    } catch (error) {
      if (epoch === documentEpochRef.current && operation === actionEpochRef.current) {
        if (isLocalOnlyApiError(error)) setServiceUnavailable(true);
        setActionError(apiErrorMessage(error, "保存到笔记失败。"));
        setActionErrorCode(error?.code || "");
      }
    } finally {
      if (epoch === documentEpochRef.current && operation === actionEpochRef.current) {
        setAction(null);
      }
    }
  };

  const jumpToContext = async (context) => {
    const anchor = context?.anchor;
    if (!anchor) return;
    await onCloseForJump?.();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    onJumpToAnchor?.({
      ...anchor,
      quoteText: anchor.quoteText || context?.quoteText,
    });
  };

  const returnToArticle = () => jumpToContext(displayedContext);

  const currentFailure =
    actionError ||
    (activePollIssue?.exhausted
      ? activePollIssue.message || "理解进度读取失败。"
      : "") ||
    (!liveContext && active?.status === "failed"
      ? active.error?.message || active.errorSummary || "这次理解请求失败。"
      : "");
  const requiresReselection =
    readerExplanationRequiresReselection(actionErrorCode);
  const activeRootId = activeChain[0]?.id || null;

  return (
    <div className="reader-explain">
      <div className="reader-explain__section-head">
        <div>
          <span className="reader-explain__eyebrow">ASK WITH CONTEXT</span>
          <h2>理解</h2>
        </div>
        {conversationThreads.length ? (
          <span
            className="reader-explain__count"
            aria-label={`${conversationThreads.length} 条理解对话`}
          >
            {String(conversationThreads.length).padStart(2, "0")}
          </span>
        ) : null}
      </div>

      <p className="reader-explain__intro">
        每段引用是一轮独立对话；首次提问和追问会连续排列，并作为一条笔记保存。
      </p>

      {conversationThreads.length ? (
        <div
          ref={resultRef}
          className="reader-explain__thread-list"
          tabIndex={-1}
          aria-label="本文理解对话列表"
        >
          {[...conversationThreads].reverse().map((thread, index) => (
            <ConversationThreadCard
              key={thread.root.id}
              thread={thread}
              index={index}
              active={thread.root.id === activeRootId}
              action={action}
              reduceMotion={reduceMotion}
              onActivate={liveContext || isGenerating ? null : () => {
                setActionError("");
                setActionErrorCode("");
                setFollowUpQuestion("");
                retryFollowUpRef.current = null;
                setActiveId(thread.latest.id);
              }}
              onJump={jumpToContext}
              onSave={() => saveConversation(thread)}
            />
          ))}
        </div>
      ) : null}

      {liveContext?.quoteText ? (
        <section className="reader-explain__quote" aria-label="引用原文">
          <header>
            <span><IconQuote aria-hidden="true" /> 原文</span>
            <button type="button" onClick={() => returnToArticle()}>
              <IconArrowLeft aria-hidden="true" />
              返回正文
            </button>
          </header>
          <blockquote>{displayedContext.quoteText}</blockquote>
        </section>
      ) : null}

      {liveContext && !disclosurePending && !isGenerating && !serviceUnavailable ? (
        <form
          className="reader-explain__composer"
          onSubmit={(event) => {
            event.preventDefault();
            submitExplanation();
          }}
        >
          <label htmlFor="reader-explain-question-draft">我的问题</label>
          <textarea
            ref={questionRef}
            id="reader-explain-question-draft"
            value={question}
            maxLength={500}
            rows={4}
            onChange={(event) => {
              setQuestion(event.target.value);
              setActionError("");
              setActionErrorCode("");
            }}
            placeholder="我对这段话的疑问是……（可不填，Codex 会直接解释原文）"
          />
          <div>
            <small>{question.length}/500 · 回答会结合当前文档全文</small>
            <button type="submit" disabled={Boolean(action)}>
              <IconSend aria-hidden="true" />
              发送给 Codex
            </button>
          </div>
        </form>
      ) : null}

      {(disclosurePending || isGenerating) && displayedQuestion ? (
        <section className="reader-explain__question-summary" aria-label="我的问题">
          <span>我的问题</span>
          <p>{displayedQuestion}</p>
        </section>
      ) : null}

      {displayedContext?.quoteText || active ? (
        <div className="reader-explain__data-note" role="note">
          <IconShieldCheck aria-hidden="true" />
          <span>
            全文、引用和每轮问题会发送给本地 Codex。只有主动保存时，同一引用下的整轮对话才会作为一条笔记进入笔记列表。
          </span>
        </div>
      ) : null}

      {disclosurePending ? (
        <section className="reader-explain__consent" aria-labelledby="reader-explain-consent-title">
          <span className="reader-explain__consent-icon"><IconLock aria-hidden="true" /></span>
          <span className="reader-explain__eyebrow">首次使用确认</span>
          <h3 id="reader-explain-consent-title">允许 Codex 阅读全文、引用和你的问题？</h3>
          <p>仅用于生成本次回答。只有你主动保存，结果才会进入阅读笔记。</p>
          <div>
            <button
              ref={consentButtonRef}
              type="button"
              className="reader-explain__primary"
              onClick={acceptDisclosure}
            >
              <IconSend aria-hidden="true" />
              同意并发送
            </button>
            <button type="button" className="reader-explain__secondary" onClick={declineDisclosure}>
              返回修改
            </button>
          </div>
        </section>
      ) : null}

      {!disclosurePending && !serviceUnavailable && historyLoading && !active && !liveContext && !isGenerating ? (
        <div className="reader-explain__state" role="status" aria-live="polite">
          <IconLoader2 className="reader-explain__spin" aria-hidden="true" />
          <strong>正在读取理解记录</strong>
        </div>
      ) : null}

      {!disclosurePending && isGenerating ? (
        <div className="reader-explain__state reader-explain__state--working" role="status" aria-live="polite">
          <span className="reader-explain__working-mark"><IconSparkles aria-hidden="true" /></span>
          <strong>Codex 正在结合全文回答</strong>
          <p>会围绕你的引用和问题，直接给出一段回答。</p>
        </div>
      ) : null}

      {!serviceUnavailable && activePollIssue && !activePollIssue.exhausted ? (
        <div className="reader-explain__inline-error" role="status" aria-live="polite">
          <IconAlertTriangle aria-hidden="true" />
          <span>
            进度连接不稳定，正在重试（
            {Math.min(activePollIssue.attempt, READER_EXPLANATION_POLL_RETRY_LIMIT)}
            /{READER_EXPLANATION_POLL_RETRY_LIMIT}）。
          </span>
        </div>
      ) : null}

      {!serviceUnavailable && historyError ? (
        <div className="reader-explain__inline-error" role="alert">
          <IconAlertTriangle aria-hidden="true" />
          <span>{historyError}</span>
        </div>
      ) : null}

      {!disclosurePending && !isGenerating && serviceUnavailable ? (
        <div className="reader-explain__state reader-explain__state--error" role="alert">
          <IconAlertTriangle aria-hidden="true" />
          <strong>仅本地 Workbench 可用</strong>
          <p>{LOCAL_API_UNAVAILABLE_MESSAGE}</p>
        </div>
      ) : null}

      {!disclosurePending && !isGenerating && !serviceUnavailable && currentFailure ? (
        <div className="reader-explain__state reader-explain__state--error" role="alert">
          <IconAlertTriangle aria-hidden="true" />
          <strong>
            {requiresReselection ? "这段引用需要重新定位" : "这次没有回答出来"}
          </strong>
          <p>{currentFailure}</p>
          {(active || liveContext) ? (
            <button
              type="button"
              className="reader-explain__secondary"
              onClick={requiresReselection ? returnToArticle : retry}
            >
              {requiresReselection
                ? <IconArrowLeft aria-hidden="true" />
                : <IconRefresh aria-hidden="true" />}
              {requiresReselection
                ? "返回正文重新选择"
                : activePollIssue?.exhausted
                  ? "重新读取进度"
                  : "重新发送"}
            </button>
          ) : null}
        </div>
      ) : null}

      {!disclosurePending &&
      !historyLoading &&
      !isGenerating &&
      !historyError &&
      !currentFailure &&
      !serviceUnavailable &&
      !active &&
      !liveContext ? (
        <div className="reader-explain__state reader-explain__state--empty">
          <IconQuote aria-hidden="true" />
          <strong>先引用一段原文</strong>
          <p>在正文中选中文字，点击“加入理解”，再写下你的问题。</p>
        </div>
      ) : null}

      {!disclosurePending &&
      !isGenerating &&
      !serviceUnavailable &&
      !liveContext &&
      active?.status === "completed" &&
      followUpState.canFollowUp ? (
        <form
          className="reader-explain__composer reader-explain__composer--follow-up"
          onSubmit={(event) => {
            event.preventDefault();
            submitFollowUp();
          }}
        >
          <label htmlFor={`reader-explain-follow-up-${active.id}`}>继续追问</label>
          <textarea
            ref={followUpRef}
            id={`reader-explain-follow-up-${active.id}`}
            value={followUpQuestion}
            maxLength={500}
            rows={3}
            onChange={(event) => {
              setFollowUpQuestion(event.target.value);
              setActionError("");
              setActionErrorCode("");
              retryFollowUpRef.current = null;
            }}
            placeholder="还想弄清哪一个细节？"
          />
          <div>
            <small>
              {followUpQuestion.length}/500 · 还可追问 {followUpState.remaining} 轮
            </small>
            <button
              type="submit"
              disabled={!followUpQuestion.trim() || Boolean(action)}
            >
              <IconSend aria-hidden="true" />
              发送追问
            </button>
          </div>
        </form>
      ) : null}

      {!disclosurePending &&
      !isGenerating &&
      !serviceUnavailable &&
      !liveContext &&
      active?.status === "completed" &&
      !followUpState.canFollowUp &&
      followUpState.limit > 0 ? (
        <div className="reader-explain__limit-note" role="note">
          当前对话已完成 {followUpState.limit} 轮追问。需要换一个问题方向时，请重新选择原文开始新的理解。
        </div>
      ) : null}

    </div>
  );
}
