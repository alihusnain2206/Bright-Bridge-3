/**
 * form8655.ts — IRS Form 8655 helpers
 *
 * getForm8655AuthDates(date) — returns YYYY and YYYY/MM strings for lines 15/16.
 * buildForm8655Pdf(data)     — fills the official IRS Form 8655 AcroForm fields.
 *
 * Reporting Agent static values are hard-coded (Rollfi, Inc).
 * No I/O here — callers are responsible for storing / uploading the result.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
// esbuild loader:.pdf=base64 embeds the official IRS form at build time
import f8655Base64 from "../assets/f8655.pdf";

// ── Rollfi reporting agent constants ─────────────────────────────────────────

const ROLLFI_NAME    = "Rollfi, Inc";
const ROLLFI_EIN     = "87-3373107";
const ROLLFI_ADDR    = "169 Maddison Ave #2351";
const ROLLFI_CITYSZ  = "New York, NY 10016";
const ROLLFI_CONTACT = "Perumalsamy Ramakrishnan";
const ROLLFI_PHONE   = "(408) 582 4650";
const ROLLFI_FAX     = "1-646-849-4046";

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Returns auth-effective date strings for IRS Form 8655 lines 15 and 16.
 *
 * IRS rules (Rev. January 2024):
 *   940 blank  — calendar year in which authorization begins, YYYY format.
 *   941 blank  — YYYY/MM where MM is the **last month** of the current quarter.
 *                e.g. Q3 2026 (Jul–Sep) → "2026/09"
 *
 * Both line 15 (filing auth) and line 16 (deposit auth) receive the same values.
 */
export function getForm8655AuthDates(date: Date): {
  annual940:    string;  // e.g. "2026"
  quarterly941: string;  // e.g. "2026/09"
} {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed
  // Quarter last month: Q1→2(Mar), Q2→5(Jun), Q3→8(Sep), Q4→11(Dec)
  const quarterLastIdx = Math.floor(month / 3) * 3 + 2;
  const mm = String(quarterLastIdx + 1).padStart(2, "0");
  return {
    annual940:    String(year),
    quarterly941: `${year}/${mm}`,
  };
}

// ── Data interface ────────────────────────────────────────────────────────────

export interface Form8655Data {
  // Part I — Taxpayer (from Rollfi getCompanyInfo)
  taxpayerName:  string;   // Line 1a
  taxpayerEin:   string;   // Line 2  (digits only — formatter adds hyphen)
  address:       string;   // Line 3  (street)
  cityStateZip:  string;   // Line 3  (city/state/ZIP)
  phone:         string;   // Line 7  (taxpayer daytime phone)
  // Signature block
  signerName:    string;
  signerTitle:   string;
  signedAt:      Date;
  // Lines 15 & 16 (pass result of getForm8655AuthDates)
  annual940:    string;
  quarterly941: string;
  /**
   * Optional drawn signature image as a raw base64-encoded PNG (no data: prefix).
   * When present, this is embedded on the PDF signature line instead of the typed name.
   * The typed name is still used for the "Signed by" metadata fields.
   */
  signatureImageBase64?: string;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatEin(ein: string): string {
  const d = ein.replace(/\D/g, "");
  return d.length === 9 ? `${d.slice(0, 2)}-${d.slice(2)}` : ein;
}

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : phone;
}

