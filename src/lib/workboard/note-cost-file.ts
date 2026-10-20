/* A COST FROM A NOTE, FILED — server only.

   The router's cost lane (note-cost) ends here: the receipt photo that came
   with the note, read by today's receipt reader, and the claim itself,
   pressed through the expense form's own action. Nothing here decides what
   a claim may be. `submitClaim` does (actions/expenses): a staff record,
   every rule `buildClaim` applies, the job resolved in this workspace, the
   receipt adopted only when it is the speaker's own upload. `cancelClaim` is
   its Undo. So a cost from a note and one from the form can never disagree
   about what may be filed.

   WHICH WAY, in order (v2 step 6, slice C):
     fuel           fuel goes on the vehicle's log, as the expense form sends
                    it there: a task for the speaker, "Log fuel: $85.00 at BP";
     another payer  someone else paid from their own pocket: a claim is the
                    payer's own to make, so a task for them, "Claim $85.00 at
                    Reece", and Tiff says why;
     claim          the speaker's own money: an expense claim, pending;
     company        the company card: a receipt on record, nothing owed. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { refIsOrgs } from "@/lib/documents/files";
import { imageForClaude } from "@/lib/images/for-claude";
import { RECEIPT_PDF_TYPE, isReadableReceipt } from "@/lib/expenses/claim";
import { readExpenseReceipt } from "@/app/actions/expense-ai";
import { submitClaim } from "@/app/actions/expenses";
import { costDescription, type CostWhy, type NoteReceipt, type ProposedCost } from "./note-cost";

export type CostRoute = { kind: "claim" } | { kind: "task"; why: CostWhy; staffId: string };

/** Which way a cost goes, for the speaker (`speakerId`). */
export function costRoute(c: Pick<ProposedCost, "category" | "paidWith" | "payerId">, speakerId: string): CostRoute {
  if (c.category === "fuel") return { kind: "task", why: "fuel", staffId: speakerId };
  if (c.paidWith === "own" && c.payerId && c.payerId !== speakerId) return { kind: "task", why: "payer", staffId: c.payerId };
  return { kind: "claim" };
}

/** The most of a receipt the reader is handed: the documents bucket's own
    ceiling, as the certifier list reader holds it. */
const RECEIPT_BYTES_MAX = 10_000_000;

/** Refusals in the words Tiff says them. */
export const RECEIPT_GONE = "That receipt photo isn't here any more. Attach it again.";

/** THE RECEIPT THAT CAME WITH A NOTE, read by today's receipt reader
    (`readExpenseReceipt`, the expense form's scan). Only a receipt the
    speaker uploaded themselves (kind `receipt`, upload finished) and not on
    a claim already, the rows `submitClaim` will adopt. A photo is turned
    upright and sized as every photo Tiff reads is (imageForClaude); a PDF
    goes as it is. A read that fails keeps the receipt with `read` null, so
    the cost is filed from the words with the photo on it. */
export async function readNoteReceipt(
  orgId: string,
  staffId: string | null,
  documentId: string,
): Promise<{ ok: true; receipt: NoteReceipt } | { ok: false; error: string }> {
  const id = (documentId ?? "").trim();
  if (!staffId || !id) return { ok: false, error: RECEIPT_GONE };
  const { data } = await supabaseAdmin
    .from("documents")
    .select("id, storage_ref, mime_type, size_bytes, expense_claim_id")
    .eq("org_id", orgId)
    .eq("id", id)
    .eq("uploaded_by", staffId)
    .eq("kind", "receipt")
    .not("uploaded_at", "is", null)
    .maybeSingle();
  const doc = data as {
    storage_ref: string;
    mime_type: string | null;
    size_bytes: number | null;
    expense_claim_id: string | null;
  } | null;
  if (!doc || doc.expense_claim_id || !refIsOrgs(doc.storage_ref, orgId)) return { ok: false, error: RECEIPT_GONE };

  const unread: NoteReceipt = { documentId: id, read: null };
  const media = (doc.mime_type ?? "").toLowerCase();
  if (!isReadableReceipt(media) || (doc.size_bytes ?? 0) > RECEIPT_BYTES_MAX) return { ok: true, receipt: unread };

  try {
    const { data: blob, error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(doc.storage_ref);
    if (error || !blob) return { ok: true, receipt: unread };
    const bytes = Buffer.from(await blob.arrayBuffer());
    const file =
      media === RECEIPT_PDF_TYPE
        ? { base64: bytes.toString("base64"), mime: media }
        : await imageForClaude(bytes, media).then((img) => (img ? { base64: img.bytes.toString("base64"), mime: img.mime } : null));
    if (!file) return { ok: true, receipt: unread };
    const res = await readExpenseReceipt(file.base64, file.mime);
    if (!res.ok) return { ok: true, receipt: unread };
    return {
      ok: true,
      receipt: {
        documentId: id,
        read: {
          total: res.total,
          gst: res.gst,
          supplier: res.supplier,
          date: res.date,
          description: res.description,
          category: res.category,
        },
      },
    };
  } catch {
    return { ok: true, receipt: unread };
  }
}

/** The job a claim can hold (`expense_claims.job_kind`): a project, a
    maintenance visit or an agreement. A ServiceM8 job it can't, so it is
    named in the claim's words instead (`costDescription`). */
export type ClaimJob = { kind: "project" | "visit" | "agreement"; id: string } | null;

/** FILE ONE COST AS A CLAIM, through the expense form's own action: the
    speaker's, or a company-card receipt, with the receipt photo adopted
    when it came with the note. */
export async function claimCost(
  c: ProposedCost,
  input: { today: string; job: ClaimJob; unlinkedJob: string | null; receiptId: string | null },
): Promise<{ ok: true; claimId: string } | { ok: false; error: string }> {
  const res = await submitClaim({
    job: input.job,
    expenseDate: c.day || input.today,
    description: costDescription(c, input.job ? null : input.unlinkedJob),
    category: c.category,
    amount: c.amount,
    gstAmount: c.gst || null,
    supplier: c.supplier || null,
    paidWith: c.paidWith,
    documentIds: input.receiptId ? [input.receiptId] : [],
  });
  return res.ok ? { ok: true, claimId: res.id } : res;
}
