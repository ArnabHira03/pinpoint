import { toPercentStyle } from "../lib/coordinates";
import styles from "./Marker.module.css";

interface Props {
  x: number;
  y: number;
  number?: number;
  comment?: string;
  selected?: boolean;
  hovered?: boolean;
  onClick?: () => void;
  onHover?: (hovering: boolean) => void;
}

/** A numbered pin centered on its normalized (x, y) point. Without a number it renders as a draft dot. */
export default function Marker({ x, y, number, comment, selected = false, hovered = false, onClick, onHover }: Props) {
  const draft = number === undefined;
  const className = [
    styles.marker,
    draft ? styles.draft : "",
    selected ? styles.selected : "",
    hovered && !selected ? styles.hovered : "",
  ].join(" ");

  if (draft) {
    return <span className={className} style={toPercentStyle(x, y)} aria-hidden="true" data-testid="draft-marker" />;
  }

  return (
    <button
      type="button"
      className={className}
      style={toPercentStyle(x, y)}
      aria-label={`Annotation ${number}`}
      aria-pressed={selected}
      title={comment}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      onClick={(e) => {
        e.stopPropagation(); // never start a new annotation from a marker click
        onClick?.();
      }}
    >
      {number}
    </button>
  );
}
