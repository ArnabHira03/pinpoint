import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../services/endpoints";
import type { Annotation, AnnotationInput } from "../types/api";

const byNumber = (a: Annotation, b: Annotation) => a.number - b.number;

/** Annotations for the selected screenshot, cached per screenshot for the session. */
export function useAnnotations(screenshotId: number | null) {
  const [cache, setCache] = useState<Record<number, Annotation[]>>({});
  const [error, setError] = useState<string | null>(null);
  const currentId = useRef(screenshotId);
  currentId.current = screenshotId;

  const load = useCallback(async (id: number) => {
    setError(null);
    try {
      const list = await api.listAnnotations(id);
      setCache((prev) => ({ ...prev, [id]: list }));
    } catch (e) {
      if (currentId.current === id) setError(e instanceof Error ? e.message : "Failed to load comments");
    }
  }, []);

  const loaded = screenshotId !== null && screenshotId in cache;

  useEffect(() => {
    setError(null);
    if (screenshotId !== null && !loaded) load(screenshotId);
  }, [screenshotId, loaded, load]);

  const put = (id: number, update: (list: Annotation[]) => Annotation[]) =>
    setCache((prev) => ({ ...prev, [id]: update(prev[id] ?? []) }));

  const create = async (input: AnnotationInput) => {
    const id = screenshotId!;
    const created = await api.createAnnotation(id, input);
    put(id, (list) => [...list, created].sort(byNumber));
    return created;
  };

  const update = async (annotationId: number, changes: Partial<AnnotationInput>) => {
    const id = screenshotId!;
    const updated = await api.updateAnnotation(annotationId, changes);
    put(id, (list) => list.map((a) => (a.id === annotationId ? updated : a)));
    return updated;
  };

  const remove = async (annotationId: number) => {
    const id = screenshotId!;
    await api.deleteAnnotation(annotationId);
    put(id, (list) => list.filter((a) => a.id !== annotationId));
  };

  return {
    data: screenshotId !== null ? (cache[screenshotId] ?? []) : [],
    loaded,
    loading: screenshotId !== null && !loaded && error === null,
    error,
    reload: () => {
      if (screenshotId !== null) load(screenshotId);
    },
    create,
    update,
    remove,
  };
}
