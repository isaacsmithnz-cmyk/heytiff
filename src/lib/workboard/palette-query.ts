/* What ⌘K reaches past the screens and the jobs: the staff, the client book
   and the projects.

   THE CLIENT BOOK IS SERVICEM8'S. HeyTiff's own records carry a client's
   NAME — typed on an agreement, copied onto a project — but the list of
   clients with an address and an identity is the mirror's `sm8_companies`.
   A standalone account has no book, and still finds its projects by the
   client named on them.

   NO SESSION HERE — callers establish the right to ask. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { fullNameOf } from "@/lib/staff/name";
import { initialsFrom } from "@/lib/staff/derive";
import { normAlias } from "@/lib/staff/aliases";

export type PaletteStaff = {
  /** staff_profiles.id — what the staff card's route resolves. */
  id: string;
  name: string;
  /** What they go by, when that is not the name — Bob, beside Robert; or
      the nickname that found them — Bobo, beside Leonardo. */
  known: string | null;
  /** The nicknames of theirs the search matched (staff_aliases), as kept —
      what Tiff's open-by-name reads "open Bobo" against. */
  nicknames: string[];
  initials: string;
  title: string | null;
  active: boolean;
};

export type PaletteClient = {
  uuid: string;
  name: string;
  /** One line, as ServiceM8 holds it — the line that tells two Smiths apart. */
  address: string | null;
};

export type PaletteProject = {
  id: string;
  name: string;
  clientName: string | null;
  siteLabel: string | null;
  stage: string;
  status: string;
};

/** Commas, brackets and quotes are PostgREST's own syntax inside `.or()`, and
    `%` is LIKE's — the same scrub the mirror's job search gives a typed term. */
