"use client";

import { jobHref } from "@/lib/shell/links";
import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearSwmsIssue, raiseSwmsIssue, signOnSwms } from "@/app/actions/swms";
import { BELL_REFRESH_EVENT } from "@/lib/dashboard/chips";
import { HRCW } from "@/lib/swms/library";
import type { SwmsDocument, SwmsPerson } from "@/lib/swms/query";
import { siteDay, siteWhen } from "@/lib/swms/when";
import { Button } from "@/components/parts/button";
import { Dialog } from "@/components/parts/dialog";
import { Field, TextArea } from "@/components/parts/field";
import { Initials } from "@/components/parts/initials";
import { Row, RowList } from "@/components/parts/row";
import { StateWord } from "@/components/parts/state";
import { Icon } from "@/components/shell/icon";
import { SignaturePad } from "./controls";
import { withCleanup } from "@/lib/ui/with-cleanup";
import "./swms.css";

/* THE SIGN-ON — read the SWMS, confirm the briefing, sign in the box.

   IN THE APP, NOT BY TEXT. A team member arrives from their bell and signs
   on as themselves. Someone from outside the business has no HeyTiff login,
   so they sign on the phone of a team member on the same SWMS, after the
   briefing — the record says whose phone.

   A REPLACED VERSION IS READ-ONLY. Its sign-ons stand as history, and the
   screen points at the version that replaced it, which asks again.

   IN V2 (Isaac, 27 October 2026, on the mock of the old screens: "change
   from crew lead to supervisor. Other than that, everything looks fine").
   Two columns on desktop, split by a hairline as a job's Overview is: the
   briefing on the left, read first and signed at its foot, and who it
   covers on the right, in view while the briefing scrolls. Each section
   wears Home's coloured block. The briefing is reading, so 16. Sign on is
   the page's one card and its button the one blue; signing someone else on
   opens over the page. */

type BlockHue = "yellow" | "red" | "pink" | "green" | "orange";

/** One section: Home's block in its colour with the icon in ink, the title
    at 16, a grey fact under it, then what it holds. A card when it is
    something you act on (rule 35), a group under its head otherwise. */
function Section({
  name,
  icon,
  hue,
  fact,
  card = false,
  headingId,
  children,
}: {
  name: string;
  icon: string;
  hue: BlockHue;
  fact?: ReactNode;
  card?: boolean;
  /** the title's id, when something inside is named by it */
  headingId?: string;
  children: ReactNode;
}) {
  const made = useId();
  const id = headingId ?? made;
  return (
    <section className={card ? "sws-sec sws-card" : "sws-sec"} aria-labelledby={id}>
      <div className="sws-head">
        <span className={`hm-blk hm-blk--${hue}`} aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
        <h2 className="sws-title" id={id}>
          {name}
        </h2>
      </div>
      {fact != null && <p className="sws-fact">{fact}</p>}
      {children}
    </section>
  );
}

/** What signing means, in the words of whoever is signing. */
function statement(person: SwmsPerson, own: boolean, inCharge: boolean, responsible: string): string {
  if (inCharge) {
    return own
      ? "By signing I confirm I understand this SWMS and I'll follow it. I'll brief everyone it covers before work starts, and if a control can't be followed I'll stop the work."
      : `By signing, ${person.name} confirms they understand this SWMS and will follow it. They'll brief everyone it covers before work starts, and if a control can't be followed they'll stop the work.`;
  }
  return own
    ? `By signing I confirm I was consulted and briefed on this SWMS, I understand it, and I'll follow it. If a control can't be followed I'll stop work and tell ${responsible}.`
    : `By signing, ${person.name} confirms they were consulted and briefed on this SWMS, understand it, and will follow it. If a control can't be followed they'll stop work and tell ${responsible}.`;
}

/** What a person is on this SWMS, in a grey line: their role, then whether
    they are in charge, from outside the business, or you. */
function roleLine(p: SwmsPerson, inCharge: boolean, you: boolean): string {
  const role = p.team ? p.role || "Team member" : p.role ? `${p.role}, outside the business` : "Outside the business";
  return [role, inCharge ? "in charge" : null, you ? "you" : null].filter(Boolean).join(", ");
}

