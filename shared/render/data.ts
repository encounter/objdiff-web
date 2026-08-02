import type { display } from 'objdiff-wasm';

export const BYTES_PER_ROW = 16;

/** A run of text from a data row, tagged with how it differs. */
export type DataSpan = {
  text: string;
  kind: display.DataDiffKind;
};

/** One rendered row of a data symbol: `address: hex bytes  ascii`. */
export type DataRow = {
  address: string;
  hex: DataSpan[];
  ascii: DataSpan[];
  anyDiff: boolean;
};

/**
 * Render one data row into flat spans.
 *
 * Matches what the data view has always produced: 16 bytes per row, a space
 * every 8 bytes, relocated zero bytes shown as `??`, and non-printable
 * characters shown as `.`.
 */
export const dataRowToSpans = (row: display.DataDiffRow): DataRow => {
  const hex: DataSpan[] = [];
  const ascii: DataSpan[] = [];
  let byteIndex = 0;

  const gap = () => {
    if (byteIndex % 8 === 0 && byteIndex < BYTES_PER_ROW) {
      hex.push({ text: ' ', kind: 'none' });
    }
  };

  for (const segment of row.segments) {
    // Relocations overlapping this segment; a relocation can override the
    // diff kind of the individual bytes it covers.
    const segStart = row.address + BigInt(byteIndex);
    const segEnd = segStart + BigInt(segment.size);
    const relocs = row.relocations.filter(
      (r) => r.address < segEnd && r.address + BigInt(r.size) > segStart,
    );

    if (segment.data.length === 0) {
      // Empty data (deletion on the other side) renders as blanks.
      for (let i = 0; i < segment.size; i++) {
        hex.push({ text: '   ', kind: 'none' });
        ascii.push({ text: ' ', kind: 'none' });
        byteIndex++;
        gap();
      }
      continue;
    }

    for (const byte of segment.data) {
      const address = row.address + BigInt(byteIndex);
      const reloc = relocs.find(
        (r) => r.address <= address && address < r.address + BigInt(r.size),
      );
      let kind = segment.kind;
      let text = byte.toString(16).padStart(2, '0');
      if (reloc) {
        if (byte === 0) {
          text = '??';
        }
        if (reloc.kind !== 'none') {
          kind = reloc.kind;
        }
      }
      hex.push({ text: `${text} `, kind });
      const char = byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.';
      ascii.push({ text: char, kind: segment.kind });
      byteIndex++;
      gap();
    }
  }

  // Pad short rows out to the full width so columns stay aligned.
  while (byteIndex < BYTES_PER_ROW) {
    hex.push({ text: '   ', kind: 'none' });
    ascii.push({ text: ' ', kind: 'none' });
    byteIndex++;
    gap();
  }

  return {
    address: `${row.address.toString(16).padStart(8, '0')}:`,
    hex,
    ascii,
    anyDiff:
      row.segments.some((s) => s.kind !== 'none') ||
      row.relocations.some((r) => r.kind !== 'none'),
  };
};

/** Concatenated plain text of a data row. */
export const dataRowToText = (row: DataRow): string =>
  `${row.address}${row.hex.map((s) => s.text).join('')} ${row.ascii
    .map((s) => s.text)
    .join('')}`.trimEnd();
