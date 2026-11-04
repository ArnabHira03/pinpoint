import { ImageOff } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";
import { toNormalized, type Point } from "../lib/coordinates";
import type { Annotation, AnnotationInput, Screenshot } from "../types/api";
import AnnotationEditor from "./AnnotationEditor";
import Marker from "./Marker";
import styles from "./ScreenshotViewer.module.css";

export type Zoom = "fit" | "actual";

interface Props {
  screenshot: Screenshot;
  zoom: Zoom;
  onZoomChange: (zoom: Zoom) => void;
  annotations: Annotation[];
  selectedAnnotationId: number | null;
  hoveredAnnotationId: number | null;
  onSelectAnnotation: (id: number | null) => void;
  onHoverAnnotation: (id: number | null) => void;
  onCreateAnnotation: (input: AnnotationInput) => Promise<Annotation>;
}

export default function ScreenshotViewer({
  screenshot,
  zoom,
  onZoomChange,
  annotations,
  selectedAnnotationId,
  hoveredAnnotationId,
  onSelectAnnotation,
  onHoverAnnotation,
  onCreateAnnotation,
}: Props) {
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<Point | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  if (!screenshot.file_available || failed) {
    return (
      <div className={styles.viewer}>
        <div className={styles.placeholder}>
          <ImageOff size={32} aria-hidden="true" />
          <p>Image file missing</p>
          <p className={styles.hint}>You can still delete this screenshot from the sidebar.</p>
        </div>
      </div>
    );
  }

  const handleFrameClick = (e: MouseEvent) => {
    if (draft || !imgRef.current) return;
    const point = toNormalized(e.clientX, e.clientY, imgRef.current.getBoundingClientRect());
    if (!point) return;
    onSelectAnnotation(null);
    setDraft(point);
  };

  const save = async (comment: string) => {
    const created = await onCreateAnnotation({ ...draft!, comment });
    setDraft(null);
    onSelectAnnotation(created.id);
  };

  const frameClass = [styles.frame, draft ? "" : styles.annotatable, zoom === "actual" ? styles.actual : ""].join(" ");

  return (
    <div className={styles.viewer}>
      <div className={styles.toolbar} role="group" aria-label="Zoom">
        <span className={styles.size}>
          {screenshot.width} × {screenshot.height}
        </span>
        <button type="button" aria-pressed={zoom === "fit"} onClick={() => onZoomChange("fit")}>
          Fit
        </button>
        <button type="button" aria-pressed={zoom === "actual"} onClick={() => onZoomChange("actual")}>
          100%
        </button>
      </div>
      <div className={styles.scroll}>
        {/* The frame hugs the rendered image exactly, so percentage positions map onto image pixels
            at any zoom: only the frame's width changes. */}
        <div className={frameClass} onClick={handleFrameClick} data-testid="image-frame">
          <img
            ref={imgRef}
            className={styles.image}
            src={screenshot.image_url}
            alt={screenshot.original_filename}
            width={screenshot.width}
            height={screenshot.height}
            draggable={false}
            onError={() => setFailed(true)}
          />
          {annotations.map((a) => (
            <Marker
              key={a.id}
              x={a.x}
              y={a.y}
              number={a.number}
              comment={a.comment}
              selected={a.id === selectedAnnotationId}
              hovered={a.id === hoveredAnnotationId}
              onClick={() => onSelectAnnotation(a.id)}
              onHover={(hovering) => onHoverAnnotation(hovering ? a.id : null)}
            />
          ))}
          {draft && (
            <>
              <Marker x={draft.x} y={draft.y} />
              <AnnotationEditor x={draft.x} y={draft.y} onSave={save} onCancel={() => setDraft(null)} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
