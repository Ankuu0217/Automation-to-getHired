// pdf-parse v1's package entry has a debug-mode guard that breaks under ESM
// loaders (module.parent is undefined) — import the lib file directly.
// Types come from src/types/pdf-parse.d.ts.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

/**
 * Text + hyperlinks out of a résumé PDF.
 *
 * pdf-parse's stock page renderer glues text items together ("Bachelorof
 * TechnologyinComputerScience") and only breaks lines on an exact Y match. This
 * renderer works from each item's position and size: a gap wider than a space
 * becomes a space, a vertical jump becomes a newline. It also collects the real
 * URLs behind clickable words ("LinkedIn", "GitHub", "Portfolio") — the display
 * text alone often has no URL at all.
 */

interface PdfTextItem {
  str: string;
  width: number;
  height: number;
  transform: number[];
}

interface PdfPageData {
  getTextContent(opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }): Promise<{
    items: PdfTextItem[];
  }>;
  getAnnotations(): Promise<Array<{ subtype?: string; url?: string; unsafeUrl?: string }>>;
}

export interface PdfContent {
  text: string;
  /**
   * Same page content rebuilt by geometry (top→bottom, left→right) instead of the
   * PDF's internal drawing order. Right-aligned dates and floated boxes land on
   * their own line here; columns get interleaved, so it is only used to read dates.
   */
  geometricText: string;
  /** http(s)/mailto targets of link annotations, in document order, de-duplicated. */
  urls: string[];
}

/** Lines by Y (top first), items by X, gaps → spaces. */
function geometricPage(items: PdfTextItem[]): string {
  const rows: Array<{ y: number; size: number; cells: Array<{ x: number; end: number; str: string }> }> = [];
  for (const it of items) {
    if (!it.str || it.str.trim() === '') continue;
    const x = it.transform[4] ?? 0;
    const y = it.transform[5] ?? 0;
    const size = Math.abs(it.height || it.transform[3] || 10) || 10;
    let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(r.size, size) * 0.45);
    if (!row) {
      row = { y, size, cells: [] };
      rows.push(row);
    }
    row.cells.push({ x, end: x + (it.width || 0), str: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((r) => {
      r.cells.sort((a, b) => a.x - b.x);
      let line = '';
      let prevEnd: number | null = null;
      for (const c of r.cells) {
        const gap = prevEnd === null ? 0 : c.x - prevEnd;
        line += (gap > r.size * 0.18 && !/\s$/.test(line) ? ' ' : '') + c.str;
        prevEnd = c.end;
      }
      return line.trim();
    })
    .filter(Boolean)
    .join('\n');
}

/** Page renderer state shared across pages of one parse (pdf-parse calls it per page). */
function makeRenderer(urls: Set<string>, geo: string[]) {
  return async function renderPage(page: PdfPageData): Promise<string> {
    const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
    geo.push(geometricPage(content.items));

    let out = '';
    let lastY: number | null = null;
    let lastEndX: number | null = null;
    let lastSize = 10;

    for (const item of content.items) {
      const str = item.str;
      if (str === undefined) continue;
      const x = item.transform[4] ?? 0;
      const y = item.transform[5] ?? 0;
      const size = Math.abs(item.height || item.transform[3] || lastSize) || lastSize;

      if (lastY === null) {
        out += str;
      } else if (Math.abs(y - lastY) > Math.max(size, lastSize) * 0.55) {
        // New line (or a big jump): break, unless the item is an empty spacer.
        if (str.trim() !== '') out += `\n${str}`;
        else continue;
      } else {
        const gap = x - (lastEndX ?? x);
        const needsSpace =
          gap > size * 0.18 && !/\s$/.test(out) && !/^\s/.test(str) && str !== '';
        out += (needsSpace ? ' ' : '') + str;
      }

      if (str.trim() !== '' || lastY === null) {
        lastY = y;
        lastSize = size;
      }
      lastEndX = x + (item.width || 0);
    }

    try {
      for (const a of await page.getAnnotations()) {
        const url = a.url ?? a.unsafeUrl;
        if (url && /^(https?:|mailto:)/i.test(url)) urls.add(url.trim());
      }
    } catch {
      /* annotations are a bonus — never fail the parse over them */
    }
    return out;
  };
}

/** Tidy raw extracted text: stable newlines, no control junk, no runs of blanks. */
export function normalizeResumeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[-]/g, '•') // private-use glyphs (icon fonts, custom bullets)
    .replace(/[    ]/g, ' ')
    .replace(/(\w)-\n(\w)/g, '$1$2') // hyphenated line wrap
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Words run together (a PDF with broken text spacing) → the text is unreliable
 * for structured parsing. Real prose rarely has many 22+ letter tokens.
 */
export function looksGarbled(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length < 20) return false;
  const jammed = words.filter((w) => /^[A-Za-z]{22,}$/.test(w) || /[a-z][A-Z][a-z]+[A-Z][a-z]+[A-Z]/.test(w));
  return jammed.length / words.length > 0.06;
}

export async function extractPdfContent(buffer: Buffer): Promise<PdfContent> {
  // pdf.js reads the raw ArrayBuffer and ignores byteOffset — Buffers returned
  // by fs.readFile are pool-backed with a non-zero offset, so hand pdf-parse
  // a dense copy with a zero offset or parsing fails with "bad XRef entry".
  const dense = new Uint8Array(buffer.byteLength);
  dense.set(buffer);
  const urls = new Set<string>();
  const geo: string[] = [];
  const result = await pdfParse(dense as unknown as Buffer, {
    pagerender: makeRenderer(urls, geo),
  });
  return {
    text: normalizeResumeText(result.text),
    geometricText: normalizeResumeText(geo.join('\n\n')),
    urls: [...urls],
  };
}
