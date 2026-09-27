import { useEffect, useState } from "react";
import type { PageMeta } from "@cp-notes/shared";
import { ApiError, type Paged } from "./api";

export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function usePagedResource<T>(
  load: (signal: AbortSignal) => Promise<Paged<T>>,
  dependencies: readonly unknown[],
): { data: T[]; meta: PageMeta | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void load(controller.signal)
      .then((result) => {
        setData(result.data);
        setMeta(result.meta);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof ApiError || caught instanceof Error ? caught.message : "The request failed");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // Callers provide the exact reload dependencies; including the inline loader would refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return { data, meta, loading, error };
}
