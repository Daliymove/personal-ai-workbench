// 图谱沿当前主题的强调色轴取色，类型差异依靠明度、节点大小和文字标签表达，
// 避免把知识层变成一张彩虹分类图。中性来源类保持灰色。
import { getAccentFamily } from "./theme.js";

export const TYPE_META = {
  concept: { tone: "accent", label: "概念", code: "CPT" },
  framework: { tone: "accentStrong", label: "框架", code: "FRM" },
  diagnosis: { tone: "accentMid", label: "诊断", code: "DIA" },
  analysis: { tone: "accentDark", label: "分析", code: "ANA" },
  comparison: { tone: "accentSoft", label: "比较", code: "CMP" },
  case: { tone: "accentMid", label: "案例", code: "CAS" },
  "source-summary": { tone: "neutral", color: "#a1a1aa", label: "来源拆解", code: "SRC" },
  source: { tone: "neutral", color: "#71717a", label: "来源", code: "SRC" },
  topic: { tone: "accent", label: "主题", code: "TOP" },
  conflict: { tone: "accentDarkest", label: "冲突", code: "CFL" },
  question: { tone: "accentLight", label: "问答", code: "QST" },
  other: { tone: "neutral", color: "#d4d4d8", label: "其他", code: "ETC" },
};

export function typeMetaOf(type) {
  return TYPE_META[type] || TYPE_META.other;
}

export function typeColor(type) {
  const meta = typeMetaOf(type);
  if (meta.tone === "neutral") return meta.color;
  return getAccentFamily()[meta.tone] || getAccentFamily().accent;
}

export function typeLabelOf(type) {
  return typeMetaOf(type).label;
}

export function typeCodeOf(type) {
  return typeMetaOf(type).code;
}

export function nodeRadius(node) {
  const degree = Math.max(0, Number(node?.degree) || 0);
  return Math.min(19, 4.2 + Math.sqrt(degree) * 1.85);
}

export function nodeLabelPriority(node) {
  const degree = Math.max(0, Number(node?.degree) || 0);
  const statusWeight = node?.status === "active" ? 3 : 0;
  return degree * 10 + statusWeight;
}

export function truncateGraphTitle(value, maximum = 24) {
  const title = String(value || "未命名页面").trim();
  if (title.length <= maximum) return title;
  return `${title.slice(0, Math.max(1, maximum - 1))}…`;
}
