import { useCallback, useEffect, useState } from "react";
import * as api from "../services/endpoints";
import type { Project } from "../types/api";

export function useProjects() {
  const [data, setData] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.listProjects());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = async (name: string) => {
    const project = await api.createProject(name);
    setData((prev) => [project, ...prev]);
    return project;
  };

  const remove = async (id: number) => {
    await api.deleteProject(id);
    setData((prev) => prev.filter((p) => p.id !== id));
  };

  return { data, loading, error, reload, create, remove };
}
