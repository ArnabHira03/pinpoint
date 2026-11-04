import { useState } from "react";
import ConfirmDialog from "../components/ConfirmDialog";
import CreateProjectForm from "../components/CreateProjectForm";
import EmptyState from "../components/EmptyState";
import ErrorBanner from "../components/ErrorBanner";
import ProjectList from "../components/ProjectList";
import Spinner from "../components/Spinner";
import { useProjects } from "../hooks/useProjects";
import type { Project } from "../types/api";
import styles from "./ProjectsPage.module.css";

export default function ProjectsPage() {
  const { data, loading, error, reload, create, remove } = useProjects();
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Pinpoint</h1>
      <p className={styles.subtitle}>Drop numbered comments on screenshots.</p>

      <CreateProjectForm onCreate={create} />

      {error ? (
        <ErrorBanner message={error} onRetry={reload} />
      ) : loading ? (
        <Spinner label="Loading projects…" />
      ) : data.length === 0 ? (
        <EmptyState title="No projects yet" hint="Create one above to start annotating screenshots." />
      ) : (
        <ProjectList projects={data} onDelete={setPendingDelete} />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete project?"
        message={
          pendingDelete
            ? `"${pendingDelete.name}" and all its screenshots and comments will be permanently deleted.`
            : ""
        }
        onConfirm={() => remove(pendingDelete!.id)}
        onClose={() => setPendingDelete(null)}
      />
    </main>
  );
}
