import { useEffect, useState } from 'react'
import { FolderOpen, Plus, Trash2 } from 'lucide-react'
import { api, type Project } from './api'
import Workspace from './Workspace'

export default function App() {
  const [openProjectId, setOpenProjectId] = useState<number | null>(null)

  if (openProjectId !== null) {
    return <Workspace projectId={openProjectId} onBack={() => setOpenProjectId(null)} />
  }
  return <ProjectList onOpen={setOpenProjectId} />
}

function ProjectList({ onOpen }: { onOpen: (id: number) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api.listProjects().then(setProjects).catch((e) => setError(e.message))
  }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const project = await api.createProject(name)
      setProjects((prev) => [project, ...(prev ?? [])])
      setName('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function remove(project: Project) {
    if (!window.confirm(`Delete "${project.name}" and all its screenshots?`)) return
    try {
      await api.deleteProject(project.id)
      setProjects((prev) => prev!.filter((p) => p.id !== project.id))
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <main className="projects-page">
      <h1>Screenshot Annotator</h1>

      <form className="create-form" onSubmit={create}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" maxLength={100} />
        <button type="submit" disabled={!name.trim()}>
          <Plus size={16} /> Create
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {projects === null && !error && <p className="muted">Loading…</p>}
      {projects?.length === 0 && <p className="muted">No projects yet.</p>}

      <ul className="project-list">
        {projects?.map((p) => (
          <li key={p.id}>
            <button className="project-open" onClick={() => onOpen(p.id)}>
              <FolderOpen size={18} />
              <span className="project-name">{p.name}</span>
              <span className="muted">
                {p.screenshot_count} screenshot{p.screenshot_count === 1 ? '' : 's'}
              </span>
            </button>
            <button className="icon-button" title="Delete project" onClick={() => remove(p)}>
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
