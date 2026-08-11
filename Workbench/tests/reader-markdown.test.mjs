import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  remarkObsidianCjkStrong,
  remarkObsidianWikilinks,
} from "../src/lib/obsidian-markdown.js";
import { remarkReaderBlocks } from "../src/lib/reader-anchors.js";
import { readerRehypePlugins } from "../src/lib/reader-markdown.js";

test("reader renders safe Obsidian HTML without exposing executable tags", () => {
  const source = [
    '正文[^1]<sup><span title="页码／位置：163">：163</span></sup>。',
    "",
    "[^1]: 参考资料",
    "",
    "<script>alert('unsafe')</script>",
  ].join("\n");
  const html = renderToStaticMarkup(
    React.createElement(
      ReactMarkdown,
      {
        remarkPlugins: [
          remarkGfm,
          remarkObsidianCjkStrong,
          [remarkObsidianWikilinks, { wikiLinks: [] }],
          remarkReaderBlocks,
        ],
        rehypePlugins: readerRehypePlugins,
      },
      source,
    ),
  );

  assert.match(html, /<sup><span title="页码／位置：163">：163<\/span><\/sup>/);
  assert.doesNotMatch(html, /&lt;sup&gt;|<script|unsafe/);
  assert.match(html, /data-reader-block="0"/);
  assert.match(html, /data-reader-canonical-text="正文1：163。"/);
  assert.match(html, /href="#user-content-fn-1"/);
  assert.match(html, /id="user-content-fn-1"/);
});

test("reader renders Obsidian CJK bold before continuous Chinese text", () => {
  const source = "第一项是：**管理者最关键的信息需求，是获得更多相关信息。**这是错误的。";
  const html = renderToStaticMarkup(
    React.createElement(
      ReactMarkdown,
      {
        remarkPlugins: [
          remarkGfm,
          remarkObsidianCjkStrong,
          [remarkObsidianWikilinks, { wikiLinks: [] }],
          remarkReaderBlocks,
        ],
        rehypePlugins: readerRehypePlugins,
      },
      source,
    ),
  );

  assert.match(
    html,
    /第一项是：<strong>管理者最关键的信息需求，是获得更多相关信息。<\/strong>这是错误的。/,
  );
  assert.doesNotMatch(html, /\*\*/);
  assert.match(
    html,
    /data-reader-canonical-text="第一项是：管理者最关键的信息需求，是获得更多相关信息。这是错误的。"/,
  );
});

test("CJK bold remains compatible when a later part of the paragraph contains escapes", () => {
  const source = "第二项错误假设是：**只要把管理者想要的信息给他们，他们就会表现得更好。**优秀管理者会解释 \\(E=mc^2\\)。";
  const html = renderToStaticMarkup(
    React.createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm, remarkObsidianCjkStrong],
        rehypePlugins: readerRehypePlugins,
      },
      source,
    ),
  );

  assert.match(
    html,
    /第二项错误假设是：<strong>只要把管理者想要的信息给他们，他们就会表现得更好。<\/strong>优秀管理者/,
  );
  assert.doesNotMatch(html, /\*\*/);
});

test("CJK bold compatibility does not reinterpret escaped markers or inline code", () => {
  const source = [
    "\\**不要加粗。**这是字面星号。",
    "",
    "`**代码。**这是`",
    "",
    "English **bold.**word remains literal.",
  ].join("\n");
  const html = renderToStaticMarkup(
    React.createElement(
      ReactMarkdown,
      {
        remarkPlugins: [remarkGfm, remarkObsidianCjkStrong],
        rehypePlugins: readerRehypePlugins,
      },
      source,
    ),
  );

  assert.match(html, /<p>\*\*不要加粗。\*\*这是字面星号。<\/p>/);
  assert.match(html, /<code>\*\*代码。\*\*这是<\/code>/);
  assert.match(html, /English \*\*bold\.\*\*word remains literal\./);
  assert.doesNotMatch(html, /<strong>/);
});
