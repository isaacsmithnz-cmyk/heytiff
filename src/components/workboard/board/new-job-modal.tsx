"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { mintPressId } from "@/lib/workboard/press-id";
import { JOB_WORDS } from "@/lib/integrations/sm8-job-words";
import {
  createNewJob,
  matchPreviousSite,
  readNewJobCategories,
  searchClientSites,
  searchNewJobClients,
  type ClientHit,
  type CreateAnswer,
  type JobCategory,
  type SiteHit,
} from "@/app/actions/job-new";

/* NEW JOB — a job taken off the phone, started in ServiceM8 as a quote
   (Isaac, 2026-10-01: "when you press new job it just goes straight to the
   form… customer name, start typing and the repeat customer could come
   up… fields are optional… how they got in touch is good… basic
   categories… next: book site visit, start quote, request more
   information").

   WHO FIRST, so a repeat customer is never made twice: typing the name
   searches the clients; a match fills in who they are, and a builder's job
   goes on a NEW SITE by default, with their previous sites one press away
   ("start off by adding a new site as default or click previous sites…
   searchable"). Typing an address we've been to says so, whoever's it was.

   Nothing is sent until Create. Create sends the job to ServiceM8 and waits
   a few seconds for it to land; the answer says its number. A Create
   pressed twice is one job (the press id is minted once per open). */

const VIA = ["phone", "email", "the website", "a referral"] as const;
const NEXT = ["book a site visit", "start the quote", "ask for more information"] as const;

type Who =
  | { kind: "none" }
  | { kind: "existing"; hit: ClientHit }
  | { kind: "new"; name: string };

type Site = { kind: "new" } | { kind: "previous"; site: SiteHit };

