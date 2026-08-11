import { toString as mdastToString } from "mdast-util-to-string";

export const READER_BLOCK_ATTRIBUTE = "data-reader-block";
export const READER_CANONICAL_TEXT_ATTRIBUTE = "data-reader-canonical-text";

const WHITESPACE = /\s/u;
const PUNCTUATION = /\p{P}/u;
const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function sourceTextForNode(source, node) {
  const start = node?.position?.start?.offset;
  const end = node?.position?.end?.offset;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null;
  return String(source ?? "").slice(start, end);
}

function cjkStrongTextNodes(node, source) {
  if (!node?.children || !Array.isArray(node.children)) return;

  node.children = node.children.flatMap((child) => {
    if (
      child.type === "text" &&
      child.value.includes("**")
    ) {
      const rawSource = sourceTextForNode(source, child);
      const output = [];
      let cursor = 0;
      let opener = child.value.indexOf("**");

      while (opener >= 0) {
        let closer = child.value.indexOf("**", opener + 2);
        while (closer >= 0) {
          const content = child.value.slice(opener + 2, closer);
          const previous = content.at(-1) || "";
          const next = child.value.slice(closer + 2).match(/^./u)?.[0] || "";
          if (
            content &&
            !WHITESPACE.test(content[0]) &&
            PUNCTUATION.test(previous) &&
            CJK_CHARACTER.test(next) &&
            rawSource?.slice(0, closer + 2) === child.value.slice(0, closer + 2)
          ) {
            if (opener > cursor) {
              output.push({ type: "text", value: child.value.slice(cursor, opener) });
            }
            output.push({
              type: "strong",
              children: [{ type: "text", value: content }],
            });
            cursor = closer + 2;
            opener = child.value.indexOf("**", cursor);
            break;
          }
          closer = child.value.indexOf("**", closer + 2);
        }
        if (closer < 0) break;
      }

      if (output.length) {
        if (cursor < child.value.length) {
          output.push({ type: "text", value: child.value.slice(cursor) });
        }
        return output;
      }
    }

    if (!["code", "inlineCode", "html", "definition"].includes(child.type)) {
      cjkStrongTextNodes(child, source);
    }
    return child;
  });
}

/**
 * Obsidian accepts bold text whose closing marker follows CJK punctuation and
 * is immediately followed by another CJK character. CommonMark treats that
 * marker as intraword punctuation and leaves the literal ** visible. Repair
 * only that narrow render-time case, and skip escaped source text.
 */
export function applyCjkStrongCompatibility(tree, source) {
  cjkStrongTextNodes(tree, source);
  return tree;
}

export function normalizeObsidianTarget(value = "") {
  return String(value)
    .trim()
    .replace(/\\+$/g, "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.md$/i, "");
}

export function parseObsidianWikilink(value = "") {
  const divider = value.indexOf("|");
  const destination = (divider >= 0 ? value.slice(0, divider) : value).trim();
  const alias = divider >= 0 ? value.slice(divider + 1).trim() : null;
  const headingIndex = destination.indexOf("#");

  return {
    target: normalizeObsidianTarget(
      headingIndex >= 0 ? destination.slice(0, headingIndex) : destination,
    ),
    heading:
      headingIndex >= 0 ? destination.slice(headingIndex + 1).trim() || null : null,
    alias: alias || null,
  };
}

export function visibleObsidianWikilinkLabel(value) {
  const parsed = typeof value === "string" ? parseObsidianWikilink(value) : value;
  if (parsed.alias) return parsed.alias;
  if (!parsed.target && parsed.heading) return parsed.heading;
  const basename =
    parsed.target.split("/").filter(Boolean).at(-1) || parsed.target;
  return parsed.heading ? `${basename} › ${parsed.heading}` : basename;
}

export function canonicalReaderBlockText(node) {
  function visibleNode(current) {
    if (!current || typeof current !== "object") return current;
    if (current.type === "html") {
      return {
        type: "text",
        value: String(current.value ?? "")
          .replace(/<!--[\s\S]*?-->/g, "")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]*>/g, ""),
      };
    }
    if (current.type === "footnoteReference") {
      return {
        type: "text",
        value: String(current.label || current.identifier || ""),
      };
    }
    if (current.type === "image" || current.type === "imageReference") {
      return { type: "text", value: "" };
    }
    if (!Array.isArray(current.children)) return current;
    return {
      ...current,
      children: current.children.map(visibleNode),
    };
  }

  return mdastToString(visibleNode(node));
}

export function normalizeVisibleSelection(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim();
}

function compactProjection(value) {
  const text = String(value ?? "");
  let compact = "";
  const offsets = [];

  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.codePointAt(index);
    const character = String.fromCodePoint(codePoint);
    if (!WHITESPACE.test(character)) {
      compact += character;
      for (let unit = 0; unit < character.length; unit += 1) {
        offsets.push(index + unit);
      }
    }
    index += character.length - 1;
  }

  return { compact, offsets };
}