const scrub = (term: string) => term.replace(/[%,()"\\]/g, " ").trim();

/** The typed words, once each. Several must each land — a second word
    narrows, the rule every search box here runs. */
const wordsOf = (safe: string) => [...new Set(safe.toLowerCase().split(/\s+/).filter(Boolean))];

const oneLine = (text: string | null): string | null => {
  const flat = (text ?? "").replace(/\s*\n\s*/g, ", ").replace(/\s+/g, " ").trim();
  return flat || null;
};

/** How well a name answers what was typed: the name itself, then a name that
    starts with it, then one with a word that does, then anything holding it.
    "kings" wants Kingsford Bakery before The Kingsway Group. */
function rank(name: string, term: string): number {
  const n = name.toLowerCase();
  const t = term.toLowerCase();
  if (n === t) return 0;
  if (n.startsWith(t)) return 1;
  if (n.includes(` ${t}`)) return 2;
  return 3;
}

/** How many names are read to choose the few that are shown. A term broad
    enough to match more than this is ranked within the first forty by name,
    and the next letter typed narrows it. */
const CLIENT_POOL = 40;

export async function searchClients(
  orgId: string,
  term: string,
  limit = 5
): Promise<PaletteClient[]> {
  const safe = scrub(term);
  if (safe.length < 2) return [];
  const words = wordsOf(safe);
  let asked = supabaseAdmin
    .from("sm8_companies")
    .select("uuid, name, address")
    .eq("org_id", orgId)
    .eq("active", 1);
  /* One word is looked for anywhere in a name, and ranked. Several must each
     START a word of it, in any order — "constr hr" is HR Constructions — the
     rule the mirror's own job search names a client by. */
  if (words.length === 1) asked = asked.ilike("name", `%${safe}%`);
  else for (const w of words) asked = asked.or(`name.ilike.${w}%,name.ilike.% ${w}%`);
  const { data } = await asked.order("name", { ascending: true }).limit(CLIENT_POOL);

  return ((data ?? []) as { uuid: string; name: string | null; address: string | null }[])
    .map((c) => ({ uuid: c.uuid, name: (c.name ?? "").trim(), address: oneLine(c.address) }))
    .filter((c) => c.name)
    .map((c, i) => ({ c, i, r: rank(c.name, safe) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map(({ c }) => c);
}

type Card = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  preferred_name: string | null;
  job_title: string | null;
  contact_email: string | null;
  status: string | null;
};

/** Staff card id → their nicknames that start with what was typed. Empty
    where the table isn't there, or the read fails. */
async function nicknamesStarting(orgId: string, safe: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const typed = normAlias(safe);
  if (typed.length < 2) return out;
  const { data, error } = await supabaseAdmin
    .from("staff_aliases")
    .select("staff_profile_id, alias")
    .eq("org_id", orgId)
    .ilike("alias_norm", `${typed}%`)
    .limit(STAFF_POOL);
  if (error) return out;
  for (const r of (data ?? []) as { staff_profile_id: string; alias: string }[]) {
    out.set(r.staff_profile_id, [...(out.get(r.staff_profile_id) ?? []), r.alias]);
  }
  return out;
}

/** How many cards are read to choose the few shown — active first. */
const STAFF_POOL = 40;

/** Staff by the words their names and their job titles start with — a first
    name, a surname, what they go by, "tech" for Senior Tech — every word
    landing, so "rob smi" is Robert Smith. Cards that have left stay findable
    after the ones still here: their records outlive them. */
export async function searchStaff(
  orgId: string,
  term: string,
  limit = 5
): Promise<PaletteStaff[]> {
  const safe = scrub(term);
  if (safe.length < 2) return [];
  let asked = supabaseAdmin
    .from("staff_profiles")
    .select("id, first_name, last_name, full_name, preferred_name, job_title, contact_email, status")
    .eq("org_id", orgId);
  for (const w of wordsOf(safe)) {
    asked = asked.or(
      [
        `first_name.ilike.${w}%`,
        `last_name.ilike.${w}%`,
        `preferred_name.ilike.${w}%`,
        `full_name.ilike.${w}%`,
        `full_name.ilike.% ${w}%`,
        `job_title.ilike.${w}%`,
        `job_title.ilike.% ${w}%`,
      ].join(",")
    );
  }
  /* THE NAMES PEOPLE GO BY find them too (Isaac, 2026-09-29): "Bobo"
     is Leonardo, learned by Tiff or typed on his card. A nickname is matched
     from its start as a whole ("big le" finds Big Leo), and its cards are
     read beside the name search's. A workspace without the table finds by
     names alone. */
  const [{ data }, called] = await Promise.all([asked.limit(STAFF_POOL), nicknamesStarting(orgId, safe)]);
  const byName = (data ?? []) as Card[];
  const missing = [...called.keys()].filter((id) => !byName.some((c) => c.id === id));
  const { data: extra } = missing.length
    ? await supabaseAdmin
        .from("staff_profiles")
        .select("id, first_name, last_name, full_name, preferred_name, job_title, contact_email, status")
        .eq("org_id", orgId)
        .in("id", missing)
    : { data: [] };

  return [...byName, ...((extra ?? []) as Card[])]
    .map((c) => {
      const stored = fullNameOf(c);
      const email = (c.contact_email ?? "").trim();
      const preferred = (c.preferred_name ?? "").trim();
      const nicknames = called.get(c.id) ?? [];
      /* the nickname that found them is what the row says beside the name;
         otherwise the preferred name, as before */
      const known = nicknames[0] ?? preferred;
      return {
        id: c.id,
        // the directory's own fallback: an imported card may carry only an address
        name: stored || email.split("@")[0] || "Unnamed",
        known: known && known.toLowerCase() !== (c.first_name ?? "").trim().toLowerCase() ? known : null,
        nicknames,
        initials: initialsFrom(stored, email),
        title: (c.job_title ?? "").trim() || null,
        active: c.status !== "Inactive",
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Projects by their name, their client or their site — every word landing in
    one of them, so "hr mosman" is HR's project on a Mosman site. Archived ones
    stay put away, as they do on the Projects list — "done" is still work
    somebody looks up. */
export async function searchProjects(
  orgId: string,
  term: string,
  limit = 5
): Promise<PaletteProject[]> {
  const safe = scrub(term);
  if (safe.length < 2) return [];
  let asked = supabaseAdmin
    .from("projects")
    .select("id, name, client_name, site_label, stage, status")
    .eq("org_id", orgId)
    .neq("status", "archived");
  for (const w of wordsOf(safe)) {
    asked = asked.or(
      `name.ilike.%${w}%,client_name.ilike.%${w}%,site_label.ilike.%${w}%,site_address.ilike.%${w}%`
    );
  }
  const { data } = await asked.order("updated_at", { ascending: false }).limit(limit);

  return (
    (data ?? []) as {
      id: string;
      name: string;
      client_name: string | null;
      site_label: string | null;
      stage: string;
      status: string;
    }[]
  ).map((p) => ({
    id: p.id,
    name: p.name,
    clientName: p.client_name,
    siteLabel: p.site_label,
    stage: p.stage,
    status: p.status,
  }));
}
