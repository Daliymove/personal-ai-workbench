import { useMemo } from "react";

function polarPoint(index, count, radius, center) {
  const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
  return {
    x: center + Math.cos(angle) * radius,
    y: center + Math.sin(angle) * radius,
  };
}

function pointsAttribute(points) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function SocialInsightRadar({
  compact = false,
  indicators = [],
  onSelect,
  selectedKey,
}) {
  const values = useMemo(
    () => indicators.filter((item) => item?.valid !== false && Number.isFinite(item?.score)),
    [indicators],
  );
  const size = compact ? 160 : 360;
  const center = size / 2;
  const radius = compact ? 62 : 116;
  const labelRadius = compact ? radius : 151;

  if (values.length < 3) return null;

  const axes = values.map((_, index) => polarPoint(index, values.length, radius, center));
  const dataPoints = values.map((item, index) =>
    polarPoint(index, values.length, radius * (item.score / 5), center),
  );
  const rings = [1, 2, 3, 4, 5].map((level) =>
    values.map((_, index) =>
      polarPoint(index, values.length, radius * (level / 5), center),
    ),
  );

  return (
    <div className={`social-radar${compact ? " social-radar--compact" : ""}`}>
      <svg
        aria-label={`本次样本内雷达图，共 ${values.length} 个维度`}
        className="social-radar__svg"
        role="img"
        viewBox={`0 0 ${size} ${size}`}
      >
        <title>本次样本内相对评估，不是全网统计指数</title>
        {rings.map((ring, index) => (
          <polygon
            className="social-radar__ring"
            key={`ring-${index + 1}`}
            points={pointsAttribute(ring)}
          />
        ))}
        {axes.map((point, index) => (
          <line
            className="social-radar__axis"
            key={`axis-${values[index].key || index}`}
            x1={center}
            x2={point.x}
            y1={center}
            y2={point.y}
          />
        ))}
        <polygon className="social-radar__shape" points={pointsAttribute(dataPoints)} />
        {dataPoints.map((point, index) => (
          <circle
            className={
              values[index].key === selectedKey
                ? "social-radar__point social-radar__point--selected"
                : "social-radar__point"
            }
            cx={point.x}
            cy={point.y}
            key={`point-${values[index].key || index}`}
            r={compact ? 2.5 : 4}
          />
        ))}
        {!compact
          ? values.map((item, index) => {
              const point = polarPoint(index, values.length, labelRadius, center);
              const anchor = point.x < center - 10 ? "end" : point.x > center + 10 ? "start" : "middle";
              return (
                <text
                  className={
                    item.key === selectedKey
                      ? "social-radar__label social-radar__label--selected"
                      : "social-radar__label"
                  }
                  key={`label-${item.key || index}`}
                  textAnchor={anchor}
                  x={point.x}
                  y={point.y + 4}
                >
                  {item.label}
                </text>
              );
            })
          : null}
      </svg>

      {!compact && onSelect ? (
        <div className="social-radar__controls" aria-label="选择雷达维度">
          {values.map((item) => (
            <button
              aria-pressed={selectedKey === item.key}
              className={selectedKey === item.key ? "is-active" : ""}
              key={item.key}
              onClick={() => onSelect(item.key)}
              type="button"
            >
              <span>{item.label}</span>
              <strong>{item.score}/5</strong>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
