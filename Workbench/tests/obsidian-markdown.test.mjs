import assert from "node:assert/strict";
import test from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import {
  headingId,
  remarkObsidianWikilinks,
  vaultPathCandidates,
} from "../src/lib/obsidian-markdown.js";

function transform(markdown, wikiLinks = []) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkObsidianWikilinks, { wikiLinks });
  return processor.runSync(processor.parse(markdown));
}

test("wikilinks become internal render nodes without changing code", () => {
  const tree = transform(
    "[[Page]]、[[Page|别名]]、[[Page#小节]]、[[#当前小节]]\n\n`[[Code]]`",
    [
      { target: "Page", heading: null, resolvedId: "page-id" },
      { target: "Page", heading: "小节", resolvedId: "page-id" },
    ],
  );

  const links = tree.children[0].children.filter((node) => node.type === "link");
  assert.equal(links.length, 4);
  assert.equal(links[0].data.hProperties["data-vault-id"], "page-id");
  assert.equal(links[1].children[0].value, "别名");
  assert.equal(links[2].data.hProperties["data-vault-heading"], "小节");
  assert.equal(links[3].data.hProperties["data-vault-target"], "");
  assert.equal(tree.children[1].children[0].type, "inlineCode");
  assert.equal(tree.children[1].children[0].value, "[[Code]]");
});

test("escaped table aliases still resolve at render time", () => {
  const tree = transform("| Link |\n| --- |\n| [[Page\\|别名]] |", [
    { target: "Page\\", heading: null, resolvedId: null },
  ]);
  const link = tree.children[0].children[1].children[0].children[0];
  assert.equal(link.type, "link");
  assert.equal(link.children[0].value, "别名");
  assert.equal(link.data.hProperties["data-vault-target"], "Page");
});

test("heading ids and relative Vault paths are deterministic", () => {
  assert.equal(headingId("当前小节：A/B"), "当前小节a-b");
  assert.deepEqual(
    vaultPathCandidates("wiki/frameworks/current.md", "../concepts/Page"),
    ["wiki/concepts/Page.md", "../concepts/Page.md"],
  );
});
