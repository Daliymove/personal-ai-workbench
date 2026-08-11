import {
  IconArrowsMaximize,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { typeLabelOf } from "../lib/graph";
import { useKnowledgeGraphEngine } from "../hooks/useKnowledgeGraphEngine";
import "../styles/knowledge-graph.css";

/**
 * React is deliberately a thin shell. The scene engine owns the single
 * Canvas clock, continuous motion, hit testing, labels and camera state.
 */
export function KnowledgeGraph({
  nodes,
  edges,
  activeTypes,
  activeStatuses,
  onSelect,
  onHover,
  onActivate,
  selectedId,
  viewportInsets,
  preview = false,
}) {
  const {
    canvasRef,
    engineRef,
    tooltipNode,
    tooltipRef,
    wrapRef,
    zoomPercent,
  } = useKnowledgeGraphEngine({
    activeStatuses,
    activeTypes,
    edges,
    nodes,
    onActivate,
    onHover,
    onSelect,
    preview,
    selectedId,
    viewportInsets,
  });

  return (
    <div
      className={`knowledge-graph${preview ? " knowledge-graph--preview" : ""}`}
      ref={wrapRef}
    >
      <canvas
        aria-label={
          preview
            ? "知识库关系图预览"
            : "可交互知识星图。拖拽平移或移动节点，滚轮缩放，点击节点查看关系，双击阅读文档。"
        }
        ref={canvasRef}
        role="img"
        tabIndex={preview ? -1 : 0}
      />

      {!preview ? (
        <div aria-label="图谱视图控制" className="knowledge-graph__controls" role="group">
          <button
            aria-label="缩小图谱"
            onClick={() => engineRef.current?.zoomBy(0.8)}
            title="缩小 (-)"
            type="button"
          >
            <IconZoomOut aria-hidden="true" />
          </button>
          <span aria-live="polite" className="knowledge-graph__zoom mono">
            {zoomPercent}%
          </span>
          <button
            aria-label="放大图谱"
            onClick={() => engineRef.current?.zoomBy(1.24)}
            title="放大 (+)"
            type="button"
          >
            <IconZoomIn aria-hidden="true" />
          </button>
          <span className="knowledge-graph__control-rule" aria-hidden="true" />
          <button
            aria-label="让全部节点适合画布"
            onClick={() => engineRef.current?.fitToView(true)}
            title="完整显示 (0)"
            type="button"
          >
            <IconArrowsMaximize aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {!preview ? (
        <div
          aria-hidden={tooltipNode ? "false" : "true"}
          className="graph-tooltip graph-tooltip--constellation"
          ref={tooltipRef}
        >
          {tooltipNode ? (
            <>
              <span className="graph-tooltip__type">
                {typeLabelOf(tooltipNode.type)} · {tooltipNode.degree ?? 0} LINKS
              </span>
              {tooltipNode.title}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

