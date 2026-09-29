/* The names people go by — reads and writes (Isaac, 2026-09-29). The rules
   are lib/staff/aliases.ts's; this file only fetches and stores.

   A WORKSPACE WITHOUT THE TABLE READS AS ONE WITH NO NICKNAMES. Every read
   here answers empty on an error, and every write says it didn't save, so
   the code can ship before staff_aliases.sql is applied without anything
   that worked before breaking. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { ALIASES_MAX, ALIAS_WORDS, normAlias, parseAliasList, realNamesOf, tidyAlias } from "./aliases";
import { fullNameOf } from "./name";

type AliasRow = { staff_profile_id: string; alias: string; created_at?: string | null };

/** Every nickname in the workspace, by staff card, oldest first. */
export async function aliasesByStaff(orgId: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const { data, error } = await supabaseAdmin
    .from("staff_aliases")
    .select("staff_profile_id, alias, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) return out;
  for (const r of (data ?? []) as AliasRow[]) {
    const list = out.get(r.staff_profile_id) ?? [];
    list.push(r.alias);
    out.set(r.staff_profile_id, list);
  }
  return out;
}

/** One card's nicknames, oldest first. */
export async function aliasesOf(orgId: string, staffId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("staff_aliases")
    .select("staff_profile_id, alias, created_at")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .order("created_at", { ascending: true });
  if (error) return [];
  return ((data ?? []) as AliasRow[]).map((r) => r.alias);
}

/** Keep a name Tiff was told, against that person. A name somebody else
    already goes by stays theirs — one person per name — and so does a card
    already holding its most. True when it was kept. */
export async function learnAlias(
  orgId: string,
  staffId: string,
  alias: string,
  addedBy: string | null,
): Promise<boolean> {
  const held = await aliasesOf(orgId, staffId);
  if (held.length >= ALIASES_MAX) return false;
  const { data, error } = await supabaseAdmin
    .from("staff_aliases")
    .upsert(
      {
        org_id: orgId,
        staff_profile_id: staffId,
        alias: tidyAlias(alias),
        alias_norm: normAlias(alias),
        source: "tiff",
        added_by: addedBy,
      },
      { onConflict: "org_id,alias_norm", ignoreDuplicates: true },
    )
    .select("id");
  return !error && ((data ?? []) as unknown[]).length > 0;
}

/** THE CARD'S LIST, AS TYPED: what it names is kept, what it no longer names
    goes. A name another person goes by is not taken from them: the list is
    refused whole, nothing is written, and the names come back in `taken`. */
export async function replaceAliases(
  orgId: string,
  staffId: string,
  names: readonly string[],
  addedBy: string | null,
): Promise<{ ok: true; taken: string[] } | { ok: false }> {
  const want = new Map(names.slice(0, ALIASES_MAX).map((n) => [normAlias(n), tidyAlias(n)]));
  const { data, error } =
    want.size > 0
      ? await supabaseAdmin
          .from("staff_aliases")
          .select("id, staff_profile_id, alias_norm")
          .eq("org_id", orgId)
          .in("alias_norm", [...want.keys()])
      : { data: [], error: null };
  if (error) return { ok: false };
  const elsewhere = new Set(
    ((data ?? []) as { staff_profile_id: string; alias_norm: string }[])
      .filter((r) => r.staff_profile_id !== staffId)
      .map((r) => r.alias_norm),
  );
  const taken = [...want.entries()].filter(([n]) => elsewhere.has(n)).map(([, t]) => t);
  if (taken.length) return { ok: true, taken };

  /* what this card no longer names goes first, then the rest is added */
  const { data: mine, error: mineError } = await supabaseAdmin
    .from("staff_aliases")
    .select("id, alias_norm")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId);
  if (mineError) return { ok: false };
  const drop = ((mine ?? []) as { id: string; alias_norm: string }[]).filter((r) => !want.has(r.alias_norm)).map((r) => r.id);
  if (drop.length) {
    const { error: dropError } = await supabaseAdmin.from("staff_aliases").delete().eq("org_id", orgId).in("id", drop);
    if (dropError) return { ok: false };
  }
  const add = [...want.entries()]
    .filter(([n]) => !elsewhere.has(n))
    .map(([n, t]) => ({ org_id: orgId, staff_profile_id: staffId, alias: t, alias_norm: n, source: "card", added_by: addedBy }));
  if (add.length) {
    const { error: addError } = await supabaseAdmin
      .from("staff_aliases")
      .upsert(add, { onConflict: "org_id,alias_norm", ignoreDuplicates: true });
    if (addError) return { ok: false };
  }
  return { ok: true, taken };
}

/** THE NAMES A TRANSCRIBER SHOULD LISTEN FOR: every word of everyone's name,
    then the names they go by — the preferred name on the card and every
    nickname. "Tell Bobo" only reaches Leonardo if "Bobo" was heard as
    "Bobo", so a nickname is boosted like a name. */
export async function spokenStaffNames(orgId: string): Promise<string[]> {
  const [{ data }, learned] = await Promise.all([
    supabaseAdmin.from("staff_profiles").select("full_name, preferred_name").eq("org_id", orgId).limit(200),
    aliasesByStaff(orgId),
  ]);
  const rows = (data ?? []) as { full_name: string | null; preferred_name?: string | null }[];
  const names = rows.flatMap((s) => (s.full_name ?? "").trim().split(/\s+/)).filter(Boolean);
  const goneBy = [
    ...rows.map((s) => (s.preferred_name ?? "").trim()),
    ...[...learned.values()].flat(),
  ].filter(Boolean);
  return [...new Set([...names, ...goneBy])];
}

/** SAVING THE CARD'S "ALSO CALLED" — the one door both the manager's and
    the person's own save go through, after their own gates. What came from
    the browser is only a list of strings; everything is re-decided here. */
export async function saveCardAliases(
  orgId: string,
  staffId: string,
  raw: unknown,
  addedBy: string | null,
): Promise<{ ok: true } | { ok: false; error: string; fields?: string[] }> {
  const typed = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").join(", ") : "";
  const { names, refused } = parseAliasList(typed);
  if (refused.length) return { ok: false, error: ALIAS_WORDS.notAName(refused[0]), fields: ["aliases"] };

  const { data: people, error } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, first_name, last_name, full_name")
    .eq("org_id", orgId)
    .limit(500);
  if (error) return { ok: false, error: ALIAS_WORDS.unsaved };
  const roster = ((people ?? []) as Record<string, unknown>[]).map((p) => ({ id: String(p.id), fullName: fullNameOf(p) }));
  /* a real name of anyone — this person's own included — is never a
     nickname: it is read as that name first */
  const real = realNamesOf(roster);
  const clash = names.find((n) => real.has(normAlias(n)));
  if (clash) return { ok: false, error: ALIAS_WORDS.realName(clash), fields: ["aliases"] };

  const r = await replaceAliases(orgId, staffId, names, addedBy);
  if (!r.ok) return { ok: false, error: ALIAS_WORDS.unsaved };
  if (r.taken.length) {
    const { data: holder } = await supabaseAdmin
      .from("staff_aliases")
      .select("staff_profile_id")
      .eq("org_id", orgId)
      .eq("alias_norm", normAlias(r.taken[0]))
      .maybeSingle();
    const who = roster.find((p) => p.id === (holder as { staff_profile_id?: string } | null)?.staff_profile_id)?.fullName;
    return { ok: false, error: ALIAS_WORDS.taken(r.taken[0], who ?? null), fields: ["aliases"] };
  }
  return { ok: true };
}
