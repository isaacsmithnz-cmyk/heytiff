"use client";

import { useEffect, useState } from "react";
import { mySignature, saveMySignature } from "@/app/actions/certificates";
import { SignaturePad } from "@/components/swms/controls";
import { StaticCard } from "./section-card";
import "@/components/swms/swms.css";

/* YOUR SIGNATURE — drawn once, here, and printed on every certificate you
   sign (docs/certificates-plan.md, Signature). Only on your own card: a
   signature is the person's own mark, so nobody draws one for somebody else,
   and the action behind it only ever writes the signed-in person's. Each
   certificate keeps its own copy, so redrawing it never changes one already
   sent. */
export function SignatureCard() {
  const [svg, setSvg] = useState<string | null | undefined>(undefined);
  const [drawing, setDrawing] = useState("");
  const [redraw, setRedraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void mySignature()
      .then((s) => {
        if (live) setSvg(s);
      })
      .catch(() => {
        if (live) setSvg(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const keep = async () => {
    setBusy(true);
    setError(null);
    const res = await saveMySignature(drawing).catch(() => ({ ok: false as const, error: "Couldn't save your signature." }));
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSvg(res.svg);
    setDrawing("");
    setRedraw(false);
  };

  return (
    <StaticCard title="Signature" sub="Printed on the certificates you sign">
      {svg === undefined ? null : svg && !redraw ? (
        <div className="sig-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt="Your signature" />
          <button type="button" className="padd" onClick={() => setRedraw(true)}>
            Draw it again
          </button>
        </div>
      ) : (
        <div className="sig-card">
          <SignaturePad label="Draw your signature" onChange={setDrawing} />
          <span className="sig-acts">
            {redraw && (
              <button type="button" className="pbtn ghost" onClick={() => setRedraw(false)}>
                Cancel
              </button>
            )}
            <button type="button" className="pbtn primary" disabled={!drawing || busy} onClick={() => void keep()}>
              {busy ? "Saving…" : "Save signature"}
            </button>
          </span>
          {error && <div className="carderr">{error}</div>}
        </div>
      )}
    </StaticCard>
  );
}
