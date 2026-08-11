import { useEffect, useRef } from "react";
import gsap from "gsap";
import { formatNumber } from "../lib/format";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const completedMetricAnimations = new Set();

/**
 * 指标卡：GSAP 数字滚动。value 为 null 时显示 —（数据缺失不伪造）。
 */
export function MetricStat({ label, value, hint, accent = false, suffix = "", onClick }) {
  const numberRef = useRef(null);
  const animationKey = `${label}:${suffix}`;

  useEffect(() => {
    const node = numberRef.current;
    if (!node || value === null || value === undefined || Number.isNaN(Number(value))) {
      return undefined;
    }
    if (prefersReducedMotion() || completedMetricAnimations.has(animationKey)) {
      node.textContent = `${formatNumber(value)}${suffix}`;
      return undefined;
    }
    const counter = { n: 0 };
    const tween = gsap.to(counter, {
      n: Number(value),
      duration: 1.2,
      ease: "power3.out",
      onUpdate: () => {
        node.textContent = `${formatNumber(Math.round(counter.n))}${suffix}`;
      },
      onComplete: () => {
        completedMetricAnimations.add(animationKey);
        node.textContent = `${formatNumber(value)}${suffix}`;
      },
    });
    return () => tween.kill();
  }, [animationKey, value, suffix]);

  const empty = value === null || value === undefined || Number.isNaN(Number(value));
  const showFinalValue = completedMetricAnimations.has(animationKey) || prefersReducedMotion();

  return (
    <div
      className={`metric${accent ? " metric--accent" : ""}`}
      onClick={onClick}
      style={onClick ? { cursor: "pointer" } : undefined}
    >
      <span className="metric__label">{label}</span>
      <div className="metric__value" ref={numberRef}>
        {empty ? "—" : showFinalValue ? `${formatNumber(value)}${suffix}` : `0${suffix}`}
      </div>
      {hint ? <div className="metric__hint">{hint}</div> : null}
    </div>
  );
}
