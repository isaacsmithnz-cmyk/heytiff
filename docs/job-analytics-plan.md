# Job analytics — plan

Isaac, 2026-10-07:

> "need an analytics page for jobs. Quotes, brands used, win rate, average price of job types etc. Make a list of all things you think are useful"

Status: **built: Overview, Quotes and To decide** at `/dashboard/analytics` (see "Built" below). The ServiceM8 clean-up buttons are next. To decide needs `docs/migrations/job_analytics_decisions.sql` applied (DEPLOY.md, 3f). This is the list of what the page could show, and what each figure stands on. The mock-up is three screens, Overview, Quotes and To decide, on the canvas at https://claude.ai/artifact/Daf2AbjZ7ekgA7TJrpqFg7, drawn with sample figures.

## Built

The first part, 2026-10-07 (Isaac: "Start building it").

- **Where it is:** `/dashboard/analytics`, an Analytics row under Operations.
  - Gated by `workboard_money`, in the nav and in the page.
  - Without ServiceM8 connected, the page leads with Connect ServiceM8.
- **The period:** Quarter, Financial year or 12 months, kept in the URL (`?period=`). Each figure is set beside the same days a year earlier.
- **Overview:**
  - The win rate leads, by count and by value.
  - Beside it: quoted, won, completed work, the median job won, open quotes and days to quote.
  - Win rate by job type, by price and by days to quote.
  - Price by job type: median, average, middle half and spread.
  - Enquiries week by week against the year before.
- **Quotes:**
  - The 180-day rule, with the days from the job being raised to a yes for every win.
  - The lost, split into Unsuccessful and past 180 days.
  - Open quotes today: to price, waiting, going cold, and reaching 180 days in the next 30.
- **The code:**
  - `src/lib/analytics/job-analytics.ts`: pure, every rule and figure, tested.
  - `src/lib/analytics/analytics-query.ts`: the mirror read, paged.
  - `src/components/analytics/`: the screen.

Settled while building:

- **What counts as a quote** is the progress line's rule (`lineOf` in job-steps.ts): a quote was sent, or the job is still a Quote or Unsuccessful. A work order nobody quoted isn't one. That settles "Is it a quote?" for most jobs before anyone is asked.
- **The 180 days run from the day the job was raised**, the clock the Workboard's "Over 6 months" group uses, so the two screens count the same quotes. A period holds the quotes on jobs raised in it.
- **Money is inc GST**, labelled as such. ServiceM8's job total is inc GST, and the house rule (job-money.ts) is to label, never convert.
- **Completed work stands in for invoiced.** ServiceM8's invoice flags never arrive (job-money.ts); a completed job's total and date do.
- **Bars are square.** 4px isn't a radius on the scale, and the paper register is the sharper one. The comparison series is the quiet text colour, so no new token was needed.
- **To decide**, the second part (Isaac, 2026-10-07: "Keep going with the To decide tab"):
  - **Is it a quote?** A work order no quote was sent for that reads like an install or comes to $3,000 or more. Until answered it isn't a quote, as the progress line says.
  - **Won or lost?** Unsuccessful in ServiceM8 but marked paid, or still a Quote though the proposal has an option marked accepted. Until answered it's left out of the win rate.
  - **What kind of job?** A decided quote whose kind can't be read. Until answered it counts as "Not known".
  - **Does this price belong?** A won price over four times its kind's median, or under a quarter of it, once the kind has five priced wins. Until answered it's left out of the prices but still counts as won.
  - The questions cover jobs raised in the chosen period. Each answer is one row in `job_analytics_decisions` (job, question, answer, who, when); a new answer replaces it and Undo deletes it.
  - The Overview says how many jobs wait, and what they keep out of the figures, with a press that opens the tab.
  - Rows answered before this visit are folded away behind "Show what was decided". A group shows 20 rows, then "Show N more".
  - The code: `src/lib/analytics/decisions.ts` (the questions and their answers), the placement in `job-analytics.ts`, `src/app/actions/analytics-decide.ts`, `src/components/analytics/analytics-decide.tsx`.
- **Not yet:**
  - The ServiceM8 clean-up buttons (Make it a work order, Mark Unsuccessful).
  - The first look at real data: how many "Is it a quote?" questions the account raises depends on how often ServiceM8 records the day a quote was sent. If it's most installs, the tab wants an "answer all of these" press.
  - Brands, which need the job's material lines read.
  - Labour, quoted against actual.
  - Price per kW, which needs each unit's capacity.

