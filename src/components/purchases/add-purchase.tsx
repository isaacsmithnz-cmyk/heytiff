"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Fade } from "@/components/parts/fade";
import { TextInput } from "@/components/parts/field";
import { SearchField } from "@/components/parts/search-field";
import { Tick } from "@/components/parts/tick";
import { StateWord } from "@/components/parts/state";
import { Loading } from "@/components/parts/states";
import { uploadFile } from "@/lib/documents/upload-client";
import { uprightFile } from "@/lib/images/upright";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { addPurchase, placePurchaseLines, pricePurchaseLine, recentJobsForPurchase, type PlaceTo, type PurchaseResult } from "@/app/actions/purchases";
import { searchAllJobs } from "@/app/actions/workboard";
import { bookWords, countWord, isClear, lineCents, money, totalCents, whereItWent, type Purchase, type PurchaseLine } from "@/lib/purchases/purchase";

/* ADD A PURCHASE (Isaac, 29 October 2026, "Build" on the mock
   DMsn3JEQmHEpKUkjnaJ2Fr): choose the docket, Tiff reads it, tick lines
   and Add to job, come back to the list, again for another job, then
   Stock the rest; Where it went says where every line went and what the
   docket did to the price book. Undo after every step.

   The docket uploads first (`purchase_docket`) and is read from the bucket,
   so what Tiff read is what's kept. A photo goes upright and no bigger than
   small print needs before it leaves. Opened from a job's Add, that job
   sits first in Which job?. */

type Job = { jobUuid: string; label: string; sub?: string };

/** The purchase's heading line: "Reece, invoice 7729 4410, Thu 29 Oct. Bought by Leo Watanangura." */
export function purchaseLine(p: Purchase): string {
  const head = [p.supplierName || "A supplier", p.invoiceNo ? `invoice ${p.invoiceNo}` : null, p.invoiceDate ? fmtAuWeekdayDayMonth(p.invoiceDate) : null].filter(Boolean).join(", ");
  return p.boughtBy ? `${head}. Bought by ${p.boughtBy.name}.` : `${head}.`;
}

function LineRow({
  line,
  ticked,
  onTick,
  onPrice,
  busy,
}: {
  line: PurchaseLine;
  ticked: boolean;
  onTick: (on: boolean) => void;
  onPrice: (dollars: number) => void;
  busy: boolean;
}) {
  const [typed, setTyped] = useState("");
  const placed = line.wentTo !== "open";
  const priceless = line.cents == null;
  const sub = placed
    ? line.wentTo === "job"
      ? (line.jobLabel ?? "A job")
      : "Stock"
    : line.priceFrom === "book"
      ? "From the price book"
      : priceless
        ? line.code
          ? `${line.code}, not in your price book`
          : "Not in your price book"
        : [line.code, line.qty === 1 ? null : `${line.qty} at ${money(line.cents ?? 0)}`].filter(Boolean).join(", ");
  const total = lineCents(line);
  return (
    <li className={placed ? "jm-row pu-line pu-line--placed" : "jm-row pu-line"}>
      <Tick
        className="jm-tick"
        checked={ticked}
        disabled={placed || priceless || busy}
        aria-label={`Tick ${line.name}`}
        onChange={onTick}
        label={
          <Fade className="jm-text">
            <b className="jm-name">{line.name}</b>
            <span className="jm-sub">{sub}</span>
          </Fade>
        }
      />
      {priceless && !placed ? (
        <form
          className="pu-price"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(typed.replace(/[$,\s]/g, ""));
            if (n > 0) onPrice(n);
          }}
        >
          <TextInput size={32} className="pu-price-in" inputMode="decimal" aria-label={`Price of one ${line.name}, before GST`} placeholder="Price" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <Button size={32} type="submit" disabled={busy || !(Number(typed.replace(/[$,\s]/g, "")) > 0)}>
            Save price
          </Button>
        </form>
      ) : (
        <span className="jm-qty pu-money">{total == null ? "" : money(total)}</span>
      )}
    </li>
  );
}

