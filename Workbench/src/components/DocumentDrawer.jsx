import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "motion/react";
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowUpRight,
  IconBookmark,
  IconExternalLink,
  IconFileBroken,
  IconFolder,
  IconLink,
  IconList,
  IconQuote,
  IconSparkles,
  IconZoomIn,
  IconX,
} from "@tabler/icons-react";
import { ReaderWorkspace } from "./reader/ReaderWorkspace";
import { ReaderPanelToggleIcon } from "./reader/ReaderPanelToggleIcon";
import {
  addMaterialToReadingQueue,
  loadDocument,
  loadMaterialReadingQueue,
  openLocalTarget,
  removeMaterialFromReadingQueue,
  searchVault,
} from "../lib/api";
import { formatFullDate, layerLabel, statusLabel } from "../lib/format";
import {
  headingId,
  remarkObsidianCjkStrong,
  remarkObsidianWikilinks,
  vaultPathCandidates,
} from "../lib/obsidian-markdown";
import {
  quoteAnchorFromSelection,
  rangeForQuoteAnchor,
  remarkReaderBlocks,
  sha256Text,
} from "../lib/reader-anchors";
import {
  canExplainDocument,
  clampSelectionToolbarPosition,
  readerImageRequestProps,
  readerPreformattedBlockClassName,
  readerPreformattedBlockText,
  readableDocumentBody,
} from "../lib/reader-ui";
import { readerRehypePlugins } from "../lib/reader-markdown";
import {
  announceBookReadingProgress,
  bookReadingStorage,
  saveBookReadingProgress,
} from "../lib/book-reading-progress";

function childrenText(children) {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(childrenText).join("");
  return children?.props?.children ? childrenText(children.props.children) : "";
}

function dataProperty(node, props, name) {
  const camelName = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  return props[name] ?? props[camelName] ?? node?.properties?.[name] ?? node?.properties?.[camelName] ?? "";
}

