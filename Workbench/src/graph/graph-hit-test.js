export const GRAPH_V6_HIT_TEST = Object.freeze({
  dwellMs: 90,
  graceMs: 180,
  releaseSettleMs: 320,
  enterPaddingPx: 6,
  exitPaddingPx: 12,
  minimumEnterRadiusPx: 10,
});

function nodeId(node) {
  return node?.id == null ? null : String(node.id);
}

function nodeX(node) {
  return Number(node?.screenX ?? node?.x) || 0;
}

function nodeY(node) {
  return Number(node?.screenY ?? node?.y) || 0;
}

function nodeRadius(node) {
  return Math.max(0, Number(node?.hitRadius ?? node?.radius ?? node?.r) || 0);
}

function pointDistanceSquared(pointer, node) {
  const dx = Number(pointer?.x) - nodeX(node);
  const dy = Number(pointer?.y) - nodeY(node);
  return dx * dx + dy * dy;
}

function enterRadius(node, config) {
  return Math.max(
    config.minimumEnterRadiusPx ?? GRAPH_V6_HIT_TEST.minimumEnterRadiusPx,
    nodeRadius(node) + (config.enterPaddingPx ?? GRAPH_V6_HIT_TEST.enterPaddingPx),
  );
}

function isInteractiveNode(node) {
  return Boolean(node && nodeId(node) != null && node.visible !== false && node.interactive !== false);
}

