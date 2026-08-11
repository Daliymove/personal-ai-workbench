import {
  canonicalReaderBlockText,
  normalizeVisibleSelection,
  projectDomSelectionToCanonical,
  projectCanonicalBoundaryToDom,
  READER_BLOCK_ATTRIBUTE,
  READER_CANONICAL_TEXT_ATTRIBUTE,
} from "../../shared/reader-text-contract.mjs";

const CONTEXT_LENGTH = 36;

export function remarkReaderBlocks() {
  return (tree) => {
    if (!Array.isArray(tree?.children)) return;
    tree.children.forEach((child, index) => {
      child.data ||= {};
      child.data.hProperties ||= {};
      child.data.hProperties[READER_BLOCK_ATTRIBUTE] = String(index);
      child.data.hProperties[READER_CANONICAL_TEXT_ATTRIBUTE] =
        canonicalReaderBlockText(child);
      child.data.hProperties.id ||= `reader-block-${index}`;
    });
  };
}

function blockForNode(node, article) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const block = element?.closest?.(`[${READER_BLOCK_ATTRIBUTE}]`);
  return block && article?.contains(block) ? block : null;
}

function characterOffset(root, container, offset) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(container, offset);
  return range.toString().length;
}

function canonicalTextForBlock(block) {
  return block.getAttribute(READER_CANONICAL_TEXT_ATTRIBUTE) ?? block.textContent ?? "";
}

function projectBlockSelection(block, domStart, domEnd) {
  const domText = block.textContent || "";
  const canonicalText = canonicalTextForBlock(block);
  return projectDomSelectionToCanonical({
    domText,
    canonicalText,
    domStart,
    domEnd,
    quoteText: domText.slice(domStart, domEnd),
  });
}

export function normalizeQuoteSelectionBlockEdges({
  blocks,
  startOffset,
  endOffset,
}) {
  if (
    !Array.isArray(blocks) ||
    blocks.length === 0 ||
    !Number.isSafeInteger(startOffset) ||
    !Number.isSafeInteger(endOffset)
  ) {
    return null;
  }

  const selectedBlocks = blocks.map((entry) => ({
    ...entry,
    domText: String(entry?.domText ?? ""),
  }));
  let normalizedStart = startOffset;
  let normalizedEnd = endOffset;
  if (
    normalizedStart < 0 ||
    normalizedStart > selectedBlocks[0].domText.length ||
    normalizedEnd < 0 ||
    normalizedEnd > selectedBlocks.at(-1).domText.length
  ) {
    return null;
  }

  while (
    selectedBlocks.length > 1 &&
    normalizedStart === selectedBlocks[0].domText.length
  ) {
    selectedBlocks.shift();
    normalizedStart = 0;
  }
  while (selectedBlocks.length > 1 && normalizedEnd === 0) {
    selectedBlocks.pop();
    normalizedEnd = selectedBlocks.at(-1).domText.length;
  }

  return {
    blocks: selectedBlocks,
    startOffset: normalizedStart,
    endOffset: normalizedEnd,
  };
}

export function buildQuoteAnchorFromCanonicalBlocks({
  blockTexts,
  startBlock,
  endBlock,
  startOffset,
  endOffset,
}) {
  if (
    !Array.isArray(blockTexts) ||
    blockTexts.length !== endBlock - startBlock + 1 ||
    !Number.isSafeInteger(startOffset) ||
    !Number.isSafeInteger(endOffset)
  ) {
    return null;
  }
  const startText = String(blockTexts[0] ?? "");
  const endText = String(blockTexts.at(-1) ?? "");
  if (
    startOffset < 0 ||
    startOffset > startText.length ||
    endOffset < 0 ||
    endOffset > endText.length ||
    (startBlock === endBlock && endOffset < startOffset)
  ) {
    return null;
  }

  const selectedParts = blockTexts.map((value, index) => {
    const text = String(value ?? "");
    if (blockTexts.length === 1) return text.slice(startOffset, endOffset);
    if (index === 0) return text.slice(startOffset);
    if (index === blockTexts.length - 1) return text.slice(0, endOffset);
    return text;
  });
  const quoteText = selectedParts.join("\n").trim();
  if (!quoteText) return null;

  return {
    blockIndex: startBlock,
    startBlock,
    endBlock,
    startOffset,
    endOffset,
    prefix: startText.slice(
      Math.max(0, startOffset - CONTEXT_LENGTH),
      startOffset,
    ),
    suffix: endText.slice(endOffset, endOffset + CONTEXT_LENGTH),
    quoteText,
  };
}

