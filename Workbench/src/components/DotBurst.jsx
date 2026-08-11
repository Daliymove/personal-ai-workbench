import { useCallback, useRef, useState } from "react";
import { getAccentFamily } from "../lib/theme.js";
import gsap from "gsap";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * 点阵烟花（跟随主题色的小惊喜）。返回 [burst, layer]：
 * burst(x, y) 在屏幕坐标触发一次爆裂；layer 渲染在页面根部。
 */
export function useDotBurst() {
  const [dots, setDots] = useState([]);
  const idRef = useRef(0);

  const burst = useCallback((x, y) => {
    if (prefersReducedMotion()) return;
    const batch = Array.from({ length: 14 }, () => {
      idRef.current += 1;
      return {
        id: idRef.current,
        x,
        y,
        hue: Math.random() > 0.5 ? getAccentFamily().accent : getAccentFamily().accentSoft,
        size: 4 + Math.random() * 6,
      };
    });
    setDots((prev) => [...prev, ...batch]);
    window.setTimeout(() => {
      setDots((prev) => prev.filter((dot) => !batch.some((b) => b.id === dot.id)));
    }, 1100);
  }, []);

  const layer = (
    <div className="confetti-layer" aria-hidden="true">
      {dots.map((dot) => (
        <Dot key={dot.id} {...dot} />
      ))}
    </div>
  );

  return [burst, layer];
}

function Dot({ x, y, hue, size }) {
  const ref = useRef(null);

  const setNode = useCallback(
    (node) => {
      ref.current = node;
      if (!node) return;
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 90;
      gsap.fromTo(
        node,
        { x, y, scale: 1, opacity: 1 },
        {
          x: x + Math.cos(angle) * dist,
          y: y + Math.sin(angle) * dist - 30,
          scale: 0,
          opacity: 0,
          duration: 0.9 + Math.random() * 0.3,
          ease: "power2.out",
        },
      );
    },
    [x, y],
  );

  return (
    <span
      className="confetti-dot"
      ref={setNode}
      style={{ background: hue, width: size, height: size, left: 0, top: 0 }}
    />
  );
}