function basenameWithoutExtension(value = "") {
  return String(value)
    .replace(/\\+$/g, "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.md$/i, "") || "";
}

export function DocumentDrawer({ documentId, onClose, onNavigateDocument, readingContext }) {
  const [trail, setTrail] = useState([]);
  const [state, setState] = useState({ loading: false, data: null, error: null });
  const [notice, setNotice] = useState(null);
  const [progress, setProgress] = useState(0);
  const [activeImage, setActiveImage] = useState(null);
  const [selectionAction, setSelectionAction] = useState(null);
  const [quoteDraft, setQuoteDraft] = useState(null);
  const [explanationDraft, setExplanationDraft] = useState(null);
  const [contentHash, setContentHash] = useState(null);
  const [readingQueue, setReadingQueue] = useState({ queued: false, pending: false });
  const [documentRevision, setDocumentRevision] = useState(0);
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("workbench:reader:rail-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("workbench:reader:workspace-collapsed") === "true";
    } catch {
      return false;
    }
  });
  const scrollRef = useRef(null);
  const readerRef = useRef(null);
  const articleRef = useRef(null);
  const workspaceRef = useRef(null);
  const closeRef = useRef(null);
  const imagePreviewCloseRef = useRef(null);
  const imagePreviewTriggerRef = useRef(null);
  const returnFocusRef = useRef(null);
  const selectionFrameRef = useRef(null);
  const selectionToolbarRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const propDocumentRef = useRef(null);
  const pendingBookProgressRef = useRef(null);
  const bookProgressTimerRef = useRef(null);
  const restoredBookChapterRef = useRef(null);
  const active = trail.at(-1) || null;
  const currentDocument = state.data;
  const readableBody = readableDocumentBody(currentDocument);
  const documentBody = readableBody ?? "该文件暂不支持正文预览。";
  const canExplain = canExplainDocument(currentDocument, contentHash);
  const bookChapters = readingContext?.kind === "book" ? readingContext.chapters || [] : [];
  const bookChapterIndex = currentDocument && readingContext?.chapterId === currentDocument.id
    ? bookChapters.findIndex((chapter) => chapter.id === currentDocument.id)
    : -1;
  const previousBookChapter = bookChapterIndex > 0 ? bookChapters[bookChapterIndex - 1] : null;
  const nextBookChapter = bookChapterIndex >= 0 && bookChapterIndex < bookChapters.length - 1
    ? bookChapters[bookChapterIndex + 1]
    : null;

  useEffect(() => {
    try {
      window.localStorage.setItem("workbench:reader:rail-collapsed", String(railCollapsed));
    } catch {
      // Reading preferences are optional when storage is unavailable.
    }
  }, [railCollapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "workbench:reader:workspace-collapsed",
        String(workspaceCollapsed),
      );
    } catch {
      // Reading preferences are optional when storage is unavailable.
    }
  }, [workspaceCollapsed]);

  const flushBookProgress = useCallback(() => {
    if (bookProgressTimerRef.current) {
      window.clearTimeout(bookProgressTimerRef.current);
      bookProgressTimerRef.current = null;
    }
    const pending = pendingBookProgressRef.current;
    pendingBookProgressRef.current = null;
    if (!pending) return null;
    const saved = saveBookReadingProgress(bookReadingStorage(window), pending);
    if (saved) announceBookReadingProgress(saved, window);
    return saved;
  }, []);

  const queueBookProgress = useCallback((record, immediate = false) => {
    pendingBookProgressRef.current = record;
    if (bookProgressTimerRef.current) window.clearTimeout(bookProgressTimerRef.current);
    if (immediate) {
      flushBookProgress();
      return;
    }
    bookProgressTimerRef.current = window.setTimeout(flushBookProgress, 240);
  }, [flushBookProgress]);

  useEffect(() => () => flushBookProgress(), [active?.id, flushBookProgress]);

  useEffect(() => {
    if (!documentId) restoredBookChapterRef.current = null;
  }, [documentId]);

  const flushBeforeTransition = useCallback(async () => {
    try {
      await workspaceRef.current?.flush?.();
      return true;
    } catch (error) {
      setNotice({
        type: "error",
        message: error?.message || "笔记尚未保存，已暂停离开当前文档。",
      });
      return false;
    }
  }, []);

  const handleClose = useCallback(async () => {
    flushBookProgress();
    if (await flushBeforeTransition()) onClose();
  }, [flushBeforeTransition, flushBookProgress, onClose]);
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;

  const closeImagePreview = useCallback(() => {
    setActiveImage(null);
    window.requestAnimationFrame(() => imagePreviewTriggerRef.current?.focus?.());
  }, []);

  useEffect(() => {
    if (!activeImage) return undefined;
    const frame = window.requestAnimationFrame(() => imagePreviewCloseRef.current?.focus?.());
    return () => window.cancelAnimationFrame(frame);
  }, [activeImage]);

  useEffect(() => {
    let cancelled = false;
    const resetDocument = async () => {
      if (
        propDocumentRef.current &&
        documentId &&
        propDocumentRef.current !== documentId &&
        !(await flushBeforeTransition())
      ) return;
      if (cancelled) return;
      propDocumentRef.current = documentId || null;
      restoredBookChapterRef.current = null;
      if (documentId) {
        setState({ loading: true, data: null, error: null });
        setProgress(0);
        setTrail([{ id: documentId, heading: null, title: null }]);
      } else {
        setState({ loading: false, data: null, error: null });
        setTrail([]);
      }
    };
    resetDocument();
    return () => {
      cancelled = true;
    };
  }, [documentId, flushBeforeTransition]);

  useEffect(() => {
    if (!active?.id) return undefined;
    let cancelled = false;
    setState({ loading: true, data: null, error: null });
    setProgress(0);

    loadDocument(active.id).then((response) => {
      if (cancelled) return;
      setState({
        loading: false,
        data: response.data,
        error: response.error,
      });
      if (response.data) {
        setTrail((current) =>
          current.map((entry, index) =>
            index === current.length - 1
              ? { ...entry, id: response.data.id, title: response.data.title }
              : entry,
          ),
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [active?.id, documentRevision]);

  useEffect(() => {
    if (!currentDocument?.relativePath) return undefined;
    const onVaultEvent = (event) => {
      if (
        event.detail?.type === "vault.index.changed" &&
        event.detail?.changedPaths?.includes(currentDocument.relativePath)
      ) {
        setDocumentRevision((value) => value + 1);
      }
    };
    window.addEventListener("vault:index-event", onVaultEvent);
    return () => window.removeEventListener("vault:index-event", onVaultEvent);
  }, [currentDocument?.relativePath]);

  useEffect(() => {
    if (!documentId) return undefined;
    const previousOverflow = document.body.style.overflow;
    returnFocusRef.current = document.activeElement;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (activeImage) {
          closeImagePreview();
          return;
        }
        handleCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      if (activeImage) {
        event.preventDefault();
        imagePreviewCloseRef.current?.focus?.();
        return;
      }

      const focusable = [...(readerRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [])].filter((element) => !element.hidden && element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus?.();
    };
  }, [activeImage, closeImagePreview, documentId]);

  useEffect(() => {
    if (!currentDocument || !readableBody) {
      setContentHash(null);
      return undefined;
    }
    if (currentDocument.contentHash) {
      setContentHash(currentDocument.contentHash);
      return undefined;
    }
    let cancelled = false;
    setContentHash(null);
    sha256Text(readableBody).then((hash) => {
      if (!cancelled) setContentHash(hash);
    });
    return () => {
      cancelled = true;
    };
  }, [currentDocument, readableBody]);

  useEffect(() => {
    if (!currentDocument || currentDocument.layer !== "raw") {
      setReadingQueue({ queued: false, pending: false });
      return undefined;
    }
    let cancelled = false;
    const refreshQueueState = () => {
      loadMaterialReadingQueue().then((response) => {
        if (cancelled) return;
        const queued = (response.data?.items ?? []).some(
          (item) =>
            item.id === currentDocument.id ||
            item.relativePath === currentDocument.relativePath,
        );
        setReadingQueue((state) => ({ ...state, queued }));
      });
    };
    refreshQueueState();
    const onVaultEvent = (event) => {
      if (event.detail?.affectedScopes?.includes("reading_queue")) refreshQueueState();
    };
    window.addEventListener("vault:index-event", onVaultEvent);
    return () => {
      cancelled = true;
      window.removeEventListener("vault:index-event", onVaultEvent);
    };
  }, [currentDocument]);

  const scrollToHeading = useCallback((heading, behavior = "smooth") => {
    if (!heading) return false;
    const container = scrollRef.current;
    const target = container?.querySelector(`#${CSS.escape(headingId(heading))}`);
    if (!container || !target) return false;
    container.scrollTo({ top: Math.max(0, target.offsetTop - 92), behavior });
    return true;
  }, []);

  useEffect(() => {
    if (state.loading || !state.data || !active?.heading) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (!scrollToHeading(active.heading, "auto")) {
        setNotice({ type: "error", message: `没有找到小节「${active.heading}」` });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active?.heading, scrollToHeading, state.data, state.loading]);

  useLayoutEffect(() => {
    if (state.loading || !currentDocument || bookChapterIndex < 0) return undefined;
    const initialPosition = readingContext?.initialPosition?.chapterId === currentDocument.id
      ? readingContext.initialPosition
      : null;
    const restoreKey = [
      readingContext.bookId,
      currentDocument.id,
      initialPosition?.updatedAt || "top",
    ].join(":");
    if (restoredBookChapterRef.current === restoreKey) return undefined;
    restoredBookChapterRef.current = restoreKey;

    let secondFrame = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const element = scrollRef.current;
        if (!element) return;
        const available = Math.max(0, element.scrollHeight - element.clientHeight);
        const nextTop = initialPosition
          ? Math.min(available, Math.max(0, initialPosition.progress * available))
          : 0;
        const inlineScrollBehavior = element.style.scrollBehavior;
        element.style.scrollBehavior = "auto";
        element.scrollTop = nextTop;
        if (inlineScrollBehavior) element.style.scrollBehavior = inlineScrollBehavior;
        else element.style.removeProperty("scroll-behavior");
        const nextProgress = available > 0 ? nextTop / available : 0;
        setProgress(nextProgress);
        queueBookProgress({
          bookId: readingContext.bookId,
          language: readingContext.language,
          chapterId: currentDocument.id,
          chapterTitle: currentDocument.title,
          scrollTop: nextTop,
          progress: nextProgress,
        }, true);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [
    bookChapterIndex,
    currentDocument,
    queueBookProgress,
    readingContext,
    state.loading,
  ]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const clearReaderHighlight = useCallback(() => {
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = null;
    globalThis.CSS?.highlights?.delete?.("reader-note-jump");
    articleRef.current
      ?.querySelectorAll(".reader-block--note-highlight")
      .forEach((block) => block.classList.remove("reader-block--note-highlight"));
    articleRef.current
      ?.querySelectorAll('[data-reader-jump-focus="true"]')
      .forEach((block) => {
        block.removeAttribute("data-reader-jump-focus");
        block.removeAttribute("tabindex");
      });
  }, []);

  useEffect(() => {
    setSelectionAction(null);
    setQuoteDraft(null);
    setExplanationDraft(null);
    setActiveImage(null);
    clearReaderHighlight();
  }, [active?.id, clearReaderHighlight]);

  useEffect(() => () => {
    if (selectionFrameRef.current) window.cancelAnimationFrame(selectionFrameRef.current);
    clearReaderHighlight();
  }, [clearReaderHighlight]);

  const captureReaderSelection = useCallback(() => {
    if (selectionFrameRef.current) window.cancelAnimationFrame(selectionFrameRef.current);
    selectionFrameRef.current = window.requestAnimationFrame(() => {
      selectionFrameRef.current = null;
      const selection = window.getSelection();
      const result = quoteAnchorFromSelection(selection, articleRef.current);
      if (!result.anchor) {
        setSelectionAction(null);
        if (result.reason === "ambiguous") {
          setNotice({
            type: "error",
            message: "这段文字在当前区块中重复出现，请多选一些前后文。",
          });
        } else if (result.reason === "projection-mismatch") {
          setNotice({
            type: "error",
            message: "当前渲染内容无法建立稳定引用，请缩小选区或避开图片、脚注等非文本元素。",
          });
        }
        return;
      }

      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const placeBelow = rect.top < 126;
      setSelectionAction({
        anchor: result.anchor,
        quoteText: result.anchor.quoteText,
        rangeRect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        },
        left: rect.left + rect.width / 2,
        top: placeBelow ? rect.bottom + 10 : rect.top - 10,
        placement: placeBelow ? "below" : "above",
      });
    });
  }, []);

  useLayoutEffect(() => {
    if (!selectionAction?.rangeRect || !selectionToolbarRef.current) return;
    const visualViewport = window.visualViewport;
    const position = clampSelectionToolbarPosition({
      rangeRect: selectionAction.rangeRect,
      toolbarRect: selectionToolbarRef.current.getBoundingClientRect(),
      viewport: {
        offsetLeft: visualViewport?.offsetLeft ?? 0,
        offsetTop: visualViewport?.offsetTop ?? 0,
        width: visualViewport?.width ?? window.innerWidth,
        height: visualViewport?.height ?? window.innerHeight,
      },
    });
    setSelectionAction((current) =>
      current?.rangeRect === selectionAction.rangeRect
        ? { ...current, ...position }
        : current
    );
  }, [selectionAction?.rangeRect]);

  useEffect(() => {
    const closeSelectionActions = () => setSelectionAction(null);
    const visualViewport = window.visualViewport;
    document.addEventListener("selectionchange", closeSelectionActions);
    window.addEventListener("resize", closeSelectionActions);
    window.addEventListener("orientationchange", closeSelectionActions);
    visualViewport?.addEventListener("resize", closeSelectionActions);
    visualViewport?.addEventListener("scroll", closeSelectionActions);
    return () => {
      document.removeEventListener("selectionchange", closeSelectionActions);
      window.removeEventListener("resize", closeSelectionActions);
      window.removeEventListener("orientationchange", closeSelectionActions);
      visualViewport?.removeEventListener("resize", closeSelectionActions);
      visualViewport?.removeEventListener("scroll", closeSelectionActions);
    };
  }, []);

  const createQuoteNote = useCallback(() => {
    if (!selectionAction) return;
    setQuoteDraft({
      clientKey: globalThis.crypto?.randomUUID?.() || `quote-${Date.now()}`,
      quoteText: selectionAction.quoteText,
      anchor: selectionAction.anchor,
    });
    window.getSelection()?.removeAllRanges();
    setSelectionAction(null);
    setNotice({ type: "success", message: "引用已送到右侧批注台。" });
  }, [selectionAction]);

  const createExplanation = useCallback(() => {
    if (!selectionAction) return;
    if (!canExplain) {
      setNotice({
        type: "error",
        message: readableBody
          ? "正文指纹仍在计算，请稍后再试。"
          : "当前文件没有可解释的文本正文。",
      });
      return;
    }
    setExplanationDraft({
      clientKey: globalThis.crypto?.randomUUID?.() || `explain-${Date.now()}`,
      quoteText: selectionAction.quoteText,
      anchor: selectionAction.anchor,
      contentHash,
    });
    window.getSelection()?.removeAllRanges();
    setSelectionAction(null);
    setNotice({ type: "success", message: "引用已加入右侧理解台，可补充问题后发送给 Codex。" });
  }, [canExplain, contentHash, readableBody, selectionAction]);

  const jumpToQuoteAnchor = useCallback((anchor) => {
    clearReaderHighlight();
    const located = rangeForQuoteAnchor(articleRef.current, anchor);
    if (!located) {
      setNotice({ type: "error", message: "原文可能已变化，暂时无法定位这条引用。" });
      articleRef.current?.focus?.({ preventScroll: true });
      return;
    }

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    located.block.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    if (globalThis.CSS?.highlights && globalThis.Highlight) {
      globalThis.CSS.highlights.set("reader-note-jump", new globalThis.Highlight(located.range));
    } else {
      (located.blocks || [located.block]).forEach((block) =>
        block.classList.add("reader-block--note-highlight"));
    }
    if (!located.block.hasAttribute("tabindex")) {
      located.block.setAttribute("tabindex", "-1");
      located.block.setAttribute("data-reader-jump-focus", "true");
    }
    located.block.focus({ preventScroll: true });
    highlightTimerRef.current = window.setTimeout(clearReaderHighlight, 2200);
  }, [clearReaderHighlight]);

  const handleScroll = useCallback((event) => {
    const element = event.currentTarget;
    const available = element.scrollHeight - element.clientHeight;
    const nextProgress = available > 0 ? Math.min(1, element.scrollTop / available) : 0;
    setProgress(nextProgress);
    if (bookChapterIndex >= 0 && currentDocument && readingContext?.bookId) {
      queueBookProgress({
        bookId: readingContext.bookId,
        language: readingContext.language,
        chapterId: currentDocument.id,
        chapterTitle: currentDocument.title,
        scrollTop: element.scrollTop,
        progress: nextProgress,
      });
    }
    setSelectionAction((current) => current ? null : current);
  }, [bookChapterIndex, currentDocument, queueBookProgress, readingContext]);

  const navigateBookChapter = useCallback(async (chapter) => {
    if (!chapter || !onNavigateDocument || readingContext?.kind !== "book") return;
    flushBookProgress();
    if (!(await flushBeforeTransition())) return;
    setNotice(null);
    onNavigateDocument({
      id: chapter.id,
      readerContext: {
        ...readingContext,
        chapterId: chapter.id,
        initialPosition: null,
      },
    });
  }, [flushBeforeTransition, flushBookProgress, onNavigateDocument, readingContext]);

  const pushDocument = useCallback(async (id, heading = null, title = null) => {
    if (!(await flushBeforeTransition())) return false;
    setNotice(null);
    setTrail((current) => [...current, { id, heading, title }]);
    return true;
  }, [flushBeforeTransition]);

  const popDocument = useCallback(async () => {
    if (!(await flushBeforeTransition())) return;
    setNotice(null);
    setTrail((current) => current.slice(0, -1));
  }, [flushBeforeTransition]);

  const resolveAndOpen = useCallback(
    async ({ id, target, heading, label }) => {
      if (!target) {
        if (!scrollToHeading(heading)) {
          setNotice({ type: "error", message: `没有找到小节「${heading}」` });
        }
        return;
      }

      if (id) {
        await pushDocument(id, heading, label);
        return;
      }

      setNotice({ type: "loading", message: `正在定位「${label || target}」…` });
      for (const candidate of vaultPathCandidates(state.data?.relativePath, target)) {
        // The document endpoint accepts a Vault-relative path as well as an opaque id.
        // Trying candidates here repairs legacy escaped-pipe links without touching Markdown.
        // eslint-disable-next-line no-await-in-loop
        const response = await loadDocument(candidate);
        if (response.source === "live" && response.data) {
          await pushDocument(response.data.id, heading, response.data.title);
          return;
        }
      }

      const basename = basenameWithoutExtension(target);
      const search = await searchVault(basename);
      if (search.source === "live") {
        const exactMatches = (search.data?.items || []).filter((item) => {
          const pathName = basenameWithoutExtension(item.path);
          return pathName === basename || item.title === basename;
        });
        if (exactMatches.length === 1) {
          await pushDocument(exactMatches[0].id, heading, exactMatches[0].title);
          return;
        }
      }

      setNotice({
        type: "error",
        message: `未找到目标文档「${label || target}」，原始 Markdown 未被修改。`,
      });
    },
    [pushDocument, scrollToHeading, state.data?.relativePath],
  );

  const markdownComponents = useMemo(() => {
    const makeHeading = (Tag) => function MarkdownHeading({ children, node, ...props }) {
      const id = headingId(childrenText(children));
      return <Tag {...props} id={id}>{children}</Tag>;
    };

    return {
      h1: makeHeading("h1"),
      h2: makeHeading("h2"),
      h3: makeHeading("h3"),
      h4: makeHeading("h4"),
      h5: makeHeading("h5"),
      h6: makeHeading("h6"),
      a({ node, href, children, ...props }) {
        const isVaultLink = dataProperty(node, props, "data-vault-link") === "true";
        if (isVaultLink) {
          const target = dataProperty(node, props, "data-vault-target");
          const heading = dataProperty(node, props, "data-vault-heading") || null;
          const id = dataProperty(node, props, "data-vault-id") || null;
          return (
            <a
              {...props}
              href="#"
              onClick={(event) => {
                event.preventDefault();
                resolveAndOpen({
                  id,
                  target,
                  heading,
                  label: childrenText(children),
                });
              }}
            >
              {children}
            </a>
          );
        }

        if (href?.startsWith("#")) {
          return (
            <a
              {...props}
              href={href}
              onClick={(event) => {
                event.preventDefault();
                scrollToHeading(decodeURIComponent(href.slice(1)));
              }}
            >
              {children}
            </a>
          );
        }

        if (href && !/^[a-z][a-z\d+.-]*:/i.test(href)) {
          const divider = href.indexOf("#");
          const target = divider >= 0 ? href.slice(0, divider) : href;
          const heading = divider >= 0 ? decodeURIComponent(href.slice(divider + 1)) : null;
          return (
            <a
              {...props}
              href={href}
              onClick={(event) => {
                event.preventDefault();
                resolveAndOpen({ target, heading, label: childrenText(children) });
              }}
            >
              {children}
            </a>
          );
        }

        return <a {...props} href={href} rel="noreferrer" target="_blank">{children}</a>;
      },
      img({ node, src, alt, ...props }) {
        const requestProps = readerImageRequestProps(src, currentDocument?.id);
        const label = alt?.trim() || "正文图片";
        return (
          <button
            aria-label={`放大查看：${label}`}
            className="reader-image-zoom"
            onClick={(event) => {
              imagePreviewTriggerRef.current = event.currentTarget;
              event.currentTarget.blur();
              setActiveImage({ ...requestProps, alt: alt || "" });
            }}
            type="button"
          >
            <img {...props} {...requestProps} alt={alt || ""} />
            <span className="reader-image-zoom__hint" aria-hidden="true">
              <IconZoomIn /> 点击放大
            </span>
          </button>
        );
      },
      pre({ node, children, className, ...props }) {
        const codeChild = Array.isArray(children)
          ? children.find((child) => child?.props)
          : children;
        const codeClassName = codeChild?.props?.className;
        const blockClassName = readerPreformattedBlockClassName(
          codeClassName,
        );
        const normalizedCodeChild = blockClassName === "reader-prose-block"
          ? isValidElement(codeChild)
            ? cloneElement(
                codeChild,
                undefined,
                readerPreformattedBlockText(
                  codeClassName,
                  childrenText(codeChild.props.children),
                ),
              )
            : readerPreformattedBlockText(codeClassName, codeChild)
          : codeChild;
        const renderedChildren = Array.isArray(children)
          ? children.map((child) => child === codeChild ? normalizedCodeChild : child)
          : normalizedCodeChild;
        return (
          <pre
            {...props}
            className={[className, blockClassName].filter(Boolean).join(" ")}
          >
            {renderedChildren}
          </pre>
        );
      },
    };
  }, [currentDocument?.id, resolveAndOpen, scrollToHeading]);

  const handleOpen = useCallback(async (target) => {
    if (!active?.id) return;
    try {
      await openLocalTarget(active.id, target);
    } catch (error) {
      setNotice({ type: "error", message: "无法调用本地应用，请确认工作台服务仍在运行。" });
    }
  }, [active?.id]);

  const toggleReadingQueue = useCallback(async () => {
    if (!currentDocument || currentDocument.layer !== "raw" || readingQueue.pending) return;
    setReadingQueue((state) => ({ ...state, pending: true }));
    try {
      if (readingQueue.queued) {
        await removeMaterialFromReadingQueue(currentDocument.id);
      } else {
        await addMaterialToReadingQueue(currentDocument.id, contentHash || undefined);
      }
      setReadingQueue({ queued: !readingQueue.queued, pending: false });
      setNotice({
        type: "success",
        message: readingQueue.queued ? "已移出待看。" : "已加入待看。",
      });
    } catch (error) {
      setReadingQueue((state) => ({ ...state, pending: false }));
      setNotice({ type: "error", message: error?.message || "待看状态更新失败。" });
    }
  }, [contentHash, currentDocument, readingQueue.pending, readingQueue.queued]);

  if (!documentId || !active) return null;

  const headings = (currentDocument?.headings || []).filter((heading) => heading.level <= 3);
  const relatedCount =
    (currentDocument?.outgoingLinks?.length || 0) + (currentDocument?.backlinks?.length || 0);

  return (
    <motion.section
      ref={readerRef}
      className={`reader${bookChapterIndex >= 0 ? " reader--book" : ""}${activeImage ? " reader--image-open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={currentDocument ? `阅读：${currentDocument.title}` : "文档阅读器"}
      initial={{ opacity: 0, scale: 0.995 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.995 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="reader__progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>

      <header className="reader__header" aria-hidden={activeImage ? "true" : undefined}>
        <div className="reader__header-start">
          {trail.length > 1 ? (
            <button
              type="button"
              className="reader__back"
              onClick={popDocument}
            >
              <IconArrowLeft aria-hidden="true" />
              <span>返回上篇</span>
            </button>
          ) : (
            <span className="reader__mode"><IconList aria-hidden="true" /> 沉浸阅读</span>
          )}
          <div className="reader__crumbs" aria-label="文档跳转路径">
            {trail.slice(-3).map((entry, index) => (
              <span key={`${entry.id}-${index}`}>{entry.title || (index === trail.length - 1 ? "正在读取" : "文档")}</span>
            ))}
          </div>
        </div>

        <div className="reader__actions">
          {currentDocument ? (
            <>
              {currentDocument.layer === "raw" ? (
                <button
                  aria-pressed={readingQueue.queued}
                  className={`reader__queue${readingQueue.queued ? " reader__queue--on" : ""}`}
                  disabled={readingQueue.pending}
                  onClick={toggleReadingQueue}
                  title={readingQueue.queued ? "移出待看" : "加入待看"}
                  type="button"
                >
                  <IconBookmark aria-hidden="true" />
                  <span>{readingQueue.pending ? "处理中" : readingQueue.queued ? "待看中" : "待看"}</span>
                </button>
              ) : null}
              <button
                className="icon-button"
                onClick={() => handleOpen("obsidian")}
                type="button"
                aria-label="在 Obsidian 打开"
                title="在 Obsidian 打开"
              >
                <IconExternalLink aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                onClick={() => handleOpen("finder")}
                type="button"
                aria-label="在 Finder 显示"
                title="在 Finder 显示"
              >
                <IconFolder aria-hidden="true" />
              </button>
            </>
          ) : null}
          <button
            ref={closeRef}
            aria-label="关闭阅读器"
            className="reader__close"
            onClick={handleClose}
            type="button"
          >
            <span>关闭</span>
            <IconX aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        className="reader__scroll"
        ref={scrollRef}
        onScroll={handleScroll}
        aria-hidden={activeImage ? "true" : undefined}
      >
        {state.loading ? (
          <div className="reader__loading" aria-label="正在读取文档">
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : state.error ? (
          <div className="reader__fatal">
            <IconFileBroken aria-hidden="true" />
            <span className="eyebrow">DOCUMENT UNAVAILABLE</span>
            <h1>文档没有打开</h1>
            <p>{state.error.message || "无法连接到本地文档服务"}</p>
            {trail.length > 1 ? (
              <button type="button" onClick={popDocument}>
                <IconArrowLeft aria-hidden="true" /> 返回上一篇
              </button>
            ) : null}
          </div>
        ) : currentDocument ? (
          <div
            className={`reader__layout${railCollapsed ? " reader__layout--rail-collapsed" : ""}${workspaceCollapsed ? " reader__layout--workspace-collapsed" : ""}`}
          >
            <aside className="reader__rail">
              <button
                aria-label={railCollapsed ? "展开左侧目录" : "收起左侧目录"}
                aria-pressed={railCollapsed}
                className="reader__rail-toggle"
                data-label={railCollapsed ? "展开目录" : "收起目录"}
                onClick={() => setRailCollapsed((collapsed) => !collapsed)}
                title={railCollapsed ? "展开左侧目录" : "收起左侧目录"}
                type="button"
              >
                <ReaderPanelToggleIcon side="left" collapsed={railCollapsed} />
              </button>
              <div className="reader__rail-content">
                <div className="reader__rail-block">
                  <span className="reader__rail-label">DOCUMENT</span>
                  <div className="reader__badges">
                    <span>{layerLabel(currentDocument.layer)}</span>
                    {currentDocument.contentType || currentDocument.type ? (
                      <span>{currentDocument.contentType || currentDocument.type}</span>
                    ) : null}
                    <span>{statusLabel(currentDocument.status)}</span>
                  </div>
                  <p className="reader__path">{currentDocument.relativePath}</p>
                  <time>{formatFullDate(currentDocument.updatedAt)}</time>
                </div>

                {headings.length > 1 ? (
                  <nav className="reader__toc" aria-label="本文目录">
                    <span className="reader__rail-label">ON THIS PAGE</span>
                    {headings.slice(0, 14).map((heading, index) => (
                      <button
                        type="button"
                        key={`${heading.title}-${index}`}
                        className={`reader__toc-item reader__toc-item--l${heading.level}`}
                        onClick={() => scrollToHeading(heading.title)}
                      >
                        {heading.title}
                      </button>
                    ))}
                  </nav>
                ) : null}
              </div>
            </aside>

            <main className="reader__document">
              <div className="reader__kicker">
                <span>{layerLabel(currentDocument.layer)}</span>
                <span aria-hidden="true">/</span>
                <span>{currentDocument.section || "ROOT"}</span>
              </div>
              <h1 className="reader__title">{currentDocument.title}</h1>
              <div className="reader__mobile-meta">
                <span>{statusLabel(currentDocument.status)}</span>
                <time>{formatFullDate(currentDocument.updatedAt)}</time>
              </div>

              <article
                ref={articleRef}
                className="markdown reader-markdown"
                tabIndex={-1}
                onPointerUp={captureReaderSelection}
                onKeyUp={captureReaderSelection}
              >
                <ReactMarkdown
                  remarkPlugins={[
                    remarkGfm,
                    remarkObsidianCjkStrong,
                    [remarkObsidianWikilinks, { wikiLinks: currentDocument.wikiLinks || [] }],
                    remarkReaderBlocks,
                  ]}
                  rehypePlugins={readerRehypePlugins}
                  components={markdownComponents}
                >
                  {documentBody}
                </ReactMarkdown>
              </article>

              {bookChapterIndex >= 0 ? (
                <nav className="reader-book-nav" aria-label="书籍章节导航">
                  <div className="reader-book-nav__meta">
                    <span>{readingContext.bookTitle}</span>
                    <span>{bookChapterIndex + 1} / {bookChapters.length}</span>
                  </div>
                  <div className="reader-book-nav__actions">
                    {previousBookChapter ? (
                      <button
                        className="reader-book-nav__chapter reader-book-nav__chapter--previous"
                        onClick={() => navigateBookChapter(previousBookChapter)}
                        type="button"
                      >
                        <IconArrowLeft aria-hidden="true" />
                        <span><small>上一章</small><strong>{previousBookChapter.title}</strong></span>
                      </button>
                    ) : <span className="reader-book-nav__edge">这是本版本的第一章</span>}
                    {nextBookChapter ? (
                      <button
                        className="reader-book-nav__chapter reader-book-nav__chapter--next"
                        onClick={() => navigateBookChapter(nextBookChapter)}
                        type="button"
                      >
                        <span><small>下一章</small><strong>{nextBookChapter.title}</strong></span>
                        <IconArrowRight aria-hidden="true" />
                      </button>
                    ) : <span className="reader-book-nav__edge reader-book-nav__edge--end">已读到本版本最后一章</span>}
                  </div>
                </nav>
              ) : null}

              {relatedCount > 0 ? (
                <section className="reader__relations" aria-label="文档关系">
                  <div className="reader__relations-head">
                    <span className="eyebrow">DOCUMENT RELATIONS</span>
                    <strong>{relatedCount} 条连接</strong>
                  </div>
                  <div className="reader__relation-groups">
                    {currentDocument.outgoingLinks?.length > 0 ? (
                      <div>
                        <h2>本文引用</h2>
                        {currentDocument.outgoingLinks.map((link, index) => (
                          <button
                            key={`out-${link.id}-${index}`}
                            type="button"
                            onClick={() => pushDocument(link.id, null, link.title)}
                          >
                            <IconLink aria-hidden="true" />
                            <span>{link.title}</span>
                            <IconArrowUpRight aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {currentDocument.backlinks?.length > 0 ? (
                      <div>
                        <h2>被这些文档引用</h2>
                        {currentDocument.backlinks.map((link, index) => (
                          <button
                            key={`back-${link.id}-${index}`}
                            type="button"
                            onClick={() => pushDocument(link.id, null, link.title)}
                          >
                            <IconLink aria-hidden="true" />
                            <span>{link.title}</span>
                            <IconArrowUpRight aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </main>

            <ReaderWorkspace
              ref={workspaceRef}
              key={currentDocument.id}
              document={currentDocument}
              contentHash={contentHash}
              canExplain={canExplain}
              quoteDraft={quoteDraft}
              explanationDraft={explanationDraft}
              onQuoteConsumed={(key) => {
                setQuoteDraft((current) => current?.clientKey === key ? null : current);
              }}
              onExplanationConsumed={(key) => {
                setExplanationDraft((current) => current?.clientKey === key ? null : current);
              }}
              onJumpToAnchor={jumpToQuoteAnchor}
              collapsed={workspaceCollapsed}
              onToggleCollapsed={() => setWorkspaceCollapsed((collapsed) => !collapsed)}
            />
          </div>
        ) : null}
      </div>

      {activeImage ? (
        <div
          aria-label={activeImage.alt ? `图片预览：${activeImage.alt}` : "图片预览"}
          aria-modal="true"
          className="reader-image-lightbox"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeImagePreview();
          }}
          role="dialog"
        >
          <button
            aria-label="关闭图片预览"
            className="reader-image-lightbox__close"
            onClick={closeImagePreview}
            ref={imagePreviewCloseRef}
            type="button"
          >
            <span>关闭</span>
            <IconX aria-hidden="true" />
          </button>
          <img
            alt={activeImage.alt}
            decoding="async"
            loading="eager"
            referrerPolicy={activeImage.referrerPolicy}
            src={activeImage.src}
          />
          {activeImage.alt ? <p>{activeImage.alt}</p> : null}
        </div>
      ) : null}

      {selectionAction ? (
        <div
          ref={selectionToolbarRef}
          role="toolbar"
          aria-label="选中内容操作"
          className={`reader-selection-actions reader-selection-actions--${selectionAction.placement}`}
          style={{ left: selectionAction.left, top: selectionAction.top }}
          onPointerDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="reader-selection-action"
            onClick={createQuoteNote}
          >
            <IconQuote aria-hidden="true" />
            引用到笔记
          </button>
          <button
            type="button"
            className="reader-selection-action reader-selection-action--explain"
            onClick={createExplanation}
            disabled={!canExplain}
            title={canExplain
              ? "引用到理解侧栏，补充问题后再发送"
              : readableBody
                ? "正在计算正文指纹"
                : "当前文件没有可解释的文本正文"}
          >
            <IconSparkles aria-hidden="true" />
            加入理解
          </button>
        </div>
      ) : null}

      {notice ? (
        <div
          className={`reader__notice reader__notice--${notice.type}`}
          role="status"
          aria-live="polite"
        >
          {notice.message}
        </div>
      ) : null}
    </motion.section>
  );
}