## Decided

Isaac, 2026-10-07:

> "jobs not converted to work order after 180 days can be marked as lost, anything unknown or questionable should be manually decided"

- **A quote with no answer 180 days after it was sent counts as lost.**
  - It's counted that way in every figure, whatever ServiceM8 says.
  - A quote that becomes a work order after that counts as won again, because the rule is applied when the figures are read, not stored.
  - Writing Unsuccessful back to ServiceM8 is a separate press, "Mark 98 lost in ServiceM8", which the owner makes. It never happens on its own.
- **Anything unknown or questionable is decided by hand, on a To decide tab.**
  - Until it's decided, the job is left out of the figures it affects, and the page says how many jobs and how much work that is.
  - Each answer is kept in HeyTiff, in a new table: job, question, answer, who, when. It overrides what was read from the text. Undo takes it back.
  - The questions in the mock-up:
    - **Is it a quote?** A work order with no quote sent.
    - **Which brand?** No brand could be read, or only a guess from a model code. "Customer's own" is one of the answers.
    - **What kind of job?** It couldn't be read, or the options span two kinds.
    - **Does this price belong?** Far from the median for its kind. "Leave it out of prices" keeps it counted as won.
    - **Won or lost?** ServiceM8 and the money disagree. For example, Unsuccessful but paid, or accepted on the proposal but still a Quote in ServiceM8.
  - A suggestion, where there is one ("Looks like Daikin, from the model code"), is shown beside the choices but never chosen for you.
- **ServiceM8 can be cleaned up too, with an extra button** (Isaac, 2026-10-07: "They can clean up in servicem8 too with an extra button").
  - Once an answer disagrees with ServiceM8, the row offers the write that would make ServiceM8 agree. It's never sent on its own.
    - **Won** on a job that's a Quote or Unsuccessful in ServiceM8: "Make it a work order in ServiceM8". This is the same Quote-to-Work-Order write that Book in and Make it a work order already send (src/app/actions/booking-sm8.ts), with its live re-read of the job first.
    - **Lost** on a job that's still a Quote: "Mark Unsuccessful in ServiceM8". This is a new status write; the 180-day button uses the same one.
  - An "Update N jobs in ServiceM8" button over the list sends every one waiting at once.
  - Once a row has gone to ServiceM8, it has no Undo; the change is then ServiceM8's, and is undone there.
  - **Not written back:** brand, "is it a quote" and "leave it out of prices", because ServiceM8 has no field for them. Job type could set the ServiceM8 category, but only once each business maps its own categories to the job types. Not in the mock-up.

## What the numbers stand on

Most job data is the ServiceM8 mirror (`sm8_*`, docs/migrations/sm8_mirror.sql and sm8_jobs_money.sql):

- every value is text;
- 24 months are backfilled, so year on year is as far back as it goes;
- a job's `status` is `Quote`, `Work Order` (won), `Unsuccessful` (lost) or `Completed`;
- its dates are `date` (enquiry), `quote_sent_stamp`, `work_order_date`, `completion_date`, `invoice_date` and `payment_received_stamp`.

HeyTiff's own quote is `quote_drafts.draft` (src/lib/quotes/proposal.ts): the options, their units and `priceCents`, which option the client took (`accepted`), and `status.sentAt`.

Each item below carries one of three tags:

- **now**: it can be worked out from what is stored today;
- **read**: it can be worked out today, but from text (`brandOf()` in src/lib/quotes/brands.ts, `workKindOf()` in src/lib/quotes/labour-history.ts), so it's an estimate;
- **needs**: a field has to be captured first (see "What to start capturing").

**★** marks the suggested first cut. It needs nothing new.

## The list

### 1. The top line

- ★ Quoted, won and invoiced value for the period, inc GST, against the same period last year. **now** (built with completed work in place of invoiced, see Built)
- ★ Win rate by count and by value, with the count beside it ("62% of 48"). **now**
- ★ Average and median job value. **now**
- ★ Open pipeline: the value of quotes waiting for an answer. **now**
- Work in hand: won but not finished, which is the revenue already coming. **now**

### 2. Quotes and win rate

