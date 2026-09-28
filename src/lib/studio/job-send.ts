import type { SendToSm8Result } from "@/app/actions/job-sm8";

/** What POST /api/studio/design-to-job answers: the file is on the job card,
    and what ServiceM8 made of it — null when sending there is not this
    person's to do. Kept out of the route file, which may export only its
    handlers. */
export type DesignToJobResult =
  | { ok: true; fileName: string; sm8: SendToSm8Result | null }
  | { ok: false; error: string };