/** The signature, the issue that can ride it, and the press that sends it,
    for the card and the dialog alike. */
function useSignOn(person: SwmsPerson, onSigned: () => void) {
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
    /* read out here, not inside the try below: React Compiler 1.0 cannot
       lower a ternary inside a try/catch, and gives up on the whole
       component when it meets one */
    const raised = raising ? issue : null;
    await withCleanup(async () => {
      try {
        const res = await signOnSwms({ personId: person.id, pathData: path, issue: raised });
        if (res.ok) onSigned();
        else setError(res.error);
      } catch {
        setError("Couldn't save the sign-on. Try again.");
      }
    }, () => setBusy(false));
  };

  /* a greyed-out button that says nothing leaves the reader hunting */
  const word = tooLong ? "That signature is too long to keep. Clear it and sign again." : (error ?? (signed ? "" : "Sign in the box to finish."));
  return {
    setPath,
    raising,
    startRaising: () => setRaising(true),
    issue,
    setIssue,
    busy,
    word,
    wrong: !!error || tooLong,
    ready: !busy && signed && !tooLong,
    submit,
  };
}

/** Raising an issue as you sign: a quiet button, then the box in its place. */
function IssueOnSigning({ s }: { s: ReturnType<typeof useSignOn> }) {
  return s.raising ? (
    <Field label="Issue with this SWMS">
      <TextArea rows={2} value={s.issue} onChange={(e) => s.setIssue(e.target.value)} />
    </Field>
  ) : (
    <Button kind="quiet" size={32} className="sws-quiet" onClick={s.startRaising}>
      Raise an issue
    </Button>
  );
}

/** Signing on as yourself: the one card on the page, at the briefing's foot. */
function SignOnCard({
  person,
  inCharge,
  responsible,
  onSigned,
}: {
  person: SwmsPerson;
  /** You're the person in charge: you give the briefing, nobody gives it you. */
  inCharge: boolean;
  responsible: string;
  onSigned: () => void;
}) {
  const s = useSignOn(person, onSigned);
  return (
    <Section name="Sign on" icon="edit" hue="pink" card>
      <p className="sws-read">{statement(person, true, inCharge, responsible)}</p>
      <SignaturePad onChange={s.setPath} label="Your signature" />
      <IssueOnSigning s={s} />
      <div className="sws-foot sws-foot--ruled">
        <span className={s.wrong ? "sws-word sws-word--wrong" : "sws-word"}>{s.word}</span>
        <Button kind="main" disabled={!s.ready} onClick={s.submit}>
          {s.busy ? "Signing on" : "Sign on"}
        </Button>
      </div>
    </Section>
  );
}

/** Signing someone else on, on your phone: over the page, as a form is
    (rule 51). A press on the dark around it keeps it open, so a signature
    is never lost to a stray tap; Cancel and Escape close it. */
function SignOnDialog({
  person,
  inCharge,
  responsible,
  onSigned,
  onClose,
}: {
  person: SwmsPerson;
  inCharge: boolean;
  responsible: string;
  onSigned: () => void;
  onClose: () => void;
}) {
  const s = useSignOn(person, onSigned);
  const first = person.name.trim().split(/\s+/)[0] || person.name;
  return (
    <Dialog
      heading={`Sign on ${person.name}`}
      onClose={onClose}
      width={560}
      dismissable={false}
      foot={
        <>
          {s.word && <span className={s.wrong ? "sws-word sws-word--wrong sws-footword" : "sws-word sws-footword"}>{s.word}</span>}
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" disabled={!s.ready} onClick={s.submit}>
            {s.busy ? "Signing on" : `Sign on ${first}`}
          </Button>
        </>
      }
    >
      <div className="sws-dlg">
        <p className="sws-dline">{`${person.team ? person.role || "Team member" : person.role || "Outside the business"}, on your phone`}</p>
        <p className="sws-read">{statement(person, false, inCharge, responsible)}</p>
        <SignaturePad onChange={s.setPath} label={`${person.name}'s signature`} />
        <IssueOnSigning s={s} />
      </div>
    </Dialog>
  );
}