export function NewJobModal({ onClose }: { onClose: () => void }) {
  const [pressId] = useState(() => mintPressId());
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [who, setWho] = useState<Who>({ kind: "none" });
  const [site, setSite] = useState<Site>({ kind: "new" });
  const [siteQ, setSiteQ] = useState("");
  const [sitesOpen, setSitesOpen] = useState(false);
  const [sites, setSites] = useState<SiteHit[]>([]);
  const [address, setAddress] = useState("");
  const [match, setMatch] = useState<SiteHit | null>(null);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [categories, setCategories] = useState<JobCategory[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [via, setVia] = useState<(typeof VIA)[number] | null>(null);
  const [next, setNext] = useState<(typeof NEXT)[number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<CreateAnswer | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const builder = who.kind === "existing" && who.hit.sites > 0;
  const builderUuid = builder ? who.hit.uuid : null;

  useEffect(() => {
    nameRef.current?.focus();
    let live = true;
    void readNewJobCategories().then((c) => live && setCategories(c));
    return () => {
      live = false;
    };
  }, []);

  /* the clients, as the name is typed */
  useEffect(() => {
    if (who.kind !== "none" || q.trim().length < 2) return;
    let live = true;
    const t = setTimeout(() => void searchNewJobClients(q).then((h) => live && setHits(h)), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, who.kind]);

  /* a builder's previous sites, opened and searched */
  useEffect(() => {
    if (!builderUuid || !sitesOpen) return;
    let live = true;
    const t = setTimeout(() => void searchClientSites(builderUuid, siteQ).then((s) => live && setSites(s)), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [siteQ, builderUuid, sitesOpen]);

  /* an address we've been to before, whoever's it was */
  useEffect(() => {
    if (site.kind !== "new" || address.trim().length < 6) return;
    let live = true;
    const t = setTimeout(() => void matchPreviousSite(address).then((m) => live && setMatch(m)), 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [address, site.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickClient = (hit: ClientHit) => {
    setWho({ kind: "existing", hit });
    setHits([]);
    setSite({ kind: "new" });
    setSitesOpen(false);
    setSites([]);
    /* a builder's job goes on a new site; anyone else's is at their address */
    setAddress(hit.sites > 0 ? "" : hit.address ?? "");
  };

  const clientName = who.kind === "existing" ? who.hit.name : who.kind === "new" ? who.name : "";
  const jobAddress = site.kind === "previous" ? site.site.address ?? site.site.name : address;
  const canCreate = who.kind !== "none" && jobAddress.trim() && description.trim() && !busy;

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    setAnswer(null);
    const client =
      who.kind === "existing"
        ? site.kind === "previous"
          ? { kind: "existing" as const, uuid: site.site.uuid }
          : builder
            ? { kind: "site" as const, parentUuid: who.hit.uuid, address }
            : { kind: "existing" as const, uuid: who.hit.uuid }
        : { kind: "new" as const, name: (who as { name: string }).name, address };
    const contactGiven = first || last || mobile || email;
    const a = await createNewJob({
      pressId,
      clientName,
      client,
      jobAddress,
      description,
      categoryUuid: category,
      contact: contactGiven ? { first, last, mobile, phone: "", email } : null,
      via,
      next,
    }).catch((): CreateAnswer => ({ ok: false, error: JOB_WORDS.press.unqueued }));
    setAnswer(a);
    setBusy(false);
  };

  const done = answer?.ok === true && (answer.line.state === "in" || answer.line.state === "partial");

  return createPortal(
    <>
      <div className="wb2-scrim" onClick={onClose} />
      <div className="wb2-daymodal wb2-newmodal njob" role="dialog" aria-modal="true" aria-label="New job">
        <div className="wb2-dmhd">
          <div className="wb2-dmtop">
            <h2 className="njob-title">New job</h2>
            <button className="wb2-ico" onClick={onClose} title="Close" aria-label="Close">
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>

        <div className="wb2-dmbody njob-body">
          {done ? (
            <div className="njob-done" role="status">
              <b>{answer.line.words}</b>
              <p>{`${clientName}, ${jobAddress.split("\n")[0]}`}</p>
            </div>
          ) : (
            <>
              {/* WHO */}
              <div className="njob-row">
                <span className="njob-k">Customer</span>
                <div className="njob-v">
                  {who.kind === "none" ? (
                    <>
                      <input
                        ref={nameRef}
                        className="wb2-fi"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Start typing their name"
                        aria-label="Customer"
                      />
                      {q.trim().length >= 2 && (
                        <div className="njob-hits" role="listbox" aria-label="Customers">
                          {hits.map((h) => (
                            <button key={h.uuid} type="button" role="option" aria-selected={false} className="njob-hit" onClick={() => pickClient(h)}>
                              <b>{h.name}</b>
                              <em>{h.sites > 0 ? `${h.sites} site${h.sites === 1 ? "" : "s"}` : h.address ?? ""}</em>
                            </button>
                          ))}
                          <button
                            type="button"
                            role="option"
                            aria-selected={false}
                            className="njob-hit add"
                            onClick={() => {
                              setWho({ kind: "new", name: q.trim() });
                              setHits([]);
                            }}
                          >
                            <Icon name="plus" size={14} />
                            {`Add “${q.trim()}” as a new customer`}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="njob-who">
                      <b>{clientName}</b>
                      <em>{who.kind === "new" ? "New customer" : builder ? `${who.hit.sites} sites` : who.hit.address ?? ""}</em>
                      <button
                        type="button"
                        className="njob-link"
                        onClick={() => {
                          setWho({ kind: "none" });
                          setSite({ kind: "new" });
                          setMatch(null);
                        }}
                      >
                        Change
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {who.kind !== "none" && (
                <>
                  {/* WHERE */}
                  <div className="njob-row">
                    <span className="njob-k">{builder ? "Site" : "Address"}</span>
                    <div className="njob-v">
                      {site.kind === "previous" ? (
                        <div className="njob-who">
                          <b>{site.site.name}</b>
                          <em>{site.site.lastJob ? `#${site.site.lastJob}` : site.site.address ?? ""}</em>
                          <button type="button" className="njob-link" onClick={() => setSite({ kind: "new" })}>
                            Change
                          </button>
                        </div>
                      ) : (
                        <>
                          <textarea
                            className="wb2-fi njob-addr"
                            value={address}
                            onChange={(e) => {
                              setAddress(e.target.value);
                              setMatch(null);
                            }}
                            placeholder={builder ? "The new site's address" : "Where the job is"}
                            aria-label={builder ? "Site address" : "Address"}
                          />
                          {match && (
                            <div className="njob-match" role="status">
                              <span>
                                Matches a previous site, <b>{match.address ?? match.name}</b>
                                {match.lastJob ? `, #${match.lastJob}` : ""}
                                {match.parentName ? `, ${match.parentName}` : ""}
                              </span>
                              <button type="button" className="pbtn ghost sm" onClick={() => setSite({ kind: "previous", site: match })}>
                                Use this site
                              </button>
                            </div>
                          )}
                          {builder && (
                            <>
                              <button type="button" className="njob-link" aria-expanded={sitesOpen} onClick={() => setSitesOpen((o) => !o)}>
                                Previous sites
                              </button>
                              {sitesOpen && (
                                <div className="njob-hits" role="listbox" aria-label="Previous sites">
                                  <input className="wb2-fi" value={siteQ} onChange={(e) => setSiteQ(e.target.value)} placeholder="Search their sites" aria-label="Search their sites" />
                                  {sites.map((s) => (
                                    <button key={s.uuid} type="button" role="option" aria-selected={false} className="njob-hit" onClick={() => setSite({ kind: "previous", site: s })}>
                                      <b>{s.name}</b>
                                      <em>{s.lastJob ? `#${s.lastJob}` : ""}</em>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* WHO TO RING — a repeat builder doesn't need one */}
                  <div className="njob-row">
                    <span className="njob-k">Contact</span>
                    <div className="njob-v">
                      {who.kind === "existing" && who.hit.contacts.length > 0 && (
                        <div className="njob-chips">
                          {who.hit.contacts.map((c) => (
                            <button
                              key={c.name}
                              type="button"
                              className={"wb2-filter" + (`${first} ${last}`.trim() === c.name ? " on" : "")}
                              onClick={() => {
                                const [f, ...l] = c.name.split(" ");
                                setFirst(f ?? "");
                                setLast(l.join(" "));
                                setMobile(c.mobile ?? c.phone ?? "");
                                setEmail(c.email ?? "");
                              }}
                            >
                              {c.name}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="njob-two">
                        <input className="wb2-fi" value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First name" aria-label="Contact first name" />
                        <input className="wb2-fi" value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last name" aria-label="Contact last name" />
                        <input className="wb2-fi" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="Mobile" aria-label="Mobile" inputMode="tel" />
                        <input className="wb2-fi" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email" inputMode="email" />
                      </div>
                    </div>
                  </div>

                  {/* WHAT */}
                  {categories.length > 0 && (
                    <div className="njob-row">
                      <span className="njob-k">Kind</span>
                      <div className="njob-v njob-chips" role="radiogroup" aria-label="Kind of job">
                        {categories.map((c) => (
                          <button key={c.uuid} type="button" role="radio" aria-checked={category === c.uuid} className={"wb2-filter" + (category === c.uuid ? " on" : "")} onClick={() => setCategory(category === c.uuid ? null : c.uuid)}>
                            {c.colour && <i className="wb2-catdot" style={{ background: c.colour }} aria-hidden />}
                            {c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="njob-row">
                    <span className="njob-k">The job</span>
                    <div className="njob-v">
                      <textarea className="wb2-fi njob-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What they're after, in their words" aria-label="The job" />
                    </div>
                  </div>
                  <div className="njob-row">
                    <span className="njob-k">Came in by</span>
                    <div className="njob-v njob-chips" role="radiogroup" aria-label="How they got in touch">
                      {VIA.map((v) => (
                        <button key={v} type="button" role="radio" aria-checked={via === v} className={"wb2-filter" + (via === v ? " on" : "")} onClick={() => setVia(via === v ? null : v)}>
                          {v.charAt(0).toUpperCase() + v.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="njob-row">
                    <span className="njob-k">Next</span>
                    <div className="njob-v njob-chips" role="radiogroup" aria-label="What happens next">
                      {NEXT.map((n) => (
                        <button key={n} type="button" role="radio" aria-checked={next === n} className={"wb2-filter" + (next === n ? " on" : "")} onClick={() => setNext(next === n ? null : n)}>
                          {n.charAt(0).toUpperCase() + n.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {answer && (answer.ok ? <p className="njob-line">{answer.line.words}</p> : <p className="wb2-sherr" style={{ margin: 0 }}>{answer.error}</p>)}
            </>
          )}
        </div>

        <div className="wb2-dmft">
          {done ? (
            <>
              {answer.sm8Url && (
                <a className="pbtn ghost" href={answer.sm8Url} target="_blank" rel="noopener noreferrer">
                  Open in ServiceM8
                </a>
              )}
              <button className="pbtn" onClick={onClose}>
                Done
              </button>
            </>
          ) : (
            <>
              <span className="njob-charge">{JOB_WORDS.card.charges}</span>
              <button className="pbtn" disabled={!canCreate} onClick={() => void create()}>
                {busy ? "Adding it to ServiceM8…" : "Create job"}
              </button>
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
