import assert from "node:assert/strict";
import test from "node:test";

import {
  createAmbientProfile,
  createGraphMotionState,
  getLinkMotion,
  getNodeMotion,
  sampleAmbientOffset,
  setGraphHoverTarget,
  setGraphReducedMotion,
  setGraphSelectionTarget,
  stepGraphMotion,
} from "../src/graph/graph-motion.js";
import {
  advanceGraphHoverIntent,
  createGraphHoverIntentState,
  findGraphNodeAtPoint,
  stepGraphHoverIntent,
} from "../src/graph/graph-hit-test.js";

function runFor(state, frequency, durationMs, options) {
  const frames = Math.round((frequency * durationMs) / 1000);
  const delta = durationMs / frames;
  for (let frame = 0; frame < frames; frame += 1) {
    stepGraphMotion(state, delta, options);
  }
  return state;
}

function node(id, x, y, radius = 5) {
  return { id, screenX: x, screenY: y, radius };
}

test("ambient paths are deterministic, bounded and independent from hover", () => {
  const profile = createAmbientProfile({ id: "steady-node", degree: 8 });
  assert.deepEqual(profile, createAmbientProfile({ id: "steady-node", degree: 8 }));
  const first = sampleAmbientOffset(profile, 45678);
  const second = sampleAmbientOffset(profile, 45678);
  assert.deepEqual(first, second);
  assert.ok(Math.abs(first.x) <= profile.amplitudeX);
  assert.ok(Math.abs(first.y) <= profile.amplitudeY);

  const idle = createGraphMotionState([{ id: "steady-node", degree: 8 }]);
  const hovered = createGraphMotionState([{ id: "steady-node", degree: 8 }]);
  setGraphHoverTarget(hovered, { id: "steady-node" });
  runFor(idle, 60, 1000);
  runFor(hovered, 60, 1000);
  assert.equal(getNodeMotion(idle, "steady-node").offsetX, getNodeMotion(hovered, "steady-node").offsetX);
  assert.equal(getNodeMotion(idle, "steady-node").offsetY, getNodeMotion(hovered, "steady-node").offsetY);
  assert.ok(getNodeMotion(hovered, "steady-node").hoverWeight > 0.99);
});

test("hover requires dwell, retains the larger exit radius and observes grace", () => {
  const intent = createGraphHoverIntentState();
  const nodes = [node("a", 0, 0)];

  stepGraphHoverIntent(intent, { nowMs: 0, pointer: { x: 5, y: 0 }, nodes });
  assert.equal(intent.phase, "candidate");
  assert.equal(intent.targetId, null);
  stepGraphHoverIntent(intent, { nowMs: 89, pointer: { x: 5, y: 0 }, nodes });
  assert.equal(intent.targetId, null);
  stepGraphHoverIntent(intent, { nowMs: 90, pointer: { x: 5, y: 0 }, nodes });
  assert.equal(intent.phase, "active");
  assert.equal(intent.targetId, "a");

  // Entry radius is 11px, but the committed exit radius is 23px.
  stepGraphHoverIntent(intent, { nowMs: 140, pointer: { x: 20, y: 0 }, nodes });
  assert.equal(intent.phase, "active");
  assert.equal(intent.targetId, "a");
  stepGraphHoverIntent(intent, { nowMs: 150, pointer: { x: 24, y: 0 }, nodes });
  assert.equal(intent.phase, "releasing");
  assert.equal(intent.targetId, "a");
  stepGraphHoverIntent(intent, { nowMs: 329, pointer: { x: 24, y: 0 }, nodes });
  assert.equal(intent.targetId, "a");
  stepGraphHoverIntent(intent, { nowMs: 330, pointer: { x: 24, y: 0 }, nodes });
  assert.equal(intent.targetId, null);
  assert.equal(intent.previousId, "a");
});

test("edge re-entry cancels release without an enter/leave flap", () => {
  const intent = createGraphHoverIntentState({ dwellMs: 0 });
  advanceGraphHoverIntent(intent, { nowMs: 0, hitId: "a" });
  assert.equal(intent.targetId, "a");
  advanceGraphHoverIntent(intent, { nowMs: 10, hitId: null, activeWithinExitRadius: false });
  assert.equal(intent.phase, "releasing");
  assert.equal(intent.targetId, "a");
  advanceGraphHoverIntent(intent, { nowMs: 170, hitId: null, activeWithinExitRadius: true });
  assert.equal(intent.phase, "active");
  assert.equal(intent.targetId, "a");
  assert.equal(intent.revision, 1);
});

