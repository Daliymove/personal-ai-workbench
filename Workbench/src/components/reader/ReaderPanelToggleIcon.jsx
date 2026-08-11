export function ReaderPanelToggleIcon({ side, collapsed }) {
  const direction = side === "left"
    ? (collapsed ? "right" : "left")
    : (collapsed ? "left" : "right");
  const chevron = direction === "left"
    ? "M14.5 7.5 10 12l4.5 4.5"
    : "M9.5 7.5 14 12l-4.5 4.5";

  return (
    <svg
      key={`${side}-${collapsed}`}
      aria-hidden="true"
      className={`reader-panel-toggle-icon reader-panel-toggle-icon--${direction}`}
      viewBox="0 0 24 24"
    >
      <path className="reader-panel-toggle-icon__chevron" d={chevron} />
    </svg>
  );
}
