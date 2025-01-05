import type { ArgumentValue } from '../shared/gen/diff_pb';
import type { DiffText } from './diff';

type HighlightKindOpcode = {
  type: 'opcode';
  opcode: number;
};

type HighlightKindArgument = {
  type: 'argument';
  value: ArgumentValue;
};

type HighlightKindSymbol = {
  type: 'symbol';
  name: string;
};

type HighlightKindAddress = {
  type: 'address';
  address: bigint;
};

export type HighlightKind =
  | HighlightKindOpcode
  | HighlightKindArgument
  | HighlightKindSymbol
  | HighlightKindAddress;

export type HighlightState = {
  left: HighlightKind | null;
  right: HighlightKind | null;
};

function bigintAbs(v: bigint): bigint {
  return v < 0n ? -v : v;
}

function argEq(a: ArgumentValue, b: ArgumentValue): boolean {
  if (a.value.oneofKind === 'signed') {
    if (b.value.oneofKind === 'signed') {
      return a.value.signed === b.value.signed;
    }
    if (b.value.oneofKind === 'unsigned') {
      return bigintAbs(a.value.signed) === b.value.unsigned;
    }
  }
  if (a.value.oneofKind === 'unsigned') {
    if (b.value.oneofKind === 'signed') {
      return a.value.unsigned === bigintAbs(b.value.signed);
    }
    if (b.value.oneofKind === 'unsigned') {
      return a.value.unsigned === b.value.unsigned;
    }
  }
  if (a.value.oneofKind === 'opaque' && b.value.oneofKind === 'opaque') {
    return a.value.opaque === b.value.opaque;
  }
  return false;
}

export function highlightColumn(
  state: HighlightState,
  column: number,
): HighlightKind | null {
  return column === 0 ? state.left : state.right;
}

export function highlightMatches(
  highlight: HighlightKind | null,
  text: DiffText,
): boolean {
  if (!highlight) {
    return false;
  }
  switch (highlight.type) {
    case 'opcode':
      return text.type === 'opcode' && text.opcode === highlight.opcode;
    case 'argument':
      return text.type === 'argument' && argEq(text.value, highlight.value);
    case 'symbol':
      return (
        text.type === 'symbol' && text.target.symbol?.name === highlight.name
      );
    case 'address':
      return (
        (text.type === 'address' || text.type === 'branch_dest') &&
        text.address === highlight.address
      );
  }
}

export function highlightEq(a: HighlightKind | null, b: HighlightKind | null) {
  if (a === null) {
    return b === null;
  }
  if (b === null) {
    return false;
  }
  if (a.type === 'opcode' && b.type === 'opcode') {
    return a.opcode === b.opcode;
  }
  if (a.type === 'argument' && b.type === 'argument') {
    return argEq(a.value, b.value);
  }
  if (a.type === 'symbol' && b.type === 'symbol') {
    return a.name === b.name;
  }
  if (a.type === 'address' && b.type === 'address') {
    return a.address === b.address;
  }
  return false;
}

export function highlightFor(text: DiffText): HighlightKind | null {
  switch (text.type) {
    case 'opcode':
      return { type: 'opcode', opcode: text.opcode };
    case 'argument':
      return { type: 'argument', value: text.value };
    case 'symbol':
      return { type: 'symbol', name: text.target.symbol?.name || '' };
    case 'address':
    case 'branch_dest':
      return { type: 'address', address: text.address };
    default:
      return null;
  }
}

export function updateHighlight(
  state: HighlightState,
  text: DiffText,
  column: number,
): HighlightState {
  const highlight = highlightFor(text);
  if (column === 0) {
    if (highlightEq(state.left, highlight)) {
      if (highlightEq(state.right, highlight)) {
        return { left: null, right: null };
      }
      return { left: highlight, right: highlight };
    }
    return { left: highlight, right: state.right };
  }
  if (highlightEq(state.right, highlight)) {
    if (highlightEq(state.left, highlight)) {
      return { left: null, right: null };
    }
    return { left: highlight, right: highlight };
  }
  return { left: state.left, right: highlight };
}

export function serializeHighlightState(state: HighlightState): string {
  return JSON.stringify(state, (_key, value) => {
    if (typeof value === 'bigint') {
      return `${value.toString()}n`;
    }
    return value;
  });
}

export function deserializeHighlightState(data: string | null): HighlightState {
  if (!data) {
    return { left: null, right: null };
  }
  try {
    return JSON.parse(data, (_key, value) => {
      if (typeof value === 'string' && /^\d+n$/.test(value)) {
        return BigInt(value.slice(0, -1));
      }
      return value;
    });
  } catch (e) {
    console.error('Failed to deserialize highlight state:', e);
    return { left: null, right: null };
  }
}
