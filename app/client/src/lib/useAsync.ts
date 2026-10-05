import { useCallback, useEffect, useState } from 'react';

export type AsyncState<T> = { status: 'loading' } | { status: 'error'; error: Error } | { status: 'ok'; data: T };

/** Loads once on mount and whenever reload() is called. */
export function useAsync<T>(load: () => Promise<T>): { state: AsyncState<T>; reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => !cancelled && setState({ status: 'ok', data }))
      .catch(
        (err: unknown) =>
          !cancelled && setState({ status: 'error', error: err instanceof Error ? err : new Error(String(err)) })
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setTick((n) => n + 1);
  }, []);

  return { state, reload };
}
