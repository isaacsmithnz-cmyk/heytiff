/* LETTERS — every letter on the business's own letterhead this person may
   open (whoever wrote it, whoever signs it, the owner), last changed first,
   one row each, the Admin menu's shape. No "use client": these are links. */

import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { ScreenBand, ScreenPanel } from "@/components/shell/screen-band";
import { letterDate } from "@/lib/letters/letter";
import type { LetterSummary } from "@/lib/letters/query";

const ACCENT = "#0E9F6E";

export const lettersHref = "/dashboard/admin/letters";
export const letterHref = (id: string) => `${lettersHref}/${id}`;

/** "9 October 2026, signed by Isaac Smith" */
function lineOf(l: LetterSummary): string {
  const date = letterDate(l.date);
  const signed = l.signer ? `signed by ${l.signer}` : "not signed";
  return date ? `${date}, ${signed}` : signed.charAt(0).toUpperCase() + signed.slice(1);
}

export function LettersList({ letters }: { letters: readonly LetterSummary[] }) {
  return (
    <div className="page in full">
      <div className="wrap">
        <div className="stg">
          <ScreenBand
            crumb={
              <Link href="/dashboard/admin" className="int-back">
                <Icon name="chevL" size={15} />
                Admin
              </Link>
            }
            title="Letters"
            tools={
              <Link className="pbtn" href={letterHref("new")}>
                New letter
              </Link>
            }
          />
          <ScreenPanel>
            {letters.length === 0 ? (
              <div className="adm-group">
                <div className="adm-card">
                  <Link className="adm-row" href={letterHref("new")}>
                    <span className="adm-ic" style={{ background: ACCENT + "1a", color: ACCENT }}>
                      <Icon name="file" size={19} />
                    </span>
                    <span className="adm-main">
                      <b>Write a letter on your letterhead</b>
                      <em>An employment confirmation for a visa, a letter for a car loan, anything asked for on company letterhead</em>
                    </span>
                    <span className="adm-ch">
                      <Icon name="chevR" size={17} />
                    </span>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="adm-group">
                <div className="adm-card">
                  {letters.map((l) => (
                    <Link className="adm-row" href={letterHref(l.id)} key={l.id}>
                      <span className="adm-ic" style={{ background: ACCENT + "1a", color: ACCENT }}>
                        <Icon name="file" size={19} />
                      </span>
                      <span className="adm-main">
                        <b>{l.title}</b>
                        <em>{lineOf(l)}</em>
                      </span>
                      <span className="adm-ch">
                        <Icon name="chevR" size={17} />
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            <p className="tpl-quiet">
              Every letter is printed on the letterhead in <Link href="/dashboard/admin/templates/letterhead">Templates</Link>.
            </p>
          </ScreenPanel>
        </div>
      </div>
    </div>
  );
}
