import type { Annotation, AnnotationInput, Health, Project, Screenshot } from "../types/api";
import { request } from "./api";

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const getHealth = () => request<Health>("/health");

export const listProjects = () => request<Project[]>("/projects");
export const getProject = (id: number) => request<Project>(`/projects/${id}`);
export const createProject = (name: string) => request<Project>("/projects", json("POST", { name }));
export const deleteProject = (id: number) => request<void>(`/projects/${id}`, { method: "DELETE" });

export const listScreenshots = (projectId: number) => request<Screenshot[]>(`/projects/${projectId}/screenshots`);
export const deleteScreenshot = (id: number) => request<void>(`/screenshots/${id}`, { method: "DELETE" });
export const uploadScreenshots = (projectId: number, files: File[]) => {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  return request<Screenshot[]>(`/projects/${projectId}/screenshots`, { method: "POST", body });
};

export const listAnnotations = (screenshotId: number) =>
  request<Annotation[]>(`/screenshots/${screenshotId}/annotations`);
export const createAnnotation = (screenshotId: number, input: AnnotationInput) =>
  request<Annotation>(`/screenshots/${screenshotId}/annotations`, json("POST", input));
export const updateAnnotation = (id: number, changes: Partial<AnnotationInput>) =>
  request<Annotation>(`/annotations/${id}`, json("PATCH", changes));
export const deleteAnnotation = (id: number) => request<void>(`/annotations/${id}`, { method: "DELETE" });
