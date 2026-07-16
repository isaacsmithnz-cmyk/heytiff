"use client";

/* First-run Help / disclaimer modal.
   Overlay is position:absolute within the .rca root — do NOT switch to
   position:fixed without portalling to document.body (shell ancestors
   have will-change/transform that break fixed positioning). */

import React from "react";
import { RC } from "./theme";
import { RcIcon, WsEyebrow } from "./ui";

export function HelpModal({ onClose }: { onClose: (dontShow: boolean) => void }) {
  const [dontShow, setDontShow] = React.useState(false);
  const steps: [string, string][] = [
    ["Enter your numbers", "Staff & wages, business costs, vehicles, a risk buffer and your profit target. Simple mode estimates from totals; Detailed lets you go line-by-line."],
    ["Get your rates", "We calculate a recommended install and service charge-out rate. These cover labour only — quote materials and parts separately."],
    ["Compare & act", "See how what you charge today stacks up against break-even and recommended, and where you may be leaving money on the table."],
    ["Review regularly", "Wages and costs drift over time. Revisit every few months so your rates stay accurate."],
  ];
  const close = () => onClose(dontShow);
  return (
    <div onClick={close} style={{ position: "absolute", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: RC.body }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(5,5,5,0.45)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", width: 700, maxHeight: "92%", background: "#fff", borderRadius: 24, boxShadow: "0 40px 100px rgba(5,5,5,0.4)", display: "flex", flexDirection: "column", overflow: "hidden auto" }}>
        {/* header */}
        <div style={{ padding: "28px 34px 0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 10, background: RC.installSoft, color: RC.install, display: "flex", alignItems: "center", justifyContent: "center" }}><RcIcon name="calc" size={16} /></div>
              <WsEyebrow>Rate Calculator · Welcome</WsEyebrow>
            </div>
            <button className="rca-iconbtn" onClick={close} title="Close"><RcIcon name="x" size={16} /></button>
          </div>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 30, letterSpacing: "-0.03em", color: RC.ink, lineHeight: 1.1, marginTop: 16 }}>How to use this tool</div>
          <div style={{ fontSize: 14, color: RC.ink2, lineHeight: 1.6, marginTop: 9 }}>
            Rate Calculator helps you understand your <b style={{ color: RC.ink }}>charge-out rates</b>{" "}and spot the gap between what you charge today and what your costs suggest you should. Here&apos;s the quick version.
          </div>
        </div>
        {/* steps */}
        <div style={{ padding: "18px 34px 0" }}>
          {steps.map(([t, d], i) => (
            <div key={t} style={{ display: "flex", gap: 15, padding: "12px 0", borderBottom: i < steps.length - 1 ? `1px solid ${RC.line}` : "none" }}>
              <div style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, background: RC.installSoft, color: RC.install, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: RC.head, fontWeight: 800, fontSize: 14 }}>{i + 1}</div>
              <div style={{ flex: 1, paddingTop: 3 }}>
                <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 14.5, letterSpacing: "-0.01em", color: RC.ink }}>{t}</div>
                <div style={{ fontSize: 13, color: RC.ink2, lineHeight: 1.5, marginTop: 3 }}>{d}</div>
              </div>
            </div>
          ))}
        </div>
        {/* disclaimer */}
        <div style={{ margin: "18px 34px 0", background: RC.amberSoft, borderRadius: 16, borderLeft: `4px solid ${RC.amber}`, padding: "15px 19px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7, color: RC.amberInk }}>
            <RcIcon name="alert" size={15} />
            <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 11, letterSpacing: "0.07em", textTransform: "uppercase" }}>Important — please read</span>
          </div>
          <div style={{ fontSize: 12.5, color: RC.amberDeep, lineHeight: 1.6 }}>
            Rate Calculator is a <b>planning tool, not a financial service.</b> It does not provide financial, accounting, taxation or legal advice. All figures are <b>estimates</b> based only on the information you enter and general assumptions, and may not reflect your full circumstances. Before making any pricing, tax or business decisions, please consult a <b>qualified accountant or financial adviser.</b> We accept no liability for decisions made on the basis of these outputs.
          </div>
        </div>
        {/* footer */}
        <div style={{ marginTop: "auto", padding: "18px 34px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <label onClick={() => setDontShow(v => !v)} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, fontWeight: 600, color: RC.ink2, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
            <span style={{ width: 20, height: 20, borderRadius: 6, border: `1.5px solid ${dontShow ? RC.ink : RC.lineStrong}`, background: dontShow ? RC.ink : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: RC.teal, fontSize: 12, transition: "all .2s" }}>{dontShow ? "✓" : ""}</span>
            Don&apos;t show this again
          </label>
          <button className="rca-btn primary lg" onClick={close}>Got it — start →</button>
        </div>
      </div>
    </div>
  );
}
