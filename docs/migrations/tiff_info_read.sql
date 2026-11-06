-- THE LITTLE i ON TIFF'S ARROW, read once for the person, on every device
-- (Isaac, 7 November 2026: "Fix all of those", the i that went away per device).
-- Pressed once on the web or the phone, it stays gone on both. Nullable and
-- additive: until it's applied the routes answer "not kept" and each device
-- remembers for itself, as before.
-- Applied 7 November 2026.
alter table public.profiles
  add column if not exists tiff_info_read_at timestamptz;