/** Something noticed after signing — the anchor found rusted on the roof. It
    rides the sign-on already given, so the register stays one statement. A
    card, because it is something you act on, with the orange flag. */
function IssueCard({ person, onClose, onDone }: { person: SwmsPerson; onClose: () => void; onDone: () => void }) {
  const headingId = useId();
  const [text, setText] = useState(person.signon?.issue ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    await withCleanup(async () => {
      try {
        const res = await raiseSwmsIssue({ personId: person.id, issue: text });
        if (res.ok) {
          onClose();
          onDone();
        } else setError(res.error);
      } catch {
        setError("Couldn't save the issue. Try again.");
      }
    }, () => setBusy(false));
  };

  return (
    <Section name="Issue with this SWMS" icon="flag" hue="orange" card headingId={headingId}>
      <TextArea rows={2} aria-labelledby={headingId} className="sws-issue" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="sws-foot">
        <span className="sws-word sws-word--wrong">{error}</span>
        <span className="sws-btns">
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" disabled={busy || !text.trim()} onClick={save}>
            {busy ? "Telling the supervisor" : "Tell the supervisor"}
          </Button>
        </span>
      </div>
    </Section>
  );
}

/** The person in charge says an issue was sorted on site. The issue itself is
    never erased — the register keeps what was raised and adds who sorted it. */
function SortedOnSite({ personId, onDone }: { personId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="sws-sorted">
      {error && <span className="sws-word sws-word--wrong">{error}</span>}
      <Button
        kind="second"
        size={32}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          await withCleanup(async () => {
            try {
              const res = await clearSwmsIssue(personId);
              if (res.ok) onDone();
              else setError(res.error);
            } catch {
              setError("Couldn't record it. Try again.");
            }
          }, () => setBusy(false));
        }}
      >
        {busy ? "Recording it as sorted" : "Record it as sorted"}
      </Button>
    </span>
  );
}

