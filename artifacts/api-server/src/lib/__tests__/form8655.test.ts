/**
 * Unit tests for buildForm8655Pdf and getForm8655AuthDates (lib/form8655.ts)
 *
 * Coverage goals:
 * 1. Image path   — signatureImageBase64 present → image drawn at x=50 y=70
 *                   with dimensions ≤ maxW=220 / maxH=44
 * 2. Text path    — signatureImageBase64 absent → signer name drawn as text;
 *                   no image placement at the signature position
 * 3. Corrupted image → typed-name fallback (signer name in stream, no throw)
 * 4. Wide PNG  (400×50) → width-constrained to ≤ 220 pt
 * 5. Tall PNG  (50×200) → height-constrained to ≤ 44 pt
 * 6. Square PNG (100×100) → both within bounds
 * 7. getForm8655AuthDates returns correct YYYY and YYYY/MM strings per quarter
 *
 * PDF content-stream format (observed from pdf-lib output):
 *
 *   q
 *   1 0 0 1 <x> <y> cm          ← translate to signature position
 *   1 0 0 1 0 0 cm               ← identity (pdf-lib padding)
 *   <drawW> 0 0 <drawH> 0 0 cm  ← scale to drawn dimensions
 *   1 0 0 1 0 0 cm               ← identity (pdf-lib padding)
 *   /Image-XXXXXXXX Do           ← paint XObject
 *   Q
 */

import { describe, it, expect, beforeAll } from "vitest";
import zlib from "node:zlib";
import { buildForm8655Pdf, getForm8655AuthDates, type Form8655Data } from "../form8655.js";

