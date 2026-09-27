/* ServiceM8's bookings and jobs, AS THE LIVE ACCOUNT BEHAVES — for the
   suites that replace ServiceM8 at its request functions (two-way phase 3).

   What the owner's real account showed (the spec's walk log, 2026-09-27):
   - a booking reads back as the wall-clock text it was booked at (P1);
   - a booking moved keeps its uuid, with a newer edit time (P2);
   - a booking cancelled reads active 0, with a newer edit time (P3);
   - the booked person opening a booking moves its edit time and nothing
     else (U21);
   - time added by hand is a row of its own, not scheduled, and clearing it
     leaves it active with its end on its start (P4);
   - a booking moves its job's edit time (P1), and so does a status change,
     which stamps work_order_date and leaves the six guarded fields (P6);
   - AND A DELETE ON A RECORD ALREADY REMOVED PUTS IT BACK (the notes walk:
     ServiceM8's DELETE of a note already out of it restored it) — taken
     here to hold for bookings, as the spec's lead does.

   Knobs a test turns: ServiceM8 keeping a uuid of its own (U1 false),
   keeping another time or another person (the guards), changing a guarded
   field with a status, and READS THAT LAG A WRITE (U23): the next n reads
   of a record show it as it was before the last write.

   Each suite wires these into its own mocks of sm8-write's booking
   requests, so a mockResolvedValueOnce it queues still answers first. It
   lives under fixtures/ so jest doesn't run it as a suite. */

type Activity = {
  uuid: string;
  jobUuid: string;
  staffUuid: string | null;
  start: string | null;
  end: string | null;
  scheduled: number;
  recorded: number;
  active: number;
  editDate: string;
};

type Job = {
  uuid: string;
  status: string;
  active: number;
  editDate: string;
  kept: Record<string, string | null>;
  logged: { work_order_date: string | null; total_invoice_amount: string | null; work_done_description: string | null; queue_uuid: string | null };
};

const key = (uuid: unknown) => String(uuid).toLowerCase();

const answer = (status: number, recordUuid: string | null = null) => ({
  status,
  outcome:
    status >= 200 && status < 300
      ? { kind: "created" as const, remoteUuid: recordUuid }
      : status === 409
        ? { kind: "exists" as const }
        : { kind: "rejected" as const, status },
  remote: null,
  recordUuid,
});

