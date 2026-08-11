const TAU = Math.PI * 2;

/**
 * V6 uses time constants instead of frame counts. A channel is visually
 * settled after roughly three time constants (95%).
 */
export const GRAPH_V6_MOTION = Object.freeze({
  maxDeltaMs: 64,
  ambientResumeTauMs: 220,
  hoverInTauMs: 72,
  hoverOutTauMs: 106,
  tooltipDelayMs: 220,
  tooltipInTauMs: 56,
  tooltipOutTauMs: 92,
  selectionInTauMs: 140,
  selectionOutTauMs: 210,
  selectedDriftGain: 0.35,
  neighborDriftGain: 0.65,
  unrelatedOpacity: 0.22,
  hoverScale: 0.06,
  maxHoverLinks: 3,
  maxSelectionLinks: 6,
  settleEpsilon: 0.001,
});

export function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

/**
 * Exact exponential damping coefficient for an elapsed time step.
 * Repeated steps covering the same elapsed time produce the same result.
 */
export function dampingAlpha(deltaMs, tauMs) {
  const delta = Math.max(0, Number(deltaMs) || 0);
  const tau = Math.max(0, Number(tauMs) || 0);
  if (delta === 0) return 0;
  if (tau === 0) return 1;
  return 1 - Math.exp(-delta / tau);
}

export function dampScalar(current, target, deltaMs, tauMs) {
  const from = Number(current) || 0;
  const to = Number(target) || 0;
  return from + (to - from) * dampingAlpha(deltaMs, tauMs);
}

