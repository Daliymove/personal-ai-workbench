import { useEffect, useRef, useState } from "react";
import { createGraphEngine } from "../graph/graph-engine.js";

export function useKnowledgeGraphEngine({
  nodes,
  edges,
  activeTypes,
  activeStatuses,
  onSelect,
  onHover,
  onActivate,
  selectedId,
  viewportInsets,
  preview,
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const tooltipRef = useRef(null);
  const engineRef = useRef(null);
  const [tooltipNode, setTooltipNode] = useState(null);
  const [zoomPercent, setZoomPercent] = useState(100);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || nodes.length === 0) return undefined;

    const engine = createGraphEngine({
      activeStatuses,
      activeTypes,
      callbacks: {
        onActivate,
        onHover,
        onSelect,
        onTooltipNode: setTooltipNode,
        onZoom: setZoomPercent,
      },
      canvas,
      edges,
      nodes,
      preview,
      selectedId,
      tooltipElement: tooltipRef.current,
      viewportInsets,
      wrap,
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [nodes, edges, preview]);

  useEffect(() => {
    engineRef.current?.setCallbacks({
      onActivate,
      onHover,
      onSelect,
      onTooltipNode: setTooltipNode,
      onZoom: setZoomPercent,
    });
  }, [onActivate, onHover, onSelect]);

  useEffect(() => {
    engineRef.current?.setFilters(activeTypes, activeStatuses);
  }, [activeTypes, activeStatuses]);

  useEffect(() => {
    engineRef.current?.setInsets(viewportInsets);
  }, [viewportInsets]);

  useEffect(() => {
    engineRef.current?.focusNode(selectedId ?? null);
  }, [selectedId]);

  return {
    canvasRef,
    engineRef,
    tooltipNode,
    tooltipRef,
    wrapRef,
    zoomPercent,
  };
}

