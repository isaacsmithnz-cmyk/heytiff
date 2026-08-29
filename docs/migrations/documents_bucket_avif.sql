-- The documents bucket must accept AVIF.
--
-- WHY. `PHOTO_EXTS` in lib/workboard/job-media.ts has admitted `.avif` since
-- the release that found Chrome renders it fine — so `isCacheableMedia` says
-- yes, the download succeeds, and then storage rejects the upload because
-- `image/avif` was never added to the bucket's allowlist. 399 live
-- attachments are `.avif`; nine of them are on job #907 alone.
--
-- The rejection was reported to the user as "Storage is full" (every upload
-- failure printed that, and nothing was logged), which sent Isaac to Supabase
-- to look at a disk holding 588MB across three buckets. The code half of that
-- is fixed alongside this — `storageNote` now reads the actual error, and the
-- uploader hands storage the mime type OUR extension implies rather than the
-- CDN's header, which is absent often enough to matter.
--
-- ALREADY APPLIED to prod 2026-08-29. Kept here because a bucket's allowlist
-- is schema: a rebuilt project without this line silently drops 399 photos.

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/gif',
  'image/avif',
  'application/pdf'
]
where id = 'documents';
