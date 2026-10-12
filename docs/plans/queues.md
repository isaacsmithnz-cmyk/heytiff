# Queues: keep the outbox, add a heartbeat

*2026-10-12. Item 14 of the record-windows plan ("Postgres queues (pgmq)").*

## What is there

Every write to ServiceM8 is a row before it is a request (`docs/migrations/sm8_writes.sql`
and the queues after it: notes, bookings, leave, new jobs). A sender claims a row with a
conditional update, holds it on a lease, sends it, and records what came back; a row that
met a busy or unreachable ServiceM8 waits for `next_attempt_at`. One row per thing written
(`dedupe_key`), the account it was asked of (`tenant_id`), the uuid chosen before the first
send, and the line the card shows (`status`, `attempts`, `maybe_landed`).

That is an **outbox**, and a careful one. Its rows mean something: the card reads them to say
"Sending to ServiceM8", the ServiceM8 screen lists them, a disconnect cancels what waits and
keeps the history, and a second press on the same certificate is the same row.

## Why not pgmq for it

pgmq would give the queue's mechanics (a visibility timeout in place of the lease, an
archive in place of settled rows) and take away what the rows mean. A pgmq message is
opaque until it is read; the card could no longer ask "where is this file?", dedupe would
have to be rebuilt beside it, and the tenant check and the uuid would ride inside a JSON
payload instead of in columns a query can see. Every one of those is a property the outbox
was built for, after an incident (the 2026-08-10 reconnect). Moving it buys nothing it does
not already have.

**Recommendation: keep the outbox. Do not install pgmq for it.**

## What is actually missing: a heartbeat

A row due for a retry is sent by the next press anywhere in that workspace, the next page
load that freshens ServiceM8, or the nightly sweep (`api/cron/sm8-sync`). Nothing wakes at
the retry time itself. A file sent at 4:55pm that met an outage can wait until morning if
nobody opens the board again.

Vercel's Hobby plan runs a cron at most once a day (`api/cron/sm8-sync` explains how that
was found). So the minute comes from the database instead:

- **`/api/cron/sm8-drain`** (in this branch) sends only what is due, for at most ten
  workspaces a call, each on a 15-second slice, inside a 60-second function. No sync, no
  settling, counts only in its answer. Locked by `CRON_SECRET` exactly as the nightly route
  is, failing closed, and let through the canonical-host move by the proxy like every
  `/api/cron/` path.
- **`pg_cron` + `pg_net`** call it every minute. Neither is installed on the project today
  (checked 2026-10-12: both available, neither installed; `supabase_vault` is installed).

### To turn it on (not applied: production)

Run in the Supabase SQL editor, with the real secret and host:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- the same value as CRON_SECRET in Vercel, kept in Vault, never in the job text
select vault.create_secret('<CRON_SECRET>', 'heytiff_cron_secret');

select cron.schedule(
  'heytiff-sm8-drain',
  '* * * * *',
  $$
  select net.http_get(
    url := 'https://<APP_BASE_URL host>/api/cron/sm8-drain',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'heytiff_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);
```

Check: `select * from cron.job_run_details order by start_time desc limit 5;` and
`select status_code, content from net._http_response order by created desc limit 5;`
(a 200 with `{"workspaces":…,"sent":…}`; a 401 means the secret differs).

Off again: `select cron.unschedule('heytiff-sm8-drain');`

**Cost.** 1,440 calls a day. A minute with nothing due is one indexed query
(`orgsWithDueSm8Writes`) and returns. If the plan's function allowance is tight, run it every
two or five minutes (`*/2 * * * *`); the nightly sweep stays as the backstop either way.

## Where pgmq would fit later

A queue with no meaning of its own to show anyone: work that is only ever "done or not yet",
where nobody asks after a single item. Candidates, none needed today:

- rendering a certificate or quote PDF off the press, when one takes longer than the press
  should wait;
- buffering ServiceM8's webhook pings if a burst ever outruns the route that takes them;
- the reminder letters, if they grow past what one nightly run sends.

Each of those would be a new queue, not a move of the outbox.
