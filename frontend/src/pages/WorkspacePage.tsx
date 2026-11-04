import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import CommentPanel from "../components/CommentPanel";
import ConfirmDialog from "../components/ConfirmDialog";
import EmptyState from "../components/EmptyState";
import ErrorBanner from "../components/ErrorBanner";
import ScreenshotSidebar from "../components/ScreenshotSidebar";
import ScreenshotViewer, { type Zoom } from "../components/ScreenshotViewer";
import Spinner from "../components/Spinner";
import UploadButton from "../components/UploadButton";
import { useAnnotations } from "../hooks/useAnnotations";
import { useScreenshots } from "../hooks/useScreenshots";
import { getProject } from "../services/endpoints";
import type { Annotation, Project, Screenshot } from "../types/api";
import styles from "./WorkspacePage.module.css";

export default function WorkspacePage() {
  const projectId = Number(useParams().projectId);
  const [project, setProject] = useState<Project | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const screenshots = useScreenshots(projectId);
  const [searchParams, setSearchParams] = useSearchParams();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Screenshot | null>(null);

  useEffect(() => {
    setProject(null);
    setProjectError(null);
    getProject(projectId)
      .then(setProject)
      .catch((e) => setProjectError(e instanceof Error ? e.message : "Failed to load project"));
  }, [projectId]);

  const requestedId = Number(searchParams.get("s"));
  const selected = screenshots.data.find((s) => s.id === requestedId) ?? screenshots.data[0] ?? null;

  const select = useCallback(
    (id: number | null) => setSearchParams(id === null ? {} : { s: String(id) }, { replace: true }),
    [setSearchParams],
  );

  // Keep ?s= pointing at what is actually shown (first screenshot by default, or after a delete).
  useEffect(() => {
    if (screenshots.loading) return;
    const shownId = selected?.id ?? null;
    if (shownId !== (requestedId || null)) select(shownId);
  }, [screenshots.loading, selected?.id, requestedId, select]);

  const annotations = useAnnotations(selected?.id ?? null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<number | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<number | null>(null);
  const [pendingAnnotationDelete, setPendingAnnotationDelete] = useState<Annotation | null>(null);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const { setAnnotationCount } = screenshots;

  useEffect(() => {
    setSelectedAnnotationId(null);
    setHoveredAnnotationId(null);
  }, [selected?.id]);

  // Escape clears the selection, unless it belongs to a text field or dialog (which handle it themselves).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("textarea, input, dialog, [role='dialog']")) return;
      setSelectedAnnotationId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const deleteAnnotation = async (annotation: Annotation) => {
    await annotations.remove(annotation.id);
    setSelectedAnnotationId((id) => (id === annotation.id ? null : id));
    setHoveredAnnotationId((id) => (id === annotation.id ? null : id));
  };

  // The sidebar badge follows the loaded list, so creates and deletes update it without a refetch.
  useEffect(() => {
    if (selected && annotations.loaded) setAnnotationCount(selected.id, annotations.data.length);
  }, [selected, annotations.loaded, annotations.data.length, setAnnotationCount]);

  const upload = async (files: File[]) => {
    setUploadError(null);
    try {
      const added = await screenshots.upload(files);
      if (added.length > 0) select(added[0].id);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
      throw e;
    }
  };

  if (projectError) {
    return (
      <div className={styles.page}>
        <Header name="" />
        <main className={styles.message}>
          <ErrorBanner message={projectError} />
          <Link to="/">Back to projects</Link>
        </main>
      </div>
    );
  }

  const list = screenshots.data;

  return (
    <div className={styles.page}>
      <Header name={project?.name ?? ""}>
        {list.length > 0 && <UploadButton onUpload={upload} />}
      </Header>

      {uploadError && (
        <div className={styles.banner}>
          <ErrorBanner message={uploadError} onDismiss={() => setUploadError(null)} />
        </div>
      )}

      {screenshots.error ? (
        <main className={styles.message}>
          <ErrorBanner message={screenshots.error} onRetry={screenshots.reload} />
        </main>
      ) : screenshots.loading || !project ? (
        <main className={styles.message}>
          <Spinner />
        </main>
      ) : list.length === 0 ? (
        <main className={styles.message}>
          <EmptyState title="Upload a screenshot to start" hint="PNG, JPEG, WebP or GIF, up to 10 MB each." />
          <UploadButton onUpload={upload} />
        </main>
      ) : (
        <div className={styles.grid}>
          <aside className={styles.sidebar}>
            <ScreenshotSidebar
              screenshots={list}
              selectedId={selected?.id ?? null}
              onSelect={select}
              onDelete={setPendingDelete}
            />
          </aside>
          <main className={styles.viewer}>
            {selected && (
              <ScreenshotViewer
                key={selected.id}
                screenshot={selected}
                zoom={zoom}
                onZoomChange={setZoom}
                annotations={annotations.data}
                selectedAnnotationId={selectedAnnotationId}
                hoveredAnnotationId={hoveredAnnotationId}
                onSelectAnnotation={setSelectedAnnotationId}
                onHoverAnnotation={setHoveredAnnotationId}
                onCreateAnnotation={annotations.create}
              />
            )}
          </main>
          <aside className={styles.comments} aria-label="Comments">
            <CommentPanel
              annotations={annotations.data}
              loading={annotations.loading}
              error={annotations.error}
              onRetry={annotations.reload}
              selectedId={selectedAnnotationId}
              hoveredId={hoveredAnnotationId}
              onSelect={setSelectedAnnotationId}
              onHover={setHoveredAnnotationId}
              onUpdate={(id, comment) => annotations.update(id, { comment })}
              onDelete={setPendingAnnotationDelete}
            />
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete screenshot?"
        message={
          pendingDelete
            ? `"${pendingDelete.original_filename}" and its comments will be permanently deleted.`
            : ""
        }
        onConfirm={() => screenshots.remove(pendingDelete!.id)}
        onClose={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={pendingAnnotationDelete !== null}
        title="Delete comment?"
        message={
          pendingAnnotationDelete
            ? `Comment #${pendingAnnotationDelete.number} will be permanently deleted. Its number won't be reused.`
            : ""
        }
        onConfirm={() => deleteAnnotation(pendingAnnotationDelete!)}
        onClose={() => setPendingAnnotationDelete(null)}
      />
    </div>
  );
}

function Header({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <header className={styles.header}>
      <Link to="/" className="icon" aria-label="Back to projects">
        <ArrowLeft size={18} />
      </Link>
      <h1 className={styles.name}>{name}</h1>
      <div className={styles.actions}>{children}</div>
    </header>
  );
}