/** Returns the nearest node inside its normal screen-space entry radius. */
export function findGraphNodeAtPoint(nodes, pointer, options = {}) {
  if (!pointer || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null;
  let winner = null;
  let winnerDistanceSquared = Number.POSITIVE_INFINITY;

  for (const node of nodes ?? []) {
    if (!isInteractiveNode(node)) continue;
    const radius = enterRadius(node, options);
    const distanceSquared = pointDistanceSquared(pointer, node);
    if (distanceSquared > radius * radius || distanceSquared >= winnerDistanceSquared) continue;
    winner = {
      id: nodeId(node),
      node,
      distance: Math.sqrt(distanceSquared),
      enterRadius: radius,
    };
    winnerDistanceSquared = distanceSquared;
  }
  return winner;
}

/**
 * Schmitt-trigger exit test: the committed node owns a larger radius than a
 * new candidate, preventing a drifting edge from repeatedly entering/leaving.
 */
export function isPointWithinGraphNodeExitRadius(node, pointer, options = {}) {
  if (!isInteractiveNode(node) || !pointer) return false;
  if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return false;
  const radius =
    enterRadius(node, options) +
    (options.exitPaddingPx ?? GRAPH_V6_HIT_TEST.exitPaddingPx);
  return pointDistanceSquared(pointer, node) <= radius * radius;
}

function resolveNow(state, nowMs) {
  const requested = Number(nowMs);
  const value = Number.isFinite(requested) ? requested : state.lastNowMs;
  return Math.max(state.lastNowMs, value);
}

export function createGraphHoverIntentState(options = {}) {
  return {
    phase: "idle",
    candidateId: null,
    candidateSinceMs: Number.NEGATIVE_INFINITY,
    activeId: null,
    previousId: null,
    targetId: null,
    releasingId: null,
    releaseSinceMs: Number.NEGATIVE_INFINITY,
    releaseCommittedAtMs: Number.NEGATIVE_INFINITY,
    transitionAtMs: Number.NEGATIVE_INFINITY,
    lastNowMs: Number.NEGATIVE_INFINITY,
    changed: false,
    committed: false,
    revision: 0,
    config: Object.freeze({ ...GRAPH_V6_HIT_TEST, ...options }),
  };
}

function setCandidate(state, id, now) {
  if (state.candidateId === id) return;
  state.candidateId = id;
  state.candidateSinceMs = now;
}

function clearCandidate(state) {
  state.candidateId = null;
  state.candidateSinceMs = Number.NEGATIVE_INFINITY;
}

function commitActive(state, id, now) {
  const previous = state.activeId ?? state.releasingId;
  if (previous !== id) {
    state.previousId = previous;
    state.transitionAtMs = now;
  }
  state.activeId = id;
  state.targetId = id;
  state.releasingId = null;
  state.releaseSinceMs = Number.NEGATIVE_INFINITY;
  state.releaseCommittedAtMs = Number.NEGATIVE_INFINITY;
  clearCandidate(state);
  state.phase = "active";
  state.changed = true;
  state.committed = true;
  state.revision += 1;
}

function beginRelease(state, now) {
  if (state.releasingId !== state.activeId || !Number.isFinite(state.releaseSinceMs)) {
    state.releasingId = state.activeId;
    state.releaseSinceMs = now;
  }
  state.phase = "releasing";
}

function commitRelease(state, now) {
  const previous = state.activeId;
  state.previousId = previous;
  state.transitionAtMs = now;
  state.releasingId = previous;
  state.activeId = null;
  state.targetId = null;
  state.releaseCommittedAtMs = now;
  state.phase = "releasing";
  state.changed = true;
  state.committed = true;
  state.revision += 1;
}

/**
 * Low-level intent transition. `hitId` is the normal-radius winner and
 * `activeWithinExitRadius` is calculated against the current frame snapshot.
 */
export function advanceGraphHoverIntent(
  state,
  { nowMs, hitId = null, activeWithinExitRadius = false } = {},
) {
  const now = resolveNow(state, nowMs);
  const directId = hitId == null ? null : String(hitId);
  state.lastNowMs = now;
  state.changed = false;
  state.committed = false;

  if (
    state.previousId != null &&
    now - state.transitionAtMs >= state.config.releaseSettleMs
  ) {
    state.previousId = null;
  }

  if (state.activeId != null) {
    if (directId === state.activeId || (directId == null && activeWithinExitRadius)) {
      clearCandidate(state);
      state.releasingId = null;
      state.releaseSinceMs = Number.NEGATIVE_INFINITY;
      state.releaseCommittedAtMs = Number.NEGATIVE_INFINITY;
      state.phase = "active";
      return state;
    }

    if (directId != null) {
      state.releasingId = null;
      state.releaseSinceMs = Number.NEGATIVE_INFINITY;
      setCandidate(state, directId, now);
      state.phase = "candidate";
      if (now - state.candidateSinceMs >= state.config.dwellMs) {
        commitActive(state, directId, now);
      }
      return state;
    }

    clearCandidate(state);
    beginRelease(state, now);
    if (now - state.releaseSinceMs >= state.config.graceMs) {
      commitRelease(state, now);
    }
    return state;
  }

  if (directId != null) {
    setCandidate(state, directId, now);
    state.phase = "candidate";
    if (now - state.candidateSinceMs >= state.config.dwellMs) {
      commitActive(state, directId, now);
    }
    return state;
  }

  clearCandidate(state);
  if (
    state.releasingId != null &&
    now - state.releaseCommittedAtMs < state.config.releaseSettleMs
  ) {
    state.phase = "releasing";
  } else {
    state.phase = "idle";
    state.releasingId = null;
    state.releaseSinceMs = Number.NEGATIVE_INFINITY;
    state.releaseCommittedAtMs = Number.NEGATIVE_INFINITY;
  }
  return state;
}

/**
 * Full screen-space hover step. Renderer and this function should receive the
 * same node snapshot so the visible location is exactly the interactive one.
 */
export function stepGraphHoverIntent(
  state,
  { nowMs, pointer = null, nodes = [] } = {},
) {
  const hit = findGraphNodeAtPoint(nodes, pointer, state.config);
  let activeWithinExitRadius = false;
  if (state.activeId != null) {
    let activeNode = null;
    for (const node of nodes) {
      if (nodeId(node) === state.activeId) {
        activeNode = node;
        break;
      }
    }
    activeWithinExitRadius = isPointWithinGraphNodeExitRadius(
      activeNode,
      pointer,
      state.config,
    );
  }
  return advanceGraphHoverIntent(state, {
    nowMs,
    hitId: hit?.id ?? null,
    activeWithinExitRadius,
  });
}

/** Immediately commits semantic release; visual fade still belongs to motion. */
export function clearGraphHoverIntent(state, nowMs = state.lastNowMs) {
  const now = resolveNow(state, nowMs);
  state.lastNowMs = now;
  state.changed = false;
  state.committed = false;
  clearCandidate(state);
  if (state.activeId != null) commitRelease(state, now);
  else {
    state.targetId = null;
    state.phase = "idle";
  }
  return state;
}
