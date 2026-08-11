import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_BASE_COLOR,
  THEME_PRESETS,
  deriveAccentFamily,
  getTheme,
  hexToRgb,
  normalizeTheme,
  resetTheme,
  rgbToHex,
  setTheme,
} from "../src/lib/theme.js";

test("hexToRgb / rgbToHex round-trip", () => {
  assert.deepEqual(hexToRgb("#7c3aed"), { r: 124, g: 58, b: 237 });
  assert.equal(rgbToHex(124, 58, 237), "#7c3aed");
  assert.equal(hexToRgb("not-a-color"), null);
});

test("默认紫色保留手调过的精确家族", () => {
  const family = deriveAccentFamily(DEFAULT_BASE_COLOR);
  assert.equal(family.accent, "#7c3aed");
  assert.equal(family.accentStrong, "#6d28d9");
  assert.equal(family.accentSoft, "#a78bfa");
  assert.equal(family.accentWash, "#f3effe");
  assert.deepEqual(family.accentRgb, { r: 124, g: 58, b: 237 });
});

test("自定义颜色推导出完整且一致的家族", () => {
  const family = deriveAccentFamily("#dc2626");
  assert.equal(family.accent, "#dc2626");
  for (const key of ["accentStrong", "accentDark", "accentMid", "accentSoft", "accentWash"]) {
    assert.match(family[key], /^#[0-9a-f]{6}$/, `${key} 应为合法 hex`);
  }
  assert.equal(family.accentGlow, "rgba(220, 38, 38, 0.16)");
  assert.equal(family.accentGlowStrong, "rgba(220, 38, 38, 0.28)");
  assert.deepEqual(family.accentRgb, { r: 220, g: 38, b: 38 });
  assert.throws(() => deriveAccentFamily("#12"), TypeError);
});

test("预设列表颜色合法且 id 唯一", () => {
  const ids = new Set();
  for (const preset of THEME_PRESETS) {
    assert.match(preset.color, /^#[0-9a-f]{6}$/);
    assert.ok(!ids.has(preset.id), `重复 id: ${preset.id}`);
    ids.add(preset.id);
  }
});

test("normalizeTheme 拒绝非法输入并回退默认", () => {
  assert.deepEqual(normalizeTheme(null), { mode: "preset", presetId: "violet", color: DEFAULT_BASE_COLOR });
  assert.deepEqual(normalizeTheme({ mode: "preset", presetId: "red", color: "#ff0000" }), {
    mode: "preset",
    presetId: "red",
    color: "#dc2626",
  });
  assert.deepEqual(normalizeTheme({ mode: "custom", presetId: null, color: "#12ab34" }), {
    mode: "custom",
    presetId: null,
    color: "#12ab34",
  });
  assert.deepEqual(normalizeTheme({ mode: "custom", color: "blue" }), {
    mode: "preset",
    presetId: "violet",
    color: DEFAULT_BASE_COLOR,
  });
});

test("无 window 环境下主题状态安全可用", () => {
  assert.equal(typeof window, "undefined");
  const theme = getTheme();
  assert.equal(theme.color, DEFAULT_BASE_COLOR);
  assert.doesNotThrow(() => setTheme({ mode: "preset", presetId: "blue", color: "#2563eb" }));
  assert.equal(getTheme().color, "#2563eb");
  assert.doesNotThrow(resetTheme);
  assert.equal(getTheme().color, DEFAULT_BASE_COLOR);
});