export function quoteAnchorFromSelection(selection, article) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !article) {
    return { anchor: null, reason: "empty" };
  }

  const range = selection.getRangeAt(0);
  const initialStartBlock = blockForNode(range.startContainer, article);
  const initialEndBlock = blockForNode(range.endContainer, article);
  if (!initialStartBlock || !initialEndBlock) {
    return { anchor: null, reason: "outside" };
  }

  const initialStartBlockIndex = Number(
    initialStartBlock.getAttribute(READER_BLOCK_ATTRIBUTE),
  );
  const initialEndBlockIndex = Number(
    initialEndBlock.getAttribute(READER_BLOCK_ATTRIBUTE),
  );
  const rawQuote = selection.toString();
  const quoteText = rawQuote.trim();
  if (!quoteText) return { anchor: null, reason: "empty" };

  const blocks = [];
  for (
    let index = initialStartBlockIndex;
    index <= initialEndBlockIndex;
    index += 1
  ) {
    const block = article.querySelector(
      `[${READER_BLOCK_ATTRIBUTE}="${CSS.escape(String(index))}"]`,
    );
    if (!block) return { anchor: null, reason: "projection-mismatch" };
    blocks.push({
      block,
      blockIndex: index,
      domText: block.textContent || "",
    });
  }

  const rawStart = characterOffset(
    initialStartBlock,
    range.startContainer,
    range.startOffset,
  );
  const rawEnd = characterOffset(
    initialEndBlock,
    range.endContainer,
    range.endOffset,
  );
  const normalizedEdges = normalizeQuoteSelectionBlockEdges({
    blocks,
    startOffset: rawStart,
    endOffset: rawEnd,
  });
  if (!normalizedEdges) {
    return { anchor: null, reason: "projection-mismatch" };
  }

  const selectedBlocks = normalizedEdges.blocks;
  const startEntry = selectedBlocks[0];
  const endEntry = selectedBlocks.at(-1);
  const startBlock = startEntry.block;
  const endBlock = endEntry.block;
  const startBlockIndex = startEntry.blockIndex;
  const endBlockIndex = endEntry.blockIndex;
  const startDomText = startEntry.domText;
  const rawNormalizedStart = normalizedEdges.startOffset;
  const rawNormalizedEnd = normalizedEdges.endOffset;
  const startProjection = projectBlockSelection(
    startBlock,
    rawNormalizedStart,
    startBlockIndex === endBlockIndex
      ? rawNormalizedEnd
      : startDomText.length,
  );
  const endProjection = startBlockIndex === endBlockIndex
    ? startProjection
    : projectBlockSelection(endBlock, 0, rawNormalizedEnd);
  if (!startProjection.ok || !endProjection.ok) {
    return {
      anchor: null,
      reason: startProjection.reason === "ambiguous" || endProjection.reason === "ambiguous"
        ? "ambiguous"
        : "projection-mismatch",
    };
  }

  const anchor = buildQuoteAnchorFromCanonicalBlocks({
    blockTexts: selectedBlocks.map(({ block }) => canonicalTextForBlock(block)),
    startBlock: startBlockIndex,
    endBlock: endBlockIndex,
    startOffset: startProjection.startOffset,
    endOffset: endProjection.endOffset,
  });
  if (
    !anchor ||
    normalizeVisibleSelection(anchor.quoteText) !== normalizeVisibleSelection(quoteText)
  ) {
    return { anchor: null, reason: "projection-mismatch" };
  }

  return {
    reason: null,
    anchor,
  };
}

