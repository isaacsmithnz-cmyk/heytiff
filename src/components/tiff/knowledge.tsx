"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { KB_CATEGORIES, filterKbDocs, type KbDoc } from "./kb";

/* Knowledge Base — stage 1. Four category cards (reusing the Toolbox card
   styles) listing the library documents, with client-side search. Uploads and
   document viewing are later stages — rows are inert beyond hover for now. */

const KIND_TINT: Record<KbDoc["kind"], [string, string]> = {
  PDF: ["rgba(255,51,102,0.08)", "#FF3366"],
  Doc: ["rgba(46,104,255,0.08)", "#2E68FF"],
  Sheet: ["rgba(0,163,137,0.08)", "#00A389"],
};

export function KnowledgeBase({ docs }: { docs: KbDoc[] }) {
  const [query, setQuery] = useState("");
  const visible = filterKbDocs(docs, query);

  return (
    <div className="page in">
      <div className="wrap">
        <div className="tbx-head">
          <div className="stg">
            <Link href="/dashboard/tiff" className="kbcrumb">
              <Icon name="chevL" size={14} />
              Tiff AI
            </Link>
            <h1>Knowledge Base</h1>
          </div>
          <div className="tbx-search">
            <Icon name="search" size={18} />
            <input
              placeholder="Search documents..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="tbx-grid stgp">
          {KB_CATEGORIES.map((c) => {
            const all = docs.filter((d) => d.category === c.key);
            const rows = visible.filter((d) => d.category === c.key);
            return (
              <div key={c.key} className="catwrap">
                <div className="cat spot" style={{ "--sc": c.color + "1f" } as React.CSSProperties}>
                  <span className="sglow"></span>
                  <div className="ctop" style={{ background: c.color }}></div>
                  <div className="cin">
                    <div className="chd">
                      <div
                        className="cic"
                        style={{ background: c.color + "15", border: `1px solid ${c.color}30`, color: c.color }}
                      >
                        <Icon name={c.icon} size={24} />
                      </div>
                      <div>
                        <div className="cht">{c.label}</div>
                        <div className="chs">
                          {all.length} {all.length === 1 ? "document" : "documents"} &middot; {c.blurb}
                        </div>
                      </div>
                    </div>
                    {all.length === 0 ? (
                      <div className="kbhint">No documents yet — uploads land in a later stage.</div>
                    ) : rows.length === 0 ? (
                      <div className="kbhint">No matches in this category.</div>
                    ) : (
                      rows.map((d, i) => (
                        <div key={d.id} className="toolrow">
                          <span className="tdot" style={{ background: i === 0 ? c.color : "#e5e7eb" }}></span>
                          <div className="tnm">
                            <b>{d.title}</b>
                            <em>
                              {d.source} &middot; {d.updated}
                            </em>
                          </div>
                          <span
                            className="tbg"
                            style={{
                              background: KIND_TINT[d.kind][0],
                              color: KIND_TINT[d.kind][1],
                              borderColor: KIND_TINT[d.kind][1] + "30",
                            }}
                          >
                            {d.kind}
                          </span>
                          <Icon name="chevR" size={18} />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
