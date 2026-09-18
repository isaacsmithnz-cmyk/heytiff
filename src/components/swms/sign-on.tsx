"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearSwmsIssue, raiseSwmsIssue, signOnSwms } from "@/app/actions/swms";
import { BELL_REFRESH_EVENT } from "@/lib/dashboard/chips";
import { SIGNATURE_VIEWBOX } from "@/lib/swms/input";
import { HRCW } from "@/lib/swms/library";
import type { SwmsDocument, SwmsPerson } from "@/lib/swms/query";
import { siteWhen } from "@/lib/swms/when";
import "./swms.css";

/* THE SIGN-ON — read the SWMS, confirm the briefing, sign in the box.

   IN THE APP, NOT BY TEXT. A team member arrives from their bell and signs
   on as themselves. Someone from outside the business has no HeyTiff login,
   so they sign on the phone of a team member on the same SWMS, after the
   briefing — the record says whose phone.

   A REPLACED VERSION IS READ-ONLY. Its sign-ons stand as history, and the
   screen points at the version that replaced it, which asks again. */

/* The drawn path as SVG path data in the stored viewBox — moves and lines,
   rounded, with points closer than a pixel of paper dropped so a slow hand
   doesn't write a megabyte. */
function SignaturePad({ onChange, label }: { onChange: (path: string) => void; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const parts = useRef<string[]>([]);
  const last = useRef<[number, number] | null>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / Math.max(r.width, 1)) * SIGNATURE_VIEWBOX.width;
    const y = ((e.clientY - r.top) / Math.max(r.height, 1)) * SIGNATURE_VIEWBOX.height;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  };
  const pen = () => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !canvas.current) return null;
    ctx.strokeStyle = getComputedStyle(canvas.current).color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    return ctx;
  };

  return (
    <div className="sws-pad">
      <canvas
        ref={canvas}
        width={SIGNATURE_VIEWBOX.width}
        height={SIGNATURE_VIEWBOX.height}
        aria-label={label}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          drawing.current = true;
          const [x, y] = at(e);
          parts.current.push(`M${x} ${y}`);
          last.current = [x, y];
          const ctx = pen();
          ctx?.beginPath();
          ctx?.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const [x, y] = at(e);
          if (Math.hypot(x - last.current[0], y - last.current[1]) < 1.5) return;
          parts.current.push(`L${x} ${y}`);
          const ctx = pen();
          ctx?.beginPath();
          ctx?.moveTo(last.current[0], last.current[1]);
          ctx?.lineTo(x, y);
          ctx?.stroke();
          last.current = [x, y];
          if (empty) setEmpty(false);
        }}
        onPointerUp={() => {
          drawing.current = false;
          onChange(parts.current.join(" "));
        }}
        onPointerCancel={() => {
          drawing.current = false;
          onChange(parts.current.join(" "));
        }}
      />
      {empty && <span>Sign here</span>}
      <button
        type="button"
        className="pbtn ghost sm sws-clear"
        onClick={() => {
          parts.current = [];
          last.current = null;
          const c = canvas.current;
          c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
          setEmpty(true);
          onChange("");
        }}
      >
        Clear
      </button>
    </div>
  );
}

