# Certificates on a job: plan

Status: plan, 2026-10-01. Nothing built yet. Open questions for Isaac are at the end.

## Why

Certifiers ask for a mechanical certificate before they issue an Occupation
Certificate. On 2026-10-01 job 1383 (74/10 Etham Ave, Darling Point, for Reed
Developments) needed one for FutureCert's item 9.1. It was put together by hand
in a chat from facts HeyTiff already holds:

- the job's address, client and contact
- the scope in the work-done description
- the team's licences
- the business's ABN and insurance

A certificate is the same kind of paper as a SWMS: HeyTiff writes it from a
library of approved wording, a person fills in what only they know, and the
issued version never changes. So it follows the SWMS build, piece for piece.

## What the person does

1. On a job's Documents face, **Create certificate** sits beside Create SWMS.
   SWMS closes when the job is finished, but a certificate opens then: it is
   usually written once the work is done.
2. They choose the type. v1 offers only **Mechanical services**. The type list
   exists from day one, so electrical, refrigerant commissioning and BASIX
   statements can join it later without a second build.
3. A short wizard opens with most fields already filled in (see Prefill). They
   correct, add and confirm.
4. **Issue** freezes a version, prints it to PDF and files the PDF on the job.
5. The PDF is an ordinary row on the Documents face, so the existing footer
   already emails it to the builder and sends it to ServiceM8. Nothing new is
   built for sending.

## How it mirrors the SWMS

| SWMS today | Certificate |
|---|---|
| `lib/swms/library.ts`: pure, versioned (`LIBRARY_VERSION`), every control sourced | `lib/certs/mechanical.ts`: pure, `CERT_LIBRARY_VERSION`, every clause names the standard or BCA part it answers |
| `swms_library_approvals`: the owner adopts the library before anything issues | `cert_template_approvals`, one per type and library version |
| `/dashboard/swms/template`: read and approve | `/dashboard/certificates/template?type=mechanical` |
| `swms` + `swms_versions` (answers and content frozen, a revision is a new row) | `certificates` + `certificate_versions`, same shape |
| `issueProblems()`: the server re-asks the wizard's rules | `certProblems()`, same pattern |
| `/swms/[versionId]`: paper outside the shell, `Letterhead` | `/certificates/[versionId]`, same, one A4 page |
| Sign-on signature pad (`signatureSvg`) | The signatory draws once at issue, using the same pad |
| Not a file yet ("a SWMS is a page") | Printed to PDF at issue, through the Studio's headless Chrome (`lib/studio/pdf-render.ts`), and filed in `documents` |

## The wizard

Five steps, each one screen. The text is the library's; the inputs are the
job's.

1. **The job.** Site address, builder, builder's contact, certifier, the
   certifier's project number, consent authority, date the works were
   completed. The completion date defaults to the job's completion date in
   ServiceM8.
2. **Equipment.** Rows of unit, location and capacity, plus model and serial
   numbers where known, then the controls. Rows can be added, removed and
   reordered. The total is calculated, never typed. (Job 1383's total was
   typed wrong on the job sheet: "29 kW" for units that add up to 19.8.)
3. **Scope.** What was included and what was by others (bulkheads,
   plasterboard, painting, electrical). This step is ticks over the library's
   lines plus one free line.
4. **Compliance.** The statements the certifier asks for, as answers rather
   than boilerplate:
   - AS/NZS 1668.1 and AS 1668.2: confirm.
   - **Fire mode (Spec 21)** is one of three answers, and the wording follows
     the answer:
     - *Individual room units, each ≤ 1000 L/s, not part of smoke control*:
       exempt from shutdown. Every unit's airflow has to be confirmed.
     - *Shuts down on a fire signal*: give the interface and the date it was
       tested.
     - *Part of a smoke control system*: the wizard stops. That needs an
       engineer's certificate, not ours.
   - BCA Part J5: insulation, sealing and the control that turns each unit
     off.
   - AS/NZS 5149, AS 4254, and the manufacturer's instructions.
   - Commissioning facts, typed and not assumed:
     - pressure test (pressure and how long it was held)
     - evacuation (microns)
     - refrigerant type and charge added
     - date commissioned
5. **Sign.** The signatory (whoever is issuing, by default) with their **ARC
   licence** and **contractor licence** read from their staff card. Draw the
   signature, then Issue.

## Prefill: where each fact comes from

