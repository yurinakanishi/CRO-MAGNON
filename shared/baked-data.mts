// Decoders for data baked at build time (scripts/bake-world-data.mjs). Baked modules carry their
// payloads as hexadecimal text: one string literal parses far faster than a numeric array literal
// of the same data, hex compresses better than base64 over HTTP, and every value decodes to
// exactly the byte or number its source held.

// Hex digit values by character code; 255 marks a character that is not a hex digit.
const NIBBLE = new Uint8Array(128).fill(255);
for (let i = 0; i < 16; i++) {
  NIBBLE['0123456789abcdef'.charCodeAt(i)] = i;
  NIBBLE['0123456789ABCDEF'.charCodeAt(i)] = i;
}

/** The bytes of hexadecimal `text`. */
export function bytesFromHex(text: string): Uint8Array {
  if (text.length % 2) throw new Error('Odd-length baked hex');
  const bytes = new Uint8Array(text.length / 2);
  let invalid = 0;
  for (let i = 0, j = 0; i < bytes.length; i++, j += 2) {
    const high = NIBBLE[text.charCodeAt(j)] ?? 255,
      low = NIBBLE[text.charCodeAt(j + 1)] ?? 255;
    invalid |= high | low;
    bytes[i] = (high << 4) | low;
  }
  if (invalid > 15) throw new Error('Baked hex holds a non-hex character');
  return bytes;
}

/** Unsigned LEB128 integers of `bytes`, read in order. */
function varints(bytes: Uint8Array) {
  let at = 0;
  return {
    done: () => at >= bytes.length,
    next() {
      let value = 0,
        scale = 1,
        byte;
      do {
        if (at >= bytes.length) throw new Error('Truncated baked varint');
        byte = bytes[at++];
        value += (byte & 0x7f) * scale;
        scale *= 128;
      } while (byte & 0x80);
      return value;
    },
  };
}

/** A byte grid from runs: each run is its value byte and then its length (LEB128). */
export function decodeRuns(text: string, length: number): Uint8Array {
  const bytes = bytesFromHex(text),
    out = new Uint8Array(length);
  let at = 0,
    filled = 0;
  while (at < bytes.length) {
    const value = bytes[at++];
    let run = 0,
      scale = 1,
      byte;
    do {
      if (at >= bytes.length) throw new Error('Truncated baked run');
      byte = bytes[at++];
      run += (byte & 0x7f) * scale;
      scale *= 128;
    } while (byte & 0x80);
    if (filled + run > length) throw new Error('Baked runs overflow their grid');
    out.fill(value, filled, filled + run);
    filled += run;
  }
  if (filled !== length) throw new Error('Baked runs do not fill their grid');
  return out;
}

/** Overwrite a rectangle of a row-major byte grid with its baked values (row-major, hex). */
export function patchGrid(
  grid: Uint8Array,
  gridWidth: number,
  patch: { x: number; z: number; width: number; height: number; values: string },
) {
  const values = bytesFromHex(patch.values);
  if (values.length !== patch.width * patch.height) throw new Error('Baked patch size mismatch');
  if (
    patch.x < 0 ||
    patch.x + patch.width > gridWidth ||
    (patch.z + patch.height) * gridWidth > grid.length
  )
    throw new Error('Baked patch outside its grid');
  for (let row = 0; row < patch.height; row++)
    grid.set(
      values.subarray(row * patch.width, (row + 1) * patch.width),
      (patch.z + row) * gridWidth + patch.x,
    );
}

/**
 * Numbers that are exact decimals: each is `integer / scale`, stored as the zigzag difference
 * from the previous number plus one (LEB128); zero is null. Division by a power of ten rounds
 * correctly, so every value is the double its decimal source parsed to.
 */
export function decodeScaledDeltas(text: string, length: number, scale: number) {
  const codes = varints(bytesFromHex(text)),
    out: (number | null)[] = new Array(length);
  let previous = 0;
  for (let i = 0; i < length; i++) {
    const code = codes.next();
    if (code === 0) {
      out[i] = null;
      continue;
    }
    const zigzag = code - 1,
      delta = zigzag % 2 ? -(zigzag + 1) / 2 : zigzag / 2;
    previous += delta;
    out[i] = previous / scale;
  }
  if (!codes.done()) throw new Error('Baked deltas exceed their length');
  return out;
}

/** `count` booleans packed eight to a byte, least significant bit first. */
export function decodeBits(text: string, count: number): boolean[] {
  const bytes = bytesFromHex(text);
  if (bytes.length !== Math.ceil(count / 8)) throw new Error('Baked bits size mismatch');
  const out: boolean[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = ((bytes[i >> 3] >> (i & 7)) & 1) === 1;
  return out;
}

/** `count` entries of `table`, one byte each. */
export function decodeIndices(text: string, count: number, table: readonly string[]): string[] {
  const bytes = bytesFromHex(text);
  if (bytes.length !== count) throw new Error('Baked indices size mismatch');
  return Array.from(bytes, (index) => {
    const value = table[index];
    if (value === undefined) throw new Error('Baked index outside its table');
    return value;
  });
}
