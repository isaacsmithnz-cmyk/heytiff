"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDate } from "@/lib/au-dates";
import { uploadFile } from "@/lib/documents/upload-client";
import {
  CATEGORY_LABEL,
  EXPENSE_CATEGORIES,
  isCancellable,
  STATUS_LABEL,
  type Claim,
  type ExpenseCategory,
} from "@/lib/expenses/claim";
import { cancelClaim, submitClaim, type ExpenseResult } from "@/app/actions/expenses";
import { readExpenseReceipt } from "@/app/actions/expense-ai";

/* My expenses — money you spent on the job, and want back.

   THE RECEIPT COMES FIRST, deliberately. Almost every claim starts as a photo
   in someone's hand at the end of a job, so the primary action is "scan a
   receipt" and the form arrives already filled in. Typing it by hand is
   offered, but it is the fallback.

   WHAT TIFF READS IS A DRAFT, NEVER A SUBMISSION. Every scanned figure lands
   in an editable field the person confirms. These numbers become money paid to
   them and a GST figure that may reach a BAS — Tiff does the typing, the human
   does the deciding. A failed scan drops them into the same form, empty, and
   nothing is lost.

   THE FILE UPLOADS ON SUBMIT, not on scan. A scan the person abandons should
   leave nothing behind in the bucket. */

const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

type Draft = {
  expenseDate: string;
  description: string;
  category: ExpenseCategory;
  amount: string;
  gstAmount: string;
  supplier: string;
};

const emptyDraft = (today: string): Draft => ({
  expenseDate: today,
  description: "",
  category: "materials",
  amount: "",
  gstAmount: "",
  supplier: "",
});