function lowerBound(values, target) {
  let start = 0;
  let end = values.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (values[middle] < target) start = middle + 1;
    else end = middle;
  }
  return start;
}

export function projectCanonicalBoundaryToDom({
  domText,
  canonicalText,
  canonicalOffset,
}) {
  const rendered = String(domText ?? "");
  const canonical = String(canonicalText ?? "");
  if (
    !Number.isSafeInteger(canonicalOffset) ||
    canonicalOffset < 0 ||
    canonicalOffset > canonical.length
  ) {
    return null;
  }
  if (rendered === canonical) return canonicalOffset;

  const renderedProjection = compactProjection(rendered);
  const canonicalProjection = compactProjection(canonical);
  if (renderedProjection.compact !== canonicalProjection.compact) return null;

  const compactBoundary = lowerBound(
    canonicalProjection.offsets,
    canonicalOffset,
  );
  if (compactBoundary <= 0) return 0;
  if (compactBoundary >= renderedProjection.offsets.length) return rendered.length;
  return renderedProjection.offsets[compactBoundary];
}

function occurrences(text, query) {
  const output = [];
  if (!query) return output;
  let cursor = text.indexOf(query);
  while (cursor >= 0) {
    output.push(cursor);
    cursor = text.indexOf(query, cursor + 1);
  }
  return output;
}

function projectedResult(canonicalText, startOffset, endOffset, source) {
  const quoteText = canonicalText.slice(startOffset, endOffset).trim();
  if (!quoteText) return { ok: false, reason: "empty" };
  const leading = canonicalText
    .slice(startOffset, endOffset)
    .length - canonicalText.slice(startOffset, endOffset).trimStart().length;
  const trailing = canonicalText
    .slice(startOffset, endOffset)
    .length - canonicalText.slice(startOffset, endOffset).trimEnd().length;
  return {
    ok: true,
    source,
    quoteText,
    startOffset: startOffset + leading,
    endOffset: Math.max(startOffset + leading, endOffset - trailing),
  };
}

/**
 * Project a DOM Range coordinate into the canonical Markdown block text used
 * by the server. React renderers may inject whitespace between list items,
 * table cells, or wrapper elements; raw DOM offsets therefore cannot be used
 * as server-side Markdown offsets.
 */
export function projectDomSelectionToCanonical({
  domText,
  canonicalText,
  domStart,
  domEnd,
  quoteText,
}) {
  const rendered = String(domText ?? "");
  const canonical = String(canonicalText ?? "");
  const quote = String(quoteText ?? "").trim();
  if (
    !quote ||
    !Number.isSafeInteger(domStart) ||
    !Number.isSafeInteger(domEnd) ||
    domStart < 0 ||
    domEnd < domStart ||
    domEnd > rendered.length
  ) {
    return { ok: false, reason: "invalid" };
  }

  const direct = canonical.slice(domStart, domEnd);
  if (
    rendered === canonical &&
    domEnd <= canonical.length &&
    normalizeVisibleSelection(direct) === normalizeVisibleSelection(quote)
  ) {
    return projectedResult(canonical, domStart, domEnd, "direct");
  }

  const renderedProjection = compactProjection(rendered);
  const canonicalProjection = compactProjection(canonical);
  if (renderedProjection.compact === canonicalProjection.compact) {
    const compactStart = lowerBound(renderedProjection.offsets, domStart);
    const compactEnd = lowerBound(renderedProjection.offsets, domEnd);
    if (
      compactStart < compactEnd &&
      compactEnd <= canonicalProjection.offsets.length
    ) {
      const startOffset = canonicalProjection.offsets[compactStart];
      const endOffset = canonicalProjection.offsets[compactEnd - 1] + 1;
      const result = projectedResult(
        canonical,
        startOffset,
        endOffset,
        "whitespace-map",
      );
      if (
        result.ok &&
        normalizeVisibleSelection(result.quoteText) ===
          normalizeVisibleSelection(quote)
      ) {
        return result;
      }
    }
  }

  const exactMatches = occurrences(canonical, quote);
  if (exactMatches.length === 1) {
    return projectedResult(
      canonical,
      exactMatches[0],
      exactMatches[0] + quote.length,
      "unique-quote",
    );
  }
  if (exactMatches.length > 1) {
    return { ok: false, reason: "ambiguous" };
  }

  const compactQuote = compactProjection(quote).compact;
  const compactMatches = occurrences(canonicalProjection.compact, compactQuote);
  if (compactMatches.length === 1 && compactQuote) {
    const compactStart = compactMatches[0];
    const compactEnd = compactStart + compactQuote.length;
    return projectedResult(
      canonical,
      canonicalProjection.offsets[compactStart],
      canonicalProjection.offsets[compactEnd - 1] + 1,
      "unique-compact-quote",
    );
  }
  return {
    ok: false,
    reason: compactMatches.length > 1 ? "ambiguous" : "not-found",
  };
}
