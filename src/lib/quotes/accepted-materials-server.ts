import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { latestInstalledPack, loadInstalledPack } from "@/lib/studio/packs/server";
import { optionMaterials, type OptionRow } from "./option-materials";
import { acceptedOptions } from "./proposal";
import { readStoredProposal } from "./proposal-writer";

/* THE ACCEPTED OPTION BECOMES THE JOB'S MATERIALS (Isaac, 2026-10-05:
   "whichever one is accepted as an option will then turn into the materials
   list for the job").

   The accepted options' lists (option-materials.ts) go on the job's own
   Materials list — the one "Materials sorted" ticks off. A row already
   there by name and detail isn't added twice. What a person put on by hand
   stays, and so does anything picked: it's bought. Only an unpicked row
   that came from one of the quote's other options gives way. HeyTiff's
   own list only: nothing goes to ServiceM8. Service role, by org; the
   route gates. */

const PACK_BRAND = "mitsubishi-electric";

export type AcceptedOnJob = { ok: true; added: number; removed: number } | { ok: false; reason: string };

const keyOf = (r: { name: string; sub: string }) => `${r.name.trim().toLowerCase()}|${r.sub.trim().toLowerCase()}`;

/** What changes on the job's list: the unpicked rows of the quote's other
    options that go, and the accepted rows not there already. Pure. */
export function acceptedChange(
  accepted: readonly OptionRow[],
  everyOption: readonly OptionRow[],
  onJob: readonly { id: string; name: string; sub: string; picked: boolean }[]
): { remove: string[]; add: OptionRow[] } {
  const mine = new Set(accepted.map(keyOf));
  const quoted = new Set(everyOption.map(keyOf));
  const remove = onJob.filter((r) => !r.picked && quoted.has(keyOf(r)) && !mine.has(keyOf(r))).map((r) => r.id);
  const gone = new Set(remove);
  return { remove, add: rowsToAdd(accepted, onJob.filter((r) => !gone.has(r.id))) };
}

/** The accepted rows not on the list already. Pure. */
export function rowsToAdd(accepted: readonly OptionRow[], already: readonly { name: string; sub: string }[]): OptionRow[] {
  const have = new Set(already.map(keyOf));
  const out: OptionRow[] = [];
  for (const r of accepted) {
    const k = keyOf(r);
    if (have.has(k)) continue;
    have.add(k);
    out.push(r);
  }
  return out;
}

export async function putAcceptedOnJob(orgId: string, userId: string, cardId: string): Promise<AcceptedOnJob> {
  const proposal = await readStoredProposal(orgId, cardId);
  if (!proposal) return { ok: false, reason: "There's no quote on this job." };
  const options = acceptedOptions(proposal.draft);
  if (options.length === 0) return { ok: false, reason: "No option is marked accepted." };
  const ref = await latestInstalledPack(PACK_BRAND);
  const pack = ref ? (await loadInstalledPack(ref.brand, ref.version)).pack : null;
  const accepted = options.flatMap((o) => optionMaterials(o, proposal.draft.checklist, pack));
  const everyOption = proposal.draft.options.flatMap((o) => optionMaterials(o, proposal.draft.checklist, pack));

  const { data } = await supabaseAdmin
    .from("job_picklist_items")
    .select("id, name, sub, picked, position")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", cardId)
    .eq("kind", "material");
  const onJob = ((data ?? []) as { id: string; name: string; sub: string | null; picked: boolean }[]).map((r) => ({ ...r, sub: r.sub ?? "" }));
  const { remove, add } = acceptedChange(accepted, everyOption, onJob);

  if (remove.length) {
    const { error } = await supabaseAdmin.from("job_picklist_items").delete().eq("org_id", orgId).in("id", remove);
    if (error) return { ok: false, reason: "The job's materials couldn't be changed. Try again." };
  }
  const { data: tail } = await supabaseAdmin
    .from("job_picklist_items")
    .select("position")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", cardId)
    .order("position", { ascending: false })
    .limit(1);
  const base = ((tail ?? [])[0]?.position as number | undefined) ?? -1;
  if (add.length) {
    const { error } = await supabaseAdmin.from("job_picklist_items").insert(
      add.map((r, i) => ({
        org_id: orgId,
        sm8_job_uuid: cardId,
        design_id: null,
        kind: "material",
        name: r.name.slice(0, 200),
        sub: r.sub.slice(0, 120),
        qty: r.qty.slice(0, 40),
        position: base + 1 + i,
        added_by: userId,
      }))
    );
    if (error) return { ok: false, reason: "The job's materials couldn't be changed. Try again." };
  }
  return { ok: true, added: add.length, removed: remove.length };
}
