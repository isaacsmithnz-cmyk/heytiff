-- The documents bucket must accept a job's office files: the phone's Add,
-- Upload a file.
--
-- WHY. Isaac, 17 November 2026, on the job card's Add: "could choose a PDF
-- just become upload file? I don't want to just lock things to PDFs."
-- lib/documents/files FILE_TYPES lets a job's document be Word, Excel,
-- PowerPoint, RTF, CSV or plain text as well as a PDF; without them here the
-- slot is handed out and storage refuses the bytes (the trap in
-- documents_bucket_avif.sql). This file is the whole list.
--
-- ALREADY APPLIED to prod 2026-11-17.

update storage.buckets
set allowed_mime_types = array[
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/jpeg',
  'video/mp4',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/rtf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]
where id = 'documents';
