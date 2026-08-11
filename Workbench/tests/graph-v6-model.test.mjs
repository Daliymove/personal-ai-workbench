import assert from "node:assert/strict";
import test from "node:test";

import { computeBaseLayout } from "../src/graph/graph-layout.js";
import {
  createGraphModel,
  neighborIdFor,
  primaryLinksFor,
} from "../src/graph/graph-model.js";

const nodes = [
  { id: "c", title: "C", type: "concept", degree: 1 },
  { id: "a", title: "A", type: "framework", degree: 3 },
  { id: "b", title: "B", type: "analysis", degree: 2 },
];

const edges = [
  { source: "a", target: "b", weight: 2 },
  { source: "b", target: "a", weight: 3 },
  { source: "a", target: "c", weight: 1 },
];

test("model aggregation is order independent and preserves direction", () => {
  const first = createGraphModel(nodes, edges);
  const second = createGraphModel([...nodes].reverse(), [...edges].reverse());
  assert.equal(first.fingerprint, second.fingerprint);
  assert.deepEqual(first.nodes.map((node) => node.id), ["a", "b", "c"]);
  assert.equal(first.links.length, 2);
  const reciprocal = first.links.find((link) => link.key.includes("a\u0000b"));
  assert.equal(reciprocal.weight, 5);
  assert.equal(reciprocal.forward, true);
  assert.equal(reciprocal.reverse, true);
});

test("primary relations are stable, ranked and bounded", () => {
  const model = createGraphModel(nodes, edges);
  const primary = primaryLinksFor(model, "a", 1);
  assert.equal(primary.length, 1);
  assert.equal(neighborIdFor(primary[0], "a"), "b");
});

test("base layout is deterministic across input ordering", () => {
  const first = computeBaseLayout(createGraphModel(nodes, edges));
  const second = computeBaseLayout(
    createGraphModel([...nodes].reverse(), [...edges].reverse()),
  );
  for (const node of first.nodes) {
    const comparison = second.nodeById.get(node.id);
    assert.ok(Math.abs(node.baseX - comparison.baseX) < 1e-9, `${node.id}:x`);
    assert.ok(Math.abs(node.baseY - comparison.baseY) < 1e-9, `${node.id}:y`);
  }
});

