import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";

import {
  VaultSyncError,
  affectedScopesForPaths,
  createVaultSyncService,
  normalizeVaultEventPath,
} from "../server/vault-sync.mjs";

const VAULT_ROOT = path.resolve("/tmp/workbench-vault-sync-fixture");

test("normalizes only stable paths inside the Vault", () => {
  assert.equal(
    normalizeVaultEventPath(VAULT_ROOT, path.join(VAULT_ROOT, "wiki", "index.md")),
    "wiki/index.md",
  );
  assert.equal(
    normalizeVaultEventPath(VAULT_ROOT, path.join(VAULT_ROOT, "10_raw", "article.md.part")),
    null,
  );
  assert.equal(
    normalizeVaultEventPath(VAULT_ROOT, path.join(VAULT_ROOT, "workbench", "src", "App.jsx")),
    null,
  );
  assert.equal(
    normalizeVaultEventPath(VAULT_ROOT, path.resolve(VAULT_ROOT, "..", "outside.md")),
    null,
  );
  assert.equal(normalizeVaultEventPath(VAULT_ROOT, VAULT_ROOT), null);
});

test("maps changed paths to the smallest relevant invalidation scopes", () => {
  assert.deepEqual(affectedScopesForPaths([]), ["runtime"]);
  assert.deepEqual(affectedScopesForPaths(["wiki/frameworks/example.md"]), [
    "graph",
    "overview",
    "recent",
    "runtime",
    "search",
    "wiki",
  ]);
  assert.deepEqual(
    affectedScopesForPaths([
      "10_raw/my-thoughts/reading-notes/.workbench-material-reading-state.json",
      "Brainstorm/20260727-example/brainstorm.md",
      "40_topics/ideas/example.md",
    ]),
    [
      "brainstorm",
      "content",
      "materials",
      "overview",
      "reading_queue",
      "recent",
      "runtime",
      "search",
      "topics",
    ],
  );
  assert.deepEqual(affectedScopesForPaths(["10_raw/douyin/snapshot.csv"]), [
    "douyin",
    "materials",
    "overview",
    "recent",
    "runtime",
    "search",
  ]);
  assert.deepEqual(
    affectedScopesForPaths(["10_raw/social-insights/example/report.md"]),
    [
      "materials",
      "overview",
      "recent",
      "runtime",
      "search",
      "social_insights",
    ],
  );
  assert.deepEqual(
    affectedScopesForPaths(["30_self_media/public-account/account-daily.csv"]),
    ["overview", "public_account", "recent", "runtime", "search"],
  );
  assert.deepEqual(
    affectedScopesForPaths(["50_scripts/public-account/review/article.md"]),
    ["content", "overview", "public_account", "recent", "runtime", "search"],
  );
});

test("coalesces filesystem changes and publishes one indexed snapshot", async (t) => {
  const buildCalls = [];
  const clearedTimers = [];
  const timers = [];
  const timestamps = [
    new Date("2026-07-27T01:00:00.000Z"),
    new Date("2026-07-27T01:00:01.000Z"),
    new Date("2026-07-27T01:00:02.000Z"),
    new Date("2026-07-27T01:00:03.000Z"),
  ];
  const service = createVaultSyncService({
    vaultRoot: VAULT_ROOT,
    buildIndex: async (root) => {
      buildCalls.push(root);
      return {
        generatedAt: `index-${buildCalls.length}`,
        documents: [],
      };
    },
    now: () => timestamps.shift() ?? new Date("2026-07-27T01:00:04.000Z"),
    setTimer: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => clearedTimers.push(timer),
  });
  t.after(() => service.close());
  const events = [];
  service.subscribe((event) => events.push(event));

  const initial = await service.currentIndex();
  assert.equal(initial.generatedAt, "index-1");
  assert.equal(service.getStatus().indexVersion, 1);

  assert.equal(
    service.queueChange("change", path.join(VAULT_ROOT, "wiki", "index.md")),
    true,
  );
  assert.equal(
    service.queueChange("add", path.join(VAULT_ROOT, "wiki", "index.md")),
    true,
  );
  assert.equal(
    service.queueChange("change", path.join(VAULT_ROOT, "10_raw", "article.md.tmp")),
    false,
  );
  assert.equal(service.queueChange("rename", path.join(VAULT_ROOT, "wiki", "other.md")), false);
  assert.equal(service.getStatus().pendingChangeCount, 1);
  assert.equal(timers.length, 2);
  assert.equal(clearedTimers.length, 1);

  const refreshed = await service.flushPending();
  assert.equal(refreshed.generatedAt, "index-2");
  assert.equal(buildCalls.length, 2);
  assert.equal(service.getStatus().pendingChangeCount, 0);
  assert.equal(service.getStatus().indexVersion, 2);
  const changed = events.filter((event) => event.type === "vault.index.changed").at(-1);
  assert.deepEqual(changed.changedPaths, ["wiki/index.md"]);
  assert.deepEqual(changed.eventTypes, ["add"]);
  assert.equal(changed.changeCount, 1);
  assert.ok(changed.affectedScopes.includes("graph"));
});

test("keeps the last good index and reports degraded state after a refresh failure", async (t) => {
  let calls = 0;
  const service = createVaultSyncService({
    vaultRoot: VAULT_ROOT,
    buildIndex: async () => {
      calls += 1;
      if (calls === 1) return { generatedAt: "good", documents: [] };
      const error = new Error("parse failed");
      error.code = "PARSE_FAILED";
      throw error;
    },
  });
  t.after(() => service.close());
  const events = [];
  service.subscribe((event) => events.push(event));

  const current = await service.currentIndex();
  await assert.rejects(service.refresh({ reason: "manual" }), /parse failed/);

  assert.equal(await service.currentIndex(), current);
  assert.equal(service.getStatus().status, "degraded");
  assert.deepEqual(service.getStatus().lastError, {
    code: "PARSE_FAILED",
    message: "parse failed",
  });
  assert.equal(events.at(-1).type, "vault.index.failed");
});

test("attaches and detaches a watcher and refuses work after close", async () => {
  const service = createVaultSyncService({
    vaultRoot: VAULT_ROOT,
    buildIndex: async () => ({ generatedAt: "ready", documents: [] }),
  });
  await service.currentIndex();

  const watcher = new EventEmitter();
  const added = [];
  const unwatched = [];
  watcher.add = (value) => added.push(value);
  watcher.unwatch = (value) => unwatched.push(value);
  service.attachWatcher(watcher);
  assert.deepEqual(added, [VAULT_ROOT]);
  assert.equal(service.getStatus().status, "watching");

  watcher.emit("all", "change", path.join(VAULT_ROOT, "Brainstorm", "session", "brainstorm.md"));
  assert.equal(service.getStatus().pendingChangeCount, 1);
  await service.close();

  assert.deepEqual(unwatched, [VAULT_ROOT]);
  assert.equal(service.getStatus().status, "stopped");
  assert.equal(service.queueChange("change", path.join(VAULT_ROOT, "wiki", "index.md")), false);
  await assert.rejects(
    service.refresh(),
    (error) => error instanceof VaultSyncError && error.code === "SERVICE_CLOSED",
  );
});