export function makeSm8Bookings() {
  const activities = new Map<string, Activity>();
  const jobs = new Map<string, Job>();
  /** Every DELETE that reached "ServiceM8", in order, by uuid. */
  const deletes: string[] = [];
  /** Every booking POST's body, in order. */
  const posts: Record<string, unknown>[] = [];
  /** Every status POST, in order: [job, status]. */
  const statusPosts: [string, string][] = [];
  /** Reads that still show a record as it was before its last write. */
  const lagging = new Map<string, { was: Activity | null; reads: number }>();
  let seq = 0;
  const knobs = {
    /** ServiceM8 keeps the uuid we send (U1). */
    keepsOurUuid: true,
    /** What ServiceM8 keeps of a booking we post: a different time, or a
        different person (the guards). */
    keeps: null as null | ((b: { staffUuid: string; start: string; end: string }) => Partial<Pick<Activity, "staffUuid" | "start" | "end" | "scheduled">>),
    /** A status change that moves one of the guarded fields as well. */
    statusAlsoSets: null as null | Record<string, string | null>,
    /** The next write's record reads as it was for this many reads (U23). */
    lagNextWrite: 0,
  };

  const tick = () => {
    seq += 1;
    return `2026-09-27 17:${String(Math.floor(seq / 60)).padStart(2, "0")}:${String(seq % 60).padStart(2, "0")}`;
  };
  const touchJob = (jobUuid: string) => {
    const j = jobs.get(key(jobUuid));
    if (j) j.editDate = tick();
  };
  const remember = (uuid: string) => {
    if (knobs.lagNextWrite > 0) {
      const was = activities.get(key(uuid));
      lagging.set(key(uuid), { was: was ? { ...was } : null, reads: knobs.lagNextWrite });
      knobs.lagNextWrite = 0;
    }
  };
  const seen = (uuid: string): Activity | null => {
    const lag = lagging.get(key(uuid));
    if (lag && lag.reads > 0) {
      lag.reads -= 1;
      return lag.was;
    }
    return activities.get(key(uuid)) ?? null;
  };
  const shaped = (a: Activity) => ({ ...a });

  return {
    activities,
    jobs,
    deletes,
    posts,
    statusPosts,
    knobs,
    /** A job in ServiceM8. */
    job(uuid: string, over: Partial<Job> = {}) {
      jobs.set(key(uuid), {
        uuid,
        status: "Quote",
        active: 1,
        editDate: "2026-09-27 16:00:00",
        kept: {
          company_uuid: "ff6cd691-2385-4367-9787-2149df3804ab",
          job_address: null,
          job_description: "HeyTiff test Z — please ignore",
          category_uuid: null,
          purchase_order_number: null,
          generated_job_id: "3370",
        },
        logged: { work_order_date: null, total_invoice_amount: "0.0000", work_done_description: null, queue_uuid: null },
        ...over,
      });
    },
    /** A booking (or recorded time) that is there. */
    put(a: Partial<Activity> & { uuid: string; jobUuid: string }) {
      activities.set(key(a.uuid), {
        staffUuid: null,
        start: null,
        end: null,
        scheduled: 1,
        recorded: 0,
        active: 1,
        editDate: tick(),
        ...a,
      });
    },
    /** A person cancels it inside ServiceM8 (P3). */
    removeThere(uuid: string) {
      const a = activities.get(key(uuid));
      if (a) Object.assign(a, { active: 0, editDate: tick() });
    },
    /** A person moves it inside ServiceM8: the same uuid (P2). */
    moveThere(uuid: string, to: Partial<Pick<Activity, "staffUuid" | "start" | "end">>) {
      const a = activities.get(key(uuid));
      if (a) Object.assign(a, to, { editDate: tick() });
    },
    /** The booked person opens it on the phone: its edit time only (U21). */
    openThere(uuid: string) {
      const a = activities.get(key(uuid));
      if (a) a.editDate = tick();
    },
    /** Whether ServiceM8 holds it active now; null when it never landed. */
    active(uuid: string): boolean | null {
      const a = activities.get(key(uuid));
      return a ? a.active === 1 : null;
    },
    get(uuid: string): Activity | null {
      return activities.get(key(uuid)) ?? null;
    },

    /* ── sm8-write's booking requests ── */

    readBooking: async (_call: unknown, uuid: string) => {
      const a = seen(uuid);
      if (!a) return { ok: true as const, found: false as const };
      return { ok: true as const, found: true as const, activity: shaped(a) };
    },
    readJobBookings: async (_call: unknown, jobUuid: string) => ({
      ok: true as const,
      activities: [...activities.values()].filter((a) => a.active === 1 && key(a.jobUuid) === key(jobUuid)).map(shaped),
    }),
    readJob: async (_call: unknown, jobUuid: string) => {
      const j = jobs.get(key(jobUuid));
      if (!j) return { ok: true as const, found: false as const };
      return { ok: true as const, found: true as const, job: { ...j, kept: { ...j.kept }, logged: { ...j.logged } } };
    },
    postBooking: async (_call: unknown, b: { uuid: string; jobUuid: string; staffUuid: string; start: string; end: string }) => {
      posts.push({ ...b });
      if (activities.has(key(b.uuid))) return answer(409);
      const uuid = knobs.keepsOurUuid ? b.uuid : `01a0e1${String(posts.length).padStart(2, "0")}-d4c9-7c94-9d9b-6a43fbb6eaab`;
      remember(uuid);
      const kept = knobs.keeps ? knobs.keeps({ staffUuid: b.staffUuid, start: b.start, end: b.end }) : {};
      activities.set(key(uuid), {
        uuid,
        jobUuid: b.jobUuid,
        staffUuid: b.staffUuid,
        start: b.start,
        end: b.end,
        scheduled: 1,
        recorded: 0,
        active: 1,
        editDate: tick(),
        ...kept,
      });
      touchJob(b.jobUuid);
      return answer(200, uuid);
    },
    postJobStatus: async (_call: unknown, jobUuid: string, status: string) => {
      statusPosts.push([jobUuid, status]);
      const j = jobs.get(key(jobUuid));
      if (!j) return answer(404);
      j.status = status;
      j.editDate = tick();
      j.logged.work_order_date = j.editDate;
      if (knobs.statusAlsoSets) Object.assign(j.kept, knobs.statusAlsoSets);
      return answer(200, jobUuid);
    },
    /** THE TOGGLE: a DELETE takes a booking out, and one reaching a booking
        already out PUTS IT BACK. A uuid never there answers 404. */
    deleteBooking: async (_call: unknown, uuid: string) => {
      deletes.push(uuid);
      const a = activities.get(key(uuid));
      if (!a) return answer(404);
      remember(uuid);
      a.active = a.active === 1 ? 0 : 1;
      a.editDate = tick();
      return answer(200);
    },
  };
}

export type Sm8Bookings = ReturnType<typeof makeSm8Bookings>;
