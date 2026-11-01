"use client";

import { notPricedOf, pricedOnOf, type WriteUp, type WriteUpRow } from "@/lib/quotes/write-up";
import type { LinesProposal } from "@/lib/quotes/lines-proposal";

/* SCOPE, WRITTEN AS A SCOPE (Isaac's walk of 3423, 30 October 2026; the mock
   https://claude.ai/artifact/DDfCy926GBnc6e7c7Fuqp5): the proposal's words,
   option by option, as the client will read them; then, from her write-up,
   what the price stands on and what's to check on site. Before she has
   written the proposal, her write-up's work stands in its place. */

export type QuoteScopeWords = {
  proposal: LinesProposal | null;
  optionNames: string[];
  /** the quote's own options: a variation is its own paper */
  options: number[];
};

function Rows({ heading, rows }: { heading: string; rows: WriteUpRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="qs-sec">
      <h3>{heading}</h3>
      <dl className="qs-rows">
        {rows.map((r, i) =>
          r.what ? (
            <div key={i} style={{ display: "contents" }}>
              <dt>{r.what}</dt>
              <dd>{r.said}</dd>
            </div>
          ) : (
            <dd key={i} className="whole">
              {r.said}
            </dd>
          ),
        )}
      </dl>
    </section>
  );
}

export function QuoteScope({ words, writeUp }: { words?: QuoteScopeWords; writeUp: WriteUp | null }) {
  const proposal = words?.proposal ?? null;
  const several = (words?.options.length ?? 0) > 1;
  const options = (words?.options ?? [])
    .map((i) => ({ i, name: words?.optionNames[i] ?? "", said: proposal?.options[i] }))
    .filter((o) => o.said && (o.said.summary || o.said.areas.length > 0));
  const hasWords = !!proposal && (!!proposal.title || !!proposal.intro || options.length > 0);
  if (!hasWords && !writeUp) return <p className="qt-noscope">Tell Tiff about the job in the conversation, and she writes it out here.</p>;
  const notPriced = writeUp ? notPricedOf(writeUp) : [];
  return (
    <section className="qs" aria-label="Scope">
      {proposal?.title && <h2>{proposal.title}</h2>}
      {proposal?.intro && <p>{proposal.intro}</p>}
      {options.map((o) => (
        <section key={o.i}>
          {several && <h3>{o.name ? `Option ${o.i + 1}, ${o.name}` : `Option ${o.i + 1}`}</h3>}
          {o.said?.summary && <p>{o.said.summary}</p>}
          {o.said?.areas.map((a, n) => (
            <div key={n}>
              {a.name && <p>{a.name}</p>}
              <ul>
                {a.items.map((item, k) => (
                  <li key={k}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {!hasWords && writeUp && writeUp.work.length > 0 && (
        <section>
          <h3>The work</h3>
          <ul>
            {writeUp.work.map((item, k) => (
              <li key={k}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      {!!proposal?.notIncluded.length && (
        <section>
          <h3>Not included</h3>
          <ul>
            {proposal.notIncluded.map((item, k) => (
              <li key={k}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      {writeUp && <Rows heading="Priced on" rows={pricedOnOf(writeUp)} />}
      {writeUp && <Rows heading="To check on site" rows={writeUp.toCheck} />}
      {notPriced.length > 0 && <Rows heading="Not priced yet" rows={notPriced.map((said) => ({ what: "", said }))} />}
    </section>
  );
}
