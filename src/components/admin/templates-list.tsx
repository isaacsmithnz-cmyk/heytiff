/* TEMPLATES — every document and message the business sends from fixed
   wording, grouped by who receives it, one row each. The same shape as the
   Admin menu and Integrations: a menu is rows, and a row that waits on the
   owner says so.

   No "use client": these are links and a status word. */

import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { ScreenBand, ScreenPanel } from "@/components/shell/screen-band";
import { TEMPLATES, TEMPLATE_GROUPS, templateHref, type TemplateKey } from "./templates-catalogue";

export type TemplateStatus = { text: string; tone: "on" | "warn" };

const ACCENT = "#FF8A00";

export function TemplatesList({ status }: { status: Partial<Record<TemplateKey, TemplateStatus>> }) {
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
            title="Templates"
          />
          <ScreenPanel>
            {TEMPLATE_GROUPS.map((g) => (
              <div className="adm-group" key={g}>
                <div className="adm-glabel">{g}</div>
                <div className="adm-card">
                  {TEMPLATES.filter((t) => t.group === g).map((t) => {
                    const s = status[t.key];
                    return (
                      <Link className="adm-row" href={templateHref(t.key)} key={t.key}>
                        <span className="adm-ic" style={{ background: ACCENT + "1a", color: ACCENT }}>
                          <Icon name={t.icon} size={19} />
                        </span>
                        <span className="adm-main">
                          <b>{t.title}</b>
                          <em>{t.sub}</em>
                        </span>
                        {s && (
                          <span className={"int-pill " + s.tone}>
                            <span className="int-dot" />
                            {s.text}
                          </span>
                        )}
                        <span className="adm-ch">
                          <Icon name="chevR" size={17} />
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </ScreenPanel>
        </div>
      </div>
    </div>
  );
}

/** One template's page: the way back to the list, its name and where it
    stands, who gets it, then the document beside what can be done with it. */
export function TemplateFrame({
  title,
  who,
  status,
  doc,
  side,
}: {
  title: string;
  who: string;
  status?: TemplateStatus | null;
  doc: React.ReactNode;
  side: React.ReactNode;
}) {
  return (
    <div className="page in full">
      <div className="wrap">
        <div className="stg">
          <ScreenBand
            crumb={
              <Link href="/dashboard/admin/templates" className="int-back">
                <Icon name="chevL" size={15} />
                Templates
              </Link>
            }
            title={title}
            tools={
              status ? (
                <span className={"int-pill " + status.tone}>
                  <span className="int-dot" />
                  {status.text}
                </span>
              ) : null
            }
          />
          <ScreenPanel>
            <p className="tpl-who">{who}</p>
            <div className="tpl-work">
              <div className="tpl-well">{doc}</div>
              <aside className="tpl-side">{side}</aside>
            </div>
          </ScreenPanel>
        </div>
      </div>
    </div>
  );
}
