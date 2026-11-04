export type Project = {
  id: number
  name: string
  created_at: string
  updated_at: string
  screenshot_count: number
}

export type Screenshot = {
  id: number
  project_id: number
  original_filename: string
  mime_type: string
  file_size: number
  created_at: string
  annotation_count: number
  image_url: string
}

export type Annotation = {
  id: number
  screenshot_id: number
  number: number
  x: number
  y: number
  comment: string
  created_at: string
  updated_at: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const detail = body?.detail
    // FastAPI validation errors come back as a list of {msg}.
    const message = Array.isArray(detail) ? detail.map((d) => d.msg).join(', ') : detail
    throw new Error(message || `Request failed (${res.status})`)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  listProjects: () => request<Project[]>('/projects'),
  getProject: (id: number) => request<Project>(`/projects/${id}`),
  createProject: (name: string) => request<Project>('/projects', json('POST', { name })),
  deleteProject: (id: number) => request<void>(`/projects/${id}`, { method: 'DELETE' }),

  listScreenshots: (projectId: number) => request<Screenshot[]>(`/projects/${projectId}/screenshots`),
  uploadScreenshot: (projectId: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<Screenshot>(`/projects/${projectId}/screenshots`, { method: 'POST', body: form })
  },
  deleteScreenshot: (id: number) => request<void>(`/screenshots/${id}`, { method: 'DELETE' }),

  listAnnotations: (screenshotId: number) => request<Annotation[]>(`/screenshots/${screenshotId}/annotations`),
  createAnnotation: (screenshotId: number, body: { x: number; y: number; comment: string }) =>
    request<Annotation>(`/screenshots/${screenshotId}/annotations`, json('POST', body)),
  deleteAnnotation: (id: number) => request<void>(`/annotations/${id}`, { method: 'DELETE' }),
}
