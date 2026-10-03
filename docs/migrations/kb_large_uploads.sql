-- Large documents in the library (Isaac, 2026-09-30): an owner may bring in a
-- whole data book up to 150 MB, twice a month (src/lib/tiff/files.ts,
-- src/lib/tiff/large.ts). The bucket is the third place the ceiling is held,
-- after the drawer and beginKbUpload, so it rises to the large ceiling; the
-- 50 MB everyday limit and the two-a-month count are the app's to enforce.
--
-- The project's global Storage upload limit (Dashboard > Storage > Settings)
-- must be at least this, or storage refuses the bytes before this applies.

update storage.buckets
set file_size_limit = 157286400 -- 150 MB
where id = 'kb';
