"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WatchSignal } from "@/lib/hq/watchlist";
import type { SaveResult } from "./edit-types";

/* "Waiting on extraction" — the standing brief for future book uploads.

   Auto signals are computed from the pack itself (declared-but-unextracted
   sources, unmatched rule references) and can't be dismissed — they clear only
   when an extraction closes them. Manual items are staff-entered and resolvable.
   Nothing here is ever answered from the internet: unknowns stay visible until
   an uploaded document answers them. */

export interface WatchItem {
  id: string;
  item: string;
  context: string | null;
  addedBy: string;
  addedAt: string;
}

const KIND_LABEL: Record<WatchSignal["kind"], string> = {
  "unextracted-source": "book not extracted",
  "unmatched-family": "unmatched family",
  "dangling-part-ref": "missing part",
};

export function WatchlistPanel({
  signals,
  items,
  onAdd,
  onResolve,
}: {
  signals: WatchSignal[];
  items: WatchItem[];
  onAdd?: (item: string, context?: string) => Promise<SaveResult>;
  onResolve?: (id: string) => Promise<SaveResult>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const empty = signals.length === 0 && items.length === 0;

  async function add() {
    if (!onAdd || !draft.trim()) return;
    setBusy(true);
    setError(null);
    const res = await onAdd(draft.trim());
    setBusy(false);
    if (res.ok) {
      setDraft("");
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  async function resolve(id: string) {
    if (!onResolve) return;
    setBusy(true);
    setError(null);
    const res = await onResolve(id);
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  return (
    <div className="hq-watch">
      <div className="hq-watch-head">
        <span className="hq-watch-title">Waiting on extraction</span>
        <span className="hq-watch-sub">
          what the next uploaded book must answer — never filled from the internet
        </span>
      </div>

      {empty ? (
        <div className="hq-watch-empty">Nothing outstanding.</div>
      ) : (
        <ul className="hq-watch-list">
          {signals.map((s) => (
            <li key={`${s.kind}:${s.title}`} className="hq-watch-item auto">
              <span className={`hq-watch-kind ${s.kind}`}>{KIND_LABEL[s.kind]}</span>
              <span className="hq-watch-body">
                <b>{s.title}</b> — {s.detail}
              </span>
            </li>
          ))}
          {items.map((it) => (
            <li key={it.id} className="hq-watch-item manual">
              <span className="hq-watch-kind manual">watch</span>
              <span className="hq-watch-body">
                <b>{it.item}</b>
                {it.context ? <> — {it.context}</> : null}
                <span className="hq-watch-by"> · {it.addedBy}</span>
              </span>
              {onResolve ? (
                <button
                  className="hq-watch-resolve"
                  onClick={() => resolve(it.id)}
                  disabled={busy}
                >
                  Resolve
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {onAdd ? (
        <div className="hq-watch-add">
          <input
            className="hq-watch-input"
            placeholder="Add something the next extraction should look for…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            disabled={busy}
          />
          <button className="hq-btn primary" onClick={add} disabled={busy || !draft.trim()}>
            Add
          </button>
        </div>
      ) : null}
      {error ? <div className="hq-pop-error">{error}</div> : null}
    </div>
  );
}