export function SwmsSignOn({ doc, me }: { doc: SwmsDocument; me: string | null }) {
  const router = useRouter();
  const [helper, setHelper] = useState<string | null>(null);
  /* the issue card that is open, held by person: your own, or a sign-on
     given on this phone, which this reader can add to as well — what the
     helper found after they signed */
  const [raising, setRaising] = useState<string | null>(null);
  const mine = doc.people.find((p) => p.staffProfileId === me) ?? null;
  const onIt = !!mine;
  /* THE PHONE THAT IS OUT. Anyone the SWMS covers and hasn't signed can sign
     on it — the business's own installer had a longer road than a stranger,
     who could always sign on the lead's phone. The record says whose. */
  const helping = doc.latest && onIt && helper ? (doc.people.find((p) => p.id === helper && !p.signon) ?? null) : null;
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
  const raisingFor = doc.latest && raising ? (doc.people.find((p) => p.id === raising && p.signon) ?? null) : null;
  /** "Wed 16 Sept, 7:50am", and "before a correction" when one carried it —
      a time earlier than the issue needs saying why, and a version number
      means nothing to someone who joined after it. */
  const signedWhen = (sg: NonNullable<SwmsPerson["signon"]>) =>
    `${siteWhen(sg.at, c.jurisdiction)}${sg.version < doc.version ? ", before a correction" : ""}`;
  /** In the list, a sign-on on the day this version was issued is its time
      alone, "7:12am"; any other day keeps its day. */
  const issuedDay = siteDay(doc.issuedAt, c.jurisdiction);
  const signedShort = (sg: NonNullable<SwmsPerson["signon"]>) => {
    const when = signedWhen(sg);
    return siteDay(sg.at, c.jurisdiction) === issuedDay && when.startsWith(`${issuedDay}, `) ? when.slice(issuedDay.length + 2) : when;
  };

  const signed = () => {
    setHelper(null);
    window.dispatchEvent(new Event(BELL_REFRESH_EVENT));
    router.refresh();
  };

  return (
    <div className="page in">
      <div className="wrap sws-page">
        {/* The way back is the job's open tab, and the grey line names the
            job as a link (the crumb went with v2's tabs). */}
        <header className="sws-top">
          <div className="sws-id">
            <h1 className="sws-h1">Safe Work Method Statement</h1>
            {doc.job && (
              <p className="sws-line">
                {"For "}
                <Link className="pt-link" href={jobHref(doc.job.uuid)}>
                  {[doc.job.number ? `job ${doc.job.number}` : "the job", doc.job.clientName].filter(Boolean).join(", ")}
                </Link>
                {doc.job.address ? `, at ${doc.job.address}` : ""}
              </p>
            )}
          </div>
          <Button kind="second" href={`/swms/${doc.versionId}`} target="_blank" rel="noreferrer">
            Open the printable SWMS
          </Button>
        </header>

        <div className="sws-cols">
          <div className="sws-main">
            {!doc.latest && latest && (
              <RowList label="This SWMS was replaced">
                <Row
                  name="A newer SWMS replaced this one"
                  line={latest.reason}
                  lines={2}
                  end={
                    <Button kind="main" size={32} href={`/dashboard/swms/${latest.id}`}>
                      Open the current SWMS
                    </Button>
                  }
                />
              </RowList>
            )}

            {doc.latest && revision && (
              <Section name="What changed" icon="rotate" hue="orange" fact={revision.material ? "Everyone signs on again" : "A correction — sign-ons carry over"}>
                <p className="sws-read sws-ruled">{revision.reason}</p>
              </Section>
            )}

            {/* IT LEADS THE PAGE for whoever has to answer it — the bell sent
                them here for this, not for the briefing they wrote */}
            {doc.latest && inCharge && openIssues.length > 0 && (
              <Section
                name={openIssues.length === 1 ? "An issue was raised" : `${openIssues.length} issues were raised`}
                icon="flag"
                hue="orange"
                fact="Yours to answer"
              >
                <RowList label="Issues raised">
                  {openIssues.map((p) => (
                    <Row
                      key={p.id}
                      lead={<Initials name={p.name} size={32} beside />}
                      name={p.signon!.issue}
                      lines={2}
                      line={`${p.name}, ${signedWhen(p.signon!)}`}
                      end={<SortedOnSite personId={p.id} onDone={signed} />}
                    />
                  ))}
                </RowList>
                {doc.job && (
                  <p className="sws-go">
                    <Link className="pt-link" href={jobHref(doc.job.uuid)}>
                      Open the job to revise the SWMS
                    </Link>
                  </p>
                )}
              </Section>
            )}

            {/* READ FIRST. The page is the briefing on paper: what the work is,
                how each step is kept safe, and what to do in an emergency —
                then, below it, the signature that says it was read. */}
            <Section
              name="Before you start"
              icon="alert"
              hue="yellow"
              fact={`Issued ${siteWhen(doc.issuedAt, c.jurisdiction)}. ${inCharge ? "You're" : `${doc.responsible} is`} in charge on site.`}
            >
              {c.categories.length > 0 && (
                <div className="sws-g">
                  <h3 className="sws-gt">High-risk work on this job</h3>
                  <ul className="sws-list">
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
                <div key={st.key} className="sws-g">
                  <div className="sws-gh">
                    <h3 className="sws-gt">{`${i + 1}. ${st.title}`}</h3>
                    <span>{st.who}</span>
                  </div>
                  <p className="sws-hz">{st.hazards}</p>
                  <ul className="sws-list">
                    {st.controls.map((k) => (
                      <li key={k.text}>{k.text}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {/* signed for on the screen it is signed on, not only on paper */}
              {c.ppe.length > 0 && (
                <div className="sws-g">
                  <h3 className="sws-gt">Protective equipment</h3>
                  <ul className="sws-list">
                    {c.ppe.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {c.siteNotes.length > 0 && (
                <div className="sws-g">
                  <h3 className="sws-gt">This site</h3>
                  <ul className="sws-list">
                    {c.siteNotes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>

            {/* where someone in a hurry finds it: its own section, red */}
            <Section name="Emergency" icon="phone" hue="red">
              <dl className="sws-em">
                <div>
                  <dt>Call</dt>
                  <dd>
                    <b>000</b>
                  </dd>
                </div>
                <div>
                  <dt>First aider</dt>
                  <dd>{c.emergency.firstAider}</dd>
                </div>
                <div>
                  <dt>Nearest hospital</dt>
                  <dd>{c.emergency.hospital}</dd>
                </div>
                <div>
                  <dt>Fire extinguisher</dt>
                  <dd>{c.emergency.extinguisher}</dd>
                </div>
              </dl>
            </Section>

            {doc.latest && mine && !mine.signon && (
              <SignOnCard person={mine} inCharge={inCharge} responsible={doc.responsible} onSigned={signed} />
            )}

            {/* AFTER SIGNING, TOO: what you find when you get on the roof is
                after the briefing at the truck */}
            {doc.latest && mine?.signon &&
              (raisingFor?.id === mine.id ? (
                <IssueCard key={mine.id} person={mine} onClose={() => setRaising(null)} onDone={signed} />
              ) : (
                <div className="sws-done">
                  <p className="sws-ok">{`You signed on ${signedWhen(mine.signon)}.`}</p>
                  <div className="sws-foot sws-foot--ruled">
                    <Button kind="quiet" size={32} className="sws-quiet" onClick={() => setRaising(mine.id)}>
                      {mine.signon.issue ? "Change the issue you raised" : "Raise an issue"}
                    </Button>
                  </div>
                </div>
              ))}
          </div>

          <div className="sws-side">
            <div className="sws-stick">
              <Section name="Who it covers" icon="users" hue="green" fact={`${doc.people.filter((p) => p.signon).length} of ${doc.people.length} signed on`}>
                <ul className="sws-people" aria-label="Who it covers">
                  {doc.people.map((p) => {
                    const you = !!me && p.staffProfileId === me;
                    /* a sign-on given on this phone is one this reader can
                       still add to — what the helper found on the roof */
                    const canRaise = doc.latest && !!p.signon && p.id !== mine?.id && !!me && p.signon.signedByStaffId === me;
                    return (
                      <li key={p.id} className="sws-person">
                        <Initials name={p.name} size={32} beside />
                        <span className="sws-pt">
                          <b>{p.name}</b>
                          <span>{roleLine(p, !!p.staffProfileId && p.staffProfileId === doc.responsibleStaffId, you)}</span>
                          {p.signon?.onPhoneOf && <span>{`On ${p.signon.onPhoneOf}'s phone`}</span>}
                          {/* what they raised when they signed — the person in
                              charge is told in their bell, and it stands here
                              beside them */}
                          {p.signon?.issue && (
                            <span className={p.signon.issueCleared ? undefined : "sws-look"}>
                              {p.signon.issueCleared
                                ? `Raised: ${p.signon.issue} — sorted by ${p.signon.issueCleared.by}, ${siteWhen(p.signon.issueCleared.at, c.jurisdiction)}`
                                : `Raised: ${p.signon.issue}`}
                            </span>
                          )}
                        </span>
                        <span className="sws-pend">
                          {p.signon ? (
                            <StateWord tone="good" className="sws-state">{`Signed on ${signedShort(p.signon)}`}</StateWord>
                          ) : doc.latest && onIt && !you ? (
                            <Button kind="second" size={32} onClick={() => setHelper(p.id)}>
                              Sign them on
                            </Button>
                          ) : (
                            <StateWord tone="look" className="sws-state">
                              Not signed on
                            </StateWord>
                          )}
                          {canRaise && raising !== p.id && (
                            <Button kind="quiet" size={32} onClick={() => setRaising(p.id)}>
                              {p.signon!.issue ? "Change the issue you raised" : "Raise an issue"}
                            </Button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Section>

              {raisingFor && raisingFor.id !== mine?.id && (
                <IssueCard key={raisingFor.id} person={raisingFor} onClose={() => setRaising(null)} onDone={signed} />
              )}
            </div>
          </div>
        </div>

        {helping && (
          <SignOnDialog
            key={helping.id}
            person={helping}
            inCharge={helping.staffProfileId === doc.responsibleStaffId}
            responsible={doc.responsible}
            onSigned={signed}
            onClose={() => setHelper(null)}
          />
        )}
      </div>
    </div>
  );
}
