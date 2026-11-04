import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ImagePlus, Trash2 } from 'lucide-react'
import { api, type Annotation, type Project, type Screenshot } from './api'

type Point = { x: number; y: number }

/**
 * Convert a click to coordinates relative to the rendered image (0..1 on each axis).
 * Uses the <img> element's own box, so sidebars, padding and empty viewer space are excluded.
 * Returns null for clicks outside the image.
 */
export function toNormalized(clientX: number, clientY: number, rect: DOMRect): Point | null {
  const x = (clientX - rect.left) / rect.width
  const y = (clientY - rect.top) / rect.height
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null
  return { x, y }
}

const replaceCount = (s: Screenshot, delta: number) => ({ ...s, annotation_count: s.annotation_count + delta })

export default function Workspace({ projectId, onBack }: { projectId: number; onBack: () => void }) {
  const [project, setProject] = useState<Project | null>(null)
  const [screenshots, setScreenshots] = useState<Screenshot[] | null>(null)
  const [selectedShotId, setSelectedShotId] = useState<number | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null)
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    Promise.all([api.getProject(projectId), api.listScreenshots(projectId)])
      .then(([p, shots]) => {
        setProject(p)
        setScreenshots(shots)
        setSelectedShotId(shots[0]?.id ?? null)
      })
      .catch((e) => setError(e.message))
  }, [projectId])

  useEffect(() => {
    setAnnotations(null)
    setSelectedAnnotationId(null)
    if (selectedShotId === null) return
    let cancelled = false
    api
      .listAnnotations(selectedShotId)
      .then((list) => !cancelled && setAnnotations(list))
      .catch((e) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [selectedShotId])

  const selectedShot = screenshots?.find((s) => s.id === selectedShotId) ?? null

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setError('')
    setUploading(true)
    for (const file of Array.from(files)) {
      try {
        const shot = await api.uploadScreenshot(projectId, file)
        setScreenshots((prev) => [...(prev ?? []), shot])
        setSelectedShotId(shot.id)
      } catch (e) {
        setError(`${file.name}: ${(e as Error).message}`)
      }
    }
    setUploading(false)
  }

  async function removeScreenshot(shot: Screenshot) {
    if (!window.confirm(`Delete "${shot.original_filename}" and its comments?`)) return
    try {
      await api.deleteScreenshot(shot.id)
      const remaining = screenshots!.filter((s) => s.id !== shot.id)
      setScreenshots(remaining)
      if (shot.id === selectedShotId) setSelectedShotId(remaining[0]?.id ?? null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function createAnnotation(point: Point, comment: string) {
    const created = await api.createAnnotation(selectedShotId!, { ...point, comment })
    setAnnotations((prev) => [...(prev ?? []), created])
    setSelectedAnnotationId(created.id)
    setScreenshots((prev) => prev!.map((s) => (s.id === created.screenshot_id ? replaceCount(s, 1) : s)))
  }

  async function removeAnnotation(a: Annotation) {
    if (!window.confirm(`Delete comment #${a.number}?`)) return
    try {
      await api.deleteAnnotation(a.id)
      setAnnotations((prev) => prev!.filter((x) => x.id !== a.id))
      setScreenshots((prev) => prev!.map((s) => (s.id === a.screenshot_id ? replaceCount(s, -1) : s)))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="workspace">
      <header className="workspace-header">
        <button className="icon-button" onClick={onBack} title="Back to projects">
          <ArrowLeft size={18} />
        </button>
        <h1>{project?.name ?? 'Loading…'}</h1>
        <label className={`upload-button ${uploading ? 'disabled' : ''}`}>
          <ImagePlus size={16} /> {uploading ? 'Uploading…' : 'Add screenshots'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            disabled={uploading}
            onChange={(e) => {
              upload(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
      </header>

      {error && (
        <p className="error banner" onClick={() => setError('')}>
          {error} <span className="muted">(click to dismiss)</span>
        </p>
      )}

      <div className="workspace-body">
        <aside className="screenshot-list">
          {screenshots?.length === 0 && <p className="muted">Upload a screenshot to start.</p>}
          {screenshots?.map((s) => (
            <div key={s.id} className={`thumb ${s.id === selectedShotId ? 'selected' : ''}`}>
              <button className="thumb-image" onClick={() => setSelectedShotId(s.id)} title={s.original_filename}>
                <img src={s.image_url} alt={s.original_filename} loading="lazy" />
              </button>
              <div className="thumb-meta">
                <span className="thumb-name">{s.original_filename}</span>
                <span className="badge">{s.annotation_count}</span>
                <button className="icon-button" title="Delete screenshot" onClick={() => removeScreenshot(s)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </aside>

        <section className="viewer">
          {selectedShot ? (
            <Viewer
              key={selectedShot.id}
              screenshot={selectedShot}
              annotations={annotations ?? []}
              selectedId={selectedAnnotationId}
              onSelect={setSelectedAnnotationId}
              onCreate={createAnnotation}
            />
          ) : (
            <p className="muted">{screenshots === null ? 'Loading…' : 'No screenshot selected.'}</p>
          )}
        </section>

        <CommentPanel
          annotations={selectedShot ? annotations : []}
          selectedId={selectedAnnotationId}
          onSelect={setSelectedAnnotationId}
          onDelete={removeAnnotation}
        />
      </div>
    </div>
  )
}

function Viewer(props: {
  screenshot: Screenshot
  annotations: Annotation[]
  selectedId: number | null
  onSelect: (id: number) => void
  onCreate: (point: Point, comment: string) => Promise<void>
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [draft, setDraft] = useState<Point | null>(null)
  const [broken, setBroken] = useState(false)

  function handleClick(e: React.MouseEvent) {
    if (draft || !imgRef.current) return
    const point = toNormalized(e.clientX, e.clientY, imgRef.current.getBoundingClientRect())
    if (point) setDraft(point)
  }

  if (broken) return <p className="error">Image file is unavailable.</p>

  return (
    // The frame is exactly the size of the rendered image, so percentage positions map 1:1 onto it.
    <div className="image-frame" onClick={handleClick}>
      <img ref={imgRef} src={props.screenshot.image_url} alt={props.screenshot.original_filename} onError={() => setBroken(true)} draggable={false} />

      {props.annotations.map((a) => (
        <button
          key={a.id}
          className={`marker ${a.id === props.selectedId ? 'selected' : ''}`}
          style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%` }}
          aria-label={`Annotation ${a.number}`}
          onClick={(e) => {
            e.stopPropagation() // selecting a marker must not create a new one
            props.onSelect(a.id)
          }}
        >
          {a.number}
        </button>
      ))}

      {draft && (
        <>
          <span className="marker draft" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%` }} />
          <AnnotationEditor
            point={draft}
            onCancel={() => setDraft(null)}
            onSave={async (comment) => {
              await props.onCreate(draft, comment)
              setDraft(null)
            }}
          />
        </>
      )}
    </div>
  )
}

function AnnotationEditor(props: { point: Point; onSave: (comment: string) => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try {
      await props.onSave(text)
    } catch (e) {
      setError((e as Error).message) // keep the draft open; nothing is shown as saved
      setSaving(false)
    }
  }

  // Open towards the side with more room so the editor stays inside the image.
  const style: React.CSSProperties = {
    ...(props.point.x > 0.6 ? { right: `${(1 - props.point.x) * 100}%` } : { left: `${props.point.x * 100}%` }),
    ...(props.point.y > 0.7 ? { bottom: `${(1 - props.point.y) * 100}%` } : { top: `${props.point.y * 100}%` }),
  }

  return (
    <div className="editor" style={style} onClick={(e) => e.stopPropagation()}>
      <textarea
        autoFocus
        value={text}
        placeholder="Add a comment…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onCancel()
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) save()
        }}
      />
      {error && <p className="error">{error}</p>}
      <div className="editor-actions">
        <button className="secondary" onClick={props.onCancel} disabled={saving}>
          Cancel
        </button>
        <button onClick={save} disabled={saving || !text.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function CommentPanel(props: {
  annotations: Annotation[] | null
  selectedId: number | null
  onSelect: (id: number) => void
  onDelete: (a: Annotation) => void
}) {
  const listRef = useRef<HTMLOListElement>(null)

  // When a marker is clicked, bring its comment into view.
  useEffect(() => {
    listRef.current?.querySelector('.comment.selected')?.scrollIntoView({ block: 'nearest' })
  }, [props.selectedId])

  return (
    <aside className="comment-panel">
      <h2>Comments {props.annotations ? `(${props.annotations.length})` : ''}</h2>
      {props.annotations === null && <p className="muted">Loading…</p>}
      {props.annotations?.length === 0 && <p className="muted">Click the image to add a comment.</p>}
      <ol ref={listRef}>
        {props.annotations?.map((a) => (
          <li
            key={a.id}
            className={`comment ${a.id === props.selectedId ? 'selected' : ''}`}
            onClick={() => props.onSelect(a.id)}
          >
            <span className="comment-number">{a.number}</span>
            <p>{a.comment}</p>
            <button
              className="icon-button"
              title="Delete comment"
              onClick={(e) => {
                e.stopPropagation()
                props.onDelete(a)
              }}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ol>
    </aside>
  )
}
