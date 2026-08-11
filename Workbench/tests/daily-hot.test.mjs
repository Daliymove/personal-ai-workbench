import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyDailyHot,
  createDailyHotLoader,
} from "../shared/ai-hot.mjs";

function hotItem({ id, title, sourceCount = 4, story = null }) {
  return {
    id,
    title,
    source: { name: "测试来源" },
    sourceCount,
    signalCount: 2,
    sourceNames: ["来源 A", "来源 B"],
    latestAt: "2026-08-02T01:00:00.000Z",
    links: {
      aihot: `https://aihot.virxact.com/items/${id}`,
      original: `https://example.com/${id}`,
      ...(story ? { story: `https://aihot.virxact.com/story/${story}` } : {}),
    },
  };
}

function selectedItem({ id, title }) {
  return {
    id,
    title,
    summary: `${title}的摘要`,
    source: { name: "测试精选来源" },
    links: {
      aihot: `https://aihot.virxact.com/items/${id}`,
      original: `https://example.com/${id}`,
    },
    publishedAt: "2026-08-02T00:30:00.000Z",
    discoveredAt: "2026-08-02T00:40:00.000Z",
    category: "ai-products",
    score: 72,
    selected: true,
  };
}

test("uses an explainable attention gate and removes story-level duplicates", () => {
  const tiers = classifyDailyHot({
    hotTopics: [
      {
        item: hotItem({
          id: "agent-hot",
          title: "Agent 工具调用能力升级",
          story: "agent-story",
        }),
        story: {
          story: {
            publicId: "agent-story",
            title: "Agent 工具调用能力升级",
            status: "active",
            digest: "多家来源正在验证新的 Agent 工具调用能力。",
            firstReportAt: "2026-08-01T23:00:00.000Z",
            latestAt: "2026-08-02T01:00:00.000Z",
            reports: [{ id: "agent-report" }],
            links: { aihot: "https://aihot.virxact.com/story/agent-story" },
          },
        },
      },
      {
        item: hotItem({ id: "funding-hot", title: "某 AI 公司完成新一轮融资" }),
        story: null,
      },
    ],
    selectedItems: [
      selectedItem({ id: "agent-report", title: "同一 Agent 事件的另一篇报道" }),
      selectedItem({ id: "product-selected", title: "一款新产品上线" }),
    ],
    dailyReport: {
      generatedAt: "2026-08-02T00:00:00.000Z",
      sections: [
        {
          label: "产品",
          items: [
            selectedItem({ id: "product-selected", title: "一款新产品上线" }),
            selectedItem({ id: "daily-only", title: "日报中的普通动态" }),
          ],
        },
      ],
    },
  });

  assert.deepEqual(tiers.mustRead.map((item) => item.id), ["agent-hot"]);
  assert.equal(tiers.mustRead[0].attention.domains[0].id, "agent-work");
  assert.equal(tiers.mustRead[0].evidence.label, "4 个独立信源");
  assert.equal(
    [...tiers.mustRead, ...tiers.browse, ...tiers.other].some(
      (item) => item.id === "agent-report",
    ),
    false,
  );
  assert.ok(tiers.browse.some((item) => item.id === "funding-hot"));
  assert.ok(tiers.browse.some((item) => item.id === "product-selected"));
  assert.deepEqual(tiers.other.map((item) => item.id), ["daily-only"]);
});

test("caches a successful read and exposes stale data when a later refresh fails", async () => {
  let currentTime = Date.parse("2026-08-02T02:00:00.000Z");
  let fail = false;
  let calls = 0;

  const responseFor = (pathname) => {
    if (pathname === "/api/v1/hot-topics") {
      return { schemaVersion: 1, count: 1, items: [hotItem({
        id: "agent-hot",
        title: "Agent 工作流能力升级",
      })] };
    }
    if (pathname === "/api/v1/items") {
      return { schemaVersion: 1, items: [], page: { hasMore: false } };
    }
    if (pathname === "/api/v1/dailies/latest") {
      return {
        schemaVersion: 1,
        report: {
          date: "2026-08-02",
          generatedAt: "2026-08-02T00:00:00.000Z",
          links: { aihot: "https://aihot.virxact.com/daily/2026-08-02" },
          sections: [],
        },
      };
    }
    throw new Error(`unexpected path ${pathname}`);
  };

  const loader = createDailyHotLoader({
    now: () => currentTime,
    cacheTtlMs: 1_000,
    requestTimeoutMs: 1_000,
    fetchImpl: async (url) => {
      calls += 1;
      if (fail) throw new Error("offline");
      const parsed = new URL(url);
      return new Response(JSON.stringify(responseFor(parsed.pathname)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const first = await loader();
  const cached = await loader();
  assert.equal(first.status, "live");
  assert.equal(cached.fetchedAt, first.fetchedAt);
  assert.equal(calls, 3);

  currentTime += 2_000;
  fail = true;
  const stale = await loader();
  assert.equal(stale.status, "stale");
  assert.equal(stale.fetchedAt, first.fetchedAt);
  assert.match(stale.error.message, /offline/);
});

