import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { queryClient } from "./query";

type State<T> = {
  data: T | null;
  error: string | null;
  /** True only when there is nothing to draw. A revalidation is not loading. */
  loading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
};

/**
 * Load one endpoint, with pull-to-refresh.
 *
 * Stale-while-revalidate over a persisted cache: a path fetched before returns
 * its last answer on the first render and refetches behind it, so `loading` is
 * false whenever there is anything to draw, however old. That is what makes a
 * tab switch repaint instantly rather than showing a skeleton.
 *
 * The signature is unchanged from the hand-rolled version this replaced, so
 * every screen reads the same; only the engine underneath is different.
 */
export function useApi<T>(path: string, fallbackMessage: string): State<T> {
  const [refreshing, setRefreshing] = useState(false);
  const client = useQueryClient();

  const query = useQuery<T, Error>({
    queryKey: [path],
    queryFn: () => api<T>(path),
  });

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await client.refetchQueries({ queryKey: [path], exact: true });
    } finally {
      setRefreshing(false);
    }
  }, [client, path]);

  return {
    data: query.data ?? null,
    // Keep showing stale data on a failed refresh rather than blanking a
    // screen the user is reading; the message is only surfaced when there is
    // nothing behind it.
    error: query.isError ? (query.error?.message ?? fallbackMessage) : null,
    loading: query.isPending,
    refreshing,
    refresh,
  };
}

/**
 * Warms a path without rendering it. Used during launch so the fetch overlaps
 * the splash animation rather than following it, and on navigation intent so a
 * screen is often loaded before it mounts.
 */
export function prefetch<T>(path: string): Promise<void> {
  return queryClient
    .prefetchQuery({ queryKey: [path], queryFn: () => api<T>(path) })
    .catch(() => {
      // A failed warm-up is not a failure: the screen will fetch and report.
    });
}
