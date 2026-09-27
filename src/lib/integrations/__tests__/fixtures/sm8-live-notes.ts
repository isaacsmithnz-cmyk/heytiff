/* ServiceM8's own copy of our notes, AS THE LIVE ACCOUNT BEHAVES — for the
   suites that replace ServiceM8 at its request functions (two-way phase 2).

   A note put there reads back active. ServiceM8's DELETE takes it out
   (active 0) — and a DELETE on a note that is ALREADY OUT PUTS IT BACK,
   which is what the owner's real account did on the live walk of
   2026-09-27: a note its sender had removed inside ServiceM8 read active
   again at the second of HeyTiff's DELETE. A uuid never put there reads
   not found, and its DELETE answers 404.

   Each suite wires `read` and `del` into its own mocks of sm8-write's
   readSm8Note and deleteSm8Note, so a mockResolvedValueOnce it queues
   still answers first. It lives under fixtures/ so jest doesn't run it as
   a suite. */

type Note = { active: boolean; relatedUuid: string };

const key = (uuid: unknown) => String(uuid).toLowerCase();

export function makeSm8Notes(relatedUuid: string) {
  const notes = new Map<string, Note>();
  /** Every DELETE that reached "ServiceM8", in order, by uuid. */
  const deletes: string[] = [];
  return {
    deletes,
    /** A note of ours that landed, active. */
    put(uuid: string, on: string = relatedUuid) {
      notes.set(key(uuid), { active: true, relatedUuid: on });
    },
    /** A person removes it inside ServiceM8. */
    removeThere(uuid: string) {
      const n = notes.get(key(uuid));
      if (n) n.active = false;
    },
    /** Whether ServiceM8 holds it active now; null when it never landed. */
    active(uuid: string): boolean | null {
      return notes.get(key(uuid))?.active ?? null;
    },
    /** readSm8Note(call, uuid): the account asking, never impersonated. */
    read: async (_call: unknown, uuid: string) => {
      const n = notes.get(key(uuid));
      if (!n) return { ok: true as const, found: false as const };
      return {
        ok: true as const,
        found: true as const,
        relatedUuid: n.relatedUuid,
        active: n.active,
        flagged: false,
        completedBy: null,
        editDate: "2026-09-20 10:00:00",
        editBy: null,
      };
    },
    /** deleteSm8Note(call, uuid, asStaffUuid): the toggle the live walk found. */
    del: async (_call: unknown, uuid: string) => {
      deletes.push(uuid);
      const n = notes.get(key(uuid));
      if (!n) return { status: 404, outcome: { kind: "rejected" as const, status: 404 }, remote: null, recordUuid: null };
      n.active = !n.active;
      return { status: 200, outcome: { kind: "created" as const, remoteUuid: null }, remote: null, recordUuid: null };
    },
  };
}

export type Sm8Notes = ReturnType<typeof makeSm8Notes>;
