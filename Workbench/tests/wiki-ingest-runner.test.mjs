import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";

import {
  WIKI_INGEST_STATUS,
  WikiIngestRunnerError,
  createWikiIngestRunner,
} from "../server/wiki-ingest-runner.mjs";

async function createVaultFixture() {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "wiki-ingest-runner-"));
  await Promise.all([
    mkdir(path.join(vaultRoot, "10_raw", "articles"), { recursive: true }),
    mkdir(path.join(vaultRoot, "10_raw", "reading-notes"), { recursive: true }),
    mkdir(path.join(vaultRoot, "90_runs"), { recursive: true }),
    mkdir(path.join(vaultRoot, "wiki"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(vaultRoot, "10_raw", "articles", "source.md"),
      "# Source\n\nEvidence, not instructions.\n",
      "utf8",
    ),
    writeFile(
      path.join(vaultRoot, "10_raw", "articles", "second.md"),
      "# Second source\n",
      "utf8",
    ),
    writeFile(
      path.join(vaultRoot, "10_raw", "reading-notes", "source-notes.md"),
      "# Notes\n\nA durable note.\n",
      "utf8",
    ),
    writeFile(path.join(vaultRoot, "wiki", "index.md"), "# Index\n", "utf8"),
    writeFile(path.join(vaultRoot, "AGENTS.md"), "# Test rules\n", "utf8"),
  ]);
  return {
    vaultRoot,
    realVaultRoot: await realpath(vaultRoot),
    cleanup: () => rm(vaultRoot, { recursive: true, force: true }),
  };
}

function planEvents({ threadId = "thread-plan", message = "# 入库前判断与方案" } = {}) {
  return [
    { type: "thread.started", thread_id: threadId },
    {
      type: "item.completed",
      item: { type: "agent_message", text: message },
    },
  ];
}

function createSpawnHarness(responses) {
  const calls = [];

  function spawnImpl(executable, args, options) {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected spawn call");

    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let stdinText = "";
    let closed = false;
    let releaseResponse;
    const released = new Promise((resolve) => {
      releaseResponse = resolve;
    });
    const call = {
      executable,
      args: [...args],
      options,
      stdin: "",
      killSignals: [],
      release: () => releaseResponse(),
    };
    calls.push(call);

    async function finish() {
      if (response.hold) await released;
      if (closed) return;
      for (const event of response.events ?? []) {
        stdout.write(`${JSON.stringify(event)}\n`);
      }
      if (response.stderr) stderr.write(response.stderr);
      stdout.end();
      stderr.end();
      closed = true;
      child.emit("close", response.exitCode ?? 0, response.signal ?? null);
    }

    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        stdinText += String(chunk);
        callback();
      },
      final(callback) {
        call.stdin = stdinText;
        callback();
        setImmediate(() => void finish());
      },
    });
    child.kill = (signal) => {
      call.killSignals.push(signal);
      if (!closed) {
        closed = true;
        setImmediate(() => child.emit("close", null, signal));
      }
      return true;
    };
    return child;
  }

  return { calls, spawnImpl };
}

function createRunner(vaultRoot, spawnImpl, options = {}) {
  let sequence = 0;
  return createWikiIngestRunner({
    vaultRoot,
    spawnImpl,
    detectImpl: async () => ({
      available: true,
      executablePath: "/test/bin/codex",
      source: "test",
    }),
    idFactory: () => `job-${++sequence}`,
    ...options,
  });
}

