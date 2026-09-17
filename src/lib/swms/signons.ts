/* WHO HAS SIGNED ON TO A VERSION — including the sign-ons a correction carries.

   A revision that changes how the work is done is MATERIAL: everyone it
   covers signs on again. A correction (a hospital's name, a typo) is not, and
   asking a whole crew to sign again for it teaches them to sign without
   reading. So a sign-on on the version before carries onto a correction, for
   the same person, and says which version it was given on. It never carries
   past a material version, and nothing is copied or written: it is worked
   out from the rows each time, so the record of who signed what stays exactly
   what was signed.

   The same person across versions is the same staff card, or for someone
   from outside the business, the same name. Pure, so the bell, the job card,
   the sign-on page and the document all agree. */

export type ChainVersion = { id: string; version: number; material: boolean };
export type ChainPerson = {
  id: string;
  versionId: string;
  staffProfileId: string | null;
  outsideName: string | null;
};

export type Effective<S> = { signon: S; version: number };

const identity = (p: ChainPerson): string =>
  p.staffProfileId ? `staff:${p.staffProfileId}` : `outside:${(p.outsideName ?? "").trim().toLowerCase()}`;

/** For every person on every version, the sign-on that stands for them — their
    own, or one carried from an earlier version through corrections — or null. */
export function effectiveSignons<S>(
  versions: readonly ChainVersion[],
  people: readonly ChainPerson[],
  signonOf: (personId: string) => S | null
): Map<string, Effective<S> | null> {
  const out = new Map<string, Effective<S> | null>();
  const ordered = [...versions].sort((a, b) => a.version - b.version);
  let previous = new Map<string, Effective<S> | null>();

  for (const v of ordered) {
    const current = new Map<string, Effective<S> | null>();
    for (const p of people.filter((x) => x.versionId === v.id)) {
      const own = signonOf(p.id);
      const carried = !v.material ? previous.get(identity(p)) ?? null : null;
      const eff = own !== null ? { signon: own, version: v.version } : carried;
      out.set(p.id, eff);
      current.set(identity(p), eff);
    }
    previous = current;
  }
  return out;
}
