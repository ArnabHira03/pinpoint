import type { Annotation } from "../types/api";
import CommentItem from "./CommentItem";
import ErrorBanner from "./ErrorBanner";
import Spinner from "./Spinner";
import styles from "./CommentPanel.module.css";

interface Props {
  annotations: Annotation[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selectedId: number | null;
  hoveredId: number | null;
  onSelect: (id: number) => void;
  onHover: (id: number | null) => void;
  onUpdate: (id: number, comment: string) => Promise<unknown>;
  onDelete: (annotation: Annotation) => void;
}

export default function CommentPanel(props: Props) {
  const { annotations, loading, error, onRetry, selectedId, hoveredId, onSelect, onHover, onUpdate, onDelete } = props;

  return (
    <section className={styles.panel}>
      <h2 className={styles.title}>
        Comments {annotations.length > 0 && <span className={styles.count}>{annotations.length}</span>}
      </h2>
      {error ? (
        <ErrorBanner message={error} onRetry={onRetry} />
      ) : loading ? (
        <Spinner label="Loading comments…" />
      ) : annotations.length === 0 ? (
        <p className={styles.empty}>Click the image to add the first comment.</p>
      ) : (
        <ol className={styles.list}>
          {annotations.map((a) => (
            <CommentItem
              key={a.id}
              annotation={a}
              selected={a.id === selectedId}
              hovered={a.id === hoveredId}
              onSelect={() => onSelect(a.id)}
              onHover={(hovering) => onHover(hovering ? a.id : null)}
              onSave={(comment) => onUpdate(a.id, comment)}
              onDelete={() => onDelete(a)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