- ★ **Win rate, defined once.** Won is `Work Order` or `Completed`; lost is `Unsuccessful`.
  - Many quotes are never marked lost in ServiceM8; they just sit.
  - So a quote unanswered after 180 days counts as lost (decided, above), and there is one rate.
  - **now**
- ★ Win rate by work kind: split, multi, ducted, VRF, service, maintenance. **read**
- ★ Win rate by price band (under $5k, $5–10k, $10–20k, over $20k). **now**
- Win rate by suburb or postcode. **now**
- Win rate by customer, person or company (`is_individual`). **now**
- Win rate by how many options were offered: one, or two to four. **now**
- Win rate by who quoted. **needs** the quote's author.
- Win rate by where the lead came from. **needs** a lead source field.
- ★ **Speed to quote:** enquiry to quote sent, as a median, by work kind. **now**
  - Then win rate by speed: sent within a day, within three days, within a week, slower.
  - This is usually the clearest lever.
- **Speed to answer:** quote sent to won.
  - Show "after N days a quote rarely wins", which sets the chase rule.
  - **now** for wins. **needs** a date for losses, because ServiceM8 keeps no date for Unsuccessful.
- Ageing: To price, Waiting, Going cold and Over 6 months, each with a count and a value. **now** (quote-worklist.ts already groups them)
- **Which option clients pick** when offered two to four: the cheapest, the middle or the top. **now** (from `accepted` and each option's `priceCents`)
  - The upsell rate: how often they take more than the cheapest.
- Uptake of optional extras in `optional` pricing mode. **now**
- Why quotes are lost: price, went elsewhere, no reply, timing, other. **needs** a lost reason.
- Quotes opened against quotes sent. **needs** a viewed date, and only if the proposal goes out as a HeyTiff page.

### 3. Brands and equipment

- ★ Brand mix: each brand's share of units quoted and of units won, and how it moves month to month. **read**
- Win rate by brand, on quotes that offered one brand. **read**
- Brand offered against brand chosen, when the options span brands. **read**
- Average installed price per unit by brand and size (for example, Daikin 7.1 kW high wall, installed). **read**
- Size mix: kW bands (2.5, 3.5, 5, 7, 8 and up). **read** (`capacity` is free text)
- Type mix: high wall, ducted, floor, cassette, multi-head. **read** (`type` is free text)
- The most installed models, by count. **read**
- Margin by brand: cost against price on `sm8_job_materials`. **read**
- Spend by supplier, from `quote_price_items` (`paid_cents`, `times_bought`). **now**
- Price creep on the top 20 items. **needs** a price history; today only the current price is kept.
- Brand partner leads (for example, "Mitsubishi Electric Australia - Lead accepted"): how many came in and how many were won. **read**

### 4. Price by job type

- ★ Median, average and range of won job value by work kind. **read**
  - Median leads, because one commercial job moves the average.
- ★ How won prices spread within each work kind, so you can see where most jobs land. **read**
- $ per kW installed (ducted) and $ per head (multi). This is a sanity check for a new quote. **read**
- Quoted against invoiced: the accepted option's price against `total_invoice_amount`. This shows variations and scope creep. **now**
- The average variation, from `project_variations`. **now**
- Median price by work kind, quarter by quarter. **read**
- Price by customer type and by region. **now**
- Discount given. **needs** the discount stored; `priceBuildUp()` works it out on every read and keeps nothing.

### 5. Margin

- Materials margin per job: sell less cost on `sm8_job_materials`. **now**
- Markup achieved against the markups set in `quote_settings` (`unit_markup_pct`, `material_markup_pct`). **now**
- Gross margin per job, with labour in: hours on site × a cost rate. **needs** a labour cost rate (charge-out is in `quote_settings`, cost isn't).
- Margin by work kind, brand, crew and customer type. **read**, and needs the above for labour.
- Jobs under a margin floor, as a list to look at. **now** for materials.

### 6. Labour: quoted against actual

- ★ Quoted hours against hours on site, across all jobs. **now**
  - `quotedHours()` and the `HoursBar` already do this for one job.
  - Over or under, by work kind.
  - This is the one that feeds quoting: the `typical` figure in quote-labour-server.ts is `null` until it exists.
- Days on site by work kind and crew size. **now** (`sm8_job_activities` sessions, `job_check_ins`)
- Hours per unit and per kW. **read**
- Return visits as a share of jobs: the call-back rate. **now** (the Return stage)
  - Warranty hours once docs/warranty-plan.md is built.
- Per tech: jobs finished, hours, and how close they come to the quoted hours. Owner only, and worth Isaac's call before it's shown.

### 7. Speed through the job

- Median days at each step: enquiry, quoted, accepted, deposit, materials, installed, paid (job-steps.ts). The slowest step is the bottleneck. **now**
- Accepted to first booking: how far out the business is booked. **now**
- Booked hours against available hours (`schedule_capacity_staff.daily_minutes`), for the next four and eight weeks. **now**

### 8. Cash

- Invoiced against paid, and days to pay (`invoice_date` to `payment_received_stamp`). **now**
- Overdue: the total and the list. **now**
- How often a deposit is taken, and the average deposit as a share of the job (`sm8_job_payments.is_deposit`, `job_no_deposit`). **now**
- Progress claims outstanding (`project_claims`). **now**

### 9. Customers and where work comes from

- Where leads come from (phone, email, website, referral, brand partner), and the win rate of each. **needs** a field.
  - Today it's only text: "Came in by …" appended to `job_description`, which could be parsed for the history.
- New against repeat customers, the repeat rate, and value per customer over time. **now**
- Top customers by value: builders and commercial clients. **now**
- By suburb or postcode: jobs, win rate and average value, to show where to advertise and how far the crews travel. **now**
- Residential against commercial. **read** from `is_individual` for now; **needs** `building_type` stored, because it's parsed from the brief and dropped.
- Maintenance agreements: how many, renewals, visits done against due, and the yearly value. This is the recurring revenue. **now**

### 10. Through the year

- ★ Enquiries and quotes per week, with last year drawn behind them (heatwaves show). **now**
- Revenue by month. This helps with hiring and stock. **now**

## What to start capturing

These are the fields to add first, in order of what they unlock. Each one is worth adding before the page is built, because history can't be backfilled.

1. **Snapshot the quote when it's sent and when it's accepted:** sell, cost, labour hours, discount, and the accepted option.
   - Today the build-up is worked out from the current price book, so an old quote read today gives today's numbers, not the ones that were sent.
   - Every price and margin figure depends on this.
2. **A lost reason, with a date,** on Unsuccessful.
3. **Lead source as a field,** not text in the description.
4. **The quote's author:** `quote_drafts` has `updated_by` but no `created_by` or `sent_by`.
5. **Brand and work kind stored on the quote** when it's sent, instead of read from text each time.
6. **Customer type stored** (`building_type`).
7. **A labour cost rate** per person or per business, to give margin with labour in.
8. **Price history** on `quote_price_items`.

## Rules for the numbers

- Inc GST throughout, as ServiceM8 holds it, and labelled.
- Show the count beside every rate. A rate over five jobs says so.
- Use the median for prices and the average only beside it.
- The period is this month, this quarter, the financial year (July to June) or a custom range, always against the same period last year.
- Every figure opens the jobs behind it, as a filtered Workboard list.
- Without ServiceM8 there are no won jobs and no money (docs/design.md), so the page says it needs ServiceM8 connected.

## Where it sits

- Every figure here is job money, so the page is gated by `workboard_money`. That's the owner tier by default, and admins don't get it.
- The page itself checks `can("workboard_money")` and redirects, as admin/quoting/page.tsx does with `financials`.
- **Home:** an Analytics entry under Operations, or a tab on the Workboard. Isaac's call.
- **Design:**
  - Read docs/design.md before drawing it.
  - The app has no chart library yet, and colour is state only. Charts need series colours, so they need a decision written into design.md before the page is built.
  - The admin index's "Usage analytics" row is a different thing: how the workspace is used, not job figures.

## Open questions for Isaac

1. Is the ★ first cut the right one? It's the top line, win rate, speed to quote, brand mix, price by job type, and quoted against actual hours. All of it is buildable from what's stored today.
2. Owner only, or also admins who are given `workboard_money`?
3. Per-tech figures: shown, or kept off the page?
4. Should the capture fields above go in now, ahead of the page, so the history starts building?
5. Charts need a grey for the context series (the mock-up uses `#8a929e`, 3.2:1 on white). Is that one token in docs/design.md?
