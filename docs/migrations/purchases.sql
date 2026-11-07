-- PURCHASES — a supplier's docket, photographed, read, and put where it went
-- (Isaac, 29 October 2026, from job 1352: Leo's Reece docket had nowhere to
-- go. "Add purchase, photo of the invoice… line items pulled out, added to
-- price book… ticked individually or add all to job. Or just stock… until
-- all items are clear").
--
-- One `purchases` row a docket, and one `purchase_lines` row a line on it.
-- A line goes to a job, to stock, or nowhere yet; a docket is clear when
-- none of its lines is left open. The photo is a `documents` row of kind
-- 'purchase_docket' pointing back here, the way a receipt points at its
-- expense claim. Not 'purchase_invoice': that is a VEHICLE's purchase
-- paperwork, which the vehicle adopts.
--
-- KEYED BY sm8_job_uuid, NOT A FOREIGN KEY, for the reason job_picklist.sql
-- and job_check_ins.sql give: the mirror is a disposable cache, and what was
-- bought for a job must outlive it. `job_label` is a SNAPSHOT for the same
-- reason expense_claims.job_label is: which job it went to at the time.
--
-- What each line did to the price book is kept on the line (`book`, and the
-- price before and after), because the book itself keeps only its newest
-- price: a purchase is the only place that can show "Price up, $268.40 to
-- $273.87" after the next docket moves it again.
--
-- SAFE TO APPLY BEFORE THE PR MERGES: new tables, a new column and a new
-- document kind nothing reads yet. APPLIED to prod 30 October 2026.

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- who it's from, as the docket prints it
  supplier_name text not null default '',
  -- the price book's supplier it matched, or null: a supplier the book
  -- doesn't keep (a hardware store, a workshop) changes no prices
  supplier_key text,
  invoice_no text not null default '',
  invoice_date date,
  -- the person who bought it: a staff card, or null when nobody's was picked
  bought_by uuid references public.staff_profiles (id) on delete set null,
  -- who added it, as every other "added_by" in the app: their auth user id
  added_by text not null,
  -- what was on the docket and isn't a line here, and why ("Freight: not a product")
  skipped jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.purchases is
  'A supplier''s docket or invoice, photographed and read. Its lines go to jobs or stock (purchase_lines); its prices went into the price book when it was added.';

create index if not exists purchases_org_idx on public.purchases (org_id, created_at desc);

create table if not exists public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  position integer not null,
  -- the supplier's code, "" when the line has none (it then never reaches the book)
  code text not null default '',
  name text not null,
  qty numeric(12, 3) not null check (qty > 0),
  -- the price of one before GST; null when neither the docket nor the book has one
  cents integer check (cents is null or cents > 0),
  -- where that price came from: the docket, or the book when the docket had none
  price_from text not null default 'docket' check (price_from in ('docket', 'book')),
  -- what the line did to the price book when the purchase was added
  book text not null default 'none' check (book in ('new', 'up', 'down', 'same', 'from_book', 'none')),
  book_before_cents integer,
  book_after_cents integer,
  -- where it went: a job, stock, or not yet
  went_to text not null default 'open' check (went_to in ('open', 'job', 'stock')),
  sm8_job_uuid text,
  job_label text,
  placed_by text,
  placed_at timestamptz,
  constraint purchase_lines_job_check check ((went_to = 'job') = (sm8_job_uuid is not null))
);

comment on table public.purchase_lines is
  'One line of a purchase: what it was, what one cost before GST, what it did to the price book, and the job it went to (or stock).';

create index if not exists purchase_lines_purchase_idx on public.purchase_lines (purchase_id, position);
-- a job's Materials: everything bought for it
create index if not exists purchase_lines_job_idx
  on public.purchase_lines (org_id, sm8_job_uuid)
  where sm8_job_uuid is not null;

-- the docket behind a purchase: its own kind (DocumentKind, files.ts)
alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents add constraint documents_kind_check check (
  kind = any (array[
    'notice_attachment'::text, 'receipt'::text, 'fuel_receipt'::text, 'medical_certificate'::text,
    'licence'::text, 'work_rights'::text, 'org_logo'::text, 'staff_photo'::text, 'project_file'::text,
    'job_file'::text, 'job_document'::text, 'job_photo'::text, 'purchase_invoice'::text,
    'purchase_docket'::text, 'insurance_policy'::text, 'rego_notice'::text, 'green_slip'::text,
    'vehicle_photo'::text, 'finance_agreement'::text, 'org_licence'::text, 'org_insurance'::text,
    'service_record'::text, 'issue_photo'::text, 'other'::text
  ])
);

alter table public.documents
  add column if not exists purchase_id uuid references public.purchases (id) on delete set null;
create index if not exists documents_purchase_idx on public.documents (purchase_id) where purchase_id is not null;

-- RLS deny-all, enforcement app-layer, same as every other table here.
alter table public.purchases enable row level security;
alter table public.purchase_lines enable row level security;
