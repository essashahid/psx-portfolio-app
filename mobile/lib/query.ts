import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiError } from "./api";

/**
 * The client every screen reads through.
 *
 * The app used to fetch on every mount from a null state, so each tab switch
 * threw away a result it had just received and redrew a skeleton for two
 * seconds. Cached data is served first and revalidated behind the render
 * instead, which is the whole difference between a screen that repaints
 * instantly and one that reloads.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Long enough that moving between tabs does not refetch, short enough
      // that a screen returned to after a minute is checked again.
      staleTime: 30_000,
      // Kept in memory well past staleness: an old answer on screen while a
      // fresh one loads always beats a skeleton.
      gcTime: 24 * 60 * 60 * 1000,
      retry: (failureCount, error) => {
        // A refused or missing resource will be refused again. Only network
        // and server faults are worth a second attempt.
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
      // The screen is already showing the last good answer, so a silent
      // refetch on return is right; refetching on every remount is not.
      refetchOnMount: "always",
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Survives the process, so a cold start opens on the portfolio rather than on
 * a skeleton while the first request crosses two oceans.
 */
export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "plumb.query",
  throttleTime: 2_000,
});
