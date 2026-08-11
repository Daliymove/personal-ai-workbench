import { useSyncExternalStore } from "react";

export const THEME_STORAGE_KEY = "workbench.theme.v1";
export const DEFAULT_BASE_COLOR = "#7c3aed";

// ---------------------------------------------------------------------------
// 颜色工具：sRGB hex <-> rgb / hsl
// ---------------------------------------------------------------------------

export function hexToRgb(hex) {
  const normalized = String(hex || "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const value = parseInt(normalized, 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

export function rgbToHex(r, g, b) {
  const clamp = (value) => Math.min(255, Math.max(0, Math.round(Number(value))));
  const toHex = (value) => clamp(value).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgba(rgb, alpha) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function hexToHsl(hex) {
  const rgb = hexToRgb(hex);
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  return { h: h / 6, s, l };
}

function hslToHex(h, s, l) {
  const hue = ((h % 1) + 1) % 1;
  const sat = Math.min(1, Math.max(0, s));
  const light = Math.min(1, Math.max(0, l));
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channel = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return rgbToHex(channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255);
}

// ---------------------------------------------------------------------------
// 强调色家族：默认紫保留手调过的精确值，其余由基础色推导
// ---------------------------------------------------------------------------

const VIOLET_FAMILY = Object.freeze({
  accent: DEFAULT_BASE_COLOR,
  accentStrong: "#6d28d9",
  accentDark: "#5b21b6",
  accentDarkest: "#4c1d95",
  accentMid: "#8b5cf6",
  accentSoft: "#a78bfa",
  accentLight: "#c4b5fd",
  accentWash: "#f3effe",
  accentGlow: "rgba(124, 58, 237, 0.16)",
  accentGlowStrong: "rgba(124, 58, 237, 0.28)",
  accentTint: "rgba(124, 58, 237, 0.18)",
  accentTintStrong: "rgba(124, 58, 237, 0.22)",
  accentFocus: "rgba(124, 58, 237, 0.20)",
  accentGlowFaint: "rgba(124, 58, 237, 0.055)",
  accentGlowSoft: "rgba(124, 58, 237, 0.12)",
  accentRgb: { r: 124, g: 58, b: 237 },
});

/**
 * 根据基础色推导整组强调色（sRGB 自由修改时使用）。
 * 默认紫直接返回手调过的 VIOLET_FAMILY，保证现有外观不变。
 */
export function deriveAccentFamily(baseColor) {
  const base = String(baseColor || "").toLowerCase();
  if (base === DEFAULT_BASE_COLOR) return VIOLET_FAMILY;
  const rgb = hexToRgb(base);
  if (!rgb) throw new TypeError(`Invalid base color: ${String(baseColor)}`);
  const { h, s, l } = hexToHsl(base);
  const lighten = (delta) => hslToHex(h, Math.min(1, s + 0.05), Math.min(0.99, l + delta));
  return {
    accent: base,
    accentStrong: hslToHex(h, s, Math.max(0, l - 0.08)),
    accentDark: hslToHex(h, s, Math.max(0, l - 0.16)),
    accentDarkest: hslToHex(h, s, Math.max(0, l - 0.22)),
    accentMid: hslToHex(h, Math.min(1, s + 0.05), Math.min(0.99, l + 0.06)),
    accentSoft: lighten(0.14),
    accentLight: lighten(0.28),
    accentWash: lighten(0.4),
    accentGlow: rgba(rgb, 0.16),
    accentGlowStrong: rgba(rgb, 0.28),
    accentTint: rgba(rgb, 0.18),
    accentTintStrong: rgba(rgb, 0.22),
    accentFocus: rgba(rgb, 0.2),
    accentGlowFaint: rgba(rgb, 0.055),
    accentGlowSoft: rgba(rgb, 0.12),
    accentRgb: rgb,
  };
}

// ---------------------------------------------------------------------------
// 预设配色
// ---------------------------------------------------------------------------

export const THEME_PRESETS = [
  { id: "violet", label: "默认紫", color: DEFAULT_BASE_COLOR },
  { id: "red", label: "红", color: "#dc2626" },
  { id: "blue", label: "蓝", color: "#2563eb" },
  { id: "green", label: "绿", color: "#16a34a" },
  { id: "mint", label: "淡绿", color: "#4ade80" },
  { id: "yellow", label: "淡黄", color: "#facc15" },
  { id: "cyan", label: "青", color: "#0ea5e9" },
  { id: "pink", label: "粉", color: "#ec4899" },
];

// ---------------------------------------------------------------------------
// 主题状态：localStorage 持久化 + 模块级订阅
// ---------------------------------------------------------------------------

const DEFAULT_THEME = Object.freeze({
  mode: "preset",
  presetId: "violet",
  color: DEFAULT_BASE_COLOR,
});

let currentTheme = null;
const listeners = new Set();

export function normalizeTheme(value) {
  if (!value || typeof value !== "object") return DEFAULT_THEME;
  const color = typeof value.color === "string" ? value.color.toLowerCase() : "";
  if (!/^#[0-9a-f]{6}$/.test(color)) return DEFAULT_THEME;
  if (value.mode === "custom") {
    return { mode: "custom", presetId: null, color };
  }
  const preset = THEME_PRESETS.find((item) => item.id === value.presetId);
  if (!preset) return DEFAULT_THEME;
  return { mode: "preset", presetId: preset.id, color: preset.color };
}

function readStoredTheme() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredTheme(theme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // 存储不可用时静默忽略，主题只在当前会话生效
  }
}

export function getTheme() {
  if (!currentTheme) currentTheme = normalizeTheme(readStoredTheme());
  return currentTheme;
}

export function getAccentFamily() {
  return deriveAccentFamily(getTheme().color);
}

export function setTheme(next) {
  const theme = normalizeTheme(next);
  currentTheme = theme;
  writeStoredTheme(theme);
  applyThemeFamily(deriveAccentFamily(theme.color));
  for (const listener of listeners) listener(theme);
}

export function resetTheme() {
  setTheme(DEFAULT_THEME);
}

export function subscribeTheme(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  return useSyncExternalStore(subscribeTheme, getTheme);
}

function camelToKebab(name) {
  return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

export function applyThemeFamily(family) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(family)) {
    if (key === "accentRgb") continue;
    root.style.setProperty(`--${camelToKebab(key)}`, value);
  }
}

/** 启动时同步应用已保存的主题，避免默认紫色闪一下。 */
export function applyStoredTheme() {
  applyThemeFamily(getAccentFamily());
}