function SignOnForm({
  person,
  own,
  inCharge = false,
  responsible,
  onSigned,
}: {
  person: SwmsPerson;
  /** Signing on as yourself, or a helper on your phone. */
  own: boolean;
  /** You're the person in charge: you give the briefing, nobody gives it you. */
  inCharge?: boolean;
  responsible: string;
  onSigned: () => void;
}) {
  const [path, setPath] = useState("");
  const [raising, setRaising] = useState(false);
  const [issue, setIssue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooLong = path.length > 20_000;
  const signed = (path.match(/L/g) ?? []).length >= 2;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await signOnSwms({ personId: person.id, pathData: path, issue: raising ? issue : null });
      if (res.ok) onSigned();
      else setError(res.error);
    } catch {
      setError("Couldn't save the sign-on. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card2 sws-card">
      <div className="sw-gh">
        <b>{own ? "Sign on" : `Sign on ${person.name}`}</b>
        {!own && <span>{person.role || "Outside the business"}, on your phone</span>}
      </div>
      <p className="sw-text">
        {inCharge
          ? own
            ? "By signing I confirm I understand this SWMS and I'll follow it. I'll brief everyone it covers before work starts, and if a control can't be followed I'll stop the work."
            : `By signing, ${person.name} confirms they understand this SWMS and will follow it. They'll brief everyone it covers before work starts, and if a control can't be followed they'll stop the work.`
          : own
            ? `By signing I confirm I was consulted and briefed on this SWMS, I understand it, and I'll follow it. If a control can't be followed I'll stop work and tell ${responsible}.`
            : `By signing, ${person.name} confirms they were consulted and briefed on this SWMS, understand it, and will follow it. If a control can't be followed they'll stop work and tell ${responsible}.`}
      </p>
      <SignaturePad onChange={setPath} label={own ? "Your signature" : `${person.name}'s signature`} />
      {raising ? (
        <div className="sw-grp">
          <label className="sw-gh" htmlFor={`issue-${person.id}`}>
            <b>Issue with this SWMS</b>
          </label>
          <textarea id={`issue-${person.id}`} className="wb2-notes" rows={2} value={issue} onChange={(e) => setIssue(e.target.value)} />
        </div>
      ) : (
        <button type="button" className="sw-more" onClick={() => setRaising(true)}>
          Raise an issue with this SWMS
        </button>
      )}
      <div className="sws-actions">
        {/* a greyed-out button that says nothing leaves the reader hunting */}
        <span className={error || tooLong ? "sw-state bad" : undefined}>
          {tooLong ? "That signature is too long to keep. Clear it and sign again." : (error ?? (signed ? "" : "Sign in the box to finish."))}
        </span>
        <button type="button" className="pbtn primary" disabled={busy || !signed || tooLong} onClick={submit}>
          {busy ? "Signing on…" : own ? "Sign on" : `Sign on ${person.name}`}
        </button>
      </div>
    </div>
  );
}

/** Something noticed after signing — the anchor found rusted on the roof. It
    rides the sign-on already given, so the register stays one statement. */
function RaiseIssue({
  person,
  open,
  onOpen,
  onClose,
  onDone,
}: {
  person: SwmsPerson;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const raised = person.signon?.issue ?? null;
  const [text, setText] = useState(raised ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await raiseSwmsIssue({ personId: person.id, issue: text });
      if (res.ok) {
        onClose();
        onDone();
      } else setError(res.error);
    } catch {
      setError("Couldn't save the issue. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="sw-more" onClick={onOpen}>
        {raised ? "Change the issue you raised" : "Raise an issue with this SWMS"}
      </button>
    );
  }
  return (
    <div className="sw-grp">
      <label className="sw-gh" htmlFor={`raise-${person.id}`}>
        <b>Issue with this SWMS</b>
      </label>
      <textarea id={`raise-${person.id}`} className="wb2-notes" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="sws-actions">
        <span className={error ? "sw-state bad" : undefined}>{error}</span>
        <button type="button" className="pbtn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="pbtn primary" disabled={busy || !text.trim()} onClick={save}>
          {busy ? "Saving…" : "Tell the crew lead"}
        </button>
      </div>
    </div>
  );
}

/** The person in charge says an issue was sorted on site. The issue itself is
    never erased — the register keeps what was raised and adds who sorted it. */
function SortedOnSite({ personId, onDone }: { personId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="sws-sorted">
      {error && <em className="sw-state bad">{error}</em>}
      <button
        type="button"
        className="pbtn ghost sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await clearSwmsIssue(personId);
            if (res.ok) onDone();
            else setError(res.error);
          } catch {
            setError("Couldn't record it. Try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Recording…" : "Record it as sorted"}
      </button>
    </span>
  );
}

export function SwmsSignOn({ doc, me }: { doc: SwmsDocument; me: string | null }) {
  const router = useRouter();
  const [helper, setHelper] = useState<string | null>(null);
  /* the door lives in the card's action row; the box it opens takes the
     card's width under it, rather than squeezing in beside a button. Held by
     person, because a sign-on given on this phone is one this reader can add
     to as well — what the helper found after they signed. */
  const [raising, setRaising] = useState<string | null>(null);
  const mine = doc.people.find((p) => p.staffProfileId === me) ?? null;
  const onIt = !!mine;
  /* THE PHONE THAT IS OUT. Anyone the SWMS covers and hasn't signed can sign
     on it — the business's own installer had a longer road than a stranger,
     who could always sign on the lead's phone. The record says whose. */
  const unsigned = doc.people.filter((p) => !p.signon);
  const latest = doc.versions[doc.versions.length - 1];
  /* WHAT CHANGED LEADS. Someone sent back to sign on again was shown the
     whole document with no word on what was different — the reason was
     written only on the version that had been replaced. */
  const revision = doc.version > 1 ? doc.versions.find((v) => v.version === doc.version) ?? null : null;
  /* what somebody raised and nobody has answered — the person in charge's to
     sort on site, or to answer with a new version of the SWMS */
  const openIssues = doc.people.filter((p) => p.signon?.issue && !p.signon.issueCleared);
  const c = doc.content;
  const inCharge = !!mine && mine.staffProfileId === doc.responsibleStaffId;
  /** "Wed 16 Sept, 7:50am", and "before a correction" when one carried it —
      a time earlier than the issue needs saying why, and a version number
      means nothing to someone who joined after it. */
  const signedWhen = (sg: NonNullable<SwmsPerson["signon"]>) =>
    `${siteWhen(sg.at, c.jurisdiction)}${sg.version < doc.version ? ", before a correction" : ""}`;

  const signed = () => {
    setHelper(null);
    window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
    router.refresh();
  };

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="sws">
            <div className="sws-head">
              {doc.job ? (
                <Link className="sws-back" href={`/dashboard/workboard?job=${encodeURIComponent(doc.job.uuid)}`}>
                  {doc.job.number ? `← Job #${doc.job.number}` : "← The job"}
                </Link>
              ) : (
                <Link className="sws-back" href="/dashboard">
                  ← Home
                </Link>
              )}
              <h1>Safe Work Method Statement</h1>
              <p>{doc.job?.address ?? "No address on the job"}</p>
            </div>

            {!doc.latest && latest && (
              <div className="card2 sws-card">
                <p className="sw-text">{`A newer SWMS replaced this one: ${latest.reason}.`}</p>
                <div className="sws-actions">
                  <span />
                  <Link className="pbtn primary" href={`/dashboard/swms/${latest.id}`}>
                    Open the current SWMS
                  </Link>
                </div>
              </div>
            )}

            {doc.latest && revision && (
              <div className="card2 sws-card">
                <div className="sw-gh">
                  <b>What changed</b>
                  <span>{revision.material ? "Everyone signs on again" : "A correction — sign-ons carry over"}</span>
                </div>
                <p className="sw-text">{revision.reason}</p>
              </div>
            )}

            {doc.latest && mine?.signon && <p className="sw-state ok">{`You signed on ${signedWhen(mine.signon)}.`}</p>}

            {/* IT LEADS THE PAGE for whoever has to answer it — the bell sent
                them here for this, not for the briefing they wrote */}
            {doc.latest && inCharge && openIssues.length > 0 && (
              <div className="card2 sws-card">
                <div className="sw-gh">
                  <b>{openIssues.length === 1 ? "An issue was raised" : `${openIssues.length} issues were raised`}</b>
                  <span>Yours to answer</span>
                </div>
                <div className="sws-people">
                  {openIssues.map((p) => (
                    <div key={p.id} className="sws-person">
                      <span>
                        <b>{p.signon!.issue}</b>
                        <em>{`${p.name}, ${signedWhen(p.signon!)}`}</em>
                      </span>
                      <SortedOnSite personId={p.id} onDone={signed} />
                    </div>
                  ))}
                </div>
                {doc.job && (
                  <Link className="sw-more" href={`/dashboard/workboard?job=${encodeURIComponent(doc.job.uuid)}`}>
                    Open the job to revise the SWMS
                  </Link>
                )}
              </div>
            )}

            {/* READ FIRST. The page is the briefing on paper: what the work is,
                how each step is kept safe, and what to do in an emergency —
                then, below it, the signature that says it was read. */}
            <div className="card2 sws-card">
              <div className="sw-gh">
                <b>Before you start</b>
                <span>{`Issued ${siteWhen(doc.issuedAt, c.jurisdiction)}. ${inCharge ? "You're" : `${doc.responsible} is`} in charge on site.`}</span>
              </div>
              {c.categories.length > 0 && (
                <div className="sw-grp">
                  <span className="sw-al">High-risk work on this job</span>
                  <ul className="sws-keys">
                    {c.categories.map((k) => (
                      <li key={k.n}>
                        <b>{HRCW.find((h) => h.n === k.n)?.plain ?? `Category ${k.n}`}</b>
                        {`: ${k.reason}`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {c.steps.map((st, i) => (
                <div key={st.key} className="sw-grp">
                  <div className="sw-gh">
                    <b>{`${i + 1}. ${st.title}`}</b>
                    <span>{st.who}</span>
                  </div>
                  <p className="sw-note">{st.hazards}</p>
                  <ul className="sws-keys">
                    {st.controls.map((k) => (
                      <li key={k.text}>{k.text}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {/* signed for on the screen it is signed on, not only on paper */}
              {c.ppe.length > 0 && (
                <div className="sw-grp">
                  <span className="sw-al">Protective equipment</span>
                  <ul className="sws-keys">
                    {c.ppe.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {c.siteNotes.length > 0 && (
                <div className="sw-grp">
                  <span className="sw-al">This site</span>
                  <ul className="sws-keys">
                    {c.siteNotes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="sw-grp">
                <span className="sw-al">Emergency</span>
                <p className="sw-text">
                  {`Call 000. First aider: ${c.emergency.firstAider}. Nearest hospital: ${c.emergency.hospital}. Fire extinguisher: ${c.emergency.extinguisher.toLowerCase()}.`}
                </p>
              </div>
              <div className="sws-actions">
                {/* AFTER SIGNING, TOO: what you find when you get on the roof
                    is after the briefing at the truck */}
                <span>
                  {doc.latest && mine?.signon && raising !== mine.id && (
                    <RaiseIssue person={mine} open={false} onOpen={() => setRaising(mine.id)} onClose={() => setRaising(null)} onDone={signed} />
                  )}
                </span>
                <a className="pbtn ghost" href={`/swms/${doc.versionId}`} target="_blank" rel="noreferrer">
                  Open the printable SWMS
                </a>
              </div>
              {doc.latest && mine?.signon && raising === mine.id && (
                <RaiseIssue person={mine} open onOpen={() => setRaising(mine.id)} onClose={() => setRaising(null)} onDone={signed} />
              )}
            </div>

            {doc.latest && mine && !mine.signon && (
              <SignOnForm person={mine} own inCharge={inCharge} responsible={doc.responsible} onSigned={signed} />
            )}

            <div className="card2 sws-card">
              <div className="sw-gh">
                <b>Who it covers</b>
                <span>{`${doc.people.filter((p) => p.signon).length} of ${doc.people.length} signed on`}</span>
              </div>
              <div className="sws-people">
                {doc.people.map((p) => (
                  <div key={p.id} className="sws-person">
                    <span>
                      <b>{p.name}</b>
                      <em>{p.team ? p.role || "Team member" : p.role || "Outside the business"}</em>
                      {/* what they raised when they signed — the person in charge
                          is told in their bell, and it stands here beside them */}
                      {p.signon?.issue && (
                        <em className={p.signon.issueCleared ? undefined : "sw-state warn"}>
                          {p.signon.issueCleared
                            ? `Raised: ${p.signon.issue} — sorted by ${p.signon.issueCleared.by}, ${siteWhen(p.signon.issueCleared.at, c.jurisdiction)}`
                            : `Raised: ${p.signon.issue}`}
                        </em>
                      )}
                    </span>
                    <span className={p.signon ? "sw-state ok" : undefined}>
                      {p.signon ? (
                        `Signed on ${signedWhen(p.signon)}${p.signon.onPhoneOf ? `, on ${p.signon.onPhoneOf}'s phone` : ""}`
                      ) : doc.latest && onIt && p.staffProfileId !== me && helper !== p.id ? (
                        <button type="button" className="pbtn ghost sm" onClick={() => setHelper(p.id)}>
                          Sign them on
                        </button>
                      ) : (
                        "Not signed on"
                      )}
                      {/* a sign-on given on this phone is one this reader can
                          still add to — what the helper found on the roof */}
                      {doc.latest && p.signon && p.id !== mine?.id && p.signon.signedByStaffId === me && raising !== p.id && (
                        <RaiseIssue person={p} open={false} onOpen={() => setRaising(p.id)} onClose={() => setRaising(null)} onDone={signed} />
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {doc.latest && raising && raising !== mine?.id && (
              <div className="card2 sws-card">
                <RaiseIssue
                  person={doc.people.find((p) => p.id === raising)!}
                  open
                  onOpen={() => setRaising(raising)}
                  onClose={() => setRaising(null)}
                  onDone={signed}
                />
              </div>
            )}

            {doc.latest && onIt && helper && unsigned.some((p) => p.id === helper) && (
              <SignOnForm
                key={helper}
                person={unsigned.find((p) => p.id === helper)!}
                own={false}
                inCharge={unsigned.find((p) => p.id === helper)!.staffProfileId === doc.responsibleStaffId}
                responsible={doc.responsible}
                onSigned={signed}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
