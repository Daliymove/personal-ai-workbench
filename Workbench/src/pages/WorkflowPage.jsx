import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  IconCheck,
  IconChevronRight,
  IconClipboard,
  IconFileText,
  IconLoader2,
  IconPlayerStop,
  IconSearch,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { PageHeader } from "../components/PageHeader";
import {
  cancelWorkflowJob,
  confirmWorkflowJob,
  createJobEventSource,
  searchVault,
  startWorkflow,
} from "../lib/api";
import { layerLabel } from "../lib/format";

const jobLabels = {
  queued: "等待启动",
  running: "Codex 正在读取并生成",
  awaiting_review: "等待你审阅",
  completed: "已确认并保存",
  failed: "运行失败",
  cancelled: "已取消",
};

export function WorkflowPage({ onOpenDocument }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searchSource, setSearchSource] = useState("loading");
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState("");
  const [brief, setBrief] = useState("");
  const [includeCards, setIncludeCards] = useState(true);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setSearchSource("loading");
    setResults([]);
    const timer = window.setTimeout(async () => {
      const response = await searchVault(query, { layer: query ? "" : "wiki" });
      if (!cancelled) {
        setResults((response.data.items ?? []).slice(0, 8));
        setSearchSource(response.source);
      }
    }, query ? 150 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(
    () => () => {
      eventSourceRef.current?.close();
    },
    [],
  );

  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const running = job?.status === "queued" || job?.status === "running";

  const toggleSource = (item) => {
    const path = item.path ?? item.relativePath ?? item.id;
    setSelectedPaths((current) =>
      current.includes(path)
        ? current.filter((entry) => entry !== path)
        : [...current, path].slice(0, 6),
    );
  };

  const subscribe = (jobId) => {
    eventSourceRef.current?.close();
    const source = createJobEventSource(jobId);
    eventSourceRef.current = source;
    source.onmessage = (event) => {
      try {
        const nextJob = JSON.parse(event.data);
        setJob(nextJob);
        if (["awaiting_review", "completed", "failed", "cancelled"].includes(nextJob.status)) {
          source.close();
        }
      } catch {
        // Ignore malformed progress frames; the job can still be polled on refresh.
      }
    };
    source.onerror = () => source.close();
  };

  const runWorkflow = async () => {
    if (selectedPaths.length === 0) {
      setError("请先选择至少一份 Wiki、Raw 或内容文件。");
      return;
    }
    if (!title.trim()) {
      setError("请填写本次输出的主题。");
      return;
    }

    setError("");
    setCopied(false);
    try {
      const extra = [
        `目标读者：${audience || "未指定"}`,
        `生成卡片结构：${includeCards ? "是" : "否"}`,
        brief ? `补充要求：${brief}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const created = await startWorkflow({
        selectedPaths,
        title: title.trim(),
        brief: extra,
      });
      setJob(created);
      subscribe(created.id);
    } catch (workflowError) {
      setError(workflowError.message || "工作流启动失败。");
    }
  };

  const cancel = async () => {
    if (!job?.id) return;
    const cancelledJob = await cancelWorkflowJob(job.id);
    setJob(cancelledJob);
    eventSourceRef.current?.close();
  };

  const confirm = async () => {
    if (!job?.id) return;
    try {
      const confirmed = await confirmWorkflowJob(job.id);
      setJob(confirmed);
    } catch (confirmError) {
      setError(confirmError.message || "保存草稿失败。");
    }
  };

  const copyFallback = async () => {
    const text = job?.fallback?.copyPrompt ?? job?.result?.markdown;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
  };

  return (
    <div className="page page--workflow">
      <PageHeader
        compact
        eyebrow="CONTROLLED CODEX WORKFLOW"
        title="输出工作流"
      />

      <div className="workflow-layout">
        <section className="workflow-builder">
          <div className="workflow-step">
            <span className="workflow-step__number">01</span>
            <div className="workflow-step__body">
              <h2>选择来源</h2>
              <p>最多选择 6 份明确材料，不自动展开到整个 Vault。</p>

              <label className="field field--search">
                <IconSearch aria-hidden="true" />
                <input
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索 Wiki、Raw 或内容文件…"
                  type="search"
                  value={query}
                />
              </label>

              <div className="source-picker">
                {searchSource === "loading" ? (
                  <div className="empty-state source-picker__empty">
                    <IconSearch aria-hidden="true" />
                    <strong>正在读取可选来源</strong>
                  </div>
                ) : null}
                {searchSource === "fallback" ? (
                  <div className="empty-state source-picker__empty">
                    <IconFileText aria-hidden="true" />
                    <strong>本地来源搜索不可用</strong>
                    <span>当前不展示演示文件。</span>
                  </div>
                ) : null}
                {results.map((item) => {
                  const itemPath = item.path ?? item.relativePath ?? item.id;
                  const selected = selectedSet.has(itemPath);
                  return (
                    <button
                      className={`source-picker__item${selected ? " source-picker__item--selected" : ""}`}
                      key={item.id}
                      onClick={() => toggleSource(item)}
                      type="button"
                    >
                      <IconFileText aria-hidden="true" />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{layerLabel(item.layer)} · {item.section ?? "未分类"}</small>
                      </span>
                      <span className="source-picker__check">
                        {selected ? <IconCheck aria-hidden="true" /> : <IconChevronRight aria-hidden="true" />}
                      </span>
                    </button>
                  );
                })}
              </div>

              {selectedPaths.length ? (
                <div className="selected-sources">
                  <span>已选择 {selectedPaths.length} 份</span>
                  {selectedPaths.map((path) => (
                    <button key={path} onClick={() => setSelectedPaths((current) => current.filter((item) => item !== path))} type="button">
                      <span>{path.split("/").pop()}</span>
                      <IconX aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="workflow-step">
            <span className="workflow-step__number">02</span>
            <div className="workflow-step__body">
              <h2>定义输出</h2>
              <p>锁定主题与读者，避免 Codex 重新发明任务。</p>
              <div className="form-grid">
                <label className="form-field">
                  <span>主题</span>
                  <input
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="输入这次要生成的内容主题"
                    value={title}
                  />
                </label>
                <label className="form-field">
                  <span>目标读者</span>
                  <input
                    onChange={(event) => setAudience(event.target.value)}
                    placeholder="可选：输入明确的目标读者"
                    value={audience}
                  />
                </label>
                <label className="form-field form-field--wide">
                  <span>补充要求</span>
                  <textarea
                    onChange={(event) => setBrief(event.target.value)}
                    placeholder="例如：保留原文中的反例；语气克制，不用夸张标题。"
                    rows={4}
                    value={brief}
                  />
                </label>
                <label className="toggle-row">
                  <input
                    checked={includeCards}
                    onChange={(event) => setIncludeCards(event.target.checked)}
                    type="checkbox"
                  />
                  <span aria-hidden="true" className="toggle-row__control" />
                  <span>
                    <strong>生成 6–9 页卡片结构</strong>
                    <small>同时输出每页目的、文案与可视化建议。</small>
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div className="workflow-runbar">
            <div>
              <IconSparkles aria-hidden="true" />
              <span>
                <strong>Codex 只读运行</strong>
                <small>未确认前不会写入 Vault。</small>
              </span>
            </div>
            <button
              className="button button--primary button--large"
              disabled={running}
              onClick={runWorkflow}
              type="button"
            >
              {running ? <IconLoader2 aria-hidden="true" className="spin" /> : <IconSparkles aria-hidden="true" />}
              {running ? "正在生成" : "生成草稿"}
            </button>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
        </section>

        <aside className="workflow-preview">
          <header>
            <div>
              <span className="eyebrow">DRAFT PREVIEW</span>
              <h2>草稿预览</h2>
            </div>
            {job ? <span className={`job-status job-status--${job.status}`}>{jobLabels[job.status]}</span> : null}
          </header>

          {!job ? (
            <div className="empty-state workflow-preview__empty">
              <IconSparkles aria-hidden="true" />
              <strong>准备好后从左侧启动</strong>
              <span>运行事件、标题、正文和卡片分镜会在这里出现。</span>
            </div>
          ) : null}

          {running ? (
            <div className="job-running">
              <IconLoader2 aria-hidden="true" className="spin" />
              <strong>{jobLabels[job.status]}</strong>
              <span>{job.progress || "正在建立只读上下文…"}</span>
              <ol>
                <li className="is-done">已校验 Vault 路径</li>
                <li className={job.status === "running" ? "is-active" : ""}>Codex 读取与生成</li>
                <li>等待人工审阅</li>
              </ol>
              <button className="button" onClick={cancel} type="button">
                <IconPlayerStop aria-hidden="true" />
                取消
              </button>
            </div>
          ) : null}

          {job?.result?.markdown ? (
            <>
              <article className="markdown-reader workflow-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{job.result.markdown}</ReactMarkdown>
              </article>
              <div className="workflow-preview__actions">
                <button className="button" onClick={copyFallback} type="button">
                  {copied ? <IconCheck aria-hidden="true" /> : <IconClipboard aria-hidden="true" />}
                  {copied ? "已复制" : "复制草稿"}
                </button>
                {job.status === "awaiting_review" ? (
                  <button className="button button--primary" onClick={confirm} type="button">
                    <IconCheck aria-hidden="true" />
                    确认并保存
                  </button>
                ) : null}
              </div>
              {job.result.savedRelativePath ? (
                <button
                  className="saved-path"
                  onClick={() => onOpenDocument(job.result.savedRelativePath)}
                  type="button"
                >
                  已保存：{job.result.savedRelativePath}
                </button>
              ) : null}
            </>
          ) : null}

          {job?.status === "failed" ? (
            <div className="job-failed">
              <strong>{job.error?.message ?? "Codex 任务失败"}</strong>
              <span>你仍可复制受控任务说明，在 Codex Desktop 中继续。</span>
              {job.fallback?.copyPrompt ? (
                <button className="button button--primary" onClick={copyFallback} type="button">
                  <IconClipboard aria-hidden="true" />
                  {copied ? "已复制" : "复制到 Codex Desktop"}
                </button>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
