import type { display } from 'objdiff-wasm';
import { type MatchRange, fuzzyMatchSymbol } from '../../shared/fuzzy';
import type { SearchOptions } from '../state';

export type SymbolMatch = {
  /** Ranges within the symbol's display name that matched, for highlighting. */
  ranges: MatchRange[];
  /** Fuzzy score; 0 when the mode doesn't rank. */
  score: number;
};

export type SymbolFilter = {
  /** Returns null when the symbol should be hidden. */
  match: (symbol: display.SymbolDisplay) => SymbolMatch | null;
  /** Whether anything is actually being filtered out. */
  active: boolean;
  /** Set when the query is an invalid regex; nothing is filtered in that case. */
  error: string | null;
};

const EMPTY: SymbolMatch = { ranges: [], score: 0 };

const rangesOf = (
  haystack: string,
  needle: string,
  caseSensitive: boolean,
): MatchRange[] => {
  const h = caseSensitive ? haystack : haystack.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  const ranges: MatchRange[] = [];
  let from = 0;
  while (true) {
    const at = h.indexOf(n, from);
    if (at < 0) {
      break;
    }
    ranges.push([at, at + n.length]);
    from = at + n.length;
  }
  return ranges;
};

const passesPercent = (
  symbol: display.SymbolDisplay,
  filter: SearchOptions['percentFilter'],
): boolean => {
  if (filter === 'all') {
    return true;
  }
  const percent = symbol.matchPercent;
  if (filter === 'complete') {
    return percent != null && percent >= 100;
  }
  // 'incomplete': symbols with no percentage at all are unfinished work too.
  return percent == null || percent < 100;
};

/**
 * Build a predicate for the symbol list from the current query and options.
 *
 * Regex mode is handled here rather than by passing `regex` down to the WASM so
 * that an invalid pattern degrades to "show everything with an error message"
 * instead of throwing, and so all three modes share one code path.
 */
export const createSymbolFilter = (
  search: string | null,
  options: SearchOptions,
): SymbolFilter => {
  const query = search ?? '';
  const { mode, caseSensitive, percentFilter } = options;

  let regex: RegExp | null = null;
  let error: string | null = null;
  if (mode === 'regex' && query) {
    try {
      regex = new RegExp(query, caseSensitive ? '' : 'i');
    } catch (e) {
      error =
        e instanceof Error
          ? e.message.replace(/^Invalid regular expression:\s*/, '')
          : String(e);
    }
  }

  const active = (query !== '' && !error) || percentFilter !== 'all';

  return {
    active,
    error,
    match: (symbol) => {
      if (!passesPercent(symbol, percentFilter)) {
        return null;
      }
      if (!query || error) {
        return EMPTY;
      }
      const name = symbol.info.name;
      const displayName = symbol.info.demangledName || name;

      if (regex) {
        if (!regex.test(displayName) && !regex.test(name)) {
          return null;
        }
        const found = displayName.match(regex);
        return {
          ranges:
            found?.index != null
              ? [[found.index, found.index + found[0].length]]
              : [],
          score: 0,
        };
      }

      if (mode === 'substring') {
        const ranges = rangesOf(displayName, query, caseSensitive);
        if (ranges.length > 0) {
          return { ranges, score: 0 };
        }
        return rangesOf(name, query, caseSensitive).length > 0 ? EMPTY : null;
      }

      const fuzzy = fuzzyMatchSymbol(query, name, symbol.info.demangledName);
      return fuzzy ? { ranges: fuzzy.ranges, score: fuzzy.score } : null;
    },
  };
};

/** Split `text` into alternating unmatched/matched chunks for rendering. */
export const splitRanges = (
  text: string,
  ranges: MatchRange[],
): { text: string; matched: boolean }[] => {
  if (ranges.length === 0) {
    return [{ text, matched: false }];
  }
  const parts: { text: string; matched: boolean }[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) {
      parts.push({ text: text.slice(at, start), matched: false });
    }
    parts.push({ text: text.slice(start, end), matched: true });
    at = end;
  }
  if (at < text.length) {
    parts.push({ text: text.slice(at), matched: false });
  }
  return parts;
};
