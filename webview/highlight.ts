import type { display } from 'objdiff-wasm';

type ArgumentValue =
  | display.DiffTextSigned
  | display.DiffTextUnsigned
  | display.DiffTextOpaque;

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

function argEq(a: display.DiffText, b: ArgumentValue): boolean {
  if (a.tag === 'signed') {
    if (b.tag === 'signed') {
      return a.val === b.val;
    }
    if (b.tag === 'unsigned') {
      return bigintAbs(a.val) === b.val;
    }
  }
  if (a.tag === 'unsigned') {
    if (b.tag === 'signed') {
      return a.val === bigintAbs(b.val);
    }
    if (b.tag === 'unsigned') {
      return a.val === b.val;
    }
  }
  if (a.tag === 'opaque' && b.tag === 'opaque') {
    return a.val === b.val;
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
  text: display.DiffText,
): boolean {
  if (!highlight) {
    return false;
  }
  switch (highlight.type) {
    case 'opcode':
      return text.tag === 'opcode' && text.val.opcode === highlight.opcode;
    case 'argument':
      return argEq(text, highlight.value);
    case 'symbol':
      return text.tag === 'symbol' && text.val.name === highlight.name;
    case 'address':
      return (
        (text.tag === 'address' || text.tag === 'branch-dest') &&
        text.val === highlight.address
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

export function highlightFor(text: display.DiffText): HighlightKind | null {
  switch (text.tag) {
    case 'opcode':
      return { type: 'opcode', opcode: text.val.opcode };
    case 'signed':
    case 'unsigned':
    case 'opaque':
      return { type: 'argument', value: text };
    case 'symbol':
      return { type: 'symbol', name: text.val.name };
    case 'address':
    case 'branch-dest':
      return { type: 'address', address: text.val };
    default:
      return null;
  }
}

export function updateHighlight(
  state: HighlightState,
  text: display.DiffText,
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
