/* The deployment's switch for live updates from ServiceM8 (two-way phase 4,
   webhooks), read from SM8_WEBHOOKS — in a module of its own, importing
   nothing, so the route, the callback, a disconnect, the cron and the
   page-load freshen can each ask "is this deployment subscribed?" without
   importing the machinery.

   THE QUESTION THAT KEEPS PRODUCTION AS IT IS. With SM8_WEBHOOKS unset,
   nothing may change: the route answers 404 before any read, no request
   goes to ServiceM8's /webhook_subscriptions, nothing new is written on a
   connect, a disconnect, a page load or the nightly run, and the meter's
   `hook` lane takes no turn. Every new path asks sm8WebhooksState() first,
   and sm8-hooks-prod.test holds each of them to it, with the env unset.

   PRODUCTION ONLY. A preview or a branch shares the database and would
   subscribe a business's ServiceM8 to an address that disappears with the
   branch, so anywhere but VERCEL_ENV=production is off, whatever the
   variable says.

   `gone` IS THE ROLLBACK. It is off in every way but one: the route answers
   410 to a well-formed hook path, which ServiceM8 documents as unsubscribing
   ("the same as if you had called the webhook subscription endpoint and
   removed it"), so the subscriptions fall away at the next ping. */

export type Sm8HooksState = "off" | "on" | "gone";

/** SM8_WEBHOOKS on Production only: "1" is on, "gone" answers 410 to every
    hook path (rollback), anything else or anywhere else is off. */
export function sm8WebhooksState(): Sm8HooksState {
  if (process.env.VERCEL_ENV !== "production") return "off";
  const v = process.env.SM8_WEBHOOKS;
  return v === "1" ? "on" : v === "gone" ? "gone" : "off";
}
