/* THE DESIGN AS A PDF FILE — what a request for one may ask, and the ticket
   that lets the headless browser in to print it. Server-only (node:crypto).

   WHY A FILE AT ALL. The Share dialog's paper has always been the browser's
   own print window, which makes a good PDF but never hands the app the bytes.
   A file is what a ServiceM8 job can carry, and what "Download PDF" can save
   without a print window in the way. So the server opens the very page the
   print window shows — PrintDoc, off the same print model — in a headless
   Chrome, and asks it for the PDF (lib/studio/pdf-render.ts).

   THE TICKET. That browser has no session. It is sent to /print/design with a
   ticket naming the workspace, the design and the options, signed with a key
   derived from AUTH0_SECRET and good for two minutes. The page trusts nothing
   else: the org comes off the ticket, and every row it reads is read inside
   that org. */

import { createHmac, timingSafeEqual } from "node:crypto";
import { ALL_SECTIONS, type ExportOptions } from "./export";

const TTL_MS = 2 * 60_000;

/** Read options that came from a browser. Anything malformed takes the
    default; nothing unrecognised survives. */
export function readPdfOptions(raw: unknown, designId: string): ExportOptions {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const ids = (v: unknown, max: number) =>
    Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 80))].slice(0, max)
      : [];
  const s = (r.sections && typeof r.sections === "object" ? r.sections : {}) as Record<string, unknown>;
  const l = (r.layers && typeof r.layers === "object" ? r.layers : {}) as Record<string, unknown>;
  const variantIds = ids(r.variantIds, 10).filter((v) => v !== designId);
  return {
    sections: {
      figures: bool(s.figures, ALL_SECTIONS.figures),
      systems: bool(s.systems, ALL_SECTIONS.systems),
      lines: bool(s.lines, ALL_SECTIONS.lines),
      picklist: bool(s.picklist, ALL_SECTIONS.picklist),
    },
    floorIds: ids(r.floorIds, 50),
    /* the open design always prints, and first */
    variantIds: [designId, ...variantIds],
    layers: {
      plan: bool(l.plan, true),
      units: bool(l.units, true),
      pipes: bool(l.pipes, true),
      labels: bool(l.labels, true),
    },
    grayscale: bool(r.grayscale, false),
    legend: bool(r.legend, false),
    paper: r.paper === "A3" ? "A3" : "A4",
    orientation: r.orientation === "landscape" ? "landscape" : "portrait",
  };
}

export interface PdfTicket {
  orgId: string;
  designId: string;
  options: ExportOptions;
}

function key(): Buffer {
  const secret = process.env.AUTH0_SECRET;
  if (!secret) throw new Error("AUTH0_SECRET is not set");
  return createHmac("sha256", secret).update("heytiff/studio-pdf/v1").digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signPdfTicket(t: PdfTicket, now: number = Date.now()): string {
  const body = b64(JSON.stringify({ ...t, exp: now + TTL_MS }));
  const sig = b64(createHmac("sha256", key()).update(body).digest());
  return `${body}.${sig}`;
}

/** The ticket's contents, or null when it is forged, altered or stale. */
export function readPdfTicket(token: string | undefined, now: number = Date.now()): PdfTicket | null {
  if (!token || token.length > 8000) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", key()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let parsed: { orgId?: unknown; designId?: unknown; options?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed.exp !== "number" || parsed.exp < now) return null;
  if (typeof parsed.orgId !== "string" || typeof parsed.designId !== "string") return null;
  return {
    orgId: parsed.orgId,
    designId: parsed.designId,
    options: readPdfOptions(parsed.options, parsed.designId),
  };
}

/** A file name a customer's mail client and ServiceM8 will both accept. */
export function pdfFileName(name: string): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${base || "Design"}.pdf`;
}
