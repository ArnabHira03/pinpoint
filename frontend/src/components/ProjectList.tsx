import { Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { Project } from "../types/api";
import styles from "./ProjectList.module.css";

interface Props {
  projects: Project[];
  onDelete: (project: Project) => void;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function ProjectList({ projects, onDelete }: Props) {
  return (
    <ul className={styles.list}>
      {projects.map((p) => (
        <li key={p.id} className={styles.item}>
          <Link to={`/projects/${p.id}`} className={styles.link}>
            <span className={styles.name}>{p.name}</span>
            <span className={styles.meta}>
              {p.screenshot_count} {p.screenshot_count === 1 ? "screenshot" : "screenshots"} · updated{" "}
              {dateFormat.format(new Date(p.updated_at))}
            </span>
          </Link>
          <button
            type="button"
            className={`icon ${styles.delete}`}
            aria-label={`Delete ${p.name}`}
            onClick={() => onDelete(p)}
          >
            <Trash2 size={16} />
          </button>
        </li>
      ))}
    </ul>
  );
}
