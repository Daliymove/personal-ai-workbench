export function formatNumber(value, maximumFractionDigits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }

  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits });
}

export function formatCompactDate(value, withTime = true) {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const formatted = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    ...(withTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }
      : {}),
  }).format(date);

  return formatted.replace(/\//g, "-");
}

export function formatFullDate(value) {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`;
}

export function statusLabel(status) {
  const labels = {
    active: "活跃",
    "needs-review": "待复核",
    needs_review: "待复核",
    deprecated: "已弃用",
    filmed: "已拍",
    published: "已发布",
    material_validating: "素材验证中",
    idea: "灵感",
    selected: "已确认",
    topic_selected: "已选题",
    framework_ready: "框架完成",
    ready_to_shoot: "准备完成",
    published_waiting_t7: "已发布 · 待 T+7",
    retro_done: "已复盘",
    archived: "已归档",
    candidate: "候选",
    collected: "已收集",
  };
  return labels[status] ?? status ?? "未标注";
}

export function layerLabel(layer) {
  const labels = {
    raw: "素材",
    wiki: "Wiki",
    topics: "选题",
    scripts: "内容",
    runs: "档案",
    topic: "选题",
    script: "内容",
    run: "档案",
  };
  return labels[layer] ?? layer ?? "文档";
}

export function fileNameFromPath(path = "") {
  return path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path;
}
