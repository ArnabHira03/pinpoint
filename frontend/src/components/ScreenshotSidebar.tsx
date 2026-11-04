import { ImageOff, MessageSquare, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Screenshot } from "../types/api";
import styles from "./ScreenshotSidebar.module.css";

interface Props {
  screenshots: Screenshot[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onDelete: (screenshot: Screenshot) => void;
}

function Thumbnail({ screenshot }: { screenshot: Screenshot }) {
  const [failed, setFailed] = useState(false);
  if (!screenshot.file_available || failed) {
    return (
      <span className={styles.missing}>
        <ImageOff size={20} aria-label="Image file missing" />
      </span>
    );
  }
  return (
    <img
      className={styles.image}
      src={screenshot.image_url}
      alt=""
      loading="lazy"
      width={screenshot.width}
      height={screenshot.height}
      onError={() => setFailed(true)}
    />
  );
}

export default function ScreenshotSidebar({ screenshots, selectedId, onSelect, onDelete }: Props) {
  return (
    <ul className={styles.list} aria-label="Screenshots">
      {screenshots.map((s) => (
        <li key={s.id} className={styles.item}>
          <button
            type="button"
            className={`${styles.thumb} ${s.id === selectedId ? styles.selected : ""}`}
            aria-current={s.id === selectedId ? "true" : undefined}
            onClick={() => onSelect(s.id)}
          >
            <span className={styles.frame}>
              <Thumbnail screenshot={s} />
              {s.annotation_count > 0 && (
                <span className={styles.badge} aria-label={`${s.annotation_count} comments`}>
                  <MessageSquare size={11} aria-hidden="true" />
                  {s.annotation_count}
                </span>
              )}
            </span>
            <span className={styles.caption} title={s.original_filename}>
              {s.original_filename}
            </span>
          </button>
          <button
            type="button"
            className={`icon ${styles.delete}`}
            aria-label={`Delete ${s.original_filename}`}
            onClick={() => onDelete(s)}
          >
            <Trash2 size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}
