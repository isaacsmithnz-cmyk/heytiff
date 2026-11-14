/* WHAT'S WAITING FOR HER (store-server queueMessage): a message sent while
   she worked is waiting until a turn begins after it. The thread as a page
   holds it may still say queued once it's taken, as a poll reads only new
   events, so a turn that began after it is what says it's taken. Pure. */

type QueueEvent = { id: number; turnId: string | null; kind: string; body: Record<string, unknown> };

/** The ids of the messages still waiting for her, oldest first. */
export function waitingIds(events: readonly QueueEvent[]): number[] {
  const firstOf = new Map<string, number>();
  for (const e of events) if (e.turnId && !firstOf.has(e.turnId)) firstOf.set(e.turnId, e.id);
  const starts = [...firstOf.values()];
  return events.filter((e) => e.kind === "message" && e.body.queued === true && !starts.some((at) => at > e.id)).map((e) => e.id);
}
