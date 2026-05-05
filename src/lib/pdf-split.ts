/**
 * PDF page-range splitter.
 *
 * Used by the compiled-PDF flow: when extractBill identifies sub-bills,
 * we slice the source PDF by page range to produce N child PDFs, then
 * run extractBill on each child independently.
 *
 * Implemented with pdf-lib because:
 *   1. It's pure JS (no native deps), so it deploys cleanly on Vercel
 *   2. It supports copyPages() which is exactly the operation we need —
 *      no rasterization, no quality loss, the child PDF is a true
 *      subset of the source.
 *
 * Trade-off: pdf-lib doesn't preserve every PDF feature on copy
 * (annotations may be flattened, some form fields drop). For utility
 * bills this is irrelevant — they're documents, not interactive forms.
 */

import { PDFDocument } from "pdf-lib";

/**
 * Extract a page range from a source PDF.
 *
 * @param sourcePdf  The full PDF as a Uint8Array (read from disk or storage)
 * @param pageStart  1-indexed first page (inclusive)
 * @param pageEnd    1-indexed last page (inclusive)
 * @returns          New PDF as a Uint8Array containing only those pages
 */
export async function splitPdfRange(
  sourcePdf: Uint8Array,
  pageStart: number,
  pageEnd:   number,
): Promise<Uint8Array> {
  if (pageStart < 1) {
    throw new Error(`pageStart must be >= 1, got ${pageStart}`);
  }
  if (pageEnd < pageStart) {
    throw new Error(`pageEnd (${pageEnd}) must be >= pageStart (${pageStart})`);
  }

  const source = await PDFDocument.load(sourcePdf, {
    // Don't throw on PDFs with mild structural issues — many scanned
    // bills have minor defects we can tolerate.
    ignoreEncryption: true,
  });

  const totalPages = source.getPageCount();
  if (pageEnd > totalPages) {
    throw new Error(
      `pageEnd (${pageEnd}) exceeds source PDF page count (${totalPages})`,
    );
  }

  const out = await PDFDocument.create();
  // Convert to 0-indexed inclusive range for pdf-lib's copyPages
  const indices = Array.from(
    { length: pageEnd - pageStart + 1 },
    (_, i) => pageStart - 1 + i,
  );

  const copied = await out.copyPages(source, indices);
  for (const page of copied) {
    out.addPage(page);
  }

  // Compress where possible. Default settings produce reasonably small
  // PDFs without losing fidelity.
  return await out.save({
    useObjectStreams:    true,
    addDefaultPage:      false,
  });
}

/**
 * Split a PDF into multiple children at once. Useful when the
 * extractor identifies several sub-bills.
 *
 * Returns an array of {pageStart, pageEnd, bytes} in input order.
 */
export async function splitPdfMultiple(
  sourcePdf: Uint8Array,
  ranges: Array<{ pageStart: number; pageEnd: number }>,
): Promise<Array<{ pageStart: number; pageEnd: number; bytes: Uint8Array }>> {
  const out: Array<{ pageStart: number; pageEnd: number; bytes: Uint8Array }> = [];
  for (const r of ranges) {
    const bytes = await splitPdfRange(sourcePdf, r.pageStart, r.pageEnd);
    out.push({ pageStart: r.pageStart, pageEnd: r.pageEnd, bytes });
  }
  return out;
}

/**
 * Get the page count of a PDF without otherwise processing it.
 * Useful for cheap "is this a long PDF?" checks.
 */
export async function getPdfPageCount(sourcePdf: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(sourcePdf, { ignoreEncryption: true });
  return doc.getPageCount();
}
