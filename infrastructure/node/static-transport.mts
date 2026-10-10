import { Readable, pipeline } from 'node:stream';
import { createGzip } from 'node:zlib';
import type { ServerResponse } from 'node:http';

/** Text and GLB containers benefit from transport compression. Even meshopt GLBs
 * retain compressible JSON and streams; their decoded bytes still pass the same
 * asset SHA checks. Images, audio, fonts and wasm keep their own encodings. */
export const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.txt',
  '.glb',
]);

/** A modest level: most of the gain of 9 at a fraction of the per-request CPU. */
export const GZIP_LEVEL = 6;

export type ContentCoding = 'gzip' | 'identity';

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const QVALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/**
 * Accept-Encoding weights (RFC 9110 §12.5.3): coding names are case-insensitive,
 * `x-gzip` is gzip, a missing q is 1, `q=0` refuses, `*` covers every coding not
 * listed (identity included). Elements with an invalid name or q are ignored; the
 * first weight given for a coding counts.
 */
export function acceptedEncodings(header: string | string[] | undefined) {
  const weights = new Map<string, number>();
  const value = Array.isArray(header) ? header.join(',') : header;
  for (const element of (value ?? '').split(',')) {
    const [name, ...parameters] = element.split(';').map((part) => part.trim());
    if (!name || !TOKEN.test(name)) continue;
    let q = 1,
      valid = true;
    for (const parameter of parameters) {
      const separator = parameter.indexOf('=');
      if (separator < 0) continue;
      if (parameter.slice(0, separator).trim().toLowerCase() !== 'q') continue;
      const weight = parameter.slice(separator + 1).trim();
      if (!QVALUE.test(weight)) valid = false;
      else q = Number(weight);
    }
    const coding = name.toLowerCase() === 'x-gzip' ? 'gzip' : name.toLowerCase();
    if (valid && !weights.has(coding)) weights.set(coding, q);
  }
  return weights;
}

/**
 * The coding to send, or null when every coding we can produce is refused (the
 * caller answers 406). Without the header the stored bytes are sent. gzip is
 * offered only for compressible content. Identity named by the client (`identity`
 * or `*`) is weighed against gzip, and gzip wins ties. Identity the client did not
 * mention is only the RFC 9110 fallback: any accepted gzip (q > 0) is preferred
 * to it, and it is used when no listed coding is available (`br`, an empty header).
 */
export function negotiateEncoding(
  header: string | string[] | undefined,
  compressible: boolean,
): ContentCoding | null {
  if (header === undefined) return 'identity';
  const weights = acceptedEncodings(header);
  const wildcard = weights.get('*');
  const gzip = compressible ? (weights.get('gzip') ?? wildcard ?? 0) : 0;
  const named = weights.get('identity') ?? wildcard;
  if (gzip > 0 && (named === undefined || gzip >= named)) return 'gzip';
  if (named === undefined || named > 0) return 'identity';
  return null;
}

/** Streams of static responses still open (released on end, error or disconnect). */
let active = 0;
export function activeStaticStreams(): number {
  return active;
}

/**
 * Send `source` into an already-written response, gzip-encoding it when asked,
 * with backpressure. On any failure (a read error, the client leaving) pipeline
 * destroys every stream, the socket included: a partly sent body is never
 * followed by another response.
 */
export function sendBody(
  source: Readable,
  response: ServerResponse,
  coding: ContentCoding,
): Promise<void> {
  active++;
  return new Promise((resolve) => {
    const done = () => {
      active--;
      resolve();
    };
    if (coding === 'gzip') pipeline(source, createGzip({ level: GZIP_LEVEL }), response, done);
    else pipeline(source, response, done);
  });
}

/** In-memory bodies (visibility overrides) go through the same path. */
export function sendText(text: string, response: ServerResponse, coding: ContentCoding) {
  return sendBody(Readable.from([Buffer.from(text)]), response, coding);
}