function formatDate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${m}/${d}/${date.getFullYear()}`;
}

// ── Field mapping (AcroForm, sorted top→bottom) ───────────────────────────────
//
// Derived from coordinate dump of f8655.pdf (all fields on Page1):
//
// y=672  f1_01(x=36,w=381)  Line 1a — Taxpayer name
// y=672  f1_03(x=418,w=158) Line 2  — Taxpayer EIN
// y=651  c1_1  (x=566)      Line 4  — Seasonal employer checkbox (leave unchecked)
// y=648  f1_02(x=36,w=381)  Line 1b — Trade name (leave blank)
// y=624  f1_04(x=36,w=381)  Line 3  — Street address
// y=624  f1_06(x=418,w=158) Line 5  — Other identification number (leave blank)
// y=600  f1_05(x=36,w=540)  Line 3  — City, state, ZIP
// y=576  f1_07(x=36,w=215)  Line 6  — Contact person
// y=576  f1_08(x=252,w=166) Line 7  — Daytime telephone
// y=576  f1_09(x=418,w=158) Line 8  — Fax (leave blank)
// y=540  f1_10(x=36,w=381)  Line 9  — Reporting Agent name
// y=540  f1_11(x=418,w=158) Line 10 — Reporting Agent EIN
// y=516  f1_12(x=36,w=540)  Line 11 — Reporting Agent address
// y=492  f1_13(x=36,w=540)  Line 11 — Reporting Agent city/state/ZIP
// y=468  f1_14(x=36,w=215)  Line 12 — Reporting Agent contact
// y=468  f1_15(x=252,w=166) Line 13 — Reporting Agent phone
// y=468  f1_16(x=418,w=158) Line 14 — Reporting Agent fax
//
// Line 15 — Filing authorization (YYYY for 940, YYYY/MM for 941; others blank)
// y=408  f1_17(x=86)   940    f1_18(x=209) 941    f1_19(x=331) 943    f1_20(x=454) 944
// y=396  f1_21(x=86)   945    f1_22(x=209) [other] f1_23(x=331) [other]
//
// Line 16 — Deposit authorization (same 940/941 values; others blank)
// y=336  f1_29(x=94) 720   f1_24(x=173) 940   f1_25(x=259) 941
//         f1_26(x=346) 943  f1_27(x=432) 944   f1_28(x=518) 945
// y=324  f1_34..f1_33 (other return types — leave blank)
//
// Sign Here section (y≈192–240)
// y=240  f1_36(x=497,w=72)  Date
// y=216  f1_37(x=497,w=72)  Title
// y=192  f1_38(x=446,w=72)  Phone (taxpayer)
// y= 60  f1_39(x=295,w=173) (footer area — leave blank)

// Full AcroForm field name prefix
const P = "topmostSubform[0].Page1[0].";
const R = `${P}Line1_ReadOrder[0].`;
const L = `${P}Lines2-3_ReadOrder[0].`;
const fn = (n: string) => `${P}${n}[0]`;

/**
 * Fills the official IRS Form 8655 (Rev. January 2024) with the supplied data.
 * Returns raw PDF bytes. Caller writes/uploads as needed.
 */
export async function buildForm8655Pdf(data: Form8655Data): Promise<Uint8Array> {
  const irsBytes = Buffer.from(f8655Base64, "base64");
  const doc  = await PDFDocument.load(irsBytes);
  const form = doc.getForm();

  const tf = (name: string, value: string) => {
    try {
      form.getTextField(name).setText(value);
    } catch (e) {
      // Silently skip fields not present (XFA-only fields, etc.)
    }
  };

  // ── Part I — Taxpayer Information ─────────────────────────────────────────
  tf(`${R}f1_01[0]`,           data.taxpayerName.trim());          // 1a name
  tf(`${L}f1_03[0]`,           formatEin(data.taxpayerEin));       // 2  EIN
  // f1_02 (1b trade name) — leave blank
  tf(`${L}f1_04[0]`,           data.address.trim());               // 3  street
  tf(`${L}f1_05[0]`,           data.cityStateZip.trim());          // 3  city/state/ZIP
  // c1_1 (seasonal checkbox) — leave unchecked
  // f1_06 (line 5 other ID) — leave blank
  tf(fn("f1_07"),              "");                                 // 6  contact (no separate contact data available)
  tf(fn("f1_08"),              formatPhone(data.phone));            // 7  taxpayer phone
  // f1_09 (fax) — leave blank

  // ── Part II — Reporting Agent (Rollfi static values) ──────────────────────
  tf(fn("f1_10"),              ROLLFI_NAME);     // 9  name
  tf(fn("f1_11"),              ROLLFI_EIN);      // 10 EIN
  tf(fn("f1_12"),              ROLLFI_ADDR);     // 11 address
  tf(fn("f1_13"),              ROLLFI_CITYSZ);   // 11 city/state/ZIP
  tf(fn("f1_14"),              ROLLFI_CONTACT);  // 12 contact
  tf(fn("f1_15"),              ROLLFI_PHONE);    // 13 phone
  tf(fn("f1_16"),              ROLLFI_FAX);      // 14 fax

  // ── Line 15 — Authorization to sign and file ──────────────────────────────
  tf(fn("f1_17"),  data.annual940);     // 940
  tf(fn("f1_18"),  data.quarterly941);  // 941
  // 943, 944, 945 and continuation row left blank

  // ── Line 16 — Authorization to make deposits ──────────────────────────────
  tf(fn("f1_24"),  data.annual940);     // 940  (x=173)
  tf(fn("f1_25"),  data.quarterly941);  // 941  (x=259)
  // 720, 943, 944, 945 and second row left blank

  // ── Line 18 — Disclosure Authorization (optional; fill 18a for W-2 series) ──
  // f1_36=18a (W-2/W-2c/W-2G), f1_37=18b (1099 series), f1_38=18c (3921/3922)
  // Rollfi handles payroll/W-2; authorize W-2 disclosure starting current year.
  tf(fn("f1_36"),  data.annual940);   // 18a: W-2 series, tax years beginning YYYY
  // f1_37, f1_38 — leave blank (Rollfi doesn't handle 1099 or 3921/3922)

  // ── Line 17 — Request duplicate notices from IRS → check box ─────────────
  // (c1_2 at y=279; useful so Rollfi receives IRS correspondence)
  try { form.getCheckBox(fn("c1_2")).check(); } catch { /* XFA-only, ignore */ }

  // ── Line 19 — Authorize state/local returns → check box ──────────────────
  // (c1_3 at y=170; Rollfi handles state payroll taxes)
  try { form.getCheckBox(fn("c1_3")).check(); } catch { /* XFA-only, ignore */ }

  // ── Sign Here — overlay typed text or drawn signature image ──────────────
  // The signature/title/date fields in the Sign Here box are XFA-only (no
  // AcroForm equivalents). We overlay content at the correct y-position.
  // Sign Here box occupies y≈65–155; signing row is at the bottom (~y=83).
  const pages = doc.getPages();
  const page  = pages[0];
  const bold  = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg   = await doc.embedFont(StandardFonts.Helvetica);

  // Signature of taxpayer (left column, wide)
  // When a drawn signature image is provided, embed the PNG.
  // Otherwise fall back to typing the signer's name as text.
  if (data.signatureImageBase64) {
    try {
      const sigImg = await doc.embedPng(Buffer.from(data.signatureImageBase64, "base64"));
      page.drawImage(sigImg, { x: 50, y: 62, width: 200, height: 28 });
    } catch {
      // Corrupted or unsupported image — fall back to typed name
      page.drawText(data.signerName.trim(), {
        x: 50, y: 70, size: 10, font: bold, color: rgb(0, 0, 0),
      });
    }
  } else {
    page.drawText(data.signerName.trim(), {
      x: 50, y: 70, size: 10, font: bold, color: rgb(0, 0, 0),
    });
  }

  // Title (middle column)
  page.drawText(data.signerTitle.trim(), {
    x: 322, y: 70, size: 9, font: reg, color: rgb(0, 0, 0),
  });
  // Date (right column)
  page.drawText(formatDate(data.signedAt), {
    x: 466, y: 70, size: 9, font: reg, color: rgb(0, 0, 0),
  });

  // Flatten so the filled values are baked in and can't be edited
  form.flatten();

  return doc.save();
}
