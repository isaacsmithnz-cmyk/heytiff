-- Fuel dockets become tax records.
--
-- THE PROBLEM. Scanning a fuel receipt already worked — Tiff read the litres,
-- the cost and the servo — but the PHOTO was thrown away the moment the fields
-- were filled, and the two figures the ATO actually wants (the GST, and who
-- you bought from) were never asked for. A vehicle_log was a fleet fact. This
-- turns it into substantiation: a figure with the document behind it.
--
-- NO NEW TABLE. A fuel purchase is already a row — vehicle_logs — and an
-- expense claim is already a row, and both already have a receipt model
-- (documents). A `tax_items` table would be a third copy of facts that live
-- elsewhere, and copies go stale. The Tax & EOFY screen READS the two sources
-- and buckets them by financial year; nothing is written twice.
--
-- APPLY THIS BEFORE MERGING THE PR.

-- ---------------------------------------------------------------------------
-- The receipt itself. A hard column, exactly like documents.expense_claim_id
-- and documents.notice_id — a polymorphic (owner_type, owner_id) pair is a
-- foreign key nothing can enforce, and this table has already chosen twice.
--
-- Nullable because the upload comes FIRST: the file has to be in the bucket to
-- be scanned, and the log row it belongs to doesn't exist until the person
-- presses Save. Between those two moments the document is an orphan with no
-- uploaded_at, which every read already filters out.
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists vehicle_log_id uuid;

create index if not exists documents_vehicle_log_idx
  on public.documents (vehicle_log_id)
  where vehicle_log_id is not null;

-- ---------------------------------------------------------------------------
-- The tax figures, on the log they came off.
-- ---------------------------------------------------------------------------
alter table public.vehicle_logs
  -- Nullable, and never derived. A tax invoice under $82.50 needn't show GST
  -- at all, and plenty of dockets don't — dividing the total by eleven would
  -- be INVENTING a figure that ends up on a BAS. No GST read means no GST
  -- claimed, which is the safe direction.
  add column if not exists gst numeric(10, 2) check (gst >= 0),
  -- The supplier's ABN, as printed. Text, not a number: it is an identifier
  -- with a check digit, it can carry leading zeros, and no arithmetic is ever
  -- done on it. Stored digits-only (11 chars); the display adds the spacing.
  add column if not exists supplier_abn text
    check (supplier_abn is null or supplier_abn ~ '^[0-9]{11}$');

-- Note on the DATE: no column is added. `logged_on` becomes the date on the
-- docket when the scan can read one, because that is genuinely when the fuel
-- was bought — the same date the fuel-economy chips should be spacing fills
-- by, and the one an accountant needs. `created_at` still records when the row
-- was actually entered, so backdating stays visible.

-- The tax screen's read: one org, one financial year, fuel only.
create index if not exists vehicle_logs_fuel_date_idx
  on public.vehicle_logs (org_id, logged_on)
  where kind = 'fuel';
