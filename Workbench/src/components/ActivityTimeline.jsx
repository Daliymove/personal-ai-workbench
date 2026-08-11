import {
  IconChevronRight,
  IconCircleDashed,
  IconCircleFilled,
} from "@tabler/icons-react";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

export function ActivityTimeline({
  title = "正在发生",
  items = [],
  reviewCount = null,
  reviewLabel = "张待复核",
  reviewDescription = "知识卡需要你的复核与连接",
  reviewActionLabel = "查看待复核",
  moreLabel = "查看更多",
  emptyLabel = "暂无进行中的事项",
  onItemClick,
  onReviewClick,
  onViewMore,
  reducedMotion = false,
  className,
}) {
  const entries = Array.isArray(items) ? items : [];
  const showReview = reviewCount !== null && reviewCount !== undefined;

  return (
    <aside
      className={joinClassNames(
        "activity-timeline",
        reducedMotion && "activity-timeline--reduced-motion",
        className,
      )}
      aria-labelledby="activity-timeline-title"
    >
      <h2 className="activity-timeline__title" id="activity-timeline-title">
        {title}
      </h2>

      {entries.length > 0 || showReview ? (
        <ol className="activity-timeline__list">
          {entries.map((item, index) => (
            <li className="activity-timeline__item" key={item.id ?? index}>
              <IconCircleFilled
                aria-hidden="true"
                className="activity-timeline__marker activity-timeline__marker--complete"
              />
              <button
                aria-label={item.ariaLabel ?? `查看${item.title}`}
                className="activity-timeline__item-button"
                onClick={() => onItemClick?.(item, index)}
                type="button"
              >
                {item.status ? (
                  <span className="activity-timeline__status">
                    {item.status}
                  </span>
                ) : null}
                <span className="activity-timeline__item-heading">
                  <span className="activity-timeline__item-title">
                    {item.title}
                  </span>
                  <IconChevronRight
                    aria-hidden="true"
                    className="activity-timeline__chevron"
                  />
                </span>
                {item.meta ? (
                  <time
                    className="activity-timeline__item-meta"
                    dateTime={item.dateTime}
                  >
                    {item.meta}
                  </time>
                ) : null}
              </button>
            </li>
          ))}

          {showReview ? (
            <li className="activity-timeline__item activity-timeline__item--review">
              <IconCircleDashed
                aria-hidden="true"
                className="activity-timeline__marker activity-timeline__marker--review"
              />
              <div className="activity-timeline__review">
                <p className="activity-timeline__review-heading">
                  <strong>{reviewCount}</strong>
                  <span>{reviewLabel}</span>
                </p>
                <p className="activity-timeline__review-description">
                  {reviewDescription}
                </p>
                <button
                  className="activity-timeline__review-button"
                  onClick={onReviewClick}
                  type="button"
                >
                  {reviewActionLabel}
                </button>
              </div>
            </li>
          ) : null}
        </ol>
      ) : (
        <p className="activity-timeline__empty">{emptyLabel}</p>
      )}

      <button
        className="activity-timeline__more-button"
        onClick={onViewMore}
        type="button"
      >
        <span>{moreLabel}</span>
        <IconChevronRight
          aria-hidden="true"
          className="activity-timeline__more-icon"
        />
      </button>
    </aside>
  );
}

export default ActivityTimeline;
