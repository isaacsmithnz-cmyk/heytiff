"use client";

import { useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/parts/dialog";
import { Button, IconButton } from "@/components/parts/button";
import { Field, TextArea, TextInput } from "@/components/parts/field";
import { Chooser } from "@/components/parts/chooser";
import { Tray } from "@/components/parts/tabs";
import { StateWord } from "@/components/parts/state";
import { WindowsContext } from "@/components/records/records-context";
import { mintPressId } from "@/lib/workboard/press-id";
import { JOB_WORDS } from "@/lib/integrations/sm8-job-words";
import { jobPageHref } from "@/lib/shell/links";
import { openMirrorJob } from "@/app/actions/workboard";
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

/* NEW › JOB (rule 44), and the board's own New job: a job taken off the
   phone, started in ServiceM8 as a quote (Isaac, 2026-10-01: "customer
   name, start typing and the repeat customer could come up… fields are
   optional… how they got in touch is good… basic categories"). The v2
   form over the board's engine (actions/job-new), which it keeps whole;
   there is no Next any more, it just saves (18 October).

   WHO FIRST, so a repeat customer is never made twice: typing the name
   searches the clients; a match fills in who they are, and a builder's job
   goes on A NEW SITE by default, with their previous sites in the Site
   chooser ("start off by adding a new site as default or click previous
   sites… searchable"). Typing an address we've been to says so, whoever's
   it was, with Use this site.

   CAME IN BY has Existing customer (18 October), matched to a client
   already here: picking one from the search chooses it, and chosen by
   hand it asks for the client to be found.

   Nothing is sent until Create job, which sends the job to ServiceM8 and
   waits a few seconds for it to land. A Create pressed twice is one job
   (the press id is minted once per open). Once ServiceM8 has it, the form
   closes and the job opens on its own page, as soon as the mirror has read
   it back; a new job can't be taken back from here, so the toast has no
   Undo. What hasn't landed says where it is, and Create job asks again. */

const VIA = ["an existing customer", "phone", "email", "the website", "a referral"] as const;
type Via = (typeof VIA)[number];
const VIA_WORD: Record<Via, string> = {
  "an existing customer": "Existing customer",
  phone: "Phone",
  email: "Email",
  "the website": "The website",
  "a referral": "A referral",
};

/** How long the form waits for the mirror to read the new job back before
    it says where the job is instead of opening it. */
const OPEN_TRIES = 12;
const OPEN_EVERY_MS = 1500;

/** searchClientSites reads at most this many; past it, their sites are searched. */
const SITES_READ = 12;

type Who = { kind: "none" } | { kind: "existing"; hit: ClientHit } | { kind: "new"; name: string };
type Site = { kind: "new" } | { kind: "previous"; site: SiteHit };
type Wrong = { who?: string; where?: string; what?: string };

/** A job read from an email (components/tiff/email-job-card): the form opens
    with it filled in, on the email's own press, so the card's Create job and
    this are one job. */
export type NewJobInitial = {
  pressId: string;
  clientName: string;
  address: string;
  first: string;
  last: string;
  mobile: string;
  email: string;
  description: string;
  via: "email";
};

export function NewJobForm({ onClose, initial, onMade }: { onClose: () => void; initial?: NewJobInitial; onMade?: (jobUuid: string) => void }) {
  const host = useContext(WindowsContext);
  const router = useRouter();
  const [pressId] = useState(() => initial?.pressId ?? mintPressId());
  const [q, setQ] = useState(initial?.clientName ?? "");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [who, setWho] = useState<Who>({ kind: "none" });
  const [site, setSite] = useState<Site>({ kind: "new" });
  const [siteQ, setSiteQ] = useState("");
  const [sites, setSites] = useState<SiteHit[]>([]);
  const [address, setAddress] = useState(initial?.address ?? "");
  const [match, setMatch] = useState<SiteHit | null>(null);
  const [first, setFirst] = useState(initial?.first ?? "");
  const [last, setLast] = useState(initial?.last ?? "");
  const [mobile, setMobile] = useState(initial?.mobile ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [categories, setCategories] = useState<JobCategory[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [via, setVia] = useState<Via | null>(initial?.via ?? null);
  const [wrong, setWrong] = useState<Wrong>({});
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<CreateAnswer | null>(null);
  /* in ServiceM8, and waiting for the mirror to read it back; then landed
     but not read back in time, said where it is */
  const [phase, setPhase] = useState<"form" | "opening" | "landed">("form");
  const alive = useRef(true);

  const builder = who.kind === "existing" && who.hit.sites > 0;
  const builderUuid = builder ? who.hit.uuid : null;

  useEffect(() => {
    alive.current = true;
    let live = true;
    void readNewJobCategories().then((c) => live && setCategories(c));
    return () => {
      live = false;
      alive.current = false;
    };
  }, []);

  /* the clients, as the name is typed; opened from an email, the one client
     with exactly the name Tiff read is chosen when the search first answers,
     and the site she read is kept (a builder's job is on a new site) */
  const autoPick = useRef(initial ? initial.clientName.trim().toLowerCase() : "");
  useEffect(() => {
    if (who.kind !== "none" || q.trim().length < 2) return;
    let live = true;
    const t = setTimeout(
      () =>
        void searchNewJobClients(q).then((h) => {
          if (!live) return;
          const same = autoPick.current ? h.filter((c) => (c.name ?? "").trim().toLowerCase() === autoPick.current) : [];
          autoPick.current = "";
          if (same.length === 1) setWho({ kind: "existing", hit: same[0]! });
          else setHits(h);
        }),
      200
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, who.kind]);

  /* a builder's previous sites, for the Site chooser, searched past the
     first few */
  useEffect(() => {
    if (!builderUuid) return;
    let live = true;
    const t = setTimeout(() => void searchClientSites(builderUuid, siteQ).then((s) => live && setSites(s)), siteQ ? 200 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [siteQ, builderUuid]);

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

  const pickClient = (hit: ClientHit) => {
    setWho({ kind: "existing", hit });
    setHits([]);
    setSite({ kind: "new" });
    setSiteQ("");
    setSites([]);
    setWrong((w) => ({ ...w, who: undefined }));
    /* a builder's job goes on a new site; anyone else's is at their address */
    setAddress(hit.sites > 0 ? "" : (hit.address ?? ""));
    /* a client already here came in as an existing customer, unless said */
    setVia((v) => v ?? "an existing customer");
  };

  const clearClient = () => {
    setWho({ kind: "none" });
    setSite({ kind: "new" });
    setMatch(null);
    setVia((v) => (v === "an existing customer" ? null : v));
  };

  const clientName = who.kind === "existing" ? who.hit.name : who.kind === "new" ? who.name : "";
  const jobAddress = site.kind === "previous" ? (site.site.address ?? site.site.name) : address;

  /** The mirror reads the new job back; until it has, its page has nothing
      to open. Asked a few times, then the form says where the job is. */
  const openWhenRead = async (jobUuid: string, words: string) => {
    for (let i = 0; i < OPEN_TRIES; i++) {
      const row = await openMirrorJob(jobUuid).catch(() => null);
      if (!alive.current) return;
      if (row) {
        onClose();
        host?.toast(words);
        router.push(jobPageHref(jobUuid));
        return;
      }
      await new Promise((r) => setTimeout(r, OPEN_EVERY_MS));
      if (!alive.current) return;
    }
    setPhase("landed");
  };

  const create = async () => {
    if (busy || phase !== "form") return;
    const w: Wrong = {
      who:
        who.kind === "none"
          ? "Say who the customer is."
          : via === "an existing customer" && who.kind !== "existing"
            ? "An existing customer is one already here. Find them by name."
            : undefined,
      where: jobAddress.trim() ? undefined : "Say where the job is.",
      what: description.trim() ? undefined : "Say what the job is.",
    };
    setWrong(w);
    if (w.who || w.where || w.what || who.kind === "none") return;
    setBusy(true);
    setAnswer(null);
    const client =
      who.kind === "existing"
        ? site.kind === "previous"
          ? { kind: "existing" as const, uuid: site.site.uuid }
          : builder
            ? { kind: "site" as const, parentUuid: who.hit.uuid, address }
            : { kind: "existing" as const, uuid: who.hit.uuid }
        : { kind: "new" as const, name: who.name, address };
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
      next: null,
    }).catch((): CreateAnswer => ({ ok: false, error: JOB_WORDS.press.unqueued }));
    if (!alive.current) return;
    setAnswer(a);
    setBusy(false);
    if (a.ok && a.line.state !== "failed" && a.line.state !== "cancelled") onMade?.(a.jobUuid);
    if (a.ok && (a.line.state === "in" || a.line.state === "partial")) {
      setPhase("opening");
      void openWhenRead(a.jobUuid, a.line.number ? `Job ${a.line.number} added` : "Job added");
    }
  };

  /* landed, and not read back in time: where it is, and ServiceM8's page */
  if (phase === "landed" && answer?.ok) {
    return (
      <Dialog
        heading="New job"
        width={560}
        onClose={onClose}
        foot={
          <>
            {answer.sm8Url && (
              <Button kind="second" href={answer.sm8Url} target="_blank" rel="noopener noreferrer">
                Open in ServiceM8
              </Button>
            )}
            <Button kind="main" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <div className="mk-form" role="status">
          <div className="mk-job-facts">
            <div>{answer.line.words}</div>
            <div>{`${clientName}, ${jobAddress.split("\n")[0]}`}</div>
          </div>
        </div>
      </Dialog>
    );
  }

  const opening = phase === "opening";
  const contacts = who.kind === "existing" ? who.hit.contacts : [];
  const contactName = `${first} ${last}`.trim();

  return (
    <Dialog
      heading="New job"
      width={560}
      onClose={onClose}
      foot={
        <>
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" disabled={busy || opening} aria-busy={busy || opening || undefined} onClick={() => void create()}>
            {opening
              ? answer?.ok && answer.line.number
                ? `Opening job ${answer.line.number}`
                : "Opening the job"
              : busy
                ? "Adding the job to ServiceM8"
                : "Create job"}
          </Button>
        </>
      }
    >
      <form
        className="mk-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        {/* WHO */}
        <Field label="Customer" error={wrong.who}>
          {who.kind === "none" ? (
            <div className="mk-jobfind">
              <TextInput
                value={q}
                data-autofocus
                invalid={!!wrong.who}
                placeholder="Start typing their name"
                onChange={(e) => {
                  setQ(e.target.value);
                  setWrong((w) => ({ ...w, who: undefined }));
                }}
              />
              {q.trim().length >= 2 && (
                <ul className="mk-jobhits" aria-label="Customers">
                  {hits.map((h) => (
                    <li key={h.uuid}>
                      <button type="button" className="mk-jobhit" onClick={() => pickClient(h)}>
                        {h.name}
                        <span className="mk-job-hitfact">{h.sites > 0 ? `${h.sites} site${h.sites === 1 ? "" : "s"}` : (h.address ?? "")}</span>
                      </button>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      className="mk-jobhit"
                      onClick={() => {
                        setWho({ kind: "new", name: q.trim() });
                        setHits([]);
                      }}
                    >
                      {`Add “${q.trim()}” as a new customer`}
                    </button>
                  </li>
                </ul>
              )}
            </div>
          ) : (
            <div className="mk-job">
              <span className="mk-job-name">{clientName}</span>
              <IconButton glyph="clear" label="Clear the customer" size={32} onClick={clearClient} />
            </div>
          )}
        </Field>
        {who.kind !== "none" && (
          <div className="mk-job-facts">
            {who.kind === "new"
              ? "A new customer."
              : builder
                ? `An existing customer: ${who.hit.sites} site${who.hit.sites === 1 ? "" : "s"}.`
                : who.hit.address
                  ? `An existing customer at ${who.hit.address}.`
                  : "An existing customer."}
          </div>
        )}

        {/* WHERE: a builder's site, new by default, or one of theirs */}
        {builder && (
          <Field label="Site">
            <Chooser
              options={[
                { value: "new", label: "A new site" },
                ...sites.map((s) => ({ value: s.uuid, label: s.name, hint: s.lastJob ? `#${s.lastJob}` : undefined })),
              ]}
              value={site.kind === "previous" ? site.site.uuid : "new"}
              onChange={(v) => {
                const s = sites.find((x) => x.uuid === v);
                setSite(s ? { kind: "previous", site: s } : { kind: "new" });
                setWrong((w) => ({ ...w, where: undefined }));
              }}
            />
          </Field>
        )}
        {builder && who.kind === "existing" && who.hit.sites > SITES_READ && (
          <Field label="Search their sites">
            <TextInput value={siteQ} onChange={(e) => setSiteQ(e.target.value)} />
          </Field>
        )}
        {site.kind === "previous" ? (
          builder ? (
            <div className="mk-job-facts">
              {[site.site.address ?? site.site.name, site.site.lastJob ? `last job ${site.site.lastJob}` : null].filter(Boolean).join(", ")}.
            </div>
          ) : (
            <Field label="Address">
              <div className="mk-job">
                <span className="mk-job-name">{site.site.address ?? site.site.name}</span>
                <IconButton glyph="clear" label="Clear the site" size={32} onClick={() => setSite({ kind: "new" })} />
              </div>
            </Field>
          )
        ) : (
          <>
            <Field label={builder ? "Site address" : "Address"} error={wrong.where}>
              <TextArea
                value={address}
                rows={2}
                invalid={!!wrong.where}
                placeholder={builder ? "The new site's address" : "Where the job is"}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setMatch(null);
                  setWrong((w) => ({ ...w, where: undefined }));
                }}
              />
            </Field>
            {match && (
              <div className="mk-job-says" role="status">
                <StateWord tone="look">
                  {`Matches a previous site: ${[match.address ?? match.name, match.lastJob ? `job ${match.lastJob}` : null, match.parentName].filter(Boolean).join(", ")}.`}
                </StateWord>
                <Button
                  kind="second"
                  size={32}
                  onClick={() => {
                    if (builder && !sites.some((s) => s.uuid === match.uuid)) setSites((cur) => [match, ...cur]);
                    setSite({ kind: "previous", site: match });
                  }}
                >
                  Use this site
                </Button>
              </div>
            )}
          </>
        )}

        {/* WHO TO RING: a repeat builder doesn't need one */}
        {contacts.length > 0 && (
          <Field label="Contact">
            <Chooser
              options={contacts.map((c) => ({ value: c.name, label: c.name }))}
              value={contacts.some((c) => c.name === contactName) ? contactName : null}
              placeholder="Choose a contact"
              onChange={(name) => {
                const c = contacts.find((x) => x.name === name);
                if (!c) return;
                const [f, ...l] = c.name.split(" ");
                setFirst(f ?? "");
                setLast(l.join(" "));
                setMobile(c.mobile ?? c.phone ?? "");
                setEmail(c.email ?? "");
              }}
            />
          </Field>
        )}
        <div className="mk-pair">
          <Field label="First name">
            <TextInput value={first} onChange={(e) => setFirst(e.target.value)} />
          </Field>
          <Field label="Last name">
            <TextInput value={last} onChange={(e) => setLast(e.target.value)} />
          </Field>
        </div>
        <div className="mk-pair">
          <Field label="Mobile">
            <TextInput value={mobile} inputMode="tel" onChange={(e) => setMobile(e.target.value)} />
          </Field>
          <Field label="Email">
            <TextInput value={email} inputMode="email" onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>

        {/* WHAT */}
        {categories.length > 0 && (
          <Field label="Kind">
            <Chooser
              options={[{ value: "", label: "No kind" }, ...categories.map((c) => ({ value: c.uuid, label: c.name }))]}
              value={category}
              placeholder="Choose a kind"
              onChange={(v) => setCategory(v || null)}
            />
          </Field>
        )}
        <Field label="The job" error={wrong.what}>
          <TextArea
            value={description}
            rows={3}
            invalid={!!wrong.what}
            placeholder="What they're after, in their words"
            onChange={(e) => {
              setDescription(e.target.value);
              setWrong((w) => ({ ...w, what: undefined }));
            }}
          />
        </Field>
        <div className="pt-field">
          <span className="pt-field-label">Came in by</span>
          <Tray
            ariaLabel="Came in by"
            options={VIA.map((v) => ({ value: v, label: VIA_WORD[v] }))}
            value={(via ?? "") as Via}
            /* the one chosen, pressed again, is none */
            onChange={(v) => {
              setVia(v === via ? null : v);
              if (v === "an existing customer" || via === "an existing customer") setWrong((w) => ({ ...w, who: undefined }));
            }}
          />
        </div>

        <div className="mk-job-facts">
          <div>{JOB_WORDS.card.charges}</div>
          {answer && !answer.ok && <StateWord tone="wrong">{answer.error}</StateWord>}
          {answer?.ok && phase === "form" && <div role="status">{answer.line.words}</div>}
        </div>
      </form>
    </Dialog>
  );
}
