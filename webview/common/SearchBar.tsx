import styles from './SearchBar.module.css';

import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PercentFilter, SearchMode, SearchOptions } from '../state';

const MODE_LABELS: Record<SearchMode, { icon: string; title: string }> = {
  fuzzy: {
    icon: '~',
    title:
      'Fuzzy match — type the letters in order, e.g. "sfxi" finds "Sound_FX_init"',
  },
  substring: {
    icon: 'ab',
    title: 'Plain text — match the query literally',
  },
  regex: {
    icon: '.*',
    title: 'Regular expression',
  },
};

const PERCENT_LABELS: Record<PercentFilter, { icon: string; title: string }> = {
  all: {
    icon: '%',
    title: 'Showing all symbols — click to show only unfinished',
  },
  incomplete: {
    icon: '<%',
    title: 'Showing only symbols below 100% — click to show only matched',
  },
  complete: {
    icon: '=%',
    title: 'Showing only fully matched symbols — click to show all',
  },
};

const NEXT_MODE: Record<SearchMode, SearchMode> = {
  fuzzy: 'substring',
  substring: 'regex',
  regex: 'fuzzy',
};

const NEXT_PERCENT: Record<PercentFilter, PercentFilter> = {
  all: 'incomplete',
  incomplete: 'complete',
  complete: 'all',
};

const DEBOUNCE_MS = 150;

/**
 * The symbol filter bar.
 *
 * The input is debounced because every keystroke re-runs the diff display over
 * every symbol in the object; typing into an unthrottled input on a large
 * object is visibly janky.
 */
export const SearchBar = ({
  search,
  options,
  resultCount,
  totalCount,
  error,
  onSearchChange,
  onOptionsChange,
  placeholder = 'Filter symbols',
  noun = 'symbols',
  showPercentFilter = true,
  hint,
}: {
  search: string | null;
  options: SearchOptions;
  resultCount: number;
  totalCount: number;
  error: string | null;
  onSearchChange: (search: string | null) => void;
  onOptionsChange: (options: Partial<SearchOptions>) => void;
  placeholder?: string;
  /** Plural noun used in the result counter. */
  noun?: string;
  /** The percentage filter only makes sense where match percentages exist. */
  showPercentFilter?: boolean;
  hint?: React.ReactNode;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(search ?? '');
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Keep the input in sync when the search is changed elsewhere (e.g. cleared
  // on unit switch), but never fight the user mid-keystroke.
  useEffect(() => {
    if (timeoutRef.current == null) {
      setDraft(search ?? '');
    }
  }, [search]);

  const commit = useCallback(
    (value: string) => {
      timeoutRef.current = undefined;
      onSearchChange(value === '' ? null : value);
    },
    [onSearchChange],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setDraft(value);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => commit(value), DEBOUNCE_MS);
    },
    [commit],
  );

  const clear = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
    setDraft('');
    onSearchChange(null);
    inputRef.current?.focus();
  }, [onSearchChange]);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  // Ctrl+F / Cmd+F focuses the filter, matching what every other editor does.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'f') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (draft) {
          clear();
        } else {
          inputRef.current?.blur();
        }
      }
    },
    [clear, draft],
  );

  const filtering =
    search != null || (showPercentFilter && options.percentFilter !== 'all');
  const mode = MODE_LABELS[options.mode];
  const percent = PERCENT_LABELS[options.percentFilter];

  return (
    <div className={styles.searchBar}>
      <div className={styles.inputRow}>
        <div className={clsx(styles.inputWrap, error && styles.invalid)}>
          <span className={clsx(styles.searchIcon, 'codicon codicon-search')} />
          <input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={draft}
            onChange={onChange}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          {draft && (
            <button
              type="button"
              className={styles.clearButton}
              title="Clear filter (Esc)"
              onClick={clear}
            >
              <span className="codicon codicon-close" />
            </button>
          )}
        </div>
        <button
          type="button"
          className={clsx(
            styles.toggle,
            options.mode !== 'fuzzy' && styles.active,
          )}
          title={mode.title}
          onClick={() => onOptionsChange({ mode: NEXT_MODE[options.mode] })}
        >
          {mode.icon}
        </button>
        <button
          type="button"
          className={clsx(
            styles.toggle,
            options.caseSensitive && styles.active,
          )}
          title={
            options.caseSensitive
              ? 'Case sensitive — click to ignore case'
              : 'Ignoring case — click to match case'
          }
          onClick={() =>
            onOptionsChange({ caseSensitive: !options.caseSensitive })
          }
        >
          Aa
        </button>
        {showPercentFilter && (
          <button
            type="button"
            className={clsx(
              styles.toggle,
              options.percentFilter !== 'all' && styles.active,
            )}
            title={percent.title}
            onClick={() =>
              onOptionsChange({
                percentFilter: NEXT_PERCENT[options.percentFilter],
              })
            }
          >
            {percent.icon}
          </button>
        )}
      </div>
      <div className={clsx(styles.status, error && styles.error)}>
        {error ? (
          <span title={error}>Invalid regex: {error}</span>
        ) : filtering ? (
          <span>
            {resultCount} of {totalCount} {noun}
          </span>
        ) : (
          <span>
            {totalCount} {noun}
          </span>
        )}
        {hint !== undefined ? (
          hint && <span className={styles.hint}>{hint}</span>
        ) : (
          <span className={styles.hint}>
            <kbd>Ctrl</kbd>+<kbd>P</kbd> go to symbol
          </span>
        )}
      </div>
    </div>
  );
};

export default SearchBar;
