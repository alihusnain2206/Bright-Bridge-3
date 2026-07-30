/**
 * form8655.ts — IRS Form 8655 helpers
 *
 * getForm8655AuthDates(date) — pure function; returns human-readable auth start dates.
 * buildForm8655Pdf(data)     — generates a PDF representation of Form 8655 using pdf-lib.
 *
 * No I/O here — callers are responsible for storing / uploading the result.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

// ── Date helpers ───────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
] as const;

/**
 * Returns the auth-effective dates for Form 8655 lines 10a (annual) and 10b (quarterly).
 *
 * IRS rules:
 *   10a: Calendar year in which authorization begins (current year).
 *   10b: First month of the current quarter (the quarter in which the form is signed).
 */
export function getForm8655AuthDates(date: Date): {
  annualYear: string;           // e.g. "2026"
  quarterlyBeginMonth: string;  // e.g. "July 2026"
} {
  const year  = date.getFullYear();
  const month = date.getMonth(); // 0-indexed
  const quarterStartIdx = Math.floor(month / 3) * 3; // 0=Jan, 3=Apr, 6=Jul, 9=Oct
  return {
    annualYear:           String(year),
    quarterlyBeginMonth:  `${MONTH_NAMES[quarterStartIdx]} ${year}`,
  };
}

// ── PDF builder ────────────────────────────────────────────────────────────────

export interface Form8655Data {
  // Part I — Taxpayer
  taxpayerName:    string;   // company name
  taxpayerEin:     string;   // EIN (digits only — formatter adds hyphen)
  address:         string;   // street address
  cityStateZip:    string;
  phone:           string;
  // Signature block
  signerName:      string;
  signerTitle:     string;
  signedAt:        Date;
  // Part II — Reporting Agent (BrightBridge's fixed values)
  agentName?:      string;
  // Auth dates (pass result of getForm8655AuthDates)
  annualYear:           string;
  quarterlyBeginMonth:  string;
}

function formatEin(ein: string): string {
  const digits = ein.replace(/\D/g, "");
  if (digits.length === 9) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return ein;
}

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return phone;
}

function formatDate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const y = date.getFullYear();
  return `${m}/${d}/${y}`;
}