| Fact | Source | Phase |
|---|---|---|
| Address, client, completion date | `sm8_jobs` | 1 |
| Builder contact | `sm8_job_contacts`, then `sm8_company_contacts` (as `readEmailDraft` already does) | 1 |
| Business name, ABN, address, logo | `organizations` through `orgBrand` | 1 |
| Insurance (footer) | `org_credentials` (public liability, workers comp) | 1 |
| Signatory's ARC and contractor licences | `staff_licences` / `staff_licence_records` | 1 |
| Equipment rows | Parsed from the work-done description ("1 x 3.6KW indoor for Master Bed"), clearly marked as read from the quote | 1 |
| Equipment from the design | `studio_designs.sm8_job_uuid`: the linked design's rooms, indoor and outdoor models, and the refrigerant charge `evaluateVrfCharge` already works out | 2 |
| Serial numbers | `job_photo_readings.ocr_text` on the job's nameplate photos, offered for the person to confirm and never filled in silently | 2 |
| Certifier, project number, which certificates are asked for | Upload the certifier's "OC list of requirements" PDF and read it (the way licences and policies are scanned now) | 3 |

## Rules that block Issue (`certProblems`)

- The signatory holds an ARC licence and a contractor licence that are on file
  and **current on the issue date**. A licence with no expiry on file counts as
  "check it" and blocks Issue, the same as an expired one. (Isaac's two were
  added on 2026-10-01 without expiry dates, because the cards in the photo
  show 2024. Their current expiry dates need adding before v1 can issue.)
- There is at least one equipment row, and every row has a location and a
  capacity.
- A fire-mode answer is chosen. The ≤ 1000 L/s answer needs every unit's
  airflow confirmed.
- The completion date is not in the future, and is not before the job was
  created.
- The certifier's project number and the consent authority are filled in
  (the certifier sends the paper back without them).
- The template for this type and library version has been approved.

## Data

One migration, additive, safe to apply before the deploy (no RLS policies,
service role only, every query scoped by `org_id`, like `swms.sql`):

```sql
create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  sm8_job_uuid text not null,
  type text not null check (type in ('mechanical')),
  created_by_staff_id uuid,
  created_at timestamptz not null default now()
);

create table public.certificate_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  certificate_id uuid not null references public.certificates (id) on delete cascade,
  version integer not null check (version >= 1),
  answers jsonb not null,          -- what the person chose and typed
  content jsonb not null,          -- what the library wrote, frozen
  library_version text not null,
  reason text not null,            -- "First issue", or why it was reissued
  signatory_staff_id uuid not null,
  signatory_licences jsonb not null, -- the numbers and expiry dates as they stood at issue
  signature_svg text not null,
  document_id uuid,                -- the PDF in documents
  issued_by_staff_id uuid not null,
  issued_at timestamptz not null default now(),
  unique (certificate_id, version)
);

create table public.cert_template_approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  type text not null,
  library_version text not null,
  approved_by_staff_id uuid not null,
  approved_at timestamptz not null default now(),
  unique (org_id, type, library_version)
);
```

The licences are snapshotted onto the version, because a certificate states
what was held on the day it was signed, not what is held now. That is the
opposite of the SWMS paper's live ticket read, on purpose.

`documents` takes a new kind, `certificate`, in its kind check (see
`documents_kind_catchup.sql` for how that check is widened).

## Gates

- **Issue**: `workboard_manage`. A certificate is outward-facing and goes to a
  certifier under the business's name.
- **Approve the template**: owner, as for the SWMS library.
- **Read the paper**: `workboard`.

## Build order

1. **Library and tests.** `lib/certs/mechanical.ts`, pure. Its golden test
   rebuilds job 1383's certificate from its answers and checks it word for
   word against what was sent on 2026-10-01.
2. **Migration and actions.** `app/actions/certificates.ts`: wizard context,
   issue, approve, list for a job.
3. **Paper.** `/certificates/[versionId]`, then the PDF at issue, filed on the
   job.
4. **Wizard and Documents face.** The Create certificate button, a
   Certificates group under Compliance, Reissue.
5. **Template page.** Read and approve.
6. **Phase 2.** Prefill from the Studio design and serial numbers from photos.
7. **Phase 3.** Read the certifier's requirements PDF. More certificate types.

Each step is its own PR. The design ratchets in
`src/app/dashboard/__tests__/design-ratchets.test.ts` hold on every one. The
wizard is a screen and follows `docs/design.md`. The paper is a print
stylesheet, outside the guards like the other three.

## Open questions for Isaac

1. **Who may sign?** Anyone with a current ARC and contractor licence, or only
   you?
2. **Signature:** draw it on each certificate, or draw it once and store it on
   your staff card for every certificate after?
3. **Which other certificates** come up often enough to be next: electrical
   (CCEW is the electrician's), refrigerant commissioning, BASIX, warranty
   letters?
4. **Should Issue also send it to ServiceM8 automatically**, or stay a tick in
   the footer like every other file?
5. **Builder vs certifier:** does it go to the builder (as with Reed) or
   straight to the certifier? That decides whose address the email draft
   starts with.