function WhichJob({ first, onPick, onBack }: { first: Job | null; onPick: (job: Job) => void; onBack: () => void }) {
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<Job[]>([]);
  /* what a search found, with the words it answers */
  const [found, setFound] = useState<{ words: string; jobs: Job[] } | null>(null);
  const words = q.trim();
  const hits = found?.words === words ? found.jobs : null;
  useEffect(() => {
    let live = true;
    void recentJobsForPurchase().then((r) => live && setRecent(r));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (words.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      void searchAllJobs(words).then((r) => {
        if (!live) return;
        setFound({
          words,
          jobs: r.slice(0, 12).map((j) => ({
            jobUuid: j.remoteId,
            label: [j.jobNumber, j.clientName].filter(Boolean).join(", ") || "A job",
            sub: j.suburb ?? undefined,
          })),
        });
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [words]);
  const row = (j: Job) => (
    <li key={j.jobUuid}>
      <button type="button" className="pu-job" onClick={() => onPick(j)}>
        <b className="jm-name">{j.label}</b>
        {j.sub && <span className="jm-sub">{j.sub}</span>}
      </button>
    </li>
  );
  const others = recent.filter((r) => r.jobUuid !== first?.jobUuid);
  return (
    <div className="pu-which">
      <SearchField value={q} onChange={setQ} label="Find a job" />
      {words.length >= 2 ? (
        hits === null ? (
          <p className="pu-quiet">Finding jobs</p>
        ) : hits.length ? (
          <ul className="jm-rows">{hits.map(row)}</ul>
        ) : (
          <p className="pu-quiet">No job matches that.</p>
        )
      ) : (
        <>
          {first && (
            <>
              <h4 className="pu-group">This job</h4>
              <ul className="jm-rows">{row(first)}</ul>
            </>
          )}
          {others.length > 0 && (
            <>
              <h4 className="pu-group">Recent</h4>
              <ul className="jm-rows">{others.map(row)}</ul>
            </>
          )}
        </>
      )}
      <div className="pu-back">
        <Button onClick={onBack}>Back to the lines</Button>
      </div>
    </div>
  );
}

function WhereItWent({ purchase }: { purchase: Purchase }) {
  const groups = whereItWent(purchase.lines);
  const changed = purchase.lines.filter((l) => l.book === "new" || l.book === "up" || l.book === "down");
  const same = purchase.lines.filter((l) => l.book === "same" || l.book === "from_book").length;
  return (
    <div className="pu-went">
      <ul className="jm-rows">
        {groups.map((g) => (
          <li className="jm-row" key={g.key}>
            <Fade className="jm-text">
              <b className="jm-name">{g.label}</b>
              <span className="jm-sub">{countWord(g.lines, "line", "lines")}</span>
            </Fade>
            <span className="jm-qty pu-money">{money(g.cents)}</span>
          </li>
        ))}
      </ul>
      {(changed.length > 0 || same > 0) && (
        <>
          <h4 className="pu-group">Price book</h4>
          <ul className="jm-rows">
            {changed.map((l) => {
              const w = bookWords(l);
              return (
                <li className="jm-row" key={l.id}>
                  <Fade className="jm-text">
                    <b className="jm-name">{l.name}</b>
                  </Fade>
                  {w.tone === "q" ? <span className="jm-stamp">{w.text}</span> : <StateWord tone={w.tone === "or" ? "look" : "good"}>{w.text}</StateWord>}
                </li>
              );
            })}
            {same > 0 && (
              <li className="jm-row">
                <Fade className="jm-text">
                  <b className="jm-name">{countWord(same, "price", "prices")}</b>
                  <span className="jm-sub">Same as the book, nothing changed</span>
                </Fade>
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

/** The Add a purchase dialog. Opens straight onto the file chooser, or on
    the lines of a purchase already read (`resume`: Put away, under Team). */
export function AddPurchase({ job, resume, onClose }: { job?: Job | null; resume?: Purchase; onClose: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [purchase, setPurchase] = useState<Purchase | null>(resume ?? null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [choosing, setChoosing] = useState(false);
  const [last, setLast] = useState<{ text: string; ids: string[] } | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    if (!resume) file.current?.click();
  }, [resume]);

  const take = async (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    setReading(true);
    try {
      const up = await uploadFile(await uprightFile(picked), "purchase_docket");
      if (!up.ok) {
        setError(up.error);
        return;
      }
      const res = await addPurchase(up.file.documentId);
      if (!res.ok) setError(res.error);
      else setPurchase(res.purchase);
    } catch {
      setError("The docket couldn't be read. Try again.");
    }
    setReading(false);
  };

  const apply = (res: PurchaseResult, said: string | null, ids: string[]) => {
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setPurchase(res.purchase);
    setTicked(new Set());
    setLast(said ? { text: said, ids } : null);
  };

  const place = (ids: string[], to: PlaceTo, said: string) =>
    start(async () => {
      if (!purchase) return;
      apply(await placePurchaseLines(purchase.id, ids, to), said, ids);
    });

  const undo = () =>
    start(async () => {
      if (!purchase || !last) return;
      apply(await placePurchaseLines(purchase.id, last.ids, "open"), null, []);
    });

  const open = purchase?.lines.filter((l) => l.wentTo === "open") ?? [];
  const placeable = open.filter((l) => l.cents != null);
  const anyPlaced = !!purchase && purchase.lines.some((l) => l.wentTo !== "open");
  const clear = !!purchase && isClear(purchase.lines);
  const tickedIds = [...ticked].filter((id) => placeable.some((l) => l.id === id));

  const chooser = (
    <input
      ref={file}
      type="file"
      accept="image/*,application/pdf"
      className="pu-file"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        void take(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  /* nothing read yet: the chooser, or Tiff reading */
  if (!purchase) {
    return (
      <Dialog
        heading="Add a purchase"
        width={560}
        onClose={onClose}
        dismissable={!reading}
        foot={
          !reading && (
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button kind="main" onClick={() => file.current?.click()}>
                Choose the docket
              </Button>
            </>
          )
        }
      >
        {chooser}
        {reading ? (
          <div className="pu-reading">
            <Loading what="Reading the docket" />
            <p className="pu-quiet">Reading the docket and matching its codes to your price book</p>
          </div>
        ) : (
          <>
            <p className="pu-quiet">A photo of the supplier&apos;s docket or invoice, or the PDF they emailed.</p>
            {error && <p className="jm-err">{error}</p>}
          </>
        )}
      </Dialog>
    );
  }

  if (choosing) {
    return (
      <Dialog heading="Which job?" width={560} onClose={() => setChoosing(false)}>
        <p className="pu-quiet">
          {countWord(tickedIds.length, "line", "lines")}, {money(totalCents(placeable.filter((l) => tickedIds.includes(l.id))))}
        </p>
        <WhichJob
          first={job ?? null}
          onBack={() => setChoosing(false)}
          onPick={(j) => {
            setChoosing(false);
            place(tickedIds, { jobUuid: j.jobUuid }, `Added to ${j.label}`);
          }}
        />
      </Dialog>
    );
  }

  if (clear) {
    return (
      <Dialog
        heading="Where it went"
        width={560}
        onClose={onClose}
        foot={
          <Button kind="main" onClick={onClose}>
            Done
          </Button>
        }
      >
        <p className="pu-quiet">{purchaseLine(purchase)}</p>
        <WhereItWent purchase={purchase} />
        {last && (
          <div className="pu-said" role="status">
            <span>Purchase put away</span>
            <Button kind="quiet" size={32} disabled={busy} onClick={undo}>
              Undo
            </Button>
          </div>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog
      heading="Purchase"
      width={720}
      onClose={onClose}
      foot={
        <>
          <Button disabled={busy || placeable.length === 0} onClick={() => place(placeable.map((l) => l.id), "stock", anyPlaced ? "The rest went to stock" : "All went to stock")}>
            {anyPlaced ? "Stock the rest" : "Stock all"}
          </Button>
          <Button kind="main" disabled={busy || tickedIds.length === 0} onClick={() => setChoosing(true)}>
            Add to job
          </Button>
        </>
      }
    >
      <p className="pu-quiet">{purchaseLine(purchase)}</p>
      <div className="pu-head">
        <h4 className="pu-group">On the invoice</h4>
        <Button kind="quiet" size={32} disabled={busy || placeable.length === 0} onClick={() => setTicked(new Set(placeable.map((l) => l.id)))}>
          Tick all
        </Button>
      </div>
      <ul className="jm-rows">
        {purchase.lines.map((l) => (
          <LineRow
            key={l.id}
            line={l}
            busy={busy}
            ticked={ticked.has(l.id)}
            onTick={(on) =>
              setTicked((cur) => {
                const next = new Set(cur);
                if (on) next.add(l.id);
                else next.delete(l.id);
                return next;
              })
            }
            onPrice={(dollars) => start(async () => apply(await pricePurchaseLine(purchase.id, l.id, dollars), null, []))}
          />
        ))}
      </ul>
      <p className="pu-quiet">Prices before GST</p>
      {purchase.skipped.length > 0 && <p className="pu-quiet">Left off: {purchase.skipped.map((s) => s.name).join(", ")}.</p>}
      {error && <p className="jm-err">{error}</p>}
      {last && (
        <div className="pu-said" role="status">
          <span>{last.text}</span>
          <Button kind="quiet" size={32} disabled={busy} onClick={undo}>
            Undo
          </Button>
        </div>
      )}
    </Dialog>
  );
}
