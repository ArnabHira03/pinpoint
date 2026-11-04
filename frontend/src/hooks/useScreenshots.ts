import { useCallback, useEffect, useState } from "react";
import * as api from "../services/endpoints";
import type { Screenshot } from "../types/api";

export function useScreenshots(projectId: number) {
  const [data, setData] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.listScreenshots(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load screenshots");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const upload = async (files: File[]) => {
    const added = await api.uploadScreenshots(projectId, files);
    setData((prev) => [...prev, ...added]);
    return added;
  };

  const remove = async (id: number) => {
    await api.deleteScreenshot(id);
    setData((prev) => prev.filter((s) => s.id !== id));
  };

  const setAnnotationCount = useCallback((id: number, count: number) => {
    setData((prev) => prev.map((s) => (s.id === id && s.annotation_count !== count ? { ...s, annotation_count: count } : s)));
  }, []);

  return { data, loading, error, reload, upload, remove, setAnnotationCount };
}
