import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";
import { nodeRadius } from "../lib/graph.js";

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

/** D3 computes once, off-screen. Runtime motion never reheats this layout. */
export function computeBaseLayout(
  model,
  { logicalWidth = 1200, logicalHeight = 800 } = {},
) {
  const width = logicalWidth;
  const height = logicalHeight;
  const simulation = forceSimulation(model.nodes)
    .force(
      "link",
      forceLink(model.links)
        .id((node) => node.id)
        .distance((link) => {
          const base = 82;
          return Math.max(base - Math.log2(link.weight + 1) * 8, base * 0.62);
        }),
    )
    .force(
      "charge",
      forceManyBody()
        .strength((node) => {
          const degree = Math.max(0, Number(node.degree) || 0);
          return -155 - Math.sqrt(degree) * 16;
        })
        .distanceMin(16)
        .distanceMax(680),
    )
    .force("center", forceCenter(width / 2, height / 2).strength(0.055))
    .force(
      "x",
      forceX(width / 2).strength((node) =>
        node.degree === 0 ? 0.038 : 0.009,
      ),
    )
    .force(
      "y",
      forceY(height / 2).strength((node) =>
        node.degree === 0 ? 0.038 : 0.009,
      ),
    )
    .force(
      "collide",
      forceCollide()
        .radius((node) => nodeRadius(node) + 11)
        .strength(0.92)
        .iterations(2),
    )
    .alphaDecay(0.019)
    .velocityDecay(0.34)
    .stop();

  simulation.tick(360);
  simulation.stop();
  for (const node of model.nodes) {
    node.baseX = Number.isFinite(node.x) ? node.x : width / 2;
    node.baseY = Number.isFinite(node.y) ? node.y : height / 2;
    node.manualX = 0;
    node.manualY = 0;
    delete node.vx;
    delete node.vy;
    delete node.fx;
    delete node.fy;
  }
  return model;
}

export function graphBounds(nodes) {
  const connected = nodes.filter((node) => Number(node.degree) > 0);
  const source = connected.length > 0 ? connected : nodes;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of source) {
    const x = node.baseX + node.manualX;
    const y = node.baseY + node.manualY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const radius = nodeRadius(node) + 20;
    minX = Math.min(minX, x - radius);
    minY = Math.min(minY, y - radius);
    maxX = Math.max(maxX, x + radius);
    maxY = Math.max(maxY, y + radius);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export function fittedGraphTransform(nodes, safe, preview = false) {
  const bounds = graphBounds(nodes);
  if (!bounds) return { x: 0, y: 0, k: 1 };
  const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
  const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
  const k = clamp(
    Math.min(safe.width / graphWidth, safe.height / graphHeight) * 0.92,
    preview ? 0.32 : 0.38,
    preview ? 1.18 : 1.25,
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    k,
    x: safe.x + safe.width / 2 - centerX * k,
    y: safe.y + safe.height / 2 - centerY * k,
  };
}
