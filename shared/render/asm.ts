import type { display } from 'objdiff-wasm';

/**
 * Semantic color of a rendered span. Mirrors `display.DiffTextColor`, with
 * `rotating` carrying its rotation index separately.
 */
export type SpanColor =
  | 'normal'
  | 'dim'
  | 'bright'
  | 'replace'
  | 'data-flow'
  | 'delete'
  | 'insert'
  | 'rotating';

/** Number of distinct rotation colors available. */
export const ROTATION_COUNT = 9;

/**
 * A single renderable run of text from an instruction row. Framework-agnostic:
 * the webview turns these into React spans, the server turns them into HTML or
 * plain text.
 */
export type AsmSpan = {
  text: string;
  color: SpanColor;
  /** Only set when `color === 'rotating'`. Already reduced modulo ROTATION_COUNT. */
  rotation?: number;
  /**
   * The originating token, when this span is individually highlightable.
   * `null` for punctuation, padding and other non-interactive text.
   */
  token: display.DiffText | null;
};

/** The result of laying out one instruction row. */
export type AsmRow = {
  spans: AsmSpan[];
  diffKind: display.InstructionDiffKind;
};

const colorOf = (color: display.DiffTextColor): SpanColor => {
  switch (color.tag) {
    case 'normal':
    case 'dim':
    case 'bright':
    case 'replace':
    case 'data-flow':
    case 'delete':
    case 'insert':
    case 'rotating':
      return color.tag;
    default:
      console.warn('Unknown color type', color);
      return 'normal';
  }
};

/**
 * Render one instruction row into flat spans.
 *
 * The text mapping is intentionally identical to what the diff view has always
 * produced, so HTML, plain text and the React view never drift apart.
 */
export const instructionRowToSpans = (
  row: display.InstructionDiffRow,
): AsmSpan[] => {
  const out: AsmSpan[] = [];
  for (const segment of row.segments) {
    const color = colorOf(segment.color);
    const rotation =
      segment.color.tag === 'rotating'
        ? segment.color.val % ROTATION_COUNT
        : undefined;
    const t = segment.text;
    let text = '';
    let postText = ''; // unhighlightable text after the token
    let isToken = false;
    switch (t.tag) {
      case 'basic':
        text = t.val;
        break;
      case 'line':
        text = t.val.toString(10);
        break;
      case 'address':
        text = t.val.toString(16);
        postText = ':';
        isToken = true;
        break;
      case 'opcode':
        text = t.val.mnemonic;
        isToken = true;
        break;
      case 'signed':
        if (t.val < 0) {
          text = `-0x${(-t.val).toString(16)}`;
        } else {
          text = `0x${t.val.toString(16)}`;
        }
        isToken = true;
        break;
      case 'unsigned':
        text = `0x${t.val.toString(16)}`;
        isToken = true;
        break;
      case 'opaque':
        text = t.val;
        isToken = true;
        break;
      case 'branch-dest':
        text = t.val.toString(16);
        isToken = true;
        break;
      case 'branch-arrow':
        text = ' ~> ';
        isToken = true;
        break;
      case 'symbol':
        text = t.val.demangledName || t.val.name;
        isToken = true;
        break;
      case 'addend':
        if (t.val < 0) {
          text = `-0x${(-t.val).toString(16)}`;
        } else {
          text = `+0x${t.val.toString(16)}`;
        }
        break;
      case 'spacing':
        text = ' '.repeat(t.val);
        break;
      case 'eol':
        continue;
      default:
        console.warn('Unknown text type', t);
        break;
    }
    out.push({ text, color, rotation, token: isToken ? t : null });
    if (postText) {
      out.push({ text: postText, color, rotation, token: null });
    }
    if (segment.padTo > text.length + postText.length) {
      out.push({
        text: ' '.repeat(segment.padTo - text.length - postText.length),
        color: 'normal',
        token: null,
      });
    }
  }
  return out;
};

/** Concatenated plain text of a row, with trailing whitespace trimmed. */
export const spansToText = (spans: AsmSpan[]): string =>
  spans
    .map((s) => s.text)
    .join('')
    .trimEnd();

/** Whether a row differs from its counterpart on the other side. */
export const isDiffRow = (kind: display.InstructionDiffKind): boolean =>
  kind !== 'none';
