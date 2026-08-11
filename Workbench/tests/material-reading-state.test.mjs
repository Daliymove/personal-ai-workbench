import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MATERIAL_READING_STATE_PATH,
  MaterialReadingStateError,
  createMaterialReadingStateRepository,
} from "../server/material-reading-state.mjs";

async function makeVault(t) {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "workbench-material-state-"));
  await mkdir(path.join(vaultRoot, "10_raw", "articles"), { recursive: true });
  t.after(() => rm(vaultRoot, { recursive: true, force: true }));
  return vaultRoot;
}

function material(overrides = {}) {
  return {
    id: "material-1",
    path: "10_raw/articles/one.md",
    contentHash: "hash-1",
    contentFingerprint: "fingerprint-1",
    ...overrides,
  };
}

test("persists, requeues, lists, and removes material reading state", async (t) => {
  const vaultRoot = await makeVault(t);
  const times = [
    new Date("2026-07-27T01:00:00.000Z"),
    new Date("2026-07-27T02:00:00.000Z"),
    new Date("2026-07-27T03:00:00.000Z"),
  ];
  const repository = createMaterialReadingStateRepository({
    vaultRoot,
    now: () => times.shift(),
  });

  assert.deepEqual(await repository.list(), { version: 1, updatedAt: null, items: [] });
  const created = await repository.add(material());
  assert.equal(created.status, "queued");
  assert.equal(created.queuedAt, "2026-07-27T01:00:00.000Z");
  assert.equal(created.updatedAt, "2026-07-27T01:00:00.000Z");

  const requeued = await repository.add(material({ contentHash: "hash-2" }));
  assert.equal(requeued.queuedAt, created.queuedAt);
  assert.equal(requeued.updatedAt, "2026-07-27T02:00:00.000Z");
  assert.equal(requeued.contentHash, "hash-2");
  const listed = await repository.list();
  assert.equal(listed.items.length, 1);
  assert.equal(listed.updatedAt, "2026-07-27T02:00:00.000Z");

  const storePath = path.join(vaultRoot, MATERIAL_READING_STATE_PATH);
  const persisted = JSON.parse(await readFile(storePath, "utf8"));
  assert.equal(persisted.version, 1);
  assert.equal(persisted.items[0].relativePath, "10_raw/articles/one.md");
  const fileNames = await readdir(path.dirname(storePath));
  assert.equal(fileNames.some((name) => name.endsWith(".tmp")), false);

  assert.equal(await repository.remove({ relativePath: material().path }), true);
  assert.equal(await repository.remove({ documentId: material().id }), false);
  assert.deepEqual((await repository.list()).items, []);
});

test("serializes concurrent additions without losing either material", async (t) => {
  const vaultRoot = await makeVault(t);
  let tick = 0;
  const repository = createMaterialReadingStateRepository({
    vaultRoot,
    now: () => new Date(Date.UTC(2026, 6, 27, 4, 0, tick++)),
  });

  await Promise.all([
    repository.add(material()),
    repository.add(material({ id: "material-2", path: "10_raw/articles/two.md" })),
  ]);

  const listed = await repository.list();
  assert.equal(listed.items.length, 2);
  assert.deepEqual(
    new Set(listed.items.map((item) => item.documentId)),
    new Set(["material-1", "material-2"]),
  );
});

test("rejects paths outside 10_raw and malformed removal requests", async (t) => {
  const vaultRoot = await makeVault(t);
  const repository = createMaterialReadingStateRepository({ vaultRoot });

  for (const invalidPath of [
    "wiki/index.md",
    "10_raw/../wiki/index.md",
    "10_raw\\articles\\one.md",
    "/10_raw/articles/one.md",
    "10_raw//articles/one.md",
  ]) {
    await assert.rejects(
      repository.add(material({ path: invalidPath })),
      (error) =>
        error instanceof MaterialReadingStateError &&
        error.code === "INVALID_MATERIAL_PATH",
    );
  }
  await assert.rejects(
    repository.remove(),
    (error) =>
      error instanceof MaterialReadingStateError &&
      error.code === "INVALID_MATERIAL_DOCUMENT",
  );
});

test("rejects corrupt stores and duplicate persisted records", async (t) => {
  const vaultRoot = await makeVault(t);
  const storePath = path.join(vaultRoot, MATERIAL_READING_STATE_PATH);
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, "not json", "utf8");
  const repository = createMaterialReadingStateRepository({ vaultRoot });
  await assert.rejects(
    repository.list(),
    (error) =>
      error instanceof MaterialReadingStateError &&
      error.code === "MATERIAL_READING_STATE_CORRUPT",
  );

  await writeFile(
    storePath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-27T01:00:00.000Z",
      items: [
        {
          documentId: "duplicate",
          relativePath: "10_raw/articles/one.md",
          queuedAt: "2026-07-27T01:00:00.000Z",
          updatedAt: "2026-07-27T01:00:00.000Z",
        },
        {
          documentId: "duplicate",
          relativePath: "10_raw/articles/two.md",
          queuedAt: "2026-07-27T01:00:00.000Z",
          updatedAt: "2026-07-27T01:00:00.000Z",
        },
      ],
    }),
    "utf8",
  );
  await assert.rejects(
    repository.list(),
    (error) =>
      error instanceof MaterialReadingStateError &&
      error.code === "MATERIAL_READING_STATE_CORRUPT",
  );
});

test("rejects a reading-state directory that escapes the Vault through a symlink", async (t) => {
  const vaultRoot = await makeVault(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), "workbench-material-state-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const storageParent = path.join(vaultRoot, "10_raw", "my-thoughts");
  await mkdir(storageParent, { recursive: true });
  await symlink(outside, path.join(storageParent, "reading-notes"));
  const repository = createMaterialReadingStateRepository({ vaultRoot });

  await assert.rejects(
    repository.add(material()),
    (error) =>
      error instanceof MaterialReadingStateError &&
      error.code === "UNSAFE_MATERIAL_READING_STATE_DIRECTORY",
  );
  assert.deepEqual(await readdir(outside), []);
});
