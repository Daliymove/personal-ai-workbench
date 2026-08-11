import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const WORKBENCH_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_ROOT = join(WORKBENCH_ROOT, "src");

function runtimeSourceFiles(directory = SRC_ROOT) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return runtimeSourceFiles(path);
    return [".js", ".jsx", ".mjs"].includes(extname(entry.name)) ? [path] : [];
  });
}

function runtimeSources() {
  return runtimeSourceFiles().map((path) => ({
    path,
    relativePath: relative(WORKBENCH_ROOT, path),
    source: readFileSync(path, "utf8"),
  }));
}

test("daily hot keeps the attention policy behind the screen", () => {
  const source = readFileSync(join(SRC_ROOT, "pages/DailyHotPage.jsx"), "utf8");
  const policyCopy = [
    "以看为主的外部信号雷达",
    "ATTENTION GATE",
    "如果今天不看这条",
    "只有多源确认",
    "不抢占首屏注意力",
    "最多三条",
    "暂时不要求你做出动作",
    "零条也是正常结果",
  ];

  for (const phrase of policyCopy) {
    assert.equal(source.includes(phrase), false, `DailyHotPage must not render policy copy: ${phrase}`);
  }

  assert.match(source, /aria-label="热点概览"/);
  assert.match(source, />多源热点</);
  assert.match(source, />今日必看</);
  assert.match(source, />24H 精选</);
  assert.match(source, /data\.fetchedAt/);
});

test("known product manifestos do not return to runtime UI", () => {
  const forbiddenVisiblePhrases = [
    "个人知识库与内容生产系统的只读工作台",
    "只作历史兼容，不代表待拍顺序",
    "仅在你二次确认后回写 Wiki",
    "40_topics 的兼容状态视图",
  ];

  for (const { relativePath, source } of runtimeSources()) {
    for (const phrase of forbiddenVisiblePhrases) {
      assert.equal(
        source.includes(phrase),
        false,
        `${relativePath} must not render product policy as user content: ${phrase}`,
      );
    }
  }
});

test("static descriptions do not expose implementation paths or policy vocabulary", () => {
  const internalVocabulary = /content_drafts|(?:^|\s)40_topics(?:\s|$)|不生成|不写入|不代表|只作历史兼容|仅在[^"\n]*确认|门禁|内部策略/;

  for (const { relativePath, source } of runtimeSources()) {
    for (const match of source.matchAll(/description="([^"]*)"/g)) {
      assert.doesNotMatch(
        match[1],
        internalVocabulary,
        `${relativePath} description leaks an implementation path or internal policy: ${match[1]}`,
      );
    }
  }
});
