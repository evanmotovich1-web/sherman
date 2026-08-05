import { useCallback, useEffect, useState } from 'react';
import { LiveClientError } from '../data/live-client';

type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string };

function genericMessage(error: unknown) {
  return error instanceof LiveClientError ? error.message : 'Commons could not be loaded.';
}

export function useResource<T>(load: () => T | Promise<T>, dependencies: readonly unknown[]) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading' });
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    Promise.resolve().then(load).then(
      (data) => { if (current) setState({ status: 'success', data }); },
      (error: unknown) => { if (current) setState({ status: 'error', message: genericMessage(error) }); },
    );
    return () => { current = false; };
    // The caller supplies the identity values that invalidate its loader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, attempt]);

  return { state, retry };
}

export function LoadingState({ label }: { label: string }) {
  return <p className="resource-panel" role="status" aria-label={`Loading ${label}`}>Loading {label}…</p>;
}

export function ErrorState({ label, message, retry }: { label: string; message: string; retry: () => void }) {
  return (
    <div className="resource-panel" role="alert">
      <p>{message}</p>
      <button type="button" onClick={retry} aria-label={`Retry ${label}`}>Retry</button>
    </div>
  );
}

export function EmptyState({ label, children }: { label: string; children: React.ReactNode }) {
  return <p className="resource-panel" role="status" aria-label={`${label} is empty`}>{children}</p>;
}
