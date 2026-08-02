/** A contiguous `[start, end)` slice of the target that the query matched. */
export type MatchRange = [number, number];

export type FuzzyMatch = {
  /** Higher is better. Only comparable between matches against the same query. */
  score: number;
  ranges: MatchRange[];
};

const BONUS_CONSECUTIVE = 8;
const BONUS_WORD_START = 10;
const BONUS_CAMEL_CASE = 6;
const BONUS_EXACT_CASE = 2;
const PENALTY_SKIP = 1;
const PENALTY_LEADING = 3;
const MAX_LEADING_PENALTY = 9;

const isWordSeparator = (c: string) =>
  c === '_' || c === '.' || c === '-' || c === '$' || c === ':' || c === ' ';

/**
 * Greedy subsequence match with positional scoring.
 *
 * Every query character must appear in `target` in order. Matches at word
 * starts (after `_`, `.`, `-`, `$`, `:`) and at camelCase boundaries score
 * higher, as do runs of consecutive characters — so `sfx` ranks
 * `Sound_FX_init` above `stuff_matrix`.
 *
 * Returns `null` when the query is not a subsequence of the target.
 */
export const fuzzyMatch = (
  query: string,
  target: string,
): FuzzyMatch | null => {
  if (query.length === 0) {
    return { score: 0, ranges: [] };
  }
  if (query.length > target.length) {
    return null;
  }

  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();

  // Fast path: an exact substring hit always beats a scattered match.
  const substringAt = lowerTarget.indexOf(lowerQuery);
  if (substringAt >= 0) {
    const wordStart =
      substringAt === 0 || isWordSeparator(target[substringAt - 1]);
    return {
      score:
        1000 +
        query.length * BONUS_CONSECUTIVE +
        (wordStart ? BONUS_WORD_START * 2 : 0) -
        Math.min(substringAt * PENALTY_LEADING, MAX_LEADING_PENALTY),
      ranges: [[substringAt, substringAt + query.length]],
    };
  }

  const ranges: MatchRange[] = [];
  let score = 0;
  let targetIndex = 0;
  let previousMatch = -2;

  for (let q = 0; q < lowerQuery.length; q++) {
    const wanted = lowerQuery[q];
    let found = -1;
    for (let t = targetIndex; t < lowerTarget.length; t++) {
      if (lowerTarget[t] === wanted) {
        found = t;
        break;
      }
    }
    if (found < 0) {
      return null;
    }

    if (found === previousMatch + 1) {
      score += BONUS_CONSECUTIVE;
      ranges[ranges.length - 1][1] = found + 1;
    } else {
      score -= Math.min((found - targetIndex) * PENALTY_SKIP, 6);
      ranges.push([found, found + 1]);
    }

    const prev = found > 0 ? target[found - 1] : '';
    if (found === 0 || isWordSeparator(prev)) {
      score += BONUS_WORD_START;
    } else if (
      prev === prev.toLowerCase() &&
      target[found] === target[found].toUpperCase() &&
      target[found] !== target[found].toLowerCase()
    ) {
      score += BONUS_CAMEL_CASE;
    }
    if (target[found] === query[q]) {
      score += BONUS_EXACT_CASE;
    }

    previousMatch = found;
    targetIndex = found + 1;
  }

  // Prefer shorter targets when everything else is equal.
  score -= Math.min(target.length - query.length, 20) / 4;
  return { score, ranges };
};

/**
 * Match a query against a symbol's mangled and demangled names, keeping
 * whichever scores higher. Ranges always refer to `displayName`.
 */
export const fuzzyMatchSymbol = (
  query: string,
  name: string,
  demangledName: string | undefined,
): FuzzyMatch | null => {
  const displayName = demangledName || name;
  const primary = fuzzyMatch(query, displayName);
  if (displayName === name) {
    return primary;
  }
  const secondary = fuzzyMatch(query, name);
  if (!primary) {
    // Matched the mangled name only; we have no ranges for the display name.
    return secondary ? { score: secondary.score - 5, ranges: [] } : null;
  }
  if (secondary && secondary.score > primary.score) {
    return { score: secondary.score, ranges: primary.ranges };
  }
  return primary;
};
