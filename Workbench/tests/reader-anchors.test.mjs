import assert from "node:assert/strict";
import test from "node:test";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { readerMarkdownVisibleBlocks } from "../server/reader-explanations.mjs";
import {
  projectCanonicalBoundaryToDom,
  projectDomSelectionToCanonical,
} from "../shared/reader-text-contract.mjs";
import {
  buildQuoteAnchorFromCanonicalBlocks,
  locateQuoteInText,
  normalizeQuoteSelectionBlockEdges,
  remarkReaderBlocks,
} from "../src/lib/reader-anchors.js";
import {
  remarkObsidianCjkStrong,
  remarkObsidianWikilinks,
} from "../src/lib/obsidian-markdown.js";

test("reader Markdown blocks receive stable top-level indexes", () => {
  const tree = {
    children: [
      {
        type: "heading",
        children: [{ type: "text", value: "标题" }],
        data: { hProperties: { id: "existing" } },
      },
      {
        type: "paragraph",
        children: [{ type: "text", value: "正文" }],
      },
    ],
  };

  remarkReaderBlocks()(tree);

  assert.deepEqual(tree.children[0].data.hProperties, {
    id: "existing",
    "data-reader-block": "0",
    "data-reader-canonical-text": "标题",
  });
  assert.deepEqual(tree.children[1].data.hProperties, {
    id: "reader-block-1",
    "data-reader-block": "1",
    "data-reader-canonical-text": "正文",
  });
});

test("frontend and server expose the same canonical Markdown block text", () => {
  const markdown = [
    "- 普通列表",
    "- 含有 [[wiki/知识层|知识层]] 的列表",
    "",
    "> 引用里的 **强调内容**",
    "",
    "`[[代码中的链接保持原样]]`",
  ].join("\n");
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkObsidianCjkStrong)
    .use(remarkObsidianWikilinks)
    .use(remarkReaderBlocks);
  const tree = processor.runSync(processor.parse(markdown), { value: markdown });

  assert.deepEqual(
    tree.children.map(
      (node) => node.data.hProperties["data-reader-canonical-text"],
    ),
    readerMarkdownVisibleBlocks(markdown),
  );
  assert.equal(
    readerMarkdownVisibleBlocks(markdown).at(-1),
    "[[代码中的链接保持原样]]",
  );
});

test("frontend and server omit compatible CJK bold markers from anchor text", () => {
  const markdown = "第一项是：**管理者最关键的信息需求，是获得更多相关信息。**这是错误的。";
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkObsidianCjkStrong)
    .use(remarkObsidianWikilinks)
    .use(remarkReaderBlocks);
  const tree = processor.runSync(processor.parse(markdown), { value: markdown });
  const expected = "第一项是：管理者最关键的信息需求，是获得更多相关信息。这是错误的。";

  assert.equal(
    tree.children[0].data.hProperties["data-reader-canonical-text"],
    expected,
  );
  assert.deepEqual(readerMarkdownVisibleBlocks(markdown), [expected]);
});

test("React list whitespace projects the real 208 DOM offset to canonical 204", () => {
  const listItems = [
    "URL：https://support.google.com/gemininotebook/answer/16269187?hl=en",
    "读取状态：完整帮助页可靠读取。",
    "可核查事实：来源多时，系统按问题检索相关信息并据此形成回答；来源全集或用户选择的子集进入回答上下文；对话历史参与生成；用户笔记只有被明确选择时才参与；免费层当前为 100 个 notebook、每个最多 50 个来源。",
    "边界：官方只描述任务行为，没有公开底层是否纯向量、混合检索、重排或长上下文组合。",
  ];
  const markdown = listItems.map((item) => `- ${item}`).join("\n");
  const domText = `\n${listItems.join("\n")}\n`;
  const canonicalText = readerMarkdownVisibleBlocks(markdown)[0];
  const quoteText = "没有公开底层是否纯向量";
  const domStart = domText.indexOf(quoteText);
  const projected = projectDomSelectionToCanonical({
    domText,
    canonicalText,
    domStart,
    domEnd: domStart + quoteText.length,
    quoteText,
  });

  assert.equal(domStart, 208);
  assert.equal(canonicalText.indexOf(quoteText), 204);
  assert.deepEqual(projected, {
    ok: true,
    source: "whitespace-map",
    quoteText,
    startOffset: 204,
    endOffset: 215,
  });
});

test("projection falls back to a unique canonical quote across non-text DOM differences", () => {
  const quoteText = "后文唯一选段";
  const domText = "前文后文唯一选段";
  const canonicalText = "前文图片说明后文唯一选段";
  const domStart = domText.indexOf(quoteText);

  assert.deepEqual(
    projectDomSelectionToCanonical({
      domText,
      canonicalText,
      domStart,
      domEnd: domStart + quoteText.length,
      quoteText,
    }),
    {
      ok: true,
      source: "unique-quote",
      quoteText,
      startOffset: canonicalText.indexOf(quoteText),
      endOffset: canonicalText.indexOf(quoteText) + quoteText.length,
    },
  );
});