test("adjacent hover commits previous to next without a blank visual frame", () => {
  const intent = createGraphHoverIntentState();
  advanceGraphHoverIntent(intent, { nowMs: 0, hitId: "a" });
  advanceGraphHoverIntent(intent, { nowMs: 90, hitId: "a" });
  const motion = createGraphMotionState(["a", "b"]);
  setGraphHoverTarget(motion, { id: intent.targetId });
  runFor(motion, 60, 300);
  const oldBeforeSwitch = getNodeMotion(motion, "a").hoverWeight;

  advanceGraphHoverIntent(intent, { nowMs: 100, hitId: "b" });
  assert.equal(intent.phase, "candidate");
  assert.equal(intent.targetId, "a");
  advanceGraphHoverIntent(intent, { nowMs: 190, hitId: "b" });
  assert.equal(intent.previousId, "a");
  assert.equal(intent.targetId, "b");
  setGraphHoverTarget(motion, { id: intent.targetId });
  stepGraphMotion(motion, 1000 / 60);

  const oldAfterSwitch = getNodeMotion(motion, "a").hoverWeight;
  const nextAfterSwitch = getNodeMotion(motion, "b").hoverWeight;
  assert.ok(oldAfterSwitch > 0);
  assert.ok(oldAfterSwitch < oldBeforeSwitch);
  assert.ok(nextAfterSwitch > 0);
  assert.ok(oldAfterSwitch + nextAfterSwitch > 0.9);
});

test("selection and relation weights remain interruptible on rapid reselection", () => {
  const motion = createGraphMotionState(["a", "b", "c"], {
    linkIds: ["ab", "bc"],
  });
  setGraphSelectionTarget(motion, {
    id: "a",
    neighborIds: ["b"],
    linkIds: ["ab"],
  });
  runFor(motion, 60, 180);
  const oldNodeBefore = getNodeMotion(motion, "a").selectionWeight;
  const oldLinkBefore = getLinkMotion(motion, "ab").selectionWeight;

  setGraphSelectionTarget(motion, {
    id: "c",
    neighborIds: ["b"],
    linkIds: ["bc"],
  });
  stepGraphMotion(motion, 1000 / 60);
  assert.equal(motion.selection.previousId, "a");
  assert.ok(getNodeMotion(motion, "a").selectionWeight < oldNodeBefore);
  assert.ok(getNodeMotion(motion, "a").selectionWeight > 0);
  assert.ok(getNodeMotion(motion, "c").selectionWeight > 0);
  assert.ok(getLinkMotion(motion, "ab").selectionWeight < oldLinkBefore);
  assert.ok(getLinkMotion(motion, "ab").selectionWeight > 0);
  assert.ok(getLinkMotion(motion, "bc").selectionWeight > 0);
});

test("runtime reduced motion settles channels and removes ambient drift", () => {
  const motion = createGraphMotionState(["a", "b"], { linkIds: ["ab"] });
  setGraphHoverTarget(motion, { id: "a", linkIds: ["ab"] });
  setGraphSelectionTarget(motion, { id: "b", neighborIds: ["a"], linkIds: ["ab"] });
  stepGraphMotion(motion, 16);
  assert.ok(getNodeMotion(motion, "a").hoverWeight > 0);
  assert.notEqual(getNodeMotion(motion, "a").offsetX, 0);

  setGraphReducedMotion(motion, true);
  assert.equal(getNodeMotion(motion, "a").hoverWeight, 1);
  assert.equal(getNodeMotion(motion, "a").offsetX, 0);
  assert.equal(getNodeMotion(motion, "b").selectionWeight, 1);
  assert.equal(getLinkMotion(motion, "ab").emphasis, 1);

  setGraphReducedMotion(motion, false);
  assert.equal(motion.ambientWeight, 0);
  stepGraphMotion(motion, 16);
  assert.ok(motion.ambientWeight > 0);
  assert.ok(motion.ambientWeight < 1);
});

test("30, 60 and 120Hz converge to the same elapsed-time snapshot", () => {
  const make = () => {
    const state = createGraphMotionState(
      [{ id: "a", degree: 3 }, { id: "b", degree: 10 }],
      { linkIds: ["ab"] },
    );
    setGraphHoverTarget(state, { id: "a", linkIds: ["ab"] });
    setGraphSelectionTarget(state, { id: "b", neighborIds: ["a"], linkIds: ["ab"] });
    return state;
  };
  const states = [30, 60, 120].map((frequency) => runFor(make(), frequency, 1000));
  const samples = states.map((state) => ({
    hover: getNodeMotion(state, "a").hoverWeight,
    tooltip: getNodeMotion(state, "a").tooltipWeight,
    selected: getNodeMotion(state, "b").selectionWeight,
    link: getLinkMotion(state, "ab").emphasis,
    x: getNodeMotion(state, "a").offsetX,
    y: getNodeMotion(state, "a").offsetY,
  }));

  for (const key of Object.keys(samples[0])) {
    assert.ok(Math.abs(samples[0][key] - samples[1][key]) < 1e-9, key);
    assert.ok(Math.abs(samples[1][key] - samples[2][key]) < 1e-9, key);
  }
});

test("a long resume delta is clamped instead of catching up offscreen time", () => {
  const motion = createGraphMotionState(["a"]);
  stepGraphMotion(motion, 5000);
  assert.equal(motion.elapsedMs, motion.config.maxDeltaMs);
});

test("hit testing picks the nearest visible screen-space node", () => {
  const hit = findGraphNodeAtPoint([
    node("far", 5, 0),
    node("near", 2, 0),
    { ...node("hidden", 0, 0), visible: false },
  ], { x: 0, y: 0 });
  assert.equal(hit.id, "near");
});
