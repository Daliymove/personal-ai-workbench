import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildVaultIndex } from "../server/vault-index.mjs";

test("public index skips hidden private workflow roots", async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "personal-dashboard-vault-"));
  t.after(() => fs.rm(vaultRoot, { recursive: true, force: true }));

  await Promise.all([
    fs.mkdir(path.join(vaultRoot, "wiki", "concepts"), { recursive: true }),
    fs.mkdir(path.join(vaultRoot, "Brainstorm", "session"), { recursive: true }),
    fs.mkdir(path.join(vaultRoot, "90_runs", "content_strategy"), { recursive: true }),
    fs.mkdir(path.join(vaultRoot, "30_self_media", "public-account"), { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(path.join(vaultRoot, "wiki", "concepts", "public.md"), "# Public\n"),
    fs.writeFile(path.join(vaultRoot, "Brainstorm", "session", "brainstorm.md"), "# Hidden\n"),
    fs.writeFile(path.join(vaultRoot, "90_runs", "content_strategy", "private.md"), "# Hidden\n"),
    fs.writeFile(path.join(vaultRoot, "30_self_media", "public-account", "private.md"), "# Hidden\n"),
  ]);

  const index = await buildVaultIndex(vaultRoot);
  assert.deepEqual(index.documents.map((document) => document.path), [
    "wiki/concepts/public.md",
  ]);
  assert.equal(index.stats.runs, 0);
  assert.equal(index.stats.brainstormSessions, 0);
});

test("demo mode only activates through the explicit marker", async (t) => {
  const vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "personal-dashboard-demo-"));
  t.after(() => fs.rm(vaultRoot, { recursive: true, force: true }));

  assert.equal((await buildVaultIndex(vaultRoot)).demoMode, false);
  await fs.writeFile(
    path.join(vaultRoot, ".workbench-demo.json"),
    JSON.stringify({ schemaVersion: 1, demoMode: true }),
  );
  assert.equal((await buildVaultIndex(vaultRoot)).demoMode, true);
});
