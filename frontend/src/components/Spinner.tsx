import styles from "./Spinner.module.css";

export default function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className={styles.wrap} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