export function stableGraphHash(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeNode(node) {
  if (typeof node === "string" || typeof node === "number") {
    return { id: String(node), degree: 0 };
  }
  if (!node || node.id == null) {
    throw new TypeError("Graph motion nodes require a stable id");
  }
  return { id: String(node.id), degree: Math.max(0, Number(node.degree) || 0) };
}

/**
 * Creates a deterministic, low-frequency screen-space orbit. The profile is
 * independent from hover and selection, so pointer intent cannot move nodes.
 */
export function createAmbientProfile(node) {
  const normalized = normalizeNode(node);
  const hash = stableGraphHash(normalized.id);
  const amplitudeBase = normalized.degree === 0
    ? 6.5
    : normalized.degree >= 18
      ? 3
      : 4.8;
  const variance = 0.9 + ((hash >>> 5) % 21) / 100;
  const amplitude = amplitudeBase * variance;

  return Object.freeze({
    amplitudeX: amplitude,
    amplitudeY: amplitude * (0.72 + ((hash >>> 3) % 19) / 100),
    periodXMs: 60000 + ((hash >>> 9) % 46000),
    periodYMs: 68000 + ((hash >>> 17) % 42000),
    phaseX: ((hash % 360) * Math.PI) / 180,
    phaseY: ((((hash >>> 12) % 360) + 71) * Math.PI) / 180,
    filterTauMs: 780 + ((hash >>> 22) % 520),
  });
}

function dampedSine(amplitude, periodMs, phase, elapsedMs, filterTauMs) {
  const omega = TAU / Math.max(1, periodMs);
  const omegaTau = omega * Math.max(0, filterTauMs);
  const attenuation = 1 / Math.sqrt(1 + omegaTau * omegaTau);
  const lag = Math.atan(omegaTau);
  return amplitude * attenuation * Math.sin(omega * elapsedMs + phase - lag);
}

/**
 * Samples the steady-state response of a first-order damped follower to two
 * deterministic sine pairs. Because this is analytic, sampling at 30, 60 or
 * 120Hz yields the same position for the same elapsed time.
 */
export function sampleAmbientOffset(
  profile,
  elapsedMs,
  { scale = 1, gain = 1, reducedMotion = false } = {},
  output = { x: 0, y: 0 },
) {
  if (reducedMotion || gain <= 0) {
    output.x = 0;
    output.y = 0;
    return output;
  }
  const safeScale = Math.max(0.5, Number(scale) || 1);
  const time = Math.max(0, Number(elapsedMs) || 0);
  const x =
    dampedSine(
      profile.amplitudeX * 0.72,
      profile.periodXMs,
      profile.phaseX,
      time,
      profile.filterTauMs,
    ) +
    dampedSine(
      profile.amplitudeX * 0.28,
      profile.periodXMs * 2.1,
      profile.phaseY,
      time,
      profile.filterTauMs,
    );
  const y =
    dampedSine(
      profile.amplitudeY * 0.7,
      profile.periodYMs,
      profile.phaseY + Math.PI / 2,
      time,
      profile.filterTauMs,
    ) +
    dampedSine(
      profile.amplitudeY * 0.3,
      profile.periodYMs * 1.8,
      profile.phaseX,
      time,
      profile.filterTauMs,
    );

  output.x = (x * gain) / safeScale;
  output.y = (y * gain) / safeScale;
  return output;
}

function makeNodeMotion(node, reducedMotion) {
  const normalized = normalizeNode(node);
  const profile = createAmbientProfile(normalized);
  const initialOffset = sampleAmbientOffset(profile, 0, { reducedMotion });
  return {
    id: normalized.id,
    profile,
    ambientSample: { x: initialOffset.x, y: initialOffset.y },
    hoverTarget: 0,
    hoverWeight: 0,
    tooltipTarget: 0,
    tooltipWeight: 0,
    selectionTarget: 0,
    selectionWeight: 0,
    neighborTarget: 0,
    neighborWeight: 0,
    driftGain: reducedMotion ? 0 : 1,
    offsetX: initialOffset.x,
    offsetY: initialOffset.y,
    opacity: 1,
    scale: 1,
  };
}

function makeLinkMotion(id) {
  return {
    id: String(id),
    hoverTarget: 0,
    hoverWeight: 0,
    selectionTarget: 0,
    selectionWeight: 0,
    emphasis: 0,
  };
}

function createConfig(overrides) {
  return Object.freeze({ ...GRAPH_V6_MOTION, ...(overrides ?? {}) });
}

/**
 * Persistent graph motion state. It is intentionally mutated by the exported
 * setters and step function so a Canvas frame loop does not allocate maps or
 * per-node state on every frame.
 */
export function createGraphMotionState(
  nodes,
  { linkIds = [], reducedMotion = false, config } = {},
) {
  const nodeMotions = new Map();
  for (const node of nodes ?? []) {
    const motion = makeNodeMotion(node, reducedMotion);
    nodeMotions.set(motion.id, motion);
  }

  const linkMotions = new Map();
  for (const linkId of linkIds) {
    const id = String(linkId);
    linkMotions.set(id, makeLinkMotion(id));
  }

  return {
    elapsedMs: 0,
    reducedMotion: Boolean(reducedMotion),
    ambientTarget: reducedMotion ? 0 : 1,
    ambientWeight: reducedMotion ? 0 : 1,
    nodes: nodeMotions,
    links: linkMotions,
    hover: {
      targetId: null,
      previousId: null,
      activatedAtMs: Number.NEGATIVE_INFINITY,
      linkIds: [],
    },
    selection: {
      targetId: null,
      previousId: null,
      weight: 0,
      targetWeight: 0,
      neighborIds: [],
      linkIds: [],
    },
    config: createConfig(config),
  };
}

function ensureKnownNode(state, id) {
  if (id == null) return null;
  const normalized = String(id);
  if (!state.nodes.has(normalized)) {
    throw new RangeError(`Unknown graph node: ${normalized}`);
  }
  return normalized;
}

function ensureLink(state, id) {
  const normalized = String(id);
  let link = state.links.get(normalized);
  if (!link) {
    link = makeLinkMotion(normalized);
    state.links.set(normalized, link);
  }
  return link;
}

function limitedIds(ids, maximum) {
  const unique = [];
  const seen = new Set();
  for (const value of ids ?? []) {
    if (value == null) continue;
    const id = String(value);
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
    if (unique.length >= maximum) break;
  }
  return unique;
}

function settleToTargets(state) {
  state.ambientWeight = 0;
  state.selection.weight = state.selection.targetWeight;
  for (const node of state.nodes.values()) {
    node.hoverWeight = node.hoverTarget;
    node.tooltipWeight = node.tooltipTarget;
    node.selectionWeight = node.selectionTarget;
    node.neighborWeight = node.neighborTarget;
    node.driftGain = 0;
    node.offsetX = 0;
    node.offsetY = 0;
    node.scale = 1 + node.hoverWeight * state.config.hoverScale;
    const relevance = Math.max(node.selectionWeight, node.neighborWeight);
    node.opacity = Math.max(
      state.config.unrelatedOpacity,
      1 - state.selection.weight * (1 - state.config.unrelatedOpacity) * (1 - relevance),
    );
  }
  for (const link of state.links.values()) {
    link.hoverWeight = link.hoverTarget;
    link.selectionWeight = link.selectionTarget;
    link.emphasis = 1 - (1 - link.hoverWeight) * (1 - link.selectionWeight);
  }
}

/** Runtime-safe reduced-motion switch. No reload or recreated engine needed. */
export function setGraphReducedMotion(state, reducedMotion) {
  const next = Boolean(reducedMotion);
  if (state.reducedMotion === next) return state;
  state.reducedMotion = next;
  state.ambientTarget = next ? 0 : 1;
  if (next) {
    if (state.hover.targetId != null) {
      const activeNode = state.nodes.get(state.hover.targetId);
      if (activeNode) activeNode.tooltipTarget = 1;
      state.hover.activatedAtMs = Math.min(
        state.hover.activatedAtMs,
        state.elapsedMs - state.config.tooltipDelayMs,
      );
    }
    settleToTargets(state);
  } else {
    // Drift is reintroduced continuously after reduced motion is disabled.
    state.ambientWeight = 0;
  }
  return state;
}

function normalizeMotionTarget(target) {
  if (target == null) return { id: null, linkIds: [], neighborIds: [] };
  if (typeof target === "string" || typeof target === "number") {
    return { id: String(target), linkIds: [], neighborIds: [] };
  }
  return {
    id: target.id == null ? null : String(target.id),
    linkIds: target.linkIds ?? [],
    neighborIds: target.neighborIds ?? [],
  };
}

/**
 * Sets the committed hover target. Candidate/dwell/grace belongs to
 * graph-hit-test; this function only crossfades the previous and next targets.
 */
export function setGraphHoverTarget(state, target) {
  const normalized = normalizeMotionTarget(target);
  const nextId = ensureKnownNode(state, normalized.id);
  const nextLinkIds = limitedIds(normalized.linkIds, state.config.maxHoverLinks);
  const changed = state.hover.targetId !== nextId;

  if (changed) {
    state.hover.previousId = state.hover.targetId;
    state.hover.targetId = nextId;
    state.hover.activatedAtMs = state.elapsedMs;
  }
  state.hover.linkIds = nextLinkIds;

  for (const node of state.nodes.values()) {
    node.hoverTarget = node.id === nextId ? 1 : 0;
    node.tooltipTarget = 0;
  }
  for (const link of state.links.values()) link.hoverTarget = 0;
  for (const linkId of nextLinkIds) ensureLink(state, linkId).hoverTarget = 1;

  if (state.reducedMotion) {
    const activeNode = nextId == null ? null : state.nodes.get(nextId);
    if (activeNode) activeNode.tooltipTarget = 1;
    settleToTargets(state);
  }
  return state;
}

/**
 * Sets a quiet, interruptible reading focus. Repeated selection replaces only
 * targets; existing weights continue from their current values.
 */
export function setGraphSelectionTarget(state, target) {
  const normalized = normalizeMotionTarget(target);
  const nextId = ensureKnownNode(state, normalized.id);
  const neighborIds = limitedIds(
    normalized.neighborIds,
    Number.POSITIVE_INFINITY,
  ).filter((id) => id !== nextId && state.nodes.has(id));
  const neighborSet = new Set(neighborIds);
  const nextLinkIds = limitedIds(
    normalized.linkIds,
    state.config.maxSelectionLinks,
  );

  if (state.selection.targetId !== nextId) {
    state.selection.previousId = state.selection.targetId;
    state.selection.targetId = nextId;
  }
  state.selection.neighborIds = neighborIds;
  state.selection.linkIds = nextLinkIds;
  state.selection.targetWeight = nextId == null ? 0 : 1;

  for (const node of state.nodes.values()) {
    node.selectionTarget = node.id === nextId ? 1 : 0;
    node.neighborTarget = neighborSet.has(node.id) ? 1 : 0;
  }
  for (const link of state.links.values()) link.selectionTarget = 0;
  for (const linkId of nextLinkIds) ensureLink(state, linkId).selectionTarget = 1;

  if (state.reducedMotion) settleToTargets(state);
  return state;
}

function channelTau(current, target, inTau, outTau) {
  return target > current ? inTau : outTau;
}

function settlePreviousIds(state) {
  const epsilon = state.config.settleEpsilon;
  if (state.hover.previousId != null) {
    const previous = state.nodes.get(state.hover.previousId);
    if (!previous || (previous.hoverWeight <= epsilon && previous.tooltipWeight <= epsilon)) {
      state.hover.previousId = null;
    }
  }
  if (state.selection.previousId != null) {
    const previous = state.nodes.get(state.selection.previousId);
    // The old selected node may legitimately become a neighbor of the new
    // selection. Only its selected channel determines whether the transition
    // itself has settled.
    if (!previous || previous.selectionWeight <= epsilon) {
      state.selection.previousId = null;
    }
  }
}

/**
 * Advances every visible channel with elapsed-time damping and returns the same
 * persistent state as the renderer/hit-test frame snapshot.
 */
export function stepGraphMotion(state, deltaMs, { scale = 1 } = {}) {
  const delta = Math.min(
    state.config.maxDeltaMs,
    Math.max(0, Number(deltaMs) || 0),
  );
  const previousElapsedMs = state.elapsedMs;
  state.elapsedMs += delta;

  if (state.reducedMotion) {
    settleToTargets(state);
    settlePreviousIds(state);
    return state;
  }

  state.ambientWeight = dampScalar(
    state.ambientWeight,
    state.ambientTarget,
    delta,
    state.config.ambientResumeTauMs,
  );
  state.selection.weight = dampScalar(
    state.selection.weight,
    state.selection.targetWeight,
    delta,
    channelTau(
      state.selection.weight,
      state.selection.targetWeight,
      state.config.selectionInTauMs,
      state.config.selectionOutTauMs,
    ),
  );

  const tooltipReadyAtMs =
    state.hover.activatedAtMs + state.config.tooltipDelayMs;
  const tooltipReady =
    state.hover.targetId != null && state.elapsedMs >= tooltipReadyAtMs;

  for (const node of state.nodes.values()) {
    const nextTooltipTarget = tooltipReady && node.id === state.hover.targetId ? 1 : 0;
    // When a frame straddles the delay boundary, integrate only the elapsed
    // portion after the exact boundary. This keeps 30/60/120Hz identical.
    const tooltipDelta =
      nextTooltipTarget === 1 &&
      node.tooltipTarget === 0 &&
      previousElapsedMs < tooltipReadyAtMs
        ? Math.max(0, state.elapsedMs - tooltipReadyAtMs)
        : delta;
    node.tooltipTarget = nextTooltipTarget;
    node.hoverWeight = dampScalar(
      node.hoverWeight,
      node.hoverTarget,
      delta,
      channelTau(
        node.hoverWeight,
        node.hoverTarget,
        state.config.hoverInTauMs,
        state.config.hoverOutTauMs,
      ),
    );
    node.tooltipWeight = dampScalar(
      node.tooltipWeight,
      node.tooltipTarget,
      tooltipDelta,
      channelTau(
        node.tooltipWeight,
        node.tooltipTarget,
        state.config.tooltipInTauMs,
        state.config.tooltipOutTauMs,
      ),
    );
    node.selectionWeight = dampScalar(
      node.selectionWeight,
      node.selectionTarget,
      delta,
      channelTau(
        node.selectionWeight,
        node.selectionTarget,
        state.config.selectionInTauMs,
        state.config.selectionOutTauMs,
      ),
    );
    node.neighborWeight = dampScalar(
      node.neighborWeight,
      node.neighborTarget,
      delta,
      channelTau(
        node.neighborWeight,
        node.neighborTarget,
        state.config.selectionInTauMs,
        state.config.selectionOutTauMs,
      ),
    );

    const neighborGain = 1 - node.neighborWeight * (1 - state.config.neighborDriftGain);
    const roleGain = neighborGain +
      (state.config.selectedDriftGain - neighborGain) * node.selectionWeight;
    node.driftGain = state.ambientWeight * roleGain;
    const offset = sampleAmbientOffset(node.profile, state.elapsedMs, {
      scale,
      gain: node.driftGain,
    }, node.ambientSample);
    node.offsetX = offset.x;
    node.offsetY = offset.y;
    node.scale = 1 + node.hoverWeight * state.config.hoverScale;

    const relevance = Math.max(node.selectionWeight, node.neighborWeight);
    node.opacity = Math.max(
      state.config.unrelatedOpacity,
      1 - state.selection.weight * (1 - state.config.unrelatedOpacity) * (1 - relevance),
    );
  }

  for (const link of state.links.values()) {
    link.hoverWeight = dampScalar(
      link.hoverWeight,
      link.hoverTarget,
      delta,
      channelTau(
        link.hoverWeight,
        link.hoverTarget,
        state.config.hoverInTauMs,
        state.config.hoverOutTauMs,
      ),
    );
    link.selectionWeight = dampScalar(
      link.selectionWeight,
      link.selectionTarget,
      delta,
      channelTau(
        link.selectionWeight,
        link.selectionTarget,
        state.config.selectionInTauMs,
        state.config.selectionOutTauMs,
      ),
    );
    link.emphasis = 1 - (1 - link.hoverWeight) * (1 - link.selectionWeight);
  }

  settlePreviousIds(state);
  return state;
}

export function getNodeMotion(state, nodeId) {
  return state.nodes.get(String(nodeId)) ?? null;
}

export function getLinkMotion(state, linkId) {
  return state.links.get(String(linkId)) ?? null;
}