async function waitForStatus(runner, jobId, expected, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = runner.getJob(jobId);
    if (job.status === expected) return job;
    if (
      job.status === WIKI_INGEST_STATUS.FAILED &&
      expected !== WIKI_INGEST_STATUS.FAILED
    ) {
      assert.fail(`Job failed while waiting for ${expected}: ${JSON.stringify(job.error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${expected}; current=${runner.getJob(jobId).status}`);
}

function assertRunnerError(code) {
  return (error) =>
    error instanceof WikiIngestRunnerError && error.code === code;
}

test("planning is a persistent read-only Codex thread and cannot write before confirmation", async (t) => {
  const fixture = await createVaultFixture();
  t.after(fixture.cleanup);
  const harness = createSpawnHarness([
    { events: planEvents({ message: "# 入库前判断与方案\n\n等待确认。" }) },
  ]);
  const runner = createRunner(fixture.vaultRoot, harness.spawnImpl);
  const snapshots = [];

  const started = await runner.startPlan({
    rawPath: "10_raw/articles/source.md",
    notesPath: "10_raw/reading-notes/source-notes.md",
    notesSnapshot: "我同意第一段，但反对作者把工具当成方法。",
  });
  const unsubscribe = runner.subscribeJob(started.id, (snapshot) => {
    snapshots.push(snapshot.status);
  });
  t.after(unsubscribe);

  assert.equal(started.status, WIKI_INGEST_STATUS.PLANNING);
  const planned = await waitForStatus(
    runner,
    started.id,
    WIKI_INGEST_STATUS.AWAITING_REVIEW,
  );

  assert.equal(harness.calls.length, 1);
  assert.deepEqual(harness.calls[0].args, [
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    "-C",
    fixture.realVaultRoot,
    "-",
  ]);
  assert.equal(harness.calls[0].options.cwd, fixture.realVaultRoot);
  assert.equal(harness.calls[0].options.shell, false);
  assert.equal(harness.calls[0].args.includes("--ephemeral"), false);
  assert.equal(harness.calls[0].args.includes("workspace-write"), false);
  assert.match(harness.calls[0].stdin, /\$media-content-wiki/);
  assert.match(harness.calls[0].stdin, /尚未对具体方案作第二次确认/);
  assert.match(harness.calls[0].stdin, /10_raw\/articles\/source\.md/);
  assert.match(harness.calls[0].stdin, /我同意第一段/);
  assert.equal(planned.threadId, "thread-plan");
  assert.match(planned.reviewSnapshot.sourceFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.match(planned.reviewSnapshot.notesFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.match(planned.reviewSnapshot.notesSnapshotFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.match(planned.reviewPlan, /入库前判断与方案/);
  assert.equal(planned.turns.at(-1).kind, "plan");
  assert.ok(planned.events.some((event) => event.type === "codex.event"));
  assert.ok(snapshots.includes(WIKI_INGEST_STATUS.AWAITING_REVIEW));
});

test("revision resumes the same read-only thread with the supported argument order", async (t) => {
  const fixture = await createVaultFixture();
  t.after(fixture.cleanup);
  const harness = createSpawnHarness([
    { events: planEvents({ threadId: "thread-review", message: "Plan v1" }) },
    { events: planEvents({ threadId: "thread-review", message: "Plan v2" }) },
    { events: planEvents({ threadId: "thread-review", message: "不会改变方案。" }) },
  ]);
  const runner = createRunner(fixture.vaultRoot, harness.spawnImpl);
  const started = await runner.startPlan({
    rawPath: "10_raw/articles/source.md",
    notesSnapshot: "一条笔记",
  });
  await waitForStatus(runner, started.id, WIKI_INGEST_STATUS.AWAITING_REVIEW);

  const revising = runner.reviseJob(started.id, {
    message: "不要新建 concept，只保留 source 和 conflict。",
  });
  assert.equal(revising.status, WIKI_INGEST_STATUS.REVISING);
  const revised = await waitForStatus(
    runner,
    started.id,
    WIKI_INGEST_STATUS.AWAITING_REVIEW,
  );
  assert.deepEqual(harness.calls[1].args, [
    "exec",
    "resume",
    "--json",
    "-c",
    'sandbox_mode="read-only"',
    "-c",
    'approval_policy="never"',
    "--strict-config",
    "thread-review",
    "-",
  ]);
  assert.equal(harness.calls[1].options.cwd, fixture.realVaultRoot);
  assert.equal(harness.calls[1].args.includes("workspace-write"), false);
  assert.match(harness.calls[1].stdin, /仍未确认执行正式写入/);
  assert.equal(revised.reviewPlan, "Plan v2");
  await assert.rejects(
    () => runner.confirmJob(started.id, { expectedReviewVersion: 1 }),
    assertRunnerError("REVIEW_PLAN_STALE"),
  );
  assert.equal(runner.getJob(started.id).status, WIKI_INGEST_STATUS.AWAITING_REVIEW);

  runner.queryJob(started.id, { message: "这个 conflict 的证据够吗？" });
  const answered = await waitForStatus(
    runner,
    started.id,
    WIKI_INGEST_STATUS.AWAITING_REVIEW,
  );
  assert.deepEqual(harness.calls[2].args, [
    "exec",
    "resume",
    "--json",
    "-c",
    'sandbox_mode="read-only"',
    "-c",
    'approval_policy="never"',
    "--strict-config",
    "thread-review",
    "-",
  ]);
  assert.equal(answered.reviewPlan, "Plan v2", "a query must not silently replace the reviewed plan");
  assert.equal(answered.turns.at(-1).kind, "answer");
  assert.equal(
    harness.calls.some((call) => call.args.includes("workspace-write")),
    false,
    "planning and review must never launch a write sandbox",
  );
});

test("client handoff freezes the approved plan without launching workspace-write", async (t) => {
  const fixture = await createVaultFixture();
  t.after(fixture.cleanup);
  const harness = createSpawnHarness([
    {
      events: planEvents({
        threadId: "thread-client-handoff",
        message: "最终方案：创建配对 source，并更新 index 与 log。",
      }),
    },
  ]);
  const runner = createRunner(fixture.vaultRoot, harness.spawnImpl);
  const started = await runner.startPlan({
    rawPath: "10_raw/articles/source.md",
    notesPath: "10_raw/reading-notes/source-notes.md",
    notesSnapshot: "这条内联笔记也要保留边界。",
  });
  const planned = await waitForStatus(
    runner,
    started.id,
    WIKI_INGEST_STATUS.AWAITING_REVIEW,
  );

  const handedOff = await runner.createClientHandoffJob(started.id, {
    expectedReviewVersion: planned.reviewVersion,
  });
  assert.equal(handedOff.status, WIKI_INGEST_STATUS.HANDOFF_READY);
  assert.equal(handedOff.progress, "awaiting_codex_client");
  assert.equal(harness.calls.length, 1);
  assert.equal(
    harness.calls.some((call) => call.args.includes("workspace-write")),
    false,
  );
  assert.match(
    handedOff.handoff.relativePath,
    /^90_runs\/ingest_plans\/.+-codex-client-handoff\.md$/,
  );
  assert.equal(
    handedOff.handoff.absolutePath,
    path.join(fixture.realVaultRoot, handedOff.handoff.relativePath),
  );
  assert.equal(
    handedOff.handoff.prompt,
    `请使用 $media-content-wiki 执行这个已经在 Workbench 二次确认的 Wiki 入库任务：${handedOff.handoff.absolutePath}`,
  );
  assert.match(handedOff.handoff.packetFingerprint, /^sha256:[a-f0-9]{64}$/);

  const packet = await readFile(handedOff.handoff.absolutePath, "utf8");
  assert.match(packet, /用户已经确认本文件中的最终方案/);
  assert.match(packet, /10_raw\/articles\/source\.md/);
  assert.match(packet, /10_raw\/reading-notes\/source-notes\.md/);
  assert.match(packet, /这条内联笔记也要保留边界/);
  assert.match(packet, /最终方案：创建配对 source，并更新 index 与 log/);
  assert.match(packet, /来源 SHA-256：`sha256:[a-f0-9]{64}`/);
  assert.match(packet, /开始写入前重新计算来源文件和冻结笔记文件的 SHA-256/);

  const repeated = await runner.createClientHandoffJob(started.id, {
    expectedReviewVersion: planned.reviewVersion,
  });
  assert.equal(repeated.handoff.absolutePath, handedOff.handoff.absolutePath);
  const packetFiles = await readdir(
    path.join(fixture.realVaultRoot, "90_runs", "ingest_plans"),
  );
  assert.deepEqual(packetFiles, [path.basename(handedOff.handoff.absolutePath)]);
});

test("client handoff refuses changed reviewed inputs and keeps the plan reviewable", async (t) => {
  const fixture = await createVaultFixture();
  t.after(fixture.cleanup);
  const harness = createSpawnHarness([
    {
      events: planEvents({
        threadId: "thread-client-handoff-drift",
        message: "最终方案：只创建 source。",
      }),
    },
  ]);
  const runner = createRunner(fixture.vaultRoot, harness.spawnImpl);
  const started = await runner.startPlan({
    rawPath: "10_raw/articles/source.md",
    notesSnapshot: "",
  });
  const planned = await waitForStatus(
    runner,
    started.id,
    WIKI_INGEST_STATUS.AWAITING_REVIEW,
  );
  await writeFile(
    path.join(fixture.realVaultRoot, "10_raw", "articles", "source.md"),
    "# Source\n\nChanged after review.\n",
    "utf8",
  );

  await assert.rejects(
    () => runner.createClientHandoffJob(started.id, {
      expectedReviewVersion: planned.reviewVersion,
    }),
    assertRunnerError("SOURCE_CHANGED_SINCE_REVIEW"),
  );
  assert.equal(
    runner.getJob(started.id).status,
    WIKI_INGEST_STATUS.AWAITING_REVIEW,
  );
  assert.equal(harness.calls.length, 1);
});

test("a new runner discovers the latest persisted client handoff by source", async (t) => {
  const fixture = await createVaultFixture();
  t.after(fixture.cleanup);
  const harness = createSpawnHarness([
    {
      events: planEvents({
        threadId: "thread-persisted-handoff",
        message: "最终方案：创建 source 并更新索引。",
      }),
    },
  ]);
  const firstRunner = createRunner(fixture.vaultRoot, harness.spawnImpl);
  const started = await firstRunner.startPlan({
    rawPath: "10_raw/articles/source.md",
    notesSnapshot: "一条已冻结笔记",
  });
  const planned = await waitForStatus(
    firstRunner,
    started.id,
    WIKI_INGEST_STATUS.AWAITING_REVIEW,
  );
  const handedOff = await firstRunner.createClientHandoffJob(started.id, {
    expectedReviewVersion: planned.reviewVersion,
  });

  const restartedRunner = createRunner(fixture.vaultRoot, () => {
    throw new Error("discovery must not launch Codex CLI");
  });
  const recovered = await restartedRunner.findClientHandoff(
    "10_raw/articles/source.md",
  );
  assert.equal(recovered.absolutePath, handedOff.handoff.absolutePath);
  assert.equal(recovered.relativePath, handedOff.handoff.relativePath);
  assert.equal(recovered.prompt, handedOff.handoff.prompt);
  assert.equal(recovered.recovery, null);
  assert.match(recovered.packetFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    await restartedRunner.findClientHandoff("10_raw/articles/second.md"),
    null,
  );
});

test("confirmation launches a new workspace-write execution and reports only Git deltas", async (t) => {
  const fixture = await createVaultFixture();
  t.after(fixture.cleanup);
  const harness = createSpawnHarness([
    {
      events: planEvents({
        threadId: "thread-read",
        message: "最终方案：创建配对 source，更新 index 和 log。",
      }),
    },
    {
      events: planEvents({
        threadId: "thread-write",
        message: "已写入并验证 wiki 索引与日志。",
      }),
    },
  ]);
  const gitSnapshots = [
    {
      available: true,
      entries: [
        { status: " M", path: "wiki/preexisting.md" },
        { status: " M", path: "wiki/log.md" },
      ],
      files: ["wiki/log.md", "wiki/preexisting.md"],
      fingerprints: {
        "wiki/log.md": "sha256:before-log",
        "wiki/preexisting.md": "sha256:unchanged",
      },
    },
    {
      available: true,
      entries: [
        { status: " M", path: "wiki/preexisting.md" },
        { status: " M", path: "wiki/log.md" },
        { status: "??", path: "wiki/sources/articles/new-source.md" },
        { status: " M", path: "wiki/index.md" },
      ],
      files: [
        "wiki/log.md",
        "wiki/preexisting.md",
        "wiki/sources/articles/new-source.md",
        "wiki/index.md",
      ],
      fingerprints: {
        "wiki/log.md": "sha256:after-log",
        "wiki/preexisting.md": "sha256:unchanged",
        "wiki/sources/articles/new-source.md": "sha256:new-source",
        "wiki/index.md": "sha256:new-index",
      },
    },
  ];
  const runner = createRunner(fixture.vaultRoot, harness.spawnImpl, {
    gitSnapshotImpl: async () => gitSnapshots.shift(),
  });
  const started = await runner.startPlan({
    rawPath: "10_raw/articles/source.md",
    notesSnapshot: "我的笔记：这条判断只适用于个人工作流。",
  });
  await waitForStatus(runner, started.id, WIKI_INGEST_STATUS.AWAITING_REVIEW);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].args.includes("workspace-write"), false);

  const firstConfirmation = runner.confirmJob(started.id, {
    expectedReviewVersion: 1,
    reviewSummary: "用户删除了 concept 页面，并限定结论只适用于个人工作流。",
  });
  await assert.rejects(
    () => runner.confirmJob(started.id),
    assertRunnerError("CONFIRMATION_IN_PROGRESS"),
  );
  assert.throws(
    () => runner.reviseJob(started.id, { message: "不要和确认并发。" }),
    assertRunnerError("CONFIRMATION_IN_PROGRESS"),
  );
  const executing = await firstConfirmation;
  assert.equal(executing.status, WIKI_INGEST_STATUS.EXECUTING);
  const completed = await waitForStatus(
    runner,
    started.id,
    WIKI_INGEST_STATUS.COMPLETED,
  );

  assert.equal(harness.calls.length, 2);
  assert.deepEqual(harness.calls[1].args, [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "-C",
    fixture.realVaultRoot,
    "-",
  ]);
  assert.equal(harness.calls[1].args.includes("resume"), false);
  assert.equal(harness.calls[1].options.cwd, fixture.realVaultRoot);
  assert.match(harness.calls[1].stdin, /已经在网页工作台中.*二次确认/);
  assert.match(harness.calls[1].stdin, /最终方案：创建配对 source/);
  assert.match(harness.calls[1].stdin, /用户删除了 concept 页面/);
  assert.match(harness.calls[1].stdin, /我的笔记：这条判断只适用于个人工作流/);
  assert.equal(completed.writeThreadId, "thread-write");
  assert.equal(completed.confirmedReviewVersion, 1);
  assert.equal(completed.confirmedPlan, "最终方案：创建配对 source，更新 index 和 log。");
  assert.deepEqual(completed.result.changedFiles, [
    "wiki/index.md",
    "wiki/log.md",
    "wiki/sources/articles/new-source.md",
  ]);
  assert.deepEqual(completed.result.postDirtyFiles, [
    "wiki/index.md",
    "wiki/log.md",
    "wiki/preexisting.md",
    "wiki/sources/articles/new-source.md",
  ]);
  assert.equal(completed.result.changedFiles.includes("wiki/preexisting.md"), false);
  assert.match(completed.result.executionMessage, /已写入并验证/);
});

test("state machine rejects premature actions, enforces concurrency, and cancellation is terminal", async (t) => {
  const fixture = await createVaultFixture();
  t.after(fixture.cleanup);
  const harness = createSpawnHarness([
    { hold: true, events: planEvents({ threadId: "thread-held", message: "Held plan" }) },
  ]);
  const runner = createRunner(fixture.vaultRoot, harness.spawnImpl, {
    maxConcurrentJobs: 1,
  });
  const started = await runner.startPlan({
    rawPath: "10_raw/articles/source.md",
    notesSnapshot: "",
  });

  await assert.rejects(
    () => runner.confirmJob(started.id),
    assertRunnerError("JOB_NOT_AWAITING_REVIEW"),
  );
  assert.throws(
    () => runner.reviseJob(started.id, { message: "too soon" }),
    assertRunnerError("JOB_NOT_AWAITING_REVIEW"),
  );
  await assert.rejects(
    runner.startPlan({
      rawPath: "10_raw/articles/second.md",
      notesSnapshot: "",
    }),
    assertRunnerError("CONCURRENCY_LIMIT"),
  );

  // Let the queued microtask spawn the held process before cancelling it.
  while (harness.calls.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const cancelled = runner.cancelJob(started.id);
  assert.equal(cancelled.status, WIKI_INGEST_STATUS.CANCELLED);
  assert.deepEqual(harness.calls[0].killSignals, ["SIGTERM"]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(runner.getJob(started.id).status, WIKI_INGEST_STATUS.CANCELLED);
  await assert.rejects(
    () => runner.confirmJob(started.id),
    assertRunnerError("JOB_NOT_AWAITING_REVIEW"),
  );
  assert.equal(
    harness.calls.some((call) => call.args.includes("workspace-write")),
    false,
  );
});

test("confirmation rejects source or frozen-note changes made after review", async (t) => {
  const fixture = await createVaultFixture();
  t.after(fixture.cleanup);
  const harness = createSpawnHarness([
    { events: planEvents({ threadId: "thread-source-version", message: "Source plan" }) },
    { events: planEvents({ threadId: "thread-notes-version", message: "Notes plan" }) },
  ]);
  const runner = createRunner(fixture.vaultRoot, harness.spawnImpl);

  const sourceJob = await runner.startPlan({
    rawPath: "10_raw/articles/source.md",
    notesPath: "10_raw/reading-notes/source-notes.md",
  });
  await waitForStatus(runner, sourceJob.id, WIKI_INGEST_STATUS.AWAITING_REVIEW);
  await writeFile(
    path.join(fixture.vaultRoot, "10_raw", "articles", "source.md"),
    "# Source\n\nChanged after review.\n",
    "utf8",
  );
  await assert.rejects(
    () => runner.confirmJob(sourceJob.id, {
      expectedReviewVersion: sourceJob.reviewVersion + 1,
    }),
    assertRunnerError("SOURCE_CHANGED_SINCE_REVIEW"),
  );
  assert.equal(
    runner.getJob(sourceJob.id).status,
    WIKI_INGEST_STATUS.AWAITING_REVIEW,
  );
  runner.cancelJob(sourceJob.id);

  const notesJob = await runner.startPlan({
    rawPath: "10_raw/articles/second.md",
    notesPath: "10_raw/reading-notes/source-notes.md",
  });
  await waitForStatus(runner, notesJob.id, WIKI_INGEST_STATUS.AWAITING_REVIEW);
  await writeFile(
    path.join(fixture.vaultRoot, "10_raw", "reading-notes", "source-notes.md"),
    "# Notes\n\nChanged after review.\n",
    "utf8",
  );
  await assert.rejects(
    () => runner.confirmJob(notesJob.id, {
      expectedReviewVersion: notesJob.reviewVersion + 1,
    }),
    assertRunnerError("NOTES_CHANGED_SINCE_REVIEW"),
  );
  assert.equal(
    runner.getJob(notesJob.id).status,
    WIKI_INGEST_STATUS.AWAITING_REVIEW,
  );
  assert.equal(
    harness.calls.some((call) => call.args.includes("workspace-write")),
    false,
  );
});

test("planning fails if the source changes while Codex is reading it", async (t) => {
  const fixture = await createVaultFixture();
  t.after(fixture.cleanup);
  const harness = createSpawnHarness([
    {
      hold: true,
      events: planEvents({
        threadId: "thread-changing-source",
        message: "This plan must never become reviewable.",
      }),
    },
  ]);
  const runner = createRunner(fixture.vaultRoot, harness.spawnImpl);
  const started = await runner.startPlan({
    rawPath: "10_raw/articles/source.md",
    notesSnapshot: "",
  });

  while (harness.calls.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  await writeFile(
    path.join(fixture.vaultRoot, "10_raw", "articles", "source.md"),
    "# Source\n\nChanged while planning.\n",
    "utf8",
  );
  harness.calls[0].release();

  const failed = await waitForStatus(
    runner,
    started.id,
    WIKI_INGEST_STATUS.FAILED,
  );
  assert.equal(failed.error.code, "SOURCE_CHANGED_SINCE_REVIEW");
  assert.equal(failed.reviewPlan, null);
  assert.equal(
    harness.calls.some((call) => call.args.includes("workspace-write")),
    false,
  );
});

test("workspace-write is blocked when input changes during pre-spawn checks", async (t) => {
  const fixture = await createVaultFixture();
  t.after(fixture.cleanup);
  const harness = createSpawnHarness([
    { events: planEvents({ threadId: "thread-pre-spawn", message: "Stable plan" }) },
  ]);
  let detectionCount = 0;
  let releaseWriteDetection;
  const writeDetectionBlocked = new Promise((resolve) => {
    releaseWriteDetection = resolve;
  });
  const runner = createRunner(fixture.vaultRoot, harness.spawnImpl, {
    detectImpl: async () => {
      detectionCount += 1;
      if (detectionCount === 2) await writeDetectionBlocked;
      return {
        available: true,
        executablePath: "/test/bin/codex",
        source: "test",
      };
    },
    gitSnapshotImpl: async () => ({
      available: true,
      entries: [],
      files: [],
      fingerprints: {},
    }),
  });
  const started = await runner.startPlan({
    rawPath: "10_raw/articles/source.md",
    notesSnapshot: "",
  });
  const planned = await waitForStatus(
    runner,
    started.id,
    WIKI_INGEST_STATUS.AWAITING_REVIEW,
  );
  const executing = await runner.confirmJob(started.id, {
    expectedReviewVersion: planned.reviewVersion,
  });
  assert.equal(executing.status, WIKI_INGEST_STATUS.EXECUTING);

  while (detectionCount < 2) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  await writeFile(
    path.join(fixture.vaultRoot, "10_raw", "articles", "source.md"),
    "# Source\n\nChanged after confirmation but before spawn.\n",
    "utf8",
  );
  releaseWriteDetection();

  const failed = await waitForStatus(
    runner,
    started.id,
    WIKI_INGEST_STATUS.FAILED,
  );
  assert.equal(failed.error.code, "SOURCE_CHANGED_SINCE_REVIEW");
  assert.equal(
    harness.calls.some((call) => call.args.includes("workspace-write")),
    false,
  );
});
