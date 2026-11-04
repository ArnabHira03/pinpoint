import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Annotation } from "../types/api";
import styles from "./CommentItem.module.css";

interface Props {
  annotation: Annotation;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
  onSave: (comment: string) => Promise<unknown>;
  onDelete: () => void;
}

export default function CommentItem({ annotation, selected, hovered, onSelect, onHover, onSave, onDelete }: Props) {
  const ref = useRef<HTMLLIElement>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(annotation.comment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bring the comment into view when its marker is selected on the image.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const startEdit = () => {
    setText(annotation.comment);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const comment = text.trim();
    if (!comment || busy) return;
    if (comment === annotation.comment) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(comment);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save comment");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  };

  const edited = annotation.updated_at > annotation.created_at;
  const className = [styles.item, selected ? styles.selected : "", hovered && !selected ? styles.hovered : ""].join(" ");

  return (
    <li
      ref={ref}
      className={className}
      aria-current={selected ? "true" : undefined}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <span className={styles.number} aria-hidden="true">
        {annotation.number}
      </span>
      {editing ? (
        <div className={styles.body} onKeyDown={onKeyDown}>
          <textarea
            aria-label={`Edit comment ${annotation.number}`}
            value={text}
            maxLength={2000}
            rows={3}
            autoFocus
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
          />
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.editActions}>
            <button type="button" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={save} disabled={busy || !text.trim()}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className={styles.body}
            aria-label={`Comment ${annotation.number}: ${annotation.comment}`}
            onClick={onSelect}
          >
            <span className={styles.text}>{annotation.comment}</span>
            {edited && <span className={styles.meta}>edited</span>}
          </button>
          <div className={styles.actions}>
            <button type="button" className="icon" aria-label={`Edit comment ${annotation.number}`} onClick={startEdit}>
              <Pencil size={14} />
            </button>
            <button type="button" className="icon" aria-label={`Delete comment ${annotation.number}`} onClick={onDelete}>
              <Trash2 size={14} />
            </button>
          </div>
        </>
      )}
    </li>
  );
}
