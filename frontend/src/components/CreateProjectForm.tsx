import { useState, type FormEvent } from "react";
import styles from "./CreateProjectForm.module.css";

interface Props {
  onCreate: (name: string) => Promise<unknown>;
}

export default function CreateProjectForm({ onCreate }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(trimmed);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.row}>
        <input
          aria-label="Project name"
          placeholder="New project name"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="primary" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create project"}
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
