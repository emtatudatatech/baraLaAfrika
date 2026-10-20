import { useCallback, useEffect, useState } from 'react';

/*
 * A tiny cached data loader: one in-flight request per key, results shared by every component
 * that asks for the same key during the session, and an explicit retry after errors.
 */

type Settled<T> = { status: 'success'; data: T } | { status: 'error'; error: Error };

const settled = new Map<string, Settled<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

export type Resource<T> =
  | { status: 'loading'; data?: undefined; error?: undefined; retry: () => void }
  | { status: 'success'; data: T; error?: undefined; retry: () => void }
  | { status: 'error'; data?: undefined; error: Error; retry: () => void };

function load<T>(key: string, loader: () => Promise<T>): Promise<T> {
  let promise = inFlight.get(key) as Promise<T> | undefined;
  if (!promise) {
    promise = loader().then(
      (data) => {
        settled.set(key, { status: 'success', data });
        inFlight.delete(key);
        return data;
      },
      (error: unknown) => {
        settled.set(key, {
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        });
        inFlight.delete(key);
        throw error;
      },
    );
    inFlight.set(key, promise);
  }
  return promise;
}

/** Load `key` with `loader` (pass key = null to wait). */
export function useResource<T>(key: string | null, loader: () => Promise<T>): Resource<T> {
  const [version, setVersion] = useState(0);
  const [, rerender] = useState(0);

  useEffect(() => {
    if (key === null || settled.has(key)) return;
    let active = true;
    load(key, loader).then(
      () => {
        if (active) rerender((n) => n + 1);
      },
      () => {
        if (active) rerender((n) => n + 1);
      },
    );
    return () => {
      active = false;
    };
    // The loader is identified by its key; a new function identity alone must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  const retry = useCallback(() => {
    if (key === null) return;
    settled.delete(key);
    setVersion((n) => n + 1);
  }, [key]);

  const entry = key === null ? undefined : (settled.get(key) as Settled<T> | undefined);
  if (!entry) return { status: 'loading', retry };
  return entry.status === 'success'
    ? { status: 'success', data: entry.data, retry }
    : { status: 'error', error: entry.error, retry };
}

/** For tests: forget every cached result. */
export function clearResourceCache(): void {
  settled.clear();
  inFlight.clear();
}
