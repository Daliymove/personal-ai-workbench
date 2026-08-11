import { dampingAlpha } from "./graph-motion.js";
import { truncateGraphTitle } from "../lib/graph.js";

function overlaps(a, b, padding = 0) {
  return !(
    a.x + a.width + padding < b.x ||
    b.x + b.width + padding < a.x ||
    a.y + a.height + padding < b.y ||
    b.y + b.height + padding < a.y
  );
}

function overlapArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

export function labelDensityTier(scale, currentTier = 0) {
  const zoom = Number(scale) || 1;
  if (currentTier <= 0) {
    if (zoom >= 1.28) return 3;
    if (zoom >= 0.9) return 2;
    if (zoom >= 0.6) return 1;
    return 0;
  }
  if (currentTier === 1) {
    if (zoom >= 1.28) return 3;
    if (zoom >= 0.9) return 2;
    if (zoom < 0.5) return 0;
    return 1;
  }
  if (currentTier === 2) {
    if (zoom >= 1.28) return 3;
    if (zoom < 0.5) return 0;
    if (zoom < 0.8) return 1;
    return 2;
  }
  if (zoom < 0.5) return 0;
  if (zoom < 0.8) return 1;
  if (zoom < 1.12) return 2;
  return 3;
}

export function labelLimitForTier(tier, selected = false) {
  const index = Math.min(3, Math.max(0, Math.round(Number(tier) || 0)));
  return selected ? [6, 7, 8, 10][index] : [5, 9, 14, 22][index];
}

function placementsFor(entry, state) {
  const gap = 8;
  return [
    { x: entry.x + entry.radius + gap, y: entry.y - state.height / 2 },
    { x: entry.x - entry.radius - gap - state.width, y: entry.y - state.height / 2 },
    { x: entry.x - state.width / 2, y: entry.y + entry.radius + gap },
    { x: entry.x - state.width / 2, y: entry.y - entry.radius - gap - state.height },
    { x: entry.x + entry.radius * 0.7 + gap, y: entry.y + entry.radius * 0.7 + 3 },
    {
      x: entry.x - entry.radius * 0.7 - gap - state.width,
      y: entry.y - entry.radius * 0.7 - state.height - 3,
    },
  ].map((placement) => ({ ...placement, width: state.width, height: state.height }));
}

/**
 * Labels keep their measurement and anchor between layout-invalidating events.
 * A few pixels of ambient node motion only translates the chosen placement.
 */
export function createGraphLabelCache(ctx, { preview = false } = {}) {
  const states = new Map();
  let tier = labelDensityTier(1, 0);
  let pendingTier = null;
  let pendingAt = 0;
  let dirty = true;
  let version = 0;

  const measure = (node) => {
    const text = truncateGraphTitle(node.title, 24);
    const font = "500 11px 'Noto Sans SC', sans-serif";
    ctx.font = font;
    const padX = 8;
    return {
      font,
      height: 23,
      node,
      padX,
      text,
      width: Math.ceil(ctx.measureText(text).width) + padX * 2,
    };
  };

  const updateTier = (scale, now, reduced) => {
    const requested = labelDensityTier(scale, tier);
    if (requested === tier) {
      pendingTier = null;
      return false;
    }
    if (reduced) {
      tier = requested;
      pendingTier = null;
      dirty = true;
      return true;
    }
    if (pendingTier !== requested) {
      pendingTier = requested;
      pendingAt = now + 240;
      return false;
    }
    if (now < pendingAt) return false;
    tier = requested;
    pendingTier = null;
    dirty = true;
    return true;
  };

  const layout = ({ candidates, screenNodes, safe }) => {
    if (preview) {
      dirty = false;
      return;
    }
    const byId = new Map(screenNodes.map((entry) => [entry.node.id, entry]));
    const occupied = [];
    const obstacles = screenNodes
      .filter((entry) => entry.opacity > 0.38)
      .map((entry) => ({
        id: entry.node.id,
        x: entry.x - entry.radius - 3,
        y: entry.y - entry.radius - 3,
        width: entry.radius * 2 + 6,
        height: entry.radius * 2 + 6,
      }));
    for (const state of states.values()) state.target = 0;

    for (const candidate of candidates) {
      const entry = byId.get(candidate.node.id);
      if (!entry) continue;
      const previous = states.get(candidate.node.id);
      const geometry = previous ?? {
        ...measure(candidate.node),
        anchor: null,
        opacity: 0,
        target: 0,
      };
      const placements = placementsFor(entry, geometry);
      const within = (box) =>
        box.x >= safe.x + 4 &&
        box.y >= safe.y + 4 &&
        box.x + box.width <= safe.x + safe.width - 4 &&
        box.y + box.height <= safe.y + safe.height - 4;
      const conflicts = (box) =>
        occupied.some((other) => overlaps(box, other, 4)) ||
        obstacles.some(
          (obstacle) => obstacle.id !== candidate.node.id && overlaps(box, obstacle, 2),
        );
      const order = [geometry.anchor, 0, 1, 2, 3, 4, 5]
        .filter(Number.isInteger)
        .filter((value, index, all) => all.indexOf(value) === index);
      let anchor = order.find((index) => within(placements[index]) && !conflicts(placements[index]));
      let placement = Number.isInteger(anchor) ? placements[anchor] : null;
      if (!placement && candidate.required) {
        const best = placements
          .map((box, index) => ({ box, index }))
          .filter(({ box }) => within(box))
          .sort((a, b) => {
            const score = ({ box }) =>
              occupied.reduce((sum, other) => sum + overlapArea(box, other), 0) +
              obstacles.reduce(
                (sum, obstacle) =>
                  sum + (obstacle.id === candidate.node.id ? 0 : overlapArea(box, obstacle)),
                0,
              );
            return score(a) - score(b);
          })[0];
        anchor = best?.index;
        placement = best?.box ?? null;
      }
      if (!placement) continue;
      occupied.push(placement);
      geometry.anchor = anchor;
      geometry.node = candidate.node;
      geometry.required = candidate.required;
      geometry.target = 1;
      states.set(candidate.node.id, geometry);
    }
    dirty = false;
    version += 1;
  };

  const step = (deltaMs, reduced) => {
    let settled = true;
    for (const [id, state] of states) {
      const tau = state.target > state.opacity ? 180 : 260;
      state.opacity = reduced
        ? state.target
        : state.opacity + (state.target - state.opacity) * dampingAlpha(deltaMs, tau);
      if (Math.abs(state.target - state.opacity) > 0.008) settled = false;
    }
    return settled;
  };

  const frame = (screenById, selectedId) => {
    const result = [];
    for (const [id, state] of states) {
      const entry = screenById.get(id);
      if (!entry || state.opacity < 0.008 || !Number.isInteger(state.anchor)) continue;
      const placement = placementsFor(entry, state)[state.anchor];
      if (!placement) continue;
      result.push({
        ...placement,
        font: state.font,
        node: state.node,
        opacity: state.opacity * entry.opacity,
        padX: state.padX,
        selected: id === selectedId,
        text: state.text,
      });
    }
    return result;
  };

  return {
    frame,
    get dirty() {
      return dirty;
    },
    get tier() {
      return tier;
    },
    get version() {
      return version;
    },
    invalidate() {
      dirty = true;
    },
    layout,
    step,
    updateTier,
  };
}