export function MyExpenses({ claims, today }: { claims: Claim[]; today: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setDraft(null);
    setFile(null);
    setPreview(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onPick = async (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
    setScanning(true);
    try {
      const b64 = await fileToBase64(picked);
      const res = await readExpenseReceipt(b64, picked.type);
      const base = emptyDraft(today);
      if (res.ok) {
        setDraft({
          ...base,
          expenseDate: res.date ?? base.expenseDate,
          description: res.description ?? "",
          category: res.category ?? "materials",
          amount: res.total !== null ? String(res.total) : "",
          gstAmount: res.gst !== null ? String(res.gst) : "",
          supplier: res.supplier ?? "",
        });
      } else {
        // A scan that couldn't read still leaves them with the receipt and a
        // form — the photo is attached either way.
        setDraft(base);
        if (res.reason !== "no-key") setError("Couldn't read that receipt — fill it in below.");
      }
    } catch {
      setDraft(emptyDraft(today));
      setError("Couldn't read that receipt — fill it in below.");
    } finally {
      setScanning(false);
    }
  };

  const run = (action: () => Promise<ExpenseResult>, onOk?: () => void) => {
    setError(null);
    start(async () => {
      const res = await action();
      if (res.ok) {
        onOk?.();
        router.refresh();
      } else setError(res.error);
    });
  };

  const submit = () => {
    if (!draft) return;
    setError(null);
    start(async () => {
      let documentIds: string[] = [];
      if (file) {
        const up = await uploadFile(file, "receipt");
        if (!up.ok) {
          setError(up.error);
          return;
        }
        documentIds = [up.file.documentId];
      }
      const res = await submitClaim({
        expenseDate: draft.expenseDate,
        description: draft.description,
        category: draft.category,
        amount: Number(draft.amount),
        gstAmount: draft.gstAmount ? Number(draft.gstAmount) : null,
        supplier: draft.supplier || null,
        documentIds,
      });
      if (res.ok) {
        reset();
        router.refresh();
      } else setError(res.error);
    });
  };

  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg" style={{ maxWidth: 760 }}>
          <div className="v2head" style={{ marginBottom: 24, alignItems: "center" }}>
            <div>
              <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
                My expenses
              </h1>
            </div>
          </div>

          {error && <div className="xc-err">{error}</div>}

          {!draft ? (
            <div className="xc-start">
              <span className="xc-ic">
                <Icon name="receipt" size={22} />
              </span>
              <div className="xc-startk">
                <b>Claim something you paid for</b>
                <em>Photograph the receipt and Tiff fills the form in — you check it before it goes.</em>
              </div>
              <div className="xc-startb">
                <button className="pbtn primary" onClick={() => fileRef.current?.click()} disabled={scanning}>
                  <Icon name="cam" size={16} />
                  {scanning ? "Reading…" : "Scan a receipt"}
                </button>
                <button className="pbtn ghost" onClick={() => setDraft(emptyDraft(today))} disabled={scanning}>
                  Enter it myself
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                hidden
                onChange={(e) => onPick(e.target.files?.[0])}
              />
            </div>
          ) : (
            <div className="card2">
              <div className="c2h">
                <span className="ci">
                  <Icon name="receipt" size={19} />
                </span>
                <div>
                  <b>New claim</b>
                  <em>Check everything before you send it — this is what gets approved.</em>
                </div>
              </div>

              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="xc-prev" src={preview} alt="The receipt you're claiming" />
              )}

              <div className="xc-form">
                <label className="xc-f">
                  <span>What was it for</span>
                  <input
                    className="inp"
                    value={draft.description}
                    onChange={(e) => set({ description: e.target.value })}
                    placeholder="Copper fittings and flux"
                  />
                </label>
                <label className="xc-f">
                  <span>Supplier</span>
                  <input
                    className="inp"
                    value={draft.supplier}
                    onChange={(e) => set({ supplier: e.target.value })}
                    placeholder="Reece"
                  />
                </label>
                <label className="xc-f sm">
                  <span>Date</span>
                  <input
                    className="inp"
                    type="date"
                    max={today}
                    value={draft.expenseDate}
                    onChange={(e) => set({ expenseDate: e.target.value })}
                  />
                </label>
                <label className="xc-f sm">
                  <span>Category</span>
                  <select value={draft.category} onChange={(e) => set({ category: e.target.value as ExpenseCategory })}>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="xc-f sm">
                  <span>Total paid</span>
                  <input
                    className="inp"
                    inputMode="decimal"
                    value={draft.amount}
                    onChange={(e) => set({ amount: e.target.value })}
                    placeholder="0.00"
                  />
                </label>
                <label className="xc-f sm">
                  <span>GST {draft.gstAmount ? "" : "(if shown)"}</span>
                  <input
                    className="inp"
                    inputMode="decimal"
                    value={draft.gstAmount}
                    onChange={(e) => set({ gstAmount: e.target.value })}
                    placeholder="—"
                  />
                </label>
              </div>

              <div className="xc-act">
                <button className="pbtn primary" onClick={submit} disabled={busy}>
                  {busy ? "Sending…" : "Send for approval"}
                </button>
                <button className="pbtn ghost" onClick={reset} disabled={busy}>
                  Discard
                </button>
              </div>
            </div>
          )}

          <div className="xc-list">
            {claims.length === 0 ? (
              <div className="adm-empty">
                <b>Nothing claimed yet</b>
                <em>Anything you buy for a job and pay for yourself goes here.</em>
              </div>
            ) : (
              claims.map((c) => (
                <div className={`xc-row ${c.status}`} key={c.id}>
                  <div className="xc-main">
                    <b>{c.description}</b>
                    <em>
                      {fmtAuWeekdayDate(c.expenseDate)}
                      {c.supplier ? ` · ${c.supplier}` : ""} · {CATEGORY_LABEL[c.category]}
                    </em>
                    {c.reviewNote && <p className="xc-note">{c.reviewNote}</p>}
                  </div>
                  <div className="xc-amt">
                    {money(c.amount)}
                    {c.gstAmount ? <span>incl. {money(c.gstAmount)} GST</span> : null}
                  </div>
                  <div className="xc-side">
                    <span className={`xc-pill ${c.status}`}>{STATUS_LABEL[c.status]}</span>
                    {(c.receipts ?? []).map((r, i) =>
                      r.url ? (
                        <a key={i} className="xc-rec" href={r.url} target="_blank" rel="noopener noreferrer">
                          {i === 0 ? "Receipt" : `Receipt ${i + 1}`}
                        </a>
                      ) : null,
                    )}
                    {isCancellable(c.status) && (
                      <button className="xc-cancel" disabled={busy} onClick={() => run(() => cancelClaim(c.id))}>
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
