import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  IconArrowLeft,
  IconArrowRight,
  IconChartRadar,
  IconChevronLeft,
  IconChevronRight,
  IconDatabase,
  IconGitBranch,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react";

import { SocialInsightRadar } from "./SocialInsightRadar";

function sampleValue(value) {
  return value == null ? "未提供" : value;
}

function scenesFor(report) {
  const strongestIndicators = [...(report.validIndicators ?? [])]
    .sort((left, right) => right.score - left.score)
    .slice(0, 2);
  return [
    {
      key: "verdict",
      eyebrow: "SCENE 01 · RESEARCH VERDICT",
      title: report.question,
      body: (
        <div className="social-presentation__verdict">
          <div className="social-presentation__quote">{report.conclusion}</div>
          <div className="social-presentation__platforms">
            {(report.platforms ?? []).map((platform, index) => (
              <span key={platform}>{index === 0 ? `${platform} · 主平台` : platform}</span>
            ))}
          </div>
        </div>
      ),
    },
    {
      key: "sample",
      eyebrow: "SCENE 02 · EVIDENCE COVERAGE",
      title: "这不是全网趋势，而是一次有边界的横截面",
      body: (
        <div className="social-presentation__sample">
          <div className="social-presentation__metrics">
            <div><strong>{sampleValue(report.sampleTotals?.searchResults)}</strong><span>搜索结果样本</span></div>
            <div><strong>{sampleValue(report.sampleTotals?.visibleNodes)}</strong><span>可见评论 / 回复</span></div>
            <div><strong>{sampleValue(report.sampleTotals?.usableUnits)}</strong><span>纳入分析单元</span></div>
          </div>
          <div className="social-presentation__sample-rows">
            {(report.sampleRows ?? []).map((row) => (
              <div key={row.platform}>
                <strong>{row.platform}</strong>
                <span>{row.role}</span>
                <span>{sampleValue(row.usableUnits)} 个可用单元</span>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      key: "radar",
      eyebrow: "SCENE 03 · SIGNAL SHAPE",
      title: "热度很高，不等于需求已经成熟",
      body: (
        <div className="social-presentation__radar">
          <SocialInsightRadar indicators={report.validIndicators} />
          <div className="social-presentation__radar-notes">
            {strongestIndicators.map((indicator) => (
              <article key={indicator.key}>
                <span>{indicator.label}</span>
                <strong>{indicator.score}/5</strong>
                <p>{indicator.rationale}</p>
              </article>
            ))}
            <small>分数仅代表本次样本内相对评估</small>
          </div>
        </div>
      ),
    },
    {
      key: "needs",
      eyebrow: "SCENE 04 · USER TASKS",
      title: "真正留下来的，是反复发生的具体任务",
      body: (
        <div className="social-presentation__needs">
          {(report.needs ?? []).slice(0, 3).map((need, index) => (
            <article key={need.cluster}>
              <span>{String(index + 1).padStart(2, "0")} · {need.confidence}置信度</span>
              <h3>{need.cluster}</h3>
              <p>{need.task}</p>
              <small>{need.failure}</small>
            </article>
          ))}
        </div>
      ),
    },
    {
      key: "conversation",
      eyebrow: "SCENE 05 · COMMENT → REPLY",
      title: "二级回复，才让第一反应变成可用判断",
      body: (
        <div className="social-presentation__conversation">
          {report.commentReplyChains?.[0] ? (
            <div className="social-presentation__chain">
              <div><span>一级问题</span><strong>{report.commentReplyChains[0].question}</strong></div>
              <IconArrowRight aria-hidden="true" />
              <div><span>回复修正</span><strong>{report.commentReplyChains[0].reply}</strong></div>
              <IconArrowRight aria-hidden="true" />
              <div><span>研究价值</span><strong>{report.commentReplyChains[0].value}</strong></div>
            </div>
          ) : null}
          <div className="social-presentation__camps">
            {(report.camps ?? []).slice(0, 2).map((camp) => (
              <article key={camp.name}>
                <span>{camp.name}</span>
                <p>{camp.judgment}</p>
              </article>
            ))}
          </div>
        </div>
      ),
    },
    {
      key: "boundary",
      eyebrow: "SCENE 06 · FINAL BOUNDARY",
      title: report.conclusion,
      body: (
        <div className="social-presentation__boundary">
          <div className="social-presentation__boundary-mark"><IconShieldCheck aria-hidden="true" /></div>
          <div>
            <span>这份判断成立到哪里</span>
            <ul>
              {(report.boundaries ?? []).slice(0, 4).map((boundary) => (
                <li key={boundary}>{boundary}</li>
              ))}
            </ul>
          </div>
        </div>
      ),
    },
  ];
}

export function SocialInsightPresentation({ onClose, report }) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const closeButtonRef = useRef(null);
  const scenes = useMemo(() => scenesFor(report), [report]);
  const scene = scenes[sceneIndex];

  const close = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    onClose();
  };

  useEffect(() => {
    const shell = document.querySelector(".app-shell");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.classList.add("social-presentation-open");
    shell?.setAttribute("inert", "");
    shell?.setAttribute("aria-hidden", "true");
    closeButtonRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (["ArrowRight", " "].includes(event.key)) {
        event.preventDefault();
        setSceneIndex((current) => Math.min(scenes.length - 1, current + 1));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSceneIndex((current) => Math.max(0, current - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      document.documentElement.classList.remove("social-presentation-open");
      shell?.removeAttribute("inert");
      shell?.removeAttribute("aria-hidden");
    };
  }, [scenes.length]);

  return createPortal(
    <div
      aria-label="社媒洞察演示模式"
      aria-modal="true"
      className="social-presentation"
      role="dialog"
    >
      <header className="social-presentation__header">
        <div className="social-presentation__brand">
          <span aria-hidden="true" />
          <strong>SOCIAL INSIGHTS</strong>
          <small>{report.topic}</small>
        </div>
        <div className="social-presentation__scene-label">
          <span>{sceneIndex + 1}</span>
          <i />
          <span>{scenes.length}</span>
        </div>
        <button
          aria-label="退出演示模式"
          onClick={close}
          ref={closeButtonRef}
          type="button"
        >
          <IconX aria-hidden="true" />
          <span>退出演示</span>
        </button>
      </header>

      <main className="social-presentation__stage" key={scene.key}>
        <div className="social-presentation__scene-icon" aria-hidden="true">
          {scene.key === "radar" ? <IconChartRadar /> : scene.key === "sample" ? <IconDatabase /> : scene.key === "conversation" ? <IconGitBranch /> : <IconShieldCheck />}
        </div>
        <span className="eyebrow">{scene.eyebrow}</span>
        <h2>{scene.title}</h2>
        <div className="social-presentation__body">{scene.body}</div>
      </main>

      <footer className="social-presentation__footer">
        <button
          disabled={sceneIndex === 0}
          onClick={() => setSceneIndex((current) => Math.max(0, current - 1))}
          type="button"
        >
          <IconChevronLeft aria-hidden="true" /> 上一幕
        </button>
        <div className="social-presentation__progress" aria-label={`第 ${sceneIndex + 1} 幕，共 ${scenes.length} 幕`}>
          {scenes.map((item, index) => (
            <button
              aria-label={`跳到第 ${index + 1} 幕`}
              aria-pressed={sceneIndex === index}
              className={sceneIndex === index ? "is-active" : ""}
              key={item.key}
              onClick={() => setSceneIndex(index)}
              type="button"
            />
          ))}
        </div>
        <button
          disabled={sceneIndex === scenes.length - 1}
          onClick={() => setSceneIndex((current) => Math.min(scenes.length - 1, current + 1))}
          type="button"
        >
          下一幕 <IconChevronRight aria-hidden="true" />
        </button>
      </footer>

      <div className="social-presentation__hint">
        <IconArrowLeft aria-hidden="true" />
        <span>方向键或空格切换</span>
        <IconArrowRight aria-hidden="true" />
      </div>
    </div>,
    document.body,
  );
}