function candidateScore(text, start, anchor) {
  let score = 0;
  const end = start + String(anchor.quoteText || "").length;
  if (anchor.prefix && text.slice(Math.max(0, start - anchor.prefix.length), start) === anchor.prefix) {
    score += 4;
  }
  if (anchor.suffix && text.slice(end, end + anchor.suffix.length) === anchor.suffix) {
    score += 4;
  }
  if (Number.isFinite(Number(anchor.startOffset))) {
    score -= Math.min(3, Math.abs(start - Number(anchor.startOffset)) / 100);
  }
  return score;
}

export function locateQuoteInText(text = "", anchor = {}) {
  const quote = String(anchor.quoteText || "");
  if (!quote) return null;

  const expectedStart = Number(anchor.startOffset);
  const expectedEnd = Number(anchor.endOffset);
  if (
    Number.isFinite(expectedStart) &&
    Number.isFinite(expectedEnd) &&
    text.slice(expectedStart, expectedEnd) === quote
  ) {
    return { startOffset: expectedStart, endOffset: expectedEnd, exact: true };
  }

  const candidates = [];
  let cursor = text.indexOf(quote);
  while (cursor >= 0) {
    candidates.push({
      startOffset: cursor,
      endOffset: cursor + quote.length,
      score: candidateScore(text, cursor, anchor),
    });
    cursor = text.indexOf(quote, cursor + 1);
  }
  if (!candidates.length) return null;
  candidates.sort((left, right) => right.score - left.score);
  return { ...candidates[0], exact: false };
}

function domPointAtOffset(root, requestedOffset) {
  const offset = Math.max(0, Number(requestedOffset) || 0);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let node = walker.nextNode();
  let lastNode = null;

  while (node) {
    lastNode = node;
    const nextConsumed = consumed + node.nodeValue.length;
    if (offset <= nextConsumed) {
      return { node, offset: Math.max(0, offset - consumed) };
    }
    consumed = nextConsumed;
    node = walker.nextNode();
  }

  return lastNode
    ? { node: lastNode, offset: lastNode.nodeValue.length }
    : { node: root, offset: 0 };
}

export function rangeForQuoteAnchor(article, anchor) {
  if (!article || !anchor) return null;
  const startBlockIndex = anchor.startBlock ?? anchor.blockIndex;
  const endBlockIndex = anchor.endBlock ?? startBlockIndex;
  const startBlock = article.querySelector(
    `[${READER_BLOCK_ATTRIBUTE}="${CSS.escape(String(startBlockIndex))}"]`,
  );
  const endBlock = article.querySelector(
    `[${READER_BLOCK_ATTRIBUTE}="${CSS.escape(String(endBlockIndex))}"]`,
  );
  if (!startBlock || !endBlock) return null;

  let startOffset;
  let endOffset;
  let location;
  if (startBlockIndex === endBlockIndex) {
    location = locateQuoteInText(startBlock.textContent || "", anchor);
    if (!location) return null;
    startOffset = location.startOffset;
    endOffset = location.endOffset;
  } else {
    startOffset = projectCanonicalBoundaryToDom({
      domText: startBlock.textContent || "",
      canonicalText: canonicalTextForBlock(startBlock),
      canonicalOffset: anchor.startOffset,
    });
    endOffset = projectCanonicalBoundaryToDom({
      domText: endBlock.textContent || "",
      canonicalText: canonicalTextForBlock(endBlock),
      canonicalOffset: anchor.endOffset,
    });
    if (startOffset == null || endOffset == null) return null;
    location = { startOffset, endOffset, exact: true };
  }

  const start = domPointAtOffset(startBlock, startOffset);
  const end = domPointAtOffset(endBlock, endOffset);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  if (
    normalizeVisibleSelection(range.toString()) !==
    normalizeVisibleSelection(anchor.quoteText)
  ) {
    return null;
  }
  const blocks = [...article.querySelectorAll(`[${READER_BLOCK_ATTRIBUTE}]`)]
    .filter((block) => {
      const index = Number(block.getAttribute(READER_BLOCK_ATTRIBUTE));
      return index >= startBlockIndex && index <= endBlockIndex;
    });
  return { block: startBlock, blocks, range, location };
}

export async function sha256Text(value = "") {
  if (!globalThis.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(String(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
