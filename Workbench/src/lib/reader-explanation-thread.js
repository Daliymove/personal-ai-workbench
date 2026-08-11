function recordTime(record) {
  const value = new Date(record?.updatedAt || record?.createdAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function recordDepth(record) {
  const value = Number(record?.followUpDepth);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function recordsById(records) {
  return new Map(
    (Array.isArray(records) ? records : [])
      .filter((record) => record?.id)
      .map((record) => [String(record.id), record]),
  );
}

export function readerExplanationChain(records, activeId) {
  const byId = recordsById(records);
  const chain = [];
  const seen = new Set();
  let current = activeId ? byId.get(String(activeId)) : null;

  while (current?.id && !seen.has(String(current.id))) {
    chain.push(current);
    seen.add(String(current.id));
    current = current.parentId ? byId.get(String(current.parentId)) : null;
  }

  return chain.reverse();
}

export function readerExplanationThreads(records) {
  const byId = recordsById(records);
  const threads = new Map();

  for (const record of byId.values()) {
    let root = record;
    const seen = new Set([String(record.id)]);
    while (root.parentId && byId.has(String(root.parentId))) {
      const parent = byId.get(String(root.parentId));
      if (!parent?.id || seen.has(String(parent.id))) break;
      root = parent;
      seen.add(String(parent.id));
    }

    const rootId = String(root.id);
    if (!threads.has(rootId)) threads.set(rootId, { root, records: [] });
    threads.get(rootId).records.push(record);
  }

  return [...threads.values()]
    .map((thread) => {
      const ordered = [...thread.records].sort((left, right) =>
        recordDepth(left) - recordDepth(right) ||
        recordTime(left) - recordTime(right) ||
        String(left.id).localeCompare(String(right.id)),
      );
      const latest = [...ordered].sort((left, right) =>
        recordDepth(right) - recordDepth(left) ||
        recordTime(right) - recordTime(left) ||
        String(right.id).localeCompare(String(left.id)),
      )[0] || thread.root;
      return { ...thread, records: ordered, latest };
    })
    .sort((left, right) =>
      recordTime(right.latest) - recordTime(left.latest) ||
      String(left.root.id).localeCompare(String(right.root.id)),
    );
}

export function readerExplanationFollowUpState(record, fallbackLimit = 3) {
  const depth = recordDepth(record);
  const declaredLimit = Number(record?.followUpLimit);
  const limit =
    Number.isFinite(declaredLimit) && declaredLimit >= 0
      ? declaredLimit
      : fallbackLimit;
  const remaining = Math.max(0, limit - depth);
  return {
    depth,
    limit,
    remaining,
    canFollowUp: record?.status === "completed" && remaining > 0,
  };
}

export function readerExplanationThreadSaveState(thread) {
  const records = Array.isArray(thread?.records) ? thread.records : [];
  const completed = records.filter((record) => record?.status === "completed");
  const root = thread?.root || completed[0] || records[0] || null;
  const savedNoteId = root?.savedNoteId || null;
  const consolidated = Boolean(
    savedNoteId &&
      completed.length &&
      completed.every((record) => record.savedNoteId === savedNoteId),
  );
  return {
    savedNoteId,
    completedCount: completed.length,
    consolidated,
    canSave: completed.length > 0 && !consolidated,
    isUpdate: Boolean(savedNoteId) && !consolidated,
  };
}