/** Draw a horizontal rule */
function hRule(page: ReturnType<PDFDocument["addPage"]>, y: number, margin: number, w: number) {
  page.drawLine({ start: { x: margin, y }, end: { x: margin + w, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
}

/**
 * Builds a multi-section PDF representation of IRS Form 8655.
 * Returns the raw PDF bytes (Uint8Array) — caller writes/uploads as needed.
 */
export async function buildForm8655Pdf(data: Form8655Data): Promise<Uint8Array> {
  const doc   = await PDFDocument.create();
  const page  = doc.addPage([612, 792]); // US Letter
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold);
  const helv  = await doc.embedFont(StandardFonts.Helvetica);
  const helvO = await doc.embedFont(StandardFonts.HelveticaOblique);

  const NAVY   = rgb(0.1, 0.22, 0.38); // #1B3A62
  const BLACK  = rgb(0,   0,   0);
  const GRAY   = rgb(0.4, 0.4, 0.4);
  const LGRAY  = rgb(0.92, 0.92, 0.92);
  const MARGIN = 50;
  const W      = 612 - MARGIN * 2;

  let y = 762; // cursor from top

  // ── Header ─────────────────────────────────────────────────────────────────
  page.drawRectangle({ x: MARGIN, y: y - 8, width: W, height: 34, color: NAVY, borderWidth: 0 });

  page.drawText("Form 8655", {
    x: MARGIN + 10, y: y + 10, size: 16, font: helvB, color: rgb(1, 1, 1),
  });
  page.drawText("Reporting Agent Authorization", {
    x: MARGIN + 10, y: y - 2, size: 8, font: helv, color: rgb(0.8, 0.9, 1),
  });
  page.drawText("(Rev. February 2012)  OMB No. 1545-1058", {
    x: MARGIN + W - 200, y: y + 10, size: 7.5, font: helv, color: rgb(0.7, 0.85, 1),
  });
  page.drawText("Department of the Treasury — Internal Revenue Service", {
    x: MARGIN + W - 200, y: y - 2, size: 7, font: helvO, color: rgb(0.7, 0.85, 1),
  });

  y -= 30;

  // Helper: labelled field row
  const field = (label: string, value: string, yPos: number, labelW = 140, font: PDFFont = helv) => {
    page.drawText(label, { x: MARGIN, y: yPos, size: 7, font: helv, color: GRAY });
    page.drawText(value || "—", { x: MARGIN + labelW, y: yPos, size: 9, font, color: BLACK });
  };

  // Helper: section header band
  const sectionHeader = (title: string, yPos: number) => {
    page.drawRectangle({ x: MARGIN, y: yPos - 3, width: W, height: 14, color: LGRAY });
    page.drawText(title, { x: MARGIN + 6, y: yPos, size: 8, font: helvB, color: NAVY });
    return yPos - 18;
  };

  // ── Part I — Taxpayer Information ──────────────────────────────────────────
  y = sectionHeader("PART I — Taxpayer Information", y);

  field("1a  Taxpayer name",                   data.taxpayerName,                 y); y -= 16;
  field("1b  Taxpayer Identification No. (EIN)", formatEin(data.taxpayerEin),     y); y -= 16;
  field("1c  Mailing address",                  data.address,                     y); y -= 16;
  field("1d  City, state, ZIP",                 data.cityStateZip,                y); y -= 12;
  hRule(page, y, MARGIN, W); y -= 16;

  // ── Taxpayer Certification ─────────────────────────────────────────────────
  y = sectionHeader("Taxpayer Certification", y);

  const certText =
    "By signing below, the taxpayer authorizes the Reporting Agent identified in Part II to perform the " +
    "acts indicated in Part III on the taxpayer's behalf. If Part III, line 8 is checked, the taxpayer " +
    "also authorizes the IRS to disclose tax return information to the Reporting Agent as described.";

  const certLines = wrapText(certText, W - 10, helv, 8);
  for (const line of certLines) {
    page.drawText(line, { x: MARGIN + 5, y, size: 8, font: helv, color: BLACK }); y -= 11;
  }
  y -= 4;

  // Signature row
  page.drawRectangle({ x: MARGIN, y: y - 22, width: W / 2 - 6, height: 28, color: rgb(0.97, 0.97, 0.97) });
  page.drawText("Taxpayer signature",  { x: MARGIN + 4,     y: y + 2,  size: 7,  font: helv,  color: GRAY });
  page.drawText(data.signerName,       { x: MARGIN + 4,     y: y - 12, size: 11, font: helvB, color: BLACK });

  page.drawRectangle({ x: MARGIN + W / 2 + 6, y: y - 22, width: W / 2 - 6, height: 28, color: rgb(0.97, 0.97, 0.97) });
  page.drawText("Date",                { x: MARGIN + W/2 + 10, y: y + 2,  size: 7,  font: helv,  color: GRAY });
  page.drawText(formatDate(data.signedAt), { x: MARGIN + W/2 + 10, y: y - 12, size: 11, font: helvB, color: BLACK });
  y -= 30;

  // Title + phone row
  page.drawRectangle({ x: MARGIN, y: y - 18, width: W / 2 - 6, height: 24, color: rgb(0.97, 0.97, 0.97) });
  page.drawText("Title",          { x: MARGIN + 4,         y: y + 2,  size: 7, font: helv, color: GRAY });
  page.drawText(data.signerTitle, { x: MARGIN + 4,         y: y - 11, size: 9, font: helv, color: BLACK });

  page.drawRectangle({ x: MARGIN + W/2 + 6, y: y - 18, width: W/2 - 6, height: 24, color: rgb(0.97, 0.97, 0.97) });
  page.drawText("Phone number",        { x: MARGIN + W/2 + 10, y: y + 2,  size: 7, font: helv, color: GRAY });
  page.drawText(formatPhone(data.phone), { x: MARGIN + W/2 + 10, y: y - 11, size: 9, font: helv, color: BLACK });
  y -= 28;

  hRule(page, y, MARGIN, W); y -= 16;

  // ── Part II — Reporting Agent Information ─────────────────────────────────
  y = sectionHeader("PART II — Reporting Agent Information", y);

  const agentName = data.agentName ?? "BrightBridge Payroll Services";
  field("4   Reporting Agent name",    agentName,          y); y -= 16;
  field("5   Telephone number",        "(888) 555-0100",   y); y -= 12;
  hRule(page, y, MARGIN, W); y -= 16;

  // ── Part III — Authorization ───────────────────────────────────────────────
  y = sectionHeader("PART III — Authorization (Effective Dates)", y);

  page.drawText(
    "This authorization is effective for the filing and payment of federal employment taxes:",
    { x: MARGIN + 5, y, size: 8, font: helv, color: BLACK }
  );
  y -= 16;

  field("10a  Annual forms (940 / 944 / W-2):",  `Tax year ${data.annualYear}`,  y); y -= 16;
  field("10b  Quarterly forms (941):  beginning", data.quarterlyBeginMonth,       y); y -= 12;

  hRule(page, y, MARGIN, W); y -= 16;

  // ── Notice ─────────────────────────────────────────────────────────────────
  const notice =
    "This authorization supersedes any previously filed Form 8655 for the same tax matters. " +
    "To revoke this authorization, the taxpayer must notify both the IRS and the Reporting Agent in writing.";
  const noticeLines = wrapText(notice, W - 10, helv, 7);
  for (const line of noticeLines) {
    page.drawText(line, { x: MARGIN + 5, y, size: 7, font: helvO, color: GRAY }); y -= 10;
  }

  // ── Footer watermark ───────────────────────────────────────────────────────
  const footerY = 22;
  page.drawLine({
    start: { x: MARGIN, y: footerY + 14 }, end: { x: MARGIN + W, y: footerY + 14 },
    thickness: 0.5, color: LGRAY,
  });
  page.drawText(
    `Signed by ${data.signerName} on ${formatDate(data.signedAt)} — ${agentName} — Generated by BrightBridge`,
    { x: MARGIN, y: footerY + 3, size: 7, font: helvO, color: GRAY }
  );

  return doc.save();
}

// ── Text wrap utility ──────────────────────────────────────────────────────────

function wrapText(text: string, maxWidth: number, font: PDFFont, size: number): string[] {
  const words  = text.split(" ");
  const lines: string[] = [];
  let current  = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}