test("projection rejects ambiguous quotes instead of guessing an occurrence", () => {
  const quoteText = "重复选段";
  const domText = `图片前${quoteText}图片后${quoteText}`;
  const canonicalText = `图片说明前${quoteText}图片说明后${quoteText}`;
  const domStart = domText.indexOf(quoteText);

  assert.deepEqual(
    projectDomSelectionToCanonical({
      domText,
      canonicalText,
      domStart,
      domEnd: domStart + quoteText.length,
      quoteText,
    }),
    {
      ok: false,
      reason: "ambiguous",
    },
  );
});

test("projection preserves UTF-16 offsets while removing rendered whitespace", () => {
  const quoteText = "😀 选段";
  const domText = `\n${quoteText}\n`;
  const canonicalText = quoteText;
  const domStart = domText.indexOf(quoteText);

  assert.deepEqual(
    projectDomSelectionToCanonical({
      domText,
      canonicalText,
      domStart,
      domEnd: domStart + quoteText.length,
      quoteText,
    }),
    {
      ok: true,
      source: "whitespace-map",
      quoteText,
      startOffset: 0,
      endOffset: quoteText.length,
    },
  );
});

test("cross-block anchors preserve selected edge offsets and include middle blocks", () => {
  const blockTexts = [
    "第一段开头，选择从这里开始。",
    "这是完整选中的中间段。",
    "最后一段只选择到这里，后文不选。",
  ];
  const startOffset = blockTexts[0].indexOf("选择");
  const endOffset = blockTexts[2].indexOf("，后文");

  assert.deepEqual(
    buildQuoteAnchorFromCanonicalBlocks({
      blockTexts,
      startBlock: 4,
      endBlock: 6,
      startOffset,
      endOffset,
    }),
    {
      blockIndex: 4,
      startBlock: 4,
      endBlock: 6,
      startOffset,
      endOffset,
      prefix: "第一段开头，",
      suffix: "，后文不选。",
      quoteText: [
        blockTexts[0].slice(startOffset),
        blockTexts[1],
        blockTexts[2].slice(0, endOffset),
      ].join("\n"),
    },
  );
});

test("canonical cross-block boundaries map back through rendered whitespace", () => {
  assert.equal(
    projectCanonicalBoundaryToDom({
      domText: "\n第一项\n第二项\n",
      canonicalText: "第一项第二项",
      canonicalOffset: 3,
    }),
    5,
  );
});

test("a one-block selection ending at the next block start drops the empty edge", () => {
  assert.deepEqual(
    normalizeQuoteSelectionBlockEdges({
      blocks: [
        { blockIndex: 14, domText: "浏览器实际选中的一行。" },
        { blockIndex: 15, domText: "下一段没有被选中。" },
      ],
      startOffset: 0,
      endOffset: 0,
    }),
    {
      blocks: [
        { blockIndex: 14, domText: "浏览器实际选中的一行。" },
      ],
      startOffset: 0,
      endOffset: "浏览器实际选中的一行。".length,
    },
  );
});

test("a selection starting at the previous block end drops the empty leading edge", () => {
  assert.deepEqual(
    normalizeQuoteSelectionBlockEdges({
      blocks: [
        { blockIndex: 14, domText: "上一段没有被选中。" },
        { blockIndex: 15, domText: "当前选中的一行。" },
      ],
      startOffset: "上一段没有被选中。".length,
      endOffset: 5,
    }),
    {
      blocks: [
        { blockIndex: 15, domText: "当前选中的一行。" },
      ],
      startOffset: 0,
      endOffset: 5,
    },
  );
});

test("quote lookup prefers the frozen exact offset", () => {
  const text = "前文 raw 保存证据，wiki 沉淀知识。后文";
  const quoteText = "raw 保存证据，wiki 沉淀知识。";
  const startOffset = text.indexOf(quoteText);

  assert.deepEqual(
    locateQuoteInText(text, {
      quoteText,
      startOffset,
      endOffset: startOffset + quoteText.length,
    }),
    {
      startOffset,
      endOffset: startOffset + quoteText.length,
      exact: true,
    },
  );
});

test("quote lookup uses context when the same sentence appears more than once", () => {
  const text = "甲：保持证据。中段。乙：保持证据。结尾。";
  const quoteText = "保持证据。";
  const expectedStart = text.lastIndexOf(quoteText);
  const located = locateQuoteInText(text, {
    quoteText,
    startOffset: 0,
    endOffset: quoteText.length,
    prefix: "乙：",
    suffix: "结尾。",
  });

  assert.equal(located.startOffset, expectedStart);
  assert.equal(located.endOffset, expectedStart + quoteText.length);
  assert.equal(located.exact, false);
});

test("quote lookup reports a removed quote as unresolved", () => {
  assert.equal(
    locateQuoteInText("正文已经变化", {
      quoteText: "旧引用",
      startOffset: 0,
      endOffset: 3,
    }),
    null,
  );
});