// ─────────────────────────────────────────────────────────────────────────────
// PNG generator
// Builds a spec-compliant RGB PNG of any dimension for use as signatureImageBase64.
// ─────────────────────────────────────────────────────────────────────────────

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) crc = (CRC32_TABLE[(crc ^ byte) & 0xFF]!) ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf  = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** Returns a base64-encoded black RGB PNG with the given pixel dimensions. */
function makeRgbPng(width: number, height: number): string {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((1 + width * 3) * height, 0);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF content-stream inspector
//
// pdf-lib compresses content streams with FlateDecode (zlib). We extract and
// decompress every stream in the PDF bytes, then search for drawing operators.
// ─────────────────────────────────────────────────────────────────────────────

/** Extracts all PDF stream bodies (FlateDecode-decompressed, or raw if uncompressed). */
function extractPdfStreams(pdfBytes: Uint8Array): string[] {
  const buf = Buffer.from(pdfBytes);
  const out: string[] = [];
  let pos = 0;
  while (pos < buf.length - 10) {
    const kw = buf.indexOf("stream", pos);
    if (kw === -1) break;
    // "stream" must be immediately followed by \r\n or \n
    let dataStart: number;
    if      (buf[kw + 6] === 0x0D && buf[kw + 7] === 0x0A) dataStart = kw + 8;
    else if (buf[kw + 6] === 0x0A)                          dataStart = kw + 7;
    else { pos = kw + 6; continue; }
    const endKw = buf.indexOf("endstream", dataStart);
    if (endKw === -1) break;
    let dataEnd = endKw;
    if (buf[dataEnd - 1] === 0x0A) dataEnd--;
    if (buf[dataEnd - 1] === 0x0D) dataEnd--;
    const raw = buf.slice(dataStart, dataEnd);
    try { out.push(zlib.inflateSync(raw).toString("latin1")); }
    catch { out.push(raw.toString("latin1")); }
    pos = endKw + 9;
  }
  return out;
}

/**
 * Returns true when `text` appears in the combined PDF streams either as a
 * PDF literal string `(text)` or as a hex string `<hex bytes>`.
 */
function textInStreams(text: string, streams: string[]): boolean {
  const combined = streams.join("\n");
  if (combined.includes(text)) return true;
  const hex = Buffer.from(text, "latin1").toString("hex");
  return combined.toLowerCase().includes(hex.toLowerCase());
}

/**
 * pdf-lib emits image drawing as:
 *
 *   q
 *   1 0 0 1 <x> <y> cm          ← translation to signature position
 *   1 0 0 1 0 0 cm               ← (identity padding)
 *   <drawW> 0 0 <drawH> 0 0 cm  ← scale (the dimensions we care about)
 *   ...
 *   /Image-XXXX Do
 *   Q
 *
 * This function locates the translation anchor at (x≈50, y≈70) and then
 * reads the scale matrix that follows before the Do operator.
 * Returns null if no such placement is found.
 */
function findSignatureDrawParams(
  streams: string[],
): { drawW: number; drawH: number; x: number; y: number } | null {
  const combined = streams.join("\n");

  // Anchor: translation matrix at the signature position
  const transRe = /1\s+0\s+0\s+1\s+([\d.]+)\s+([\d.]+)\s+cm/g;
  let transMatch: RegExpExecArray | null;
  while ((transMatch = transRe.exec(combined)) !== null) {
    const x = parseFloat(transMatch[1]!);
    const y = parseFloat(transMatch[2]!);
    if (Math.abs(x - 50) > 1 || Math.abs(y - 70) > 1) continue;

    // Look at the next 300 characters for the scale matrix followed by Do
    const after = combined.slice(transMatch.index + transMatch[0].length,
                                 transMatch.index + transMatch[0].length + 300);
    if (!/\bDo\b/.test(after)) continue;

    // Walk scale matrices until we find a non-identity one (a > 1, d > 1).
    // pdf-lib inserts `1 0 0 1 0 0 cm` identity padding before the real scale
    // matrix, so a single exec() would stop at the identity — we need a loop.
    const scaleRe = /([\d.]+(?:\.\d+)?)\s+0\s+0\s+([\d.]+(?:\.\d+)?)\s+0\s+0\s+cm/g;
    let scaleMatch: RegExpExecArray | null;
    while ((scaleMatch = scaleRe.exec(after)) !== null) {
      const drawW = parseFloat(scaleMatch[1]!);
      const drawH = parseFloat(scaleMatch[2]!);
      if (drawW > 1 && drawH > 1) {
        return { drawW, drawH, x, y };
      }
    }
  }
  return null;
}

/** Returns true when an image is drawn at the signature position (x≈50, y≈70). */
function hasSignatureImagePlacement(streams: string[]): boolean {
  return findSignatureDrawParams(streams) !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture data
// ─────────────────────────────────────────────────────────────────────────────

const BASE_DATA: Form8655Data = {
  taxpayerName:  "Sunshine Daycare LLC",
  taxpayerEin:   "123456789",
  address:       "123 Main St",
  cityStateZip:  "Austin, TX 78701",
  phone:         "5125550100",
  signerName:    "Jane Doe",
  signerTitle:   "CEO",
  signedAt:      new Date("2026-07-01T12:00:00.000Z"),
  annual940:     "2026",
  quarterly941:  "2026/09",
};

// Pre-built PNGs for aspect-ratio scaling tests
// Wide  (400×50): ratio = min(220/400, 44/50) = 0.55 → drawW≈220, drawH≈27.5
// Tall  (50×200): ratio = min(220/50,  44/200) = 0.22 → drawH≈44,  drawW≈11
// Square(100×100): ratio = min(2.2, 0.44)      = 0.44 → drawW=drawH≈44
const PNG_1x1    = makeRgbPng(1, 1);
const PNG_WIDE   = makeRgbPng(400, 50);
const PNG_TALL   = makeRgbPng(50, 200);
const PNG_SQUARE = makeRgbPng(100, 100);

// ─────────────────────────────────────────────────────────────────────────────
// Tests — text path (no drawn signature image)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildForm8655Pdf — text path (no signatureImageBase64)", () => {
  let pdfBytes: Uint8Array;
  let streams:  string[];

  beforeAll(async () => {
    pdfBytes = await buildForm8655Pdf(BASE_DATA);
    streams  = extractPdfStreams(pdfBytes);
  });

  it("produces valid PDF bytes (starts with %PDF)", () => {
    expect(Buffer.from(pdfBytes.slice(0, 4)).toString("ascii")).toBe("%PDF");
  });

  it("produces a non-trivially large PDF (> 10 KB)", () => {
    expect(pdfBytes.length).toBeGreaterThan(10 * 1024);
  });

  it("signer name 'Jane Doe' appears in the page content stream", () => {
    expect(textInStreams("Jane Doe", streams)).toBe(true);
  });

  it("no image is placed at the signature position (text path taken, not image path)", () => {
    expect(hasSignatureImagePlacement(streams)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — image path (1×1 PNG)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildForm8655Pdf — image path (1×1 PNG)", () => {
  let pdfBytes: Uint8Array;
  let streams:  string[];

  beforeAll(async () => {
    pdfBytes = await buildForm8655Pdf({ ...BASE_DATA, signatureImageBase64: PNG_1x1 });
    streams  = extractPdfStreams(pdfBytes);
  });

  it("produces valid PDF bytes (starts with %PDF)", () => {
    expect(Buffer.from(pdfBytes.slice(0, 4)).toString("ascii")).toBe("%PDF");
  });

  it("produces a non-trivially large PDF (> 10 KB)", () => {
    expect(pdfBytes.length).toBeGreaterThan(10 * 1024);
  });

  it("an image is placed at the signature position (x≈50, y≈70)", () => {
    expect(hasSignatureImagePlacement(streams)).toBe(true);
  });

  it("signature x-coordinate is 50 pt", () => {
    const p = findSignatureDrawParams(streams)!;
    expect(p.x).toBeCloseTo(50, 0);
  });

  it("signature y-coordinate is 70 pt — on the signature line", () => {
    const p = findSignatureDrawParams(streams)!;
    expect(p.y).toBeCloseTo(70, 0);
  });

  it("drawn width does not exceed maxW = 220 pt", () => {
    const p = findSignatureDrawParams(streams)!;
    expect(p.drawW).toBeLessThanOrEqual(220 + 0.5);
  });

  it("drawn height does not exceed maxH = 44 pt", () => {
    const p = findSignatureDrawParams(streams)!;
    expect(p.drawH).toBeLessThanOrEqual(44 + 0.5);
  });

  it("signer name does NOT appear as drawn text (image replaced the typed overlay)", () => {
    // In the image path, page.drawText(signerName) is skipped entirely.
    expect(textInStreams("Jane Doe", streams)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — corrupted image → typed-name fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("buildForm8655Pdf — corrupted image falls back to typed name", () => {
  let pdfBytes: Uint8Array;
  let streams:  string[];

  beforeAll(async () => {
    pdfBytes = await buildForm8655Pdf({
      ...BASE_DATA,
      signatureImageBase64: Buffer.from("not-a-png!!!").toString("base64"),
    });
    streams = extractPdfStreams(pdfBytes);
  });

  it("does not throw", () => {
    expect(pdfBytes).toBeDefined();
  });

  it("produces valid PDF bytes", () => {
    expect(Buffer.from(pdfBytes.slice(0, 4)).toString("ascii")).toBe("%PDF");
  });

  it("signer name appears in the content stream (typed fallback ran)", () => {
    expect(textInStreams("Jane Doe", streams)).toBe(true);
  });

  it("no image at the signature position (drawImage was skipped)", () => {
    expect(hasSignatureImagePlacement(streams)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — aspect-ratio scaling across canvas / screen sizes
//
// The server replicates the concern the task title calls out: a signature
// captured on a wide screen might be 400×50 px, a portrait phone 50×200, etc.
// buildForm8655Pdf must scale every PNG to fit within maxW=220 / maxH=44 while
// always landing at x=50 y=70.
// ─────────────────────────────────────────────────────────────────────────────

describe("buildForm8655Pdf — aspect-ratio scaling across canvas sizes", () => {
  let wideP:   ReturnType<typeof findSignatureDrawParams>;
  let tallP:   ReturnType<typeof findSignatureDrawParams>;
  let squareP: ReturnType<typeof findSignatureDrawParams>;

  beforeAll(async () => {
    const [wideBytes, tallBytes, squareBytes] = await Promise.all([
      buildForm8655Pdf({ ...BASE_DATA, signatureImageBase64: PNG_WIDE }),
      buildForm8655Pdf({ ...BASE_DATA, signatureImageBase64: PNG_TALL }),
      buildForm8655Pdf({ ...BASE_DATA, signatureImageBase64: PNG_SQUARE }),
    ]);
    wideP   = findSignatureDrawParams(extractPdfStreams(wideBytes));
    tallP   = findSignatureDrawParams(extractPdfStreams(tallBytes));
    squareP = findSignatureDrawParams(extractPdfStreams(squareBytes));
  });

  // ── Wide PNG (400×50): width-limited ───────────────────────────────────────
  // ratio = min(220/400, 44/50) = min(0.55, 0.88) = 0.55 → drawW=220, drawH≈27.5

  it("wide PNG (400×50): image is placed at signature position", () => {
    expect(wideP).not.toBeNull();
  });

  it("wide PNG (400×50): drawn width is ≈ 220 pt (width limit reached)", () => {
    expect(wideP!.drawW).toBeCloseTo(220, 0);
  });

  it("wide PNG (400×50): drawn height is < 44 pt (height not the constraint)", () => {
    expect(wideP!.drawH).toBeLessThan(44);
  });

  it("wide PNG (400×50): drawn height does not overflow maxH = 44 pt", () => {
    expect(wideP!.drawH).toBeLessThanOrEqual(44 + 0.5);
  });

  // ── Tall PNG (50×200): height-limited ──────────────────────────────────────
  // ratio = min(220/50, 44/200) = min(4.4, 0.22) = 0.22 → drawH=44, drawW≈11

  it("tall PNG (50×200): image is placed at signature position", () => {
    expect(tallP).not.toBeNull();
  });

  it("tall PNG (50×200): drawn height is ≈ 44 pt (height limit reached)", () => {
    expect(tallP!.drawH).toBeCloseTo(44, 0);
  });

  it("tall PNG (50×200): drawn width is < 220 pt (width not the constraint)", () => {
    expect(tallP!.drawW).toBeLessThan(220);
  });

  it("tall PNG (50×200): drawn width does not overflow maxW = 220 pt", () => {
    expect(tallP!.drawW).toBeLessThanOrEqual(220 + 0.5);
  });

  // ── Square PNG (100×100): height-limited ───────────────────────────────────
  // ratio = min(220/100, 44/100) = 0.44 → drawW=drawH=44

  it("square PNG (100×100): image is placed at signature position", () => {
    expect(squareP).not.toBeNull();
  });

  it("square PNG (100×100): drawn width ≤ 220 pt", () => {
    expect(squareP!.drawW).toBeLessThanOrEqual(220 + 0.5);
  });

  it("square PNG (100×100): drawn height ≤ 44 pt", () => {
    expect(squareP!.drawH).toBeLessThanOrEqual(44 + 0.5);
  });

  // ── Common position: all sizes land at the same baseline ───────────────────

  it("wide PNG x-coordinate is 50 pt", ()   => { expect(wideP!.x).toBeCloseTo(50, 0); });
  it("tall PNG x-coordinate is 50 pt", ()   => { expect(tallP!.x).toBeCloseTo(50, 0); });
  it("square PNG x-coordinate is 50 pt", () => { expect(squareP!.x).toBeCloseTo(50, 0); });

  it("wide PNG y-coordinate is 70 pt (signature line)",   () => { expect(wideP!.y).toBeCloseTo(70, 0); });
  it("tall PNG y-coordinate is 70 pt (signature line)",   () => { expect(tallP!.y).toBeCloseTo(70, 0); });
  it("square PNG y-coordinate is 70 pt (signature line)", () => { expect(squareP!.y).toBeCloseTo(70, 0); });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — getForm8655AuthDates
// ─────────────────────────────────────────────────────────────────────────────

describe("getForm8655AuthDates", () => {
  it("annual940 is the 4-digit calendar year as a string", () => {
    expect(getForm8655AuthDates(new Date("2026-07-15")).annual940).toBe("2026");
  });

  it("Q3 (July) → quarterly941 = '2026/09' (last month of Q3)", () => {
    expect(getForm8655AuthDates(new Date("2026-07-15")).quarterly941).toBe("2026/09");
  });

  it("Q1 (January) → quarterly941 = '2026/03' (last month of Q1)", () => {
    expect(getForm8655AuthDates(new Date("2026-01-10")).quarterly941).toBe("2026/03");
  });

  it("Q2 (April) → quarterly941 = '2026/06' (last month of Q2)", () => {
    expect(getForm8655AuthDates(new Date("2026-04-01")).quarterly941).toBe("2026/06");
  });

  it("Q4 (December) → quarterly941 = '2026/12' (last month of Q4)", () => {
    expect(getForm8655AuthDates(new Date("2026-12-31")).quarterly941).toBe("2026/12");
  });

  it("annual940 and quarterly941 start with the same year prefix", () => {
    const { annual940, quarterly941 } = getForm8655AuthDates(new Date("2026-09-01"));
    expect(quarterly941.startsWith(annual940)).toBe(true);
  });
});
