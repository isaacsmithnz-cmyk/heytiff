import type { EventDetail } from "./events";
import type { PollResult } from "./polls";
import type { NoticeWithRead } from "./tasks";

/* The composed shape a noticeboard row actually renders as.

   The noticeboard is one ordered stream of posts that happen to carry
   different attachments — a poll's answers, later an event's RSVPs, reactions,
   comments. Each of those owns its own pure module and its own tables; this
   file is only the seam where they meet, so `tasks.ts` never has to learn what
   a poll is and no feature module imports another.

   Type-only on purpose: nothing here runs. */

export type BoardNotice = NoticeWithRead & {
  /** Present only on kind === "poll". */
  poll: PollResult | null;
  /** Present only on kind === "event"; carries the RSVPs in the poll's shape. */
  event: EventDetail | null;
};
