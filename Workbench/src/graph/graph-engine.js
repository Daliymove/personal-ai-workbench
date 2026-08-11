import { nodeRadius } from "../lib/graph.js";
import {
  createGraphHoverIntentState,
  clearGraphHoverIntent,
  findGraphNodeAtPoint,
  stepGraphHoverIntent,
} from "./graph-hit-test.js";
import { createGraphLabelCache, labelLimitForTier } from "./graph-label-cache.js";
import { computeBaseLayout, fittedGraphTransform } from "./graph-layout.js";
import { createGraphModel, neighborIdFor, primaryLinksFor } from "./graph-model.js";
import {
  dampingAlpha,
  createGraphMotionState,
  getLinkMotion,
  getNodeMotion,
  setGraphHoverTarget,
  setGraphReducedMotion,
  setGraphSelectionTarget,
  stepGraphMotion,
} from "./graph-motion.js";
import { renderGraphFrame } from "./graph-renderer.js";

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

export function normalizeGraphInsets(insets, width) {
  if (width < 760) {
    return {
      top: Math.max(76, insets?.top || 0),
      right: 18,
      bottom: Math.max(88, insets?.bottom || 0),
      left: 18,
    };
  }
  return {
    top: Math.max(20, insets?.top || 0),
    right: Math.max(20, insets?.right || 0),
    bottom: Math.max(20, insets?.bottom || 0),
    left: Math.max(20, insets?.left || 0),
  };
}

function asSet(value) {
  return value && value.size > 0 ? new Set(value) : null;
}

function channelIsSettled(current, target, epsilon = 0.002) {
  return Math.abs(current - target) <= epsilon;
}

function motionIsSettled(motion) {
  if (!channelIsSettled(motion.ambientWeight, motion.ambientTarget)) return false;
  if (!channelIsSettled(motion.selection.weight, motion.selection.targetWeight)) return false;
  for (const node of motion.nodes.values()) {
    if (!channelIsSettled(node.hoverWeight, node.hoverTarget)) return false;
    if (!channelIsSettled(node.tooltipWeight, node.tooltipTarget)) return false;
    if (!channelIsSettled(node.selectionWeight, node.selectionTarget)) return false;
    if (!channelIsSettled(node.neighborWeight, node.neighborTarget)) return false;
  }
  for (const link of motion.links.values()) {
    if (!channelIsSettled(link.hoverWeight, link.hoverTarget)) return false;
    if (!channelIsSettled(link.selectionWeight, link.selectionTarget)) return false;
  }
  return true;
}

/**
 * The V6 graph scene owns one clock and one frame snapshot. React receives
 * only semantic changes such as committed hover, zoom text and selection.
 */
