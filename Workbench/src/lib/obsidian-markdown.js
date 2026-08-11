import {
  applyCjkStrongCompatibility,
  normalizeObsidianTarget,
  parseObsidianWikilink,
  visibleObsidianWikilinkLabel,
} from "../../shared/reader-text-contract.mjs";

const WIKILINK_PATTERN = /(!)?\[\[([^\]]+)\]\]/g;

function findResolvedLink(wikiLinks, target, heading) {
  const normalizedTarget = normalizeObsidianTarget(target);
  return (wikiLinks || []).find((link) => {
    const sameTarget =
      normalizeObsidianTarget(link.target) === normalizedTarget;
    const sameHeading = (link.heading || null) === (heading || null);
    return sameTarget && sameHeading;
  });
}

function visitTextNodes(node, wikiLinks) {
  if (!node?.children || !Array.isArray(node.children)) return;

  node.children = node.children.flatMap((child) => {
    if (child.type === "text" && child.value.includes("[[")) {
      const output = [];
      let cursor = 0;

      for (const match of child.value.matchAll(WIKILINK_PATTERN)) {
        if (match.index > cursor) {
          output.push({ type: "text", value: child.value.slice(cursor, match.index) });
        }

        const parsed = parseObsidianWikilink(match[2]);
        const knownLink = findResolvedLink(wikiLinks, parsed.target, parsed.heading);
        const label = visibleObsidianWikilinkLabel(parsed);
        const resolvedId = knownLink?.resolvedId || "";

        output.push({
          type: "link",
          url: "#",
          title: resolvedId
            ? `打开「${label}」`
            : parsed.target
              ? `尝试打开「${label}」`
              : `跳到「${label}」`,
          children: [{ type: "text", value: label }],
          data: {
            hProperties: {
              className: [
                "wikilink",
                match[1] ? "wikilink--embed" : "",
                !resolvedId && parsed.target ? "wikilink--unresolved" : "",
              ].filter(Boolean),
              "data-vault-link": "true",
              "data-vault-target": parsed.target,
              "data-vault-heading": parsed.heading || "",
              "data-vault-id": resolvedId,
              "data-vault-embed": match[1] ? "true" : "false",
            },
          },
        });
        cursor = match.index + match[0].length;
      }

      if (cursor < child.value.length) {
        output.push({ type: "text", value: child.value.slice(cursor) });
      }

      return output.length ? output : child;
    }

    if (!["code", "inlineCode", "html", "link", "definition"].includes(child.type)) {
      visitTextNodes(child, wikiLinks);
    }
    return child;
  });
}

/**
 * Turns Obsidian wikilinks into ordinary mdast links at render time. The Vault
 * markdown remains untouched; resolution metadata comes from /api/documents.
 */
export function remarkObsidianWikilinks(options = {}) {
  const wikiLinks = options.wikiLinks || [];
  return (tree) => visitTextNodes(tree, wikiLinks);
}

/**
 * Keeps Obsidian's CJK strong-emphasis behavior without changing source files.
 */
export function remarkObsidianCjkStrong() {
  return (tree, file) => applyCjkStrongCompatibility(tree, file.value);
}

export function headingId(value = "") {
  return String(value)
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s/]+/g, "-")
    .replace(/[^\p{Letter}\p{Number}_-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function vaultPathCandidates(currentPath = "", rawTarget = "") {
  const target = normalizeObsidianTarget(rawTarget);
  if (!target) return [];

  const topLevel = /^(10_raw|30_self_media|40_topics|50_scripts|wiki)\//.test(target);
  const base = topLevel ? target : `${currentPath.split("/").slice(0, -1).join("/")}/${target}`;
  const segments = [];

  for (const segment of base.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }

  const relativeCandidate = `${segments.join("/")}.md`;
  const rootCandidate = `${target}.md`;
  return [...new Set([relativeCandidate, rootCandidate])];
}
