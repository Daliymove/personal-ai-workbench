import {
  IconBookmark,
  IconClock,
  IconFileText,
  IconUnlink,
} from "@tabler/icons-react";
import { formatCompactDate } from "../../lib/format";

function fileType(item) {
  const extension = item.extension || item.path?.split(".").pop();
  if (!extension || extension.includes("/")) return "FILE";
  return String(extension).replace(/^\./, "").toUpperCase();
}

function parentPath(item) {
  const path = item.relativePath || item.path || "";
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || "10_raw";
}

export function MaterialDocumentRow({
  item,
  onOpen,
  onToggleQueue,
  pending = false,
  showQueuedAt = false,
}) {
  const unavailable = item.available === false;
  const date = showQueuedAt && item.queuedAt ? item.queuedAt : item.updatedAt;

  return (
    <article className={`material-row${unavailable ? " material-row--unavailable" : ""}`}>
      <button
        className="material-row__open"
        disabled={unavailable}
        onClick={() => onOpen(item)}
        type="button"
      >
        <span className="material-row__file-icon" aria-hidden="true">
          {unavailable ? <IconUnlink size={18} /> : <IconFileText size={18} />}
        </span>
        <span className="material-row__identity">
          <strong>{item.title}</strong>
          <span>{unavailable ? "原文件已移动或删除" : parentPath(item)}</span>
        </span>
      </button>

      <span className="material-row__type mono">{fileType(item)}</span>

      <span className="material-row__date">
        <IconClock aria-hidden="true" size={14} />
        {showQueuedAt && item.queuedAt ? "加入 " : "更新 "}
        {formatCompactDate(date, false)}
      </span>

      <button
        aria-label={item.isQueued ? `将“${item.title}”移出待看` : `将“${item.title}”加入待看`}
        aria-pressed={Boolean(item.isQueued)}
        className={`material-queue-button${item.isQueued ? " material-queue-button--on" : ""}`}
        disabled={pending}
        onClick={() => onToggleQueue(item)}
        type="button"
      >
        <IconBookmark aria-hidden="true" size={16} />
        <span>{pending ? "处理中" : item.isQueued ? "待看中" : "待看"}</span>
      </button>
    </article>
  );
}
