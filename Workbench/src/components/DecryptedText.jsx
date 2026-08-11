import { useEffect, useMemo, useState } from "react";
import "./DecryptedText.css";

const CIPHER = "01/<>[]{}._-+*";
const completedReveals = new Set();

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

const makePlaceholder = (characters) =>
  characters.map((character) => (/\s/u.test(character) ? character : "·")).join("");

/**
 * A bounded, one-shot technical-label reveal inspired by Decrypted Text.
 * It intentionally uses short timers instead of a permanent animation loop.
 */
export function DecryptedText({
  active = false,
  className = "",
  duration = 400,
  settleWithoutAnimation = false,
  text,
}) {
  const reducedMotion = usePrefersReducedMotion();
  const characters = useMemo(() => Array.from(text), [text]);
  const visibleIndexes = useMemo(
    () => characters.flatMap((character, index) => (/\s/u.test(character) ? [] : [index])),
    [characters],
  );
  const alreadyRevealed = completedReveals.has(text);
  const [display, setDisplay] = useState(() =>
    alreadyRevealed ? text : makePlaceholder(characters),
  );
  const [resolvedCount, setResolvedCount] = useState(() =>
    alreadyRevealed ? visibleIndexes.length : 0,
  );

  useEffect(() => {
    let timer = 0;

    if (completedReveals.has(text) || settleWithoutAnimation) {
      setDisplay(text);
      setResolvedCount(visibleIndexes.length);
      return undefined;
    }

    if (reducedMotion) {
      completedReveals.add(text);
      setDisplay(text);
      setResolvedCount(visibleIndexes.length);
      return undefined;
    }

    if (!active) {
      setDisplay(makePlaceholder(characters));
      setResolvedCount(0);
      return undefined;
    }

    const startedAt = performance.now();
    let tick = 0;

    const reveal = () => {
      const elapsed = performance.now() - startedAt;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - (1 - progress) ** 3;
      const nextResolvedCount = Math.floor(eased * visibleIndexes.length);
      const resolvedIndexes = new Set(visibleIndexes.slice(0, nextResolvedCount));

      setDisplay(
        characters
          .map((character, index) => {
            if (/\s/u.test(character) || resolvedIndexes.has(index)) return character;
            return CIPHER[(tick * 3 + index * 5) % CIPHER.length];
          })
          .join(""),
      );
      setResolvedCount(nextResolvedCount);
      tick += 1;

      if (progress < 1) {
        timer = window.setTimeout(reveal, 42);
      } else {
        completedReveals.add(text);
        setDisplay(text);
        setResolvedCount(visibleIndexes.length);
      }
    };

    reveal();
    return () => window.clearTimeout(timer);
  }, [active, characters, duration, reducedMotion, settleWithoutAnimation, text, visibleIndexes]);

  const resolvedIndexes = new Set(visibleIndexes.slice(0, resolvedCount));

  return (
    <span aria-label={text} className={`decrypted-text ${className}`.trim()}>
      <span aria-hidden="true">
        {Array.from(display).map((character, index) => (
          <span
            className={resolvedIndexes.has(index) ? undefined : "decrypted-text__cipher"}
            key={`${index}-${characters[index]}`}
          >
            {character}
          </span>
        ))}
      </span>
    </span>
  );
}
