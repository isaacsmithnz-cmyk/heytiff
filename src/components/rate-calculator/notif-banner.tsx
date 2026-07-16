"use client";

/* Slim rate-review notification banner. */

import React from "react";
import { RC } from "./theme";
import { RcIcon } from "./ui";

export function NotifBanner({ daysSince = null, message = null, onReview, onDismiss }: {
  daysSince?: number | null; message?: string | null; onReview: () => void; onDismiss: () => void;
}) {
  const ageText = (daysSince != null && daysSince > 0)
    ? `Your rates were last reviewed ${daysSince} day${daysSince === 1 ? "" : "s"} ago.`
    : "Review your rates to keep them current.";
  return (
    <div style={{ flexShrink: 0, margin: "12px 20px 0", background: RC.amberSoft, border: `1px solid ${RC.amber}30`, borderRadius: 13, boxShadow: "0 1px 2px rgba(10,12,20,.04)", padding: "9px 14px", display: "flex", alignItems: "center", gap: 12, fontFamily: RC.body }}>
      <span style={{ width: 26, height: 26, borderRadius: 8, background: "#fff", border: `1px solid ${RC.amber}40`, color: RC.amberInk, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><RcIcon name="bell" size={13} /></span>
      <div style={{ fontSize: 13, color: RC.amberDeep, lineHeight: 1.4 }}>
        {message && <b style={{ color: RC.amberInk }}>{message} </b>}{ageText}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <button onClick={onReview} style={{ border: "none", background: RC.ink, color: "#fff", borderRadius: 9, padding: "7px 15px", fontFamily: RC.head, fontWeight: 700, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap", transition: "all .25s" }}
          onMouseEnter={e => { e.currentTarget.style.background = RC.teal; e.currentTarget.style.color = RC.ink; }}
          onMouseLeave={e => { e.currentTarget.style.background = RC.ink; e.currentTarget.style.color = "#fff"; }}>Review rates</button>
        <button onClick={onDismiss} title="Dismiss" style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${RC.amber}40`, background: "transparent", color: RC.amberInk, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}><RcIcon name="x" size={13} /></button>
      </div>
    </div>
  );
}
