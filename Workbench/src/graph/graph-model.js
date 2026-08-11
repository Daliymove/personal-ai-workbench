import { nodeLabelPriority } from "../lib/graph.js";

export function stableGraphHash(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function edgeId(value) {
  return typeof value === "object" ? value?.id : value;
}

/**
 * Builds the immutable relationship model used by the scene engine. D3 is
 * allowed to mutate the cloned nodes later, but never the API payload.
 */
export function createGraphModel(inputNodes, inputEdges) {
  const nodes = [...inputNodes]
    .sort((a, b) => String(a.id).localeCompare(String(b.id), "zh-CN"))
    .map((node, index) => ({
      ...node,
      index,
      baseX: 0,
      baseY: 0,
      manualX: 0,
      manualY: 0,
    }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const adjacency = new Map(nodes.map((node) => [node.id, new Set()]));
  const incidentLinks = new Map(nodes.map((node) => [node.id, []]));
  const pairs = new Map();

  for (const edge of inputEdges) {
    const sourceId = edgeId(edge.source);
    const targetId = edgeId(edge.target);
    if (!sourceId || !targetId || sourceId === targetId) continue;
    if (!nodeById.has(sourceId) || !nodeById.has(targetId)) continue;

    adjacency.get(sourceId).add(targetId);
    adjacency.get(targetId).add(sourceId);

    const [firstId, secondId] = sourceId < targetId
      ? [sourceId, targetId]
      : [targetId, sourceId];
    const key = `${firstId}\u0000${secondId}`;
    const link = pairs.get(key) ?? {
      key,
      source: nodeById.get(firstId),
      target: nodeById.get(secondId),
      weight: 0,
      forward: false,
      reverse: false,
      curve: ((stableGraphHash(key) % 200) / 200 - 0.5) * 8,
    };
    link.weight += Math.max(1, Number(edge.weight) || 1);
    if (sourceId === firstId) link.forward = true;
    else link.reverse = true;
    pairs.set(key, link);
  }

  const links = [...pairs.values()].sort((a, b) => a.key.localeCompare(b.key));
  for (const link of links) {
    incidentLinks.get(link.source.id).push(link);
    incidentLinks.get(link.target.id).push(link);
  }
  for (const [id, nodeLinks] of incidentLinks) {
    nodeLinks.sort((a, b) => {
      const neighborA = neighborIdFor(a, id);
      const neighborB = neighborIdFor(b, id);
      const degreeA = Number(nodeById.get(neighborA)?.degree) || 0;
      const degreeB = Number(nodeById.get(neighborB)?.degree) || 0;
      return b.weight - a.weight || degreeB - degreeA || a.key.localeCompare(b.key);
    });
  }

  const labelOrder = [...nodes].sort(
    (a, b) => nodeLabelPriority(b) - nodeLabelPriority(a) || a.index - b.index,
  );
  const fingerprint = [
    ...nodes.map((node) => node.id),
    ...links.map((link) => `${link.key}:${link.weight}`),
  ].join("|");

  return {
    adjacency,
    fingerprint: stableGraphHash(fingerprint).toString(36),
    incidentLinks,
    labelOrder,
    links,
    nodeById,
    nodes,
  };
}

export function neighborIdFor(link, focusId) {
  return link.source.id === focusId ? link.target.id : link.source.id;
}

export function primaryLinksFor(model, focusId, limit = 6) {
  if (!focusId) return [];
  return (model.incidentLinks.get(focusId) ?? []).slice(0, Math.max(0, limit));
}
