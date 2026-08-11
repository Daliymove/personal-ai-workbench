import { useEffect, useMemo, useState } from "react";
import {
  THEME_PRESETS,
  getAccentFamily,
  hexToRgb,
  resetTheme,
  rgbToHex,
  setTheme,
  useTheme,
} from "../lib/theme.js";
import "./ThemeCustomizer.css";

const CHANNELS = [
  { key: "r", label: "R", color: "#dc2626" },
  { key: "g", label: "G", color: "#16a34a" },
  { key: "b", label: "B", color: "#2563eb" },
];

export function ThemeCustomizer() {
  const theme = useTheme();
  const family = useMemo(() => getAccentFamily(), [theme.color]);
  const rgb = useMemo(() => hexToRgb(theme.color) ?? { r: 124, g: 58, b: 237 }, [theme.color]);
  const [hexDraft, setHexDraft] = useState(theme.color);

  useEffect(() => {
    setHexDraft(theme.color);
  }, [theme.color]);

  const setCustomColor = (color) => {
    setTheme({ mode: "custom", presetId: null, color });
  };

  const handleChannel = (key, value) => {
    if (value === "" || Number.isNaN(Number(value))) return;
    const next = { ...rgb, [key]: Number(value) };
    setCustomColor(rgbToHex(next.r, next.g, next.b));
  };

  const commitHex = () => {
    const normalized = hexDraft.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
      setCustomColor(`#${normalized.toLowerCase()}`);
    } else {
      setHexDraft(theme.color);
    }
  };

  return (
    <div className="theme-customizer">
      <div className="theme-customizer__section">
        <h3 className="theme-customizer__heading">预设配色</h3>
        <div className="theme-presets">
          {THEME_PRESETS.map((preset) => {
            const active = theme.mode === "preset" && theme.presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                className={`theme-preset${active ? " theme-preset--active" : ""}`}
                onClick={() => setTheme({ mode: "preset", presetId: preset.id, color: preset.color })}
                title={`切换为${preset.label}`}
                aria-pressed={active}
              >
                <span className="theme-preset__swatch" style={{ background: preset.color }} />
                <span className="theme-preset__label">{preset.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="theme-customizer__section">
        <h3 className="theme-customizer__heading">自定义 sRGB</h3>
        <div className="theme-srgb">
          {CHANNELS.map(({ key, label, color }) => (
            <label key={key} className="theme-srgb__channel" style={{ "--channel-color": color }}>
              <span className="theme-srgb__name">{label}</span>
              <input
                className="theme-srgb__range"
                type="range"
                min="0"
                max="255"
                step="1"
                value={rgb[key]}
                onChange={(event) => handleChannel(key, event.target.value)}
                aria-label={`${label} 通道`}
              />
              <input
                className="theme-srgb__number"
                type="number"
                min="0"
                max="255"
                value={rgb[key]}
                onChange={(event) => handleChannel(key, event.target.value)}
                aria-label={`${label} 数值`}
              />
            </label>
          ))}
          <label className="theme-srgb__hex">
            <span className="theme-srgb__name">HEX</span>
            <input
              className="theme-srgb__hex-input"
              type="text"
              value={hexDraft}
              onChange={(event) => setHexDraft(event.target.value)}
              onBlur={commitHex}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitHex();
                }
              }}
              spellCheck="false"
              aria-label="十六进制颜色"
            />
          </label>
        </div>
      </div>

      <div className="theme-customizer__footer">
        <div className="theme-preview" aria-hidden="true">
          <span className="theme-preview__chip" style={{ background: family.accent }} title="主色" />
          <span className="theme-preview__chip" style={{ background: family.accentStrong }} title="深色" />
          <span className="theme-preview__chip" style={{ background: family.accentSoft }} title="浅色" />
          <span className="theme-preview__chip theme-preview__chip--wash" style={{ background: family.accentWash }} title="底色" />
          <span className="theme-preview__value">{theme.color}</span>
        </div>
        <button type="button" className="graph-filter theme-customizer__reset" onClick={resetTheme}>
          恢复默认配色
        </button>
      </div>
    </div>
  );
}
