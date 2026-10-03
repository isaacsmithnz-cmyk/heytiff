# Warranty and the system's log book — plan

Isaac, 2026-10-03:

> "we need to add in a warranty section under compliance. this can hold the history for this system and serve as a log book for the unit plus more data for us. install completed, 1 year later theres an issue. open up job card again, click warranty, it creates a warranty call out. this will accurately track warranty hours against the original job."

> "i think it can just reopen the job in servicem8 not create a new one. but ours will at least add correct time to the labour hours bar, probably in a different colour."

Status: **researched, not built.** Nothing here writes to ServiceM8 yet.

## What it is

A **Warranty** section under Compliance on an installed job's card. It's the system's log book:

- **What's installed:** models, serials, install date, who installed it.
  - From the compliance certificate's equipment rows (#976), for every business that writes certificates in HeyTiff.
  - Never from another business.
- **Its history:** each warranty call-out (when, who, hours, what was found), and maintenance visits at the same site.
- **Warranty call-out:** the press that starts one.

## How a call-out works (Isaac's way: reopen, don't create)

1. **Warranty call-out** on the original job asks for a line about the fault ("Head in bed 2 not cooling").
2. HeyTiff records a **warranty window** of its own, in a new `job_warranty_calls` table:
   - job, opened at, opened by, the fault;
   - closed at;
   - and the job's **original completion date as it stood at that moment**, because ServiceM8 overwrites it when the job is completed again.
3. HeyTiff asks ServiceM8 to make the job a **Work Order** again. This is the same status write Book in and Make it a work order already use, reversed (Completed → Work Order). The techs then see it and are booked as usual.
4. **Hours inside the window** are warranty hours, from ServiceM8 sessions and HeyTiff check-ins between opened and closed:
   - drawn on the labour hours bar in their own colour, beside the install hours;
   - counted against the original job, never mixed into the install figure.
5. **When the job is completed again,** the window closes:
   - the next sync sees Completed;
   - the progress line goes back to the stored original install date;
   - the log book gets the visit.

## What ServiceM8 says, and what it doesn't

- **Reopening is supported:** setting Job Status to Work Order reopens a completed job ([adding missing items](https://support.servicem8.com/questions/invoices/link-invoices-xero)).
- **Completing again sends the job back to approval:** it returns to Invoicing → *Awaiting approval*, and **approving is what sends the invoice to Xero** ([sending your first job to Xero](https://support.servicem8.com/help-center/servicem8-add-ons/xero/sending-your-first-job-to-xero)).
- **Not documented:** what happens to an invoice that was **already approved, sent or paid** when the job is reopened and completed again ([sync issues](https://support.servicem8.com/help-center/servicem8-add-ons/xero/resolving-xero-invoice-synchronization-issues) covers only $0 invoices and wrong-organisation syncs).

So the risk is a second approval re-sending, or changing, an invoice the customer has already paid.

## The rule this sets

- **Not invoiced yet:** reopen, as Isaac wants.
- **Invoiced or paid:** HeyTiff must not reopen until the behaviour is proven. Two candidates:
  - (a) reopen, and the office leaves the re-completed invoice unapproved (fragile: relies on a person);
  - (b) for an invoiced job, the call-out is a new $0 Warranty job, linked back in HeyTiff. That's ServiceM8's own way, and the industry's (recall/warranty jobs linked to the original, no charge; e.g. [ServiceTitan](https://help.servicetitan.com/docs/book-a-recall-or-warranty-job)). Its hours still count against the original job on the bar.

## To prove before building (Isaac)

1. On a throwaway job that **was invoiced and approved to Xero**: reopen it, complete it again, and see in ServiceM8 and in Xero whether the invoice is re-sent, duplicated, changed or untouched.
2. The same for a **paid** job.
3. Whether a reopened job keeps its invoice number.

The answers decide (a) or (b) for invoiced jobs. Everything else in this plan stands either way.

## Universal

- The log book, windows and hours are per business (org_id).
- Equipment comes from the business's own certificates; model facts come from the shared data pack.
- No business sees another's warranty history.

## Build order once decided

1. `job_warranty_calls` table and its reader; the Warranty section listing installed equipment and past call-outs (read-only).
2. Warranty hours on the hours bar in their own colour (read-only, from windows).
3. The **Warranty call-out** press: the status write behind the existing door, gated per the rule above.
