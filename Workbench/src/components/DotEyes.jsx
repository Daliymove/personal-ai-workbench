import { useEffect, useRef, useState } from "react";
import "./DotEyes.css";

const SPARK_ANGLES = [0, 58, 118, 180, 238, 302];
let wakeHasCompleted = false;

const getPrefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const usePrefersReducedMotion = () => {
  const [reducedMotion, setReducedMotion] = useState(getPrefersReducedMotion);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return undefined;
    const onChange = (event) => setReducedMotion(event.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  return reducedMotion;
};

/**
 * 点阵眼睛：首页的 signature 视觉。
 * 数据就绪时仅苏醒一次；指针跟随只在位置尚未收敛时请求动画帧。
 */
export function DotEyes({ awake = true, size = 148 }) {
  const wrapRef = useRef(null);
  const responseTimerRef = useRef(0);
  const blinkTimerRef = useRef(0);
  const responseIdRef = useRef(0);
  const pointerTypeRef = useRef("mouse");
  const reducedMotion = usePrefersReducedMotion();
  const [blink, setBlink] = useState(false);
  const [phase, setPhase] = useState("dormant");
  const [response, setResponse] = useState(null);

  useEffect(() => {
    let wakeTimer = 0;

    if (!awake) {
      setPhase("dormant");
      return undefined;
    }

    if (reducedMotion || wakeHasCompleted) {
      wakeHasCompleted = true;
      setPhase("awake");
      return undefined;
    }

    setPhase("waking");
    wakeTimer = window.setTimeout(() => {
      wakeHasCompleted = true;
      setPhase("awake");
    }, 980);
    return () => window.clearTimeout(wakeTimer);
  }, [awake, reducedMotion]);

  useEffect(() => {
    if (!awake || reducedMotion) return undefined;

    let frame = 0;
    let cachedRect = null;
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };

    const refreshRect = () => {
      const node = wrapRef.current;
      cachedRect = node ? node.getBoundingClientRect() : null;
    };

    const paint = () => {
      const node = wrapRef.current;
      if (!node) {
        frame = 0;
        return;
      }

      const dx = target.x - current.x;
      const dy = target.y - current.y;
      current.x += dx * 0.16;
      current.y += dy * 0.16;

      if (Math.abs(dx) + Math.abs(dy) < 0.025) {
        current.x = target.x;
        current.y = target.y;
      }

      node.style.setProperty("--look-x", `${current.x.toFixed(2)}px`);
      node.style.setProperty("--look-y", `${current.y.toFixed(2)}px`);
      node.style.setProperty("--tilt", `${(current.x * 0.42).toFixed(2)}deg`);

      if (current.x === target.x && current.y === target.y) {
        frame = 0;
        return;
      }
      frame = window.requestAnimationFrame(paint);
    };

    const schedulePaint = () => {
      if (!frame) frame = window.requestAnimationFrame(paint);
    };

    const onMove = (event) => {
      const node = wrapRef.current;
      if (!node) return;
      const rect = cachedRect ?? node.getBoundingClientRect();
      cachedRect = rect;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const deltaX = event.clientX - cx;
      const deltaY = event.clientY - cy;
      const distance = Math.hypot(deltaX, deltaY);
      const angle = Math.atan2(deltaY, deltaX);
      const travel = Math.min(9, distance / 24);

      target.x = Math.cos(angle) * travel;
      target.y = Math.sin(angle) * travel;
      node.style.setProperty("--attention", String(Math.max(0, 1 - distance / 460)));
      schedulePaint();
    };

    const resetGaze = () => {
      target.x = 0;
      target.y = 0;
      wrapRef.current?.style.setProperty("--attention", "0");
      schedulePaint();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("blur", resetGaze);
    window.addEventListener("resize", refreshRect);
    window.addEventListener("scroll", refreshRect, { capture: true, passive: true });
    document.documentElement.addEventListener("pointerleave", resetGaze);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(refreshRect);
    if (wrapRef.current) resizeObserver?.observe(wrapRef.current);
    refreshRect();

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("blur", resetGaze);
      window.removeEventListener("resize", refreshRect);
      window.removeEventListener("scroll", refreshRect, true);
      document.documentElement.removeEventListener("pointerleave", resetGaze);
      resizeObserver?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [awake, reducedMotion]);

  useEffect(() => {
    if (!reducedMotion) return;
    window.clearTimeout(responseTimerRef.current);
    window.clearTimeout(blinkTimerRef.current);
    setBlink(false);
    setResponse(null);
  }, [reducedMotion]);

  useEffect(
    () => () => {
      window.clearTimeout(responseTimerRef.current);
      window.clearTimeout(blinkTimerRef.current);
    },
    [],
  );

  const respond = (event) => {
    if (!awake || reducedMotion) return;
    const node = wrapRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const hasPointerCoordinates = Number.isFinite(event?.clientX) && event.clientX > 0;
    const x = hasPointerCoordinates ? event.clientX - rect.left : rect.width / 2;
    const y = hasPointerCoordinates ? event.clientY - rect.top : rect.height / 2;

    window.clearTimeout(responseTimerRef.current);
    window.clearTimeout(blinkTimerRef.current);
    responseIdRef.current += 1;
    setResponse({ id: responseIdRef.current, x, y });
    setBlink(true);

    blinkTimerRef.current = window.setTimeout(() => setBlink(false), 190);
    responseTimerRef.current = window.setTimeout(() => setResponse(null), 560);
  };

  const eye = (key, order) => (
    <span
      className={`dot-eye${blink ? " dot-eye--blink" : ""}`}
      key={key}
      style={{ "--eye-order": order }}
    >
      <span aria-hidden="true" className="dot-eye__grid" />
      <span aria-hidden="true" className="dot-eye__orbit dot-eye__orbit--outer" />
      <span aria-hidden="true" className="dot-eye__orbit dot-eye__orbit--inner" />
      <span aria-hidden="true" className="dot-eye__iris">
        <span className="dot-eye__pupil" />
        <span className="dot-eye__glint" />
      </span>
      <span aria-hidden="true" className="dot-eye__lid" />
    </span>
  );

  return (
    <button
      ref={wrapRef}
      aria-label={
        awake
          ? "知识库视线已苏醒。双击，或聚焦后按回车键触发回应"
          : "知识库数据加载中"
      }
      className={`hero__eyes dot-eyes dot-eyes--${phase}`}
      disabled={!awake}
      onClick={(event) => {
        if (pointerTypeRef.current !== "mouse") respond(event);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        if (pointerTypeRef.current === "mouse") respond(event);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        respond(event);
      }}
      onPointerDown={(event) => {
        pointerTypeRef.current = event.pointerType || "mouse";
      }}
      style={{ "--eye-size": `${size * 0.42}px`, "--eye-gap": `${size * 0.1}px` }}
      title={awake ? "她在看着你的知识库 · 双击回应" : "正在等待本地索引"}
      type="button"
    >
      <span aria-hidden="true" className="dot-eyes__signal dot-eyes__signal--left" />
      {eye("l", 0)}
      <span aria-hidden="true" className="dot-eyes__bridge" />
      {eye("r", 1)}
      <span aria-hidden="true" className="dot-eyes__signal dot-eyes__signal--right" />

      {response ? (
        <span aria-hidden="true" className="dot-eyes__response" key={response.id}>
          <span className="dot-eyes__response-ring" />
          <span
            className="dot-eyes__spark"
            style={{ "--spark-x": `${response.x}px`, "--spark-y": `${response.y}px` }}
          >
            {SPARK_ANGLES.map((angle) => (
              <span
                className="dot-eyes__spark-ray"
                key={angle}
                style={{ "--spark-angle": `${angle}deg` }}
              />
            ))}
          </span>
        </span>
      ) : null}
    </button>
  );
}
