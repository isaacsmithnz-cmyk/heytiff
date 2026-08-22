"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { ViewTabs } from "@/components/shell/view-tabs";
import { fmtAuWeekdayDate } from "@/lib/au-dates";
import { uploadFile } from "@/lib/documents/upload-client";
import { DateField } from "@/components/ui/date-field";
import {
  CATEGORY_LABEL,
  EXPENSE_CATEGORIES,
  isCancellable,
  isOpen,
  owedTotal,
  RECEIPT_ACCEPT,
  RECEIPT_PDF_TYPE,
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
   leave nothing behind in the bucket.

   THE RECEIPT CAN BE ATTACHED AT ANY POINT, which it could not before: the
   file input lived only on the start screen, so anyone who chose "Enter it
   myself" was silently committed to a claim with no evidence on it — and the
   approver, who is being asked for money, had nothing to look at. The form
   carries its own attach row now.

   ATTACHING FROM THE FORM DOES NOT RE-SCAN. By that point the person has
   typed something; reading the file would overwrite their own figures with
   Tiff's, which is the one direction this screen must never move in. Scanning
   is what the start screen is for. */

const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A PDF has no thumbnail, so the strip names it instead of showing it. */
const isPdf = (f: File) => f.type === RECEIPT_PDF_TYPE;

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
  /* One claim armed for cancellation at a time — same shape My leave and the
     team directory use. Arming a second forgets the first. */
  const [armed, setArmed] = useState<string | null>(null);
  const [tab, setTab] = useState<"claims" | "closed">("claims");
  const fileRef = useRef<HTMLInputElement>(null);

  /* Object URLs are held until they're replaced or the claim is cleared —
     without this the browser keeps every abandoned preview alive for the life
     of the page. `attach` is the only place a preview is minted. */
  const attach = (picked: File | null) => {
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return picked && !isPdf(picked) ? URL.createObjectURL(picked) : null;
    });
    setFile(picked);
    if (!picked && fileRef.current) fileRef.current.value = "";
  };

  const reset = () => {
    setDraft(null);
    attach(null);
    setError(null);
  };

  /* Attaching from INSIDE the form — no scan. See the header: by then the
     person has typed something, and reading the file would overwrite their
     figures with Tiff's. */
  const onAttachOnly = (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    attach(picked);
  };

  const onPick = async (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    attach(picked);
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
        // form — the file stays attached either way.
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

  /* WHAT THE FORM ALREADY KNOWS, it stops asking the server. "Send for
     approval" was enabled on a completely empty form, so the first thing a
     person got back was a round trip and "Say what the expense was for" —
     something the button could see before it was pressed. `buildClaim` still
     re-checks every rule; this only stops the pointless trip. */
  const missing = !draft
    ? null
    : !draft.description.trim()
      ? "Say what it was for"
      : !(Number(draft.amount) > 0)
        ? "Add how much it cost"
        : null;

  /* WHAT YOU ARE OWED. The same `owedTotal` the approver's queue and the
     Time & Pay stat tile have always used — it counts pending plus
     approved-but-unpaid, and it was on every screen except the one belonging
     to the person who is actually out of pocket. */
  const owed = owedTotal(claims);

  /* The two faces: what's still moving, and what's been answered. Open rides
     `isOpen` — the same test `owedTotal` uses — so the Claims tab and the
     owed figure can never disagree about which rows count. */
  const openClaims = claims.filter((c) => isOpen(c.status));
  const closedClaims = claims.filter((c) => !isOpen(c.status));
  const shown = tab === "closed" ? closedClaims : openClaims;

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 24, alignItems: "center" }}>
            <div>
              <h1>
                My expenses
              </h1>
            </div>
          </div>

          {error && <div className="xc-err">{error}</div>}

          {/* The board's card and tabs. Claims is the working face — capture
              first, then what's still moving; Closed is the answered pile
              (reimbursed, declined, cancelled), which used to pad out the one
              list forever. */}
          <div className="wb2">
            <ViewTabs
              ariaLabel="Your expense claims"
              idPrefix="xct"
              panelPrefix="xcp"
              active={tab}
              onGo={(k) => setTab(k as "claims" | "closed")}
              items={[
                {
                  key: "claims",
                  label: "Claims",
                  count: openClaims.length,
                  countLabel: (n) => `${n} open`,
                },
                { key: "closed", label: "Closed" },
              ]}
            />
            <div className="wb2-card">
              <div className="ppanel2">
                <section
                  key={tab}
                  id={`xcp-${tab}`}
                  role="tabpanel"
                  aria-labelledby={`xct-${tab}`}
                  tabIndex={-1}
                  className="psec2"
                >
          {tab === "claims" && (
            <>
          {!draft ? (
            <div className="xc-start">
              <span className="xc-ic">
                <Icon name="receipt" size={22} />
              </span>
              <div className="xc-startk">
                <b>Claim something you paid for</b>
                {/* "— you check it before it goes" came off: the same hedge
                    the agreement modal wore ("every field below is editable
                    before anything is created"). The form appears filled and
                    editable with a Send button under it; the sentence only
                    taught you to distrust the fill. */}
                <em>Photograph the receipt and Tiff fills the form in.</em>
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

              {/* THE RECEIPT, and the way to change it. There was no control
                  here at all — the picker lived on the start screen and
                  unmounted the moment a draft existed, so "Enter it myself"
                  meant no receipt, ever. */}
              <div className="xc-att">
                {file ? (
                  <>
                    {preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="xc-prev" src={preview} alt="The receipt you're claiming" />
                    ) : (
                      // a PDF has nothing to show — name it instead
                      <span className="xc-pdf">
                        <Icon name="file" size={18} />
                        {file.name}
                      </span>
                    )}
                    <div className="xc-attb">
                      <button className="pbtn ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                        Replace
                      </button>
                      <button className="pbtn ghost" onClick={() => attach(null)} disabled={busy}>
                        Remove
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="xc-attk">
                      <b>No receipt attached</b>
                      <em>A claim with the docket on it is the one that gets approved without a conversation.</em>
                    </span>
                    <div className="xc-attb">
                      <button className="pbtn" onClick={() => fileRef.current?.click()} disabled={busy}>
                        <Icon name="upload" size={15} />
                        Attach a receipt
                      </button>
                    </div>
                  </>
                )}
              </div>

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
                {/* THE APP'S OWN PICKER, not the browser's. `date-field.tsx`
                    opens with "Every date in HeyTiff is picked, never typed",
                    and spells out why: `<input type="date">` renders a
                    different control in every browser and, on a phone, a wheel
                    that answers "what's the date" in whatever the OS locale
                    says — dd/mm vs mm/dd, silently. This one sat directly
                    beside the app's own styled Category select, on a form
                    whose date decides which BAS period a GST figure lands in. */}
                <label className="xc-f sm">
                  <span>Date</span>
                  <DateField
                    value={draft.expenseDate || null}
                    today={today}
                    max={today}
                    onChange={(iso) => set({ expenseDate: iso ?? "" })}
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
                <button className="pbtn primary" onClick={submit} disabled={busy || !!missing}>
                  {busy ? "Sending…" : "Send for approval"}
                </button>
                <button className="pbtn ghost" onClick={reset} disabled={busy}>
                  Discard
                </button>
                {missing && !busy && <span className="xc-need">{missing}</span>}
              </div>
            </div>
          )}

          {/* WHAT YOU ARE OWED, on the screen of the person owed it. The
              approver's queue has carried this figure all along, and so has
              the Time & Pay stat tile; the claimant's own screen listed the
              claims and left them to add up. */}
          {owed > 0 && (
            <div className="xc-owed">
              <span className="xc-owedk">Owed to you</span>
              <b>{money(owed)}</b>
              <em>Claims sent or approved but not yet paid.</em>
            </div>
          )}
            </>
          )}

          <div className="xc-list">
            {shown.length === 0 ? (
              tab === "closed" ? (
                <div className="adm-empty">
                  <b>Nothing here yet</b>
                  <em>Claims land here once they&apos;re reimbursed, declined or cancelled.</em>
                </div>
              ) : (
                <div className="adm-empty">
                  <b>Nothing claimed yet</b>
                  <em>Anything you buy for a job and pay for yourself goes here.</em>
                </div>
              )
            ) : (
              shown.map((c) => (
                <div className={`xc-row ${c.status}`} key={c.id}>
                  <div className="xc-main">
                    <b>{c.description}</b>
                    <em>
                      {fmtAuWeekdayDate(c.expenseDate)}
                      {c.supplier ? ` · ${c.supplier}` : ""} · {CATEGORY_LABEL[c.category]}
                    </em>
                    {/* WHERE THIS CAME FROM. A claim raised by "Log fuel · my
                        own money" is one the person never filled in, so the
                        row has to say so or it reads as a mystery. */}
                    {c.fuelLog && (
                      <p className="xc-from">
                        <Icon name="fuel" size={13} />
                        Raised from your fuel log
                        {c.fuelLog.vehicle ? ` · ${c.fuelLog.vehicle}` : ""}
                      </p>
                    )}
                    {c.reviewNote && <p className="xc-note">{c.reviewNote}</p>}
                  </div>
                  <div className="xc-amt">
                    {money(c.amount)}
                    {c.gstAmount ? <span>incl. {money(c.gstAmount)} GST</span> : null}
                  </div>
                  <div className="xc-side">
                    <span className={`xc-pill ${c.status}`}>{STATUS_LABEL[c.status]}</span>
                    {/* THE APPROVER'S ROW HAS ALWAYS SAID THIS and the
                        claimant's never did — so the person was told a docket
                        is "what gets approved without a conversation" while
                        filling the form, and then never told again whether
                        theirs had one. Same words the review screen uses. */}
                    {(c.receipts ?? []).length > 0 ? (
                      (c.receipts ?? []).map((r, i) =>
                        r.url ? (
                          <a key={i} className="xc-rec" href={r.url} target="_blank" rel="noopener noreferrer">
                            {i === 0 ? "Receipt" : `Receipt ${i + 1}`}
                          </a>
                        ) : null,
                      )
                    ) : (
                      /* Only while the claim is still live. A reimbursed or
                         declined one is history, and chasing its docket in
                         amber is drawing the eye to a decision already made. */
                      isOpen(c.status) && <span className="xr-noreceipt">No receipt</span>
                    )}
                    {/* ARMS BEFORE IT FIRES, the same protocol My leave uses on
                        its own Cancel and for the same reason: this discards a
                        claim for money you are owed — an APPROVED one, at that
                        — and strands the receipt with it. One press asked, and
                        it was gone. */}
                    {isCancellable(c.status) && (
                      <button
                        className={`xc-cancel${armed === c.id ? " arm" : ""}`}
                        disabled={busy}
                        aria-label={
                          armed === c.id
                            ? `Confirm cancelling ${c.description}`
                            : `Cancel ${c.description}`
                        }
                        onClick={() => {
                          if (armed !== c.id) return setArmed(c.id);
                          run(() => cancelClaim(c.id), () => setArmed(null));
                        }}
                      >
                        {armed === c.id ? "Confirm" : "Cancel"}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
                </section>
              </div>
            </div>
          </div>

          {/* ONE picker, mounted for the life of the screen — outside the
              card so a tab switch can't unmount it mid-pick. On the start
              screen a file is scanned into a draft; once a draft exists it is
              attached and nothing is overwritten. */}
          <input
            ref={fileRef}
            type="file"
            accept={RECEIPT_ACCEPT}
            hidden
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (draft) onAttachOnly(picked);
              else void onPick(picked);
            }}
          />
        </div>
      </div>
    </div>
  );
}
