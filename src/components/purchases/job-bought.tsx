"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Fade } from "@/components/parts/fade";
import { StateWord } from "@/components/parts/state";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { jobBought } from "@/app/actions/purchases";
import { againstQuote, lineCents, money, totalCents } from "@/lib/purchases/purchase";

/* BOUGHT, on a job's Materials (the Purchases mock, DMsn3JEQ…): every
   purchase line that went to this job, above the van's pick list, set
   against what the quote allowed for materials at cost: "$638.10 of the
   $2,002.40 in the quote for materials", Inside the quote in green, Over
   the quote in orange. A job with no quote in HeyTiff shows the lines and
   their total alone. Money only with money access; each line opens its
   purchase under Team, which is money's too. Draws nothing until something
   was bought. `version` reloads it after a purchase is added here. */

type Data = Awaited<ReturnType<typeof jobBought>>;

export function JobBought({ jobUuid, version = 0 }: { jobUuid: string; version?: number }) {
  const id = useId();
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    let live = true;
    void jobBought(jobUuid).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [jobUuid, version]);
  if (!data || data.lines.length === 0) return null;
  const spent = totalCents(data.lines);
  const against = againstQuote(spent, data.allowanceCents);
  return (
    <section className="jm-box pu-bought" aria-labelledby={id}>
      <h4 className="jm-head" id={id}>
        <span className="jm-ic" aria-hidden="true">
          <Icon name="receipt" size={16} />
        </span>
        Bought
      </h4>
      {data.money && data.allowanceCents != null && against && (
        <p className="pu-against">
          <span>
            {money(spent)} of the {money(data.allowanceCents)} in the quote for materials
          </span>
          <StateWord tone={against.tone === "gr" ? "good" : "look"}>{against.text}</StateWord>
        </p>
      )}
      <ul className="jm-rows">
        {data.lines.map((l) => {
          const total = lineCents(l);
          const sub = [l.supplierName || "A supplier", l.boughtBy, fmtAuWeekdayDayMonth(l.on)].filter(Boolean).join(", ") + (l.priceFrom === "book" ? ". Price from the book" : "");
          return (
            <li className="jm-row" key={l.id}>
              <Fade className="jm-text">
                {data.money ? (
                  <Link className="jm-name pu-open" href={`/dashboard/team?view=purchases&purchase=${l.purchaseId}`}>
                    {l.name}
                  </Link>
                ) : (
                  <b className="jm-name">{l.name}</b>
                )}
                <span className="jm-sub">{sub}</span>
              </Fade>
              <span className="jm-qty">{l.qty}</span>
              {data.money && <span className="jm-qty pu-money">{total == null ? "" : money(total)}</span>}
            </li>
          );
        })}
        {data.money && (
          <li className="jm-row pu-total">
            <span className="jm-text">Total before GST</span>
            <span className="jm-qty pu-money">{money(spent)}</span>
          </li>
        )}
      </ul>
    </section>
  );
}
