import styles from './SymbolSearchResults.module.css';

import { useEffect, useState } from 'react';
import type { Unit } from '../../shared/config';
import { type SymbolRefByName, setCurrentUnit, useAppStore } from '../state';
import PercentBadge from './PercentBadge';

export type ApiSymbol = {
  unit: string;
  name: string;
  demangledName?: string;
  section: string;
  kind: string;
  matchPercent: number | null;
};

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; results: ApiSymbol[]; total: number }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

const LIMIT = 40;
const DEBOUNCE_MS = 400;

/**
 * Search every symbol in the project through the API server.
 *
 * The browser can't do this itself — it would have to parse and diff all of the
 * project's objects — so it is delegated to `/api/symbols`, which caches them.
 * Degrades to `unavailable` when no API server is running behind `/api`.
 */
export const useProjectSymbolSearch = (query: string): State => {
  const [state, setState] = useState<State>({ status: 'idle' });

  useEffect(() => {
    if (!query || query.length < 2) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState({ status: 'loading' });
      try {
        const response = await fetch(
          `/api/symbols?unit=*&q=${encodeURIComponent(query)}&limit=${LIMIT}`,
          { signal: controller.signal },
        );
        if (cancelled) {
          return;
        }
        if (response.status === 404) {
          setState({ status: 'unavailable' });
          return;
        }
        const body = await response.json();
        if (cancelled) {
          return;
        }
        if (body.error) {
          setState({ status: 'error', message: body.error.message });
          return;
        }
        setState({
          status: 'done',
          results: body.results ?? [],
          total: body.total ?? 0,
        });
      } catch (e) {
        if (!cancelled && (e as Error).name !== 'AbortError') {
          setState({ status: 'unavailable' });
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  return state;
};

/**
 * Symbol hits for the current filter, shown under the file list so that typing
 * a function name finds it even though the list itself is of files.
 */
export const SymbolSearchResults = ({
  query,
  units,
}: {
  query: string;
  units: Unit[];
}) => {
  const state = useProjectSymbolSearch(query);
  const setSelectedSymbol = useAppStore((s) => s.setSelectedSymbol);

  if (state.status === 'idle') {
    return null;
  }
  if (state.status === 'unavailable') {
    return (
      <div className={styles.results}>
        <div className={styles.heading}>Functions</div>
        <div className={styles.message}>
          Symbol search requires the API server. Run{' '}
          <code>pnpm dev</code> to enable it.
        </div>
      </div>
    );
  }

  const open = (symbol: ApiSymbol) => {
    const unit = units.find((u) => u.name === symbol.unit);
    if (!unit) {
      return;
    }
    const ref: SymbolRefByName = {
      symbolName: symbol.name,
      sectionName: symbol.section,
    };
    // Both sides are looked up by name once the object loads; whichever side
    // doesn't have it simply resolves to nothing.
    setSelectedSymbol(ref, ref);
    setCurrentUnit(unit);
  };

  return (
    <div className={styles.results}>
      <div className={styles.heading}>
        Functions
        {state.status === 'done' && (
          <span className={styles.count}>
            {state.total > state.results.length
              ? `${state.results.length} of ${state.total}`
              : state.total}
          </span>
        )}
      </div>
      {state.status === 'loading' && (
        <div className={styles.message}>Searching all units…</div>
      )}
      {state.status === 'error' && (
        <div className={styles.message}>{state.message}</div>
      )}
      {state.status === 'done' &&
        (state.results.length === 0 ? (
          <div className={styles.message}>No function matches</div>
        ) : (
          state.results.map((symbol) => (
            <button
              type="button"
              key={`${symbol.unit}/${symbol.section}/${symbol.name}`}
              className={styles.row}
              onClick={() => open(symbol)}
              title={symbol.name}
            >
              {symbol.matchPercent != null ? (
                <PercentBadge percent={symbol.matchPercent} />
              ) : (
                <span className={styles.noPercent}>—</span>
              )}
              <span className={styles.name}>
                {symbol.demangledName || symbol.name}
              </span>
              <span className={styles.unit}>{symbol.unit}</span>
            </button>
          ))
        ))}
    </div>
  );
};

export default SymbolSearchResults;