export function createGraphEngine({
  canvas,
  wrap,
  tooltipElement,
  nodes,
  edges,
  preview = false,
  callbacks: initialCallbacks = {},
  activeTypes,
  activeStatuses,
  selectedId: initialSelectedId = null,
  viewportInsets,
}) {
  if (!canvas || !wrap) throw new Error("Knowledge graph requires a canvas and wrapper");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Knowledge graph could not create a 2D context");

  let callbacks = { ...initialCallbacks };
  let filters = { types: asSet(activeTypes), statuses: asSet(activeStatuses) };
  let insets = { ...(viewportInsets || {}) };
  let width = Math.max(1, wrap.clientWidth);
  let height = Math.max(1, wrap.clientHeight);
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let running = true;
  let intersecting = true;
  let documentVisible = !document.hidden;
  let frameRequest = 0;
  let previousFrameAt = 0;
  let lastPreviewPaintAt = 0;
  let selectedId = null;
  let primarySelectionLinks = [];
  let lastTooltipNodeId = null;
  const debugEnabled = Boolean(import.meta.env?.DEV);
  const debugFrameDurations = [];
  let debugFrameCounter = 0;

  const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  let reducedMotion = Boolean(motionQuery?.matches);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const model = computeBaseLayout(createGraphModel(nodes, edges));
  if (debugEnabled) canvas.dataset.graphEngine = "v6";
  const motion = createGraphMotionState(model.nodes, {
    linkIds: model.links.map((link) => link.key),
    reducedMotion,
  });
  const hoverIntent = createGraphHoverIntentState();
  const labelCache = createGraphLabelCache(ctx, { preview });
  const nodeFrames = model.nodes.map((node) => ({
    filterOpacity: 1,
    filterTarget: 1,
    hoverWeight: 0,
    neighborWeight: 0,
    node,
    opacity: 1,
    radius: nodeRadius(node),
    selectionWeight: 0,
    x: node.baseX,
    y: node.baseY,
  }));
  const nodeFrameById = new Map(nodeFrames.map((frame) => [frame.node.id, frame]));
  const screenFrames = nodeFrames.map((frame) => ({
    id: frame.node.id,
    interactive: true,
    node: frame.node,
    opacity: 1,
    radius: frame.radius,
    screenX: 0,
    screenY: 0,
    visible: true,
    x: 0,
    y: 0,
  }));
  const screenFrameById = new Map(screenFrames.map((frame) => [frame.id, frame]));
  const linkFrames = model.links.map((link) => ({
    alpha: 0.12,
    focusWeight: 0,
    hoverWeight: 0,
    link,
    source: nodeFrameById.get(link.source.id),
    target: nodeFrameById.get(link.target.id),
  }));

  const safeRect = () => {
    const normalized = normalizeGraphInsets(insets, width);
    const left = clamp(normalized.left, 0, width * 0.44);
    const right = clamp(normalized.right, 0, width * 0.44);
    const top = clamp(normalized.top, 0, height * 0.35);
    const bottom = clamp(normalized.bottom, 0, height * 0.42);
    return {
      x: left,
      y: top,
      width: Math.max(120, width - left - right),
      height: Math.max(120, height - top - bottom),
    };
  };

  const view = {
    ...fittedGraphTransform(model.nodes, safeRect(), preview),
    target: null,
    pendingSelectionCamera: null,
  };
  let lastZoomPercent = Math.round(view.k * 100);

  const passesFilter = (node) => {
    if (filters.types && !filters.types.has(node.type)) return false;
    if (filters.statuses && !filters.statuses.has(node.status ?? "unknown")) return false;
    return true;
  };

  const pointer = { inside: false, x: Number.NaN, y: Number.NaN };
  const dragging = {
    moved: false,
    node: null,
    pan: null,
    pointerId: null,
    startX: 0,
    startY: 0,
    grabDx: 0,
    grabDy: 0,
  };

  const setZoomReadout = () => {
    const next = Math.round(view.k * 100);
    if (next === lastZoomPercent) return;
    lastZoomPercent = next;
    callbacks.onZoom?.(next);
  };

  const cancelCamera = () => {
    view.target = null;
    view.pendingSelectionCamera = null;
  };

  const targetView = (target, tauMs = 130) => {
    const next = {
      x: Number.isFinite(target.x) ? target.x : view.x,
      y: Number.isFinite(target.y) ? target.y : view.y,
      k: clamp(Number.isFinite(target.k) ? target.k : view.k, 0.32, 3.5),
      tauMs,
    };
    if (reducedMotion) {
      view.x = next.x;
      view.y = next.y;
      view.k = next.k;
      view.target = null;
      setZoomReadout();
      return;
    }
    view.target = next;
  };

  const fitToView = (animate = true) => {
    const target = fittedGraphTransform(model.nodes, safeRect(), preview);
    if (!animate || reducedMotion) {
      view.x = target.x;
      view.y = target.y;
      view.k = target.k;
      view.target = null;
      setZoomReadout();
    } else {
      targetView(target, 105);
    }
    labelCache.invalidate();
    wake();
  };

  const zoomBy = (factor) => {
    const safe = safeRect();
    const pointX = safe.x + safe.width / 2;
    const pointY = safe.y + safe.height / 2;
    const scale = clamp(view.k * factor, 0.32, 3.5);
    targetView(
      {
        k: scale,
        x: pointX - ((pointX - view.x) * scale) / view.k,
        y: pointY - ((pointY - view.y) * scale) / view.k,
      },
      72,
    );
    wake();
  };

  const stepView = (deltaMs, now) => {
    const pending = view.pendingSelectionCamera;
    if (pending && now >= pending.dueAt) {
      view.pendingSelectionCamera = null;
      if (!reducedMotion && pending.id === selectedId) {
        const nodeFrame = nodeFrameById.get(pending.id);
        if (nodeFrame) {
          const safe = safeRect();
          const screenX = view.x + nodeFrame.x * view.k;
          const screenY = view.y + nodeFrame.y * view.k;
          const comfortX = Math.min(108, safe.width * 0.18);
          const comfortY = Math.min(84, safe.height * 0.18);
          const inside =
            screenX >= safe.x + comfortX &&
            screenX <= safe.x + safe.width - comfortX &&
            screenY >= safe.y + comfortY &&
            screenY <= safe.y + safe.height - comfortY;
          if (!inside) {
            targetView(
              {
                k: view.k,
                x: safe.x + safe.width / 2 - nodeFrame.x * view.k,
                y: safe.y + safe.height / 2 - nodeFrame.y * view.k,
              },
              235,
            );
          }
        }
      }
    }

    if (!view.target) return true;
    const blend = dampingAlpha(deltaMs, view.target.tauMs);
    view.x += (view.target.x - view.x) * blend;
    view.y += (view.target.y - view.y) * blend;
    view.k += (view.target.k - view.k) * blend;
    setZoomReadout();
    const settled =
      Math.abs(view.target.x - view.x) < 0.08 &&
      Math.abs(view.target.y - view.y) < 0.08 &&
      Math.abs(view.target.k - view.k) < 0.0005;
    if (settled) {
      view.x = view.target.x;
      view.y = view.target.y;
      view.k = view.target.k;
      view.target = null;
      setZoomReadout();
    }
    return settled;
  };

  const focusNode = (id) => {
    const nextId = id && model.nodeById.has(id) ? id : null;
    selectedId = nextId;
    primarySelectionLinks = primaryLinksFor(model, nextId, 6);
    setGraphSelectionTarget(motion, {
      id: nextId,
      neighborIds: primarySelectionLinks.map((link) => neighborIdFor(link, nextId)),
      linkIds: primarySelectionLinks.map((link) => link.key),
    });
    labelCache.invalidate();
    view.target = null;
    view.pendingSelectionCamera = nextId && !preview && !reducedMotion
      ? { id: nextId, dueAt: performance.now() + 180 }
      : null;
    wake();
  };

  const applyCommittedHover = () => {
    if (!hoverIntent.changed) return;
    const id = hoverIntent.targetId;
    const hoverLinks = primaryLinksFor(model, id, 3);
    setGraphHoverTarget(motion, {
      id,
      linkIds: hoverLinks.map((link) => link.key),
    });
    callbacks.onHover?.(id ? model.nodeById.get(id) ?? null : null);
  };

  const releaseHover = (now = performance.now()) => {
    clearGraphHoverIntent(hoverIntent, now);
    applyCommittedHover();
    pointer.inside = false;
  };

  const updateFrames = (deltaMs) => {
    const filterBlend = reducedMotion ? 1 : dampingAlpha(deltaMs, 150);
    for (let index = 0; index < nodeFrames.length; index += 1) {
      const frame = nodeFrames[index];
      const screen = screenFrames[index];
      const nodeMotion = getNodeMotion(motion, frame.node.id);
      frame.filterTarget = passesFilter(frame.node) ? 1 : 0;
      frame.filterOpacity += (frame.filterTarget - frame.filterOpacity) * filterBlend;
      frame.x = frame.node.baseX + frame.node.manualX + nodeMotion.offsetX;
      frame.y = frame.node.baseY + frame.node.manualY + nodeMotion.offsetY;
      frame.hoverWeight = nodeMotion.hoverWeight;
      frame.selectionWeight = nodeMotion.selectionWeight;
      frame.neighborWeight = nodeMotion.neighborWeight;
      frame.opacity = nodeMotion.opacity * frame.filterOpacity;

      const radius = frame.radius * view.k * nodeMotion.scale;
      screen.screenX = view.x + frame.x * view.k;
      screen.screenY = view.y + frame.y * view.k;
      screen.x = screen.screenX;
      screen.y = screen.screenY;
      screen.radius = radius;
      screen.hitRadius = radius;
      screen.opacity = frame.opacity;
      screen.interactive = frame.filterTarget > 0.5 && frame.opacity > 0.12;
      screen.visible = frame.opacity > 0.008;
    }

    const globalSelection = motion.selection.weight;
    for (const frame of linkFrames) {
      const linkMotion = getLinkMotion(motion, frame.link.key);
      frame.focusWeight = linkMotion.selectionWeight;
      frame.hoverWeight = linkMotion.hoverWeight;
      const ambient = 0.12 - globalSelection * 0.07;
      const emphasis = frame.focusWeight * 0.5 + frame.hoverWeight * 0.24;
      frame.alpha =
        Math.min(frame.source.opacity, frame.target.opacity) * clamp(ambient + emphasis, 0, 0.64);
    }
  };

  const labelCandidates = () => {
    const candidates = [];
    if (selectedId) {
      const selected = model.nodeById.get(selectedId);
      if (selected && passesFilter(selected)) {
        candidates.push({ node: selected, priority: 100000, required: true });
      }
      const limit = Math.max(0, labelLimitForTier(labelCache.tier, true) - 1);
      primarySelectionLinks.slice(0, Math.min(6, limit)).forEach((link, index) => {
        const neighbor = model.nodeById.get(neighborIdFor(link, selectedId));
        if (neighbor && passesFilter(neighbor)) {
          candidates.push({ node: neighbor, priority: 50000 - index, required: false });
        }
      });
      return candidates;
    }

    const limit = labelLimitForTier(labelCache.tier, false);
    for (let index = 0; index < Math.min(limit, model.labelOrder.length); index += 1) {
      const node = model.labelOrder[index];
      if (!passesFilter(node)) continue;
      candidates.push({ node, priority: 1000 - index, required: index < 3 });
    }
    return candidates;
  };

  const updateTooltip = () => {
    if (!tooltipElement) return;
    let bestMotion = null;
    for (const nodeMotion of motion.nodes.values()) {
      if (nodeMotion.tooltipWeight <= (bestMotion?.tooltipWeight ?? 0.006)) continue;
      bestMotion = nodeMotion;
    }
    const nextId = bestMotion?.id ?? null;
    if (nextId !== lastTooltipNodeId) {
      lastTooltipNodeId = nextId;
      callbacks.onTooltipNode?.(nextId ? model.nodeById.get(nextId) ?? null : null);
    }
    const frame = nextId ? screenFrameById.get(nextId) : null;
    const opacity = frame ? bestMotion.tooltipWeight * frame.opacity : 0;
    if (!frame || opacity < 0.006) {
      tooltipElement.style.opacity = "0";
      tooltipElement.style.visibility = "hidden";
      tooltipElement.setAttribute("aria-hidden", "true");
      return;
    }
    const x = clamp(frame.screenX, 150, Math.max(150, width - 150));
    const y = clamp(frame.screenY - frame.radius - 12, 58, Math.max(58, height - 36));
    tooltipElement.style.left = `${x}px`;
    tooltipElement.style.top = `${y}px`;
    tooltipElement.style.opacity = String(clamp(opacity, 0, 1));
    tooltipElement.style.visibility = "visible";
    tooltipElement.setAttribute("aria-hidden", "false");
  };

  const draw = (now, deltaMs) => {
    stepGraphMotion(motion, deltaMs, { scale: view.k });
    const viewSettled = stepView(deltaMs, now);
    updateFrames(deltaMs);

    if (!preview && !dragging.node && !dragging.pan) {
      stepGraphHoverIntent(hoverIntent, {
        nowMs: now,
        pointer: pointer.inside ? pointer : null,
        nodes: screenFrames,
      });
      applyCommittedHover();
      canvas.style.cursor = hoverIntent.activeId || hoverIntent.candidateId ? "pointer" : "grab";
    }

    labelCache.updateTier(view.k, now, reducedMotion);
    if (labelCache.dirty) {
      labelCache.layout({
        candidates: labelCandidates(),
        screenNodes: screenFrames,
        safe: safeRect(),
      });
    }
    const labelsSettled = labelCache.step(deltaMs, reducedMotion);
    const labels = labelCache.frame(screenFrameById, selectedId);
    renderGraphFrame(ctx, {
      canvas,
      dpr,
      labels,
      links: linkFrames,
      nodes: nodeFrames,
      view,
    });
    updateTooltip();
    return { labelCount: labels.length, labelsSettled, viewSettled };
  };

  const shouldContinue = (drawState) => {
    if (!running || !intersecting || !documentVisible) return false;
    if (!reducedMotion) return true;
    const intentActive = hoverIntent.phase === "candidate" || hoverIntent.phase === "releasing";
    return Boolean(
      intentActive ||
      dragging.node ||
      dragging.pan ||
      view.target ||
      view.pendingSelectionCamera ||
      !drawState.labelsSettled ||
      !drawState.viewSettled ||
      !motionIsSettled(motion),
    );
  };

  const loop = (now) => {
    frameRequest = 0;
    if (!running || !intersecting || !documentVisible) return;
    if (preview && lastPreviewPaintAt && now - lastPreviewPaintAt < 30) {
      frameRequest = window.requestAnimationFrame(loop);
      return;
    }
    const deltaMs = previousFrameAt ? Math.max(1, now - previousFrameAt) : 16;
    previousFrameAt = now;
    lastPreviewPaintAt = now;
    const drawStartedAt = debugEnabled ? performance.now() : 0;
    const drawState = draw(now, deltaMs);
    if (debugEnabled) {
      debugFrameDurations.push(performance.now() - drawStartedAt);
      if (debugFrameDurations.length > 120) debugFrameDurations.shift();
      debugFrameCounter += 1;
      if (debugFrameCounter % 30 === 0) {
        const ordered = [...debugFrameDurations].sort((a, b) => a - b);
        const p95 = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))] ?? 0;
        canvas.dataset.graphFrameP95 = p95.toFixed(2);
        canvas.dataset.graphHoverRevision = String(hoverIntent.revision);
        canvas.dataset.graphHoverId = hoverIntent.targetId ?? "";
        canvas.dataset.graphLabelLayoutVersion = String(labelCache.version);
        canvas.dataset.graphLabelCount = String(drawState.labelCount);
        canvas.dataset.graphPrimaryLinks = String(primarySelectionLinks.length);
        canvas.dataset.graphSelectedId = selectedId ?? "";
      }
    }
    if (shouldContinue(drawState)) frameRequest = window.requestAnimationFrame(loop);
  };

  function wake() {
    if (!running || !intersecting || !documentVisible || frameRequest) return;
    frameRequest = window.requestAnimationFrame(loop);
  }

  const stopFrames = () => {
    if (frameRequest) window.cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    previousFrameAt = 0;
    lastPreviewPaintAt = 0;
  };

  const eventPoint = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const graphPoint = (point) => ({
    x: (point.x - view.x) / view.k,
    y: (point.y - view.y) / view.k,
  });

  const updatePointer = (event) => {
    const point = eventPoint(event);
    pointer.x = point.x;
    pointer.y = point.y;
    pointer.inside = true;
    return point;
  };

  const onPointerMove = (event) => {
    const point = updatePointer(event);
    if (dragging.node) {
      dragging.moved = dragging.moved ||
        Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY) > 4;
      const graph = graphPoint(point);
      const nodeMotion = getNodeMotion(motion, dragging.node.id);
      dragging.node.manualX = graph.x + dragging.grabDx - dragging.node.baseX - nodeMotion.offsetX;
      dragging.node.manualY = graph.y + dragging.grabDy - dragging.node.baseY - nodeMotion.offsetY;
      wake();
      return;
    }
    if (dragging.pan) {
      dragging.moved = dragging.moved ||
        Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY) > 4;
      view.x = dragging.pan.originX + (event.clientX - dragging.startX);
      view.y = dragging.pan.originY + (event.clientY - dragging.startY);
      cancelCamera();
      wake();
      return;
    }
    wake();
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const point = updatePointer(event);
    const hit = findGraphNodeAtPoint(screenFrames, point);
    cancelCamera();
    dragging.pointerId = event.pointerId;
    dragging.startX = event.clientX;
    dragging.startY = event.clientY;
    dragging.moved = false;
    canvas.setPointerCapture?.(event.pointerId);
    if (hit) {
      const node = model.nodeById.get(hit.id);
      const frame = nodeFrameById.get(hit.id);
      const graph = graphPoint(point);
      dragging.node = node;
      dragging.grabDx = frame.x - graph.x;
      dragging.grabDy = frame.y - graph.y;
    } else {
      dragging.pan = { originX: view.x, originY: view.y };
    }
    releaseHover(performance.now());
    canvas.style.cursor = "grabbing";
    wake();
  };

  const finishPointer = (event) => {
    if (dragging.pointerId !== null && event.pointerId !== dragging.pointerId) return;
    const cancelled = event.type === "pointercancel";
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (!cancelled && !dragging.moved) {
      if (dragging.node) callbacks.onSelect?.(dragging.node);
      else if (dragging.pan) callbacks.onSelect?.(null);
    }
    const movedNode = dragging.node;
    dragging.node = null;
    dragging.pan = null;
    dragging.pointerId = null;
    if (movedNode) labelCache.invalidate();
    canvas.style.cursor = "grab";
    wake();
  };

  const onWheel = (event) => {
    event.preventDefault();
    const point = updatePointer(event);
    cancelCamera();
    const factor = Math.exp(-event.deltaY * 0.00115);
    const scale = clamp(view.k * factor, 0.32, 3.5);
    view.x = point.x - ((point.x - view.x) * scale) / view.k;
    view.y = point.y - ((point.y - view.y) * scale) / view.k;
    view.k = scale;
    setZoomReadout();
    wake();
  };

  const onDoubleClick = (event) => {
    const point = updatePointer(event);
    const hit = findGraphNodeAtPoint(screenFrames, point);
    if (hit) callbacks.onActivate?.(model.nodeById.get(hit.id));
  };

  const onPointerLeave = () => {
    if (dragging.node || dragging.pan) return;
    pointer.inside = false;
    wake();
  };

  const onKeyDown = (event) => {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(1.24);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomBy(0.8);
    } else if (event.key === "0") {
      event.preventDefault();
      fitToView(true);
    } else if (event.key === "Escape") {
      callbacks.onSelect?.(null);
    }
  };

  if (!preview) {
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", finishPointer);
    canvas.addEventListener("pointercancel", finishPointer);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("keydown", onKeyDown);
  }

  const resizeObserver = new ResizeObserver(() => {
    const nextWidth = Math.max(1, wrap.clientWidth);
    const nextHeight = Math.max(1, wrap.clientHeight);
    const deltaX = nextWidth - width;
    const deltaY = nextHeight - height;
    width = nextWidth;
    height = nextHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.x += deltaX / 2;
    view.y += deltaY / 2;
    if (view.target) {
      view.target.x += deltaX / 2;
      view.target.y += deltaY / 2;
    }
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    labelCache.invalidate();
    previousFrameAt = 0;
    wake();
  });
  resizeObserver.observe(wrap);

  const intersectionObserver = new IntersectionObserver(([entry]) => {
    intersecting = entry?.isIntersecting ?? true;
    if (!intersecting) {
      pointer.inside = false;
      releaseHover(performance.now());
      stopFrames();
    }
    else wake();
  }, { threshold: 0.01 });
  intersectionObserver.observe(wrap);

  const onVisibilityChange = () => {
    documentVisible = !document.hidden;
    if (!documentVisible) {
      pointer.inside = false;
      releaseHover(performance.now());
      stopFrames();
    } else {
      previousFrameAt = 0;
      wake();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const onMotionPreferenceChange = (event) => {
    reducedMotion = event.matches;
    setGraphReducedMotion(motion, reducedMotion);
    if (reducedMotion) cancelCamera();
    labelCache.invalidate();
    previousFrameAt = 0;
    wake();
  };
  motionQuery?.addEventListener?.("change", onMotionPreferenceChange);

  document.fonts?.ready?.then(() => {
    if (!running) return;
    labelCache.invalidate();
    wake();
  });

  if (initialSelectedId) focusNode(initialSelectedId);
  callbacks.onZoom?.(lastZoomPercent);
  wake();

  const destroy = () => {
    if (!running) return;
    running = false;
    stopFrames();
    if (!preview) {
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", finishPointer);
      canvas.removeEventListener("pointercancel", finishPointer);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("keydown", onKeyDown);
    }
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    motionQuery?.removeEventListener?.("change", onMotionPreferenceChange);
  };

  return {
    destroy,
    fitToView,
    focusNode,
    invalidateLabels() {
      labelCache.invalidate();
      wake();
    },
    setCallbacks(nextCallbacks) {
      callbacks = { ...nextCallbacks };
    },
    setFilters(types, statuses) {
      filters = { types: asSet(types), statuses: asSet(statuses) };
      if (hoverIntent.targetId) {
        const hoveredNode = model.nodeById.get(hoverIntent.targetId);
        if (!hoveredNode || !passesFilter(hoveredNode)) releaseHover(performance.now());
      }
      labelCache.invalidate();
      wake();
    },
    setInsets(nextInsets) {
      insets = { ...(nextInsets || {}) };
      labelCache.invalidate();
      wake();
    },
    wake,
    zoomBy,
  };
}
