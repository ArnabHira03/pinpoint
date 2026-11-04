import { useState, type KeyboardEvent } from "react";
import { popoverPlacement, toPercentStyle } from "../lib/coordinates";
import styles from "./AnnotationEditor.module.css";

interface Props {
  x: number;
  y: number;
  onSave: (comment: string) => Promise<unknown>;
  onCancel: () => void;
}

export default function AnnotationEditor({ x, y, onSave, onCancel }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { flipX, flipY } = popoverPlacement(x, y);

  const save = async () => {
    const comment = text.trim();
    if (!comment || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(comment);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save comment");
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  };

  return (
    <div
      className={`${styles.editor} ${flipX ? styles.flipX : ""} ${flipY ? styles.flipY : ""}`}
      style={toPercentStyle(x, y)}
      role="dialog"
      aria-label="New comment"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <textarea
        aria-label="Comment"
        placeholder="Add a comment…"
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
      <div className={styles.actions}>
        <span className={styles.hint}>Ctrl+Enter to save</span>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={save} disabled={busy || !text.trim()}>
          {busy ? "Saving…" : error ? "Retry" : "Save"}
        </button>
      </div>
    </div>
  );
}
