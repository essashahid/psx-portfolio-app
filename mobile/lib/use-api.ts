import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

type State<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
};

/**
 * Load one endpoint, with pull-to-refresh. Keeps the last good data on a failed
 * refresh so a dropped connection does not blank a screen the user is reading.
 */
export function useApi<T>(path: string, fallbackMessage: string): State<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallbackMessage);
    }
  }, [path, fallbackMessage]);

  useEffect(() => {
    let active = true;
    load().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return { data, error, loading, refreshing, refresh };
}
