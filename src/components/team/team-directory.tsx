"use client";

import { Empty } from "@/components/parts/states";
import { Fade } from "@/components/parts/fade";
import { Initials } from "@/components/parts/initials";
import type { DirectoryPerson } from "@/lib/staff/query";

/* TEAM, FOR SOMEONE WITHOUT `team` (Isaac, 20 October 2026: "everyone has
   team… they'll just get basic information like their full name and their
   phone number if they need to contact them"). The working colleagues, each
   a row: the name in bold, what they do under it, the mobile on the right
   to ring. Nobody's record opens from here. */

const matches = (q: string, ...hay: string[]) => hay.some((h) => h.toLowerCase().includes(q));

export function TeamDirectory({ people, query }: { people: DirectoryPerson[]; query: string }) {
  const q = query.trim().toLowerCase();
  const rows = q ? people.filter((p) => matches(q, p.name, p.role)) : people;
  if (!rows.length) return <Empty what={q ? "Nobody by that name" : "Nobody here yet"} action={null} />;
  return (
    <div className="tm2-table tm2-table--dir">
      <div className="tm2-row tm2-row--head" aria-hidden="true">
        <span className="tm2-cell">Person</span>
        <span className="tm2-cell">Mobile</span>
      </div>
      <ul className="tm2-rows" aria-label="Your colleagues">
        {rows.map((p) => (
          <li key={p.id} className="tm2-row">
            <span className="tm2-cell tm2-who">
              <Initials name={p.name} size={40} beside />
              <span className="tm2-whotext">
                <Fade className="tm2-name">{p.name}</Fade>
                {p.role && <Fade className="tm2-sub">{p.role}</Fade>}
              </span>
            </span>
            <span className="tm2-cell tm2-num">
              {p.phone ? (
                <a className="tm2-call" href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}>
                  {p.phone}
                </a>
              ) : (
                <span className="tm2-sub">No mobile</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
