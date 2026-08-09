/* WHICH LANGUAGE, AND WHO IS IT FOR — the one rule, in one place.

   Speech is transcribed in whatever language it was spoken and never
   translated on the way in, so the app now receives Vietnamese, Mandarin,
   Arabic, Spanish and Tagalog as readily as English. That splits every model
   call in the app into two kinds, and they want OPPOSITE answers:

     · TALKING TO ONE PERSON — an answer on their phone, read once, by them.
       That should arrive in the language they asked in. A tech who asks in
       Vietnamese and is answered in English has been handed a translation
       job while standing in front of the equipment.

     · WRITING INTO THE WORKSPACE — a task, a flag, a bullet on a job, an
       entry in the library. That is read by the WHOLE CREW, weeks later,
       usually by somebody who was not there and does not speak the language
       it was spoken in. A task titled in Tagalog is invisible to the four
       people who could have done it.

   So: reply in kind, record in English. The same conversation can do both,
   and the two rules below are what say so.

   NOTHING IS LOST BY RECORDING IN ENGLISH. The note row keeps the raw
   transcript word for word (`workboard-notes.ts` writes `transcript` before
   the router is ever called), so the person's own words survive underneath
   whatever the crew reads on the board.

   WHERE THIS DOES NOT APPLY: search internals. `tiff/keywords.ts` tags a
   document with the words someone would type to find it and `query-prep.ts`
   expands a question into the terms a manual would contain — both must match
   the DOCUMENT's language, not this one, or the index stops finding the page.

   AND THE KB's `to_tsvector('english', …)` IS NOT A BUG — measured against
   prod on 2026-08-09, because reading the word "english" in the DDL invites
   exactly one wrong conclusion. Postgres tokenises the document and the query
   with the SAME configuration, so a Spanish, Vietnamese, Arabic or Tagalog
   phrase finds itself: the English snowball stemmer leaves those words alone,
   and the stopwords it drops it drops from both sides. What it costs is
   stemming FAMILIES in another language ("cambió" doesn't reach "cambiar") —
   and the Spanish configuration doesn't relate those two either. Switching to
   'simple' would be a straight regression: "short cycling" stops matching
   "short cycle", which is the search this library exists for. The one language
   genuinely broken is Chinese, and it is broken identically under every
   configuration Supabase offers — no segmenter, so a whole run of Han is one
   token. That is a segmenter problem, not a language-configuration one, and
   the vector leg (voyage-4, multilingual) is what carries it meanwhile.

   WHY A CONSTANT RATHER THAN A SETTING. One business, one language on the
   board — and a settings row would not actually buy the guarantee it looks
   like it buys, because what keeps another language out of the records is
   this instruction, not a value in a table. Keeping it here means the
   instruction is written once, tested once, and the day a second workspace
   genuinely needs a different one, `RECORD_LANGUAGE` is where it plugs in. */

/** The language every stored record is written in. */
export const RECORD_LANGUAGE = "Australian English";

/** For a model that is ANSWERING somebody.

    NAMES NO LANGUAGE, and that is the whole lesson of this constant. The
    first version said "Vietnamese question, Vietnamese answer" as an
    illustration, and on 2026-08-09 a tech typed "u4 fault daikin vrv" into
    the library and got a page of Vietnamese back. The query is a fault code,
    a brand and a product line — it carries no language to mirror, so the
    only language the prompt named became the default. An example in a rule
    about language IS the rule. */
export const REPLY_IN_KIND = [
  `Answer in ${RECORD_LANGUAGE}, unless the question itself is clearly`,
  "written in another language — then answer in that one, and keep answering",
  "in it while they keep asking in it.",
  "",
  "A question made of codes, model numbers and brand names carries no",
  "language of its own: it is the commonest question this trade asks, it is",
  "not a request for anything but English, and it is never evidence for a",
  "language you have not actually been written to in.",
  "",
  "Australian practice does not change with the language: metric units,",
  "AS/NZS wiring rules, the refrigerants used here. Model numbers, fault",
  "codes and product names are written exactly as the manufacturer writes",
  "them, whatever the answer around them is written in.",
].join("\n");

/** For a model that is WRITING A RECORD other people will read. */
export const RECORD_IN_ENGLISH = [
  `Everything you write here is READ BY THE WHOLE CREW, so write it in ${RECORD_LANGUAGE}`,
  "even when the note was spoken in another language — titles, details,",
  "bullets, entries, summaries, the clarifying question. Translate what they",
  "meant; never leave a record half in each language, and never transliterate",
  "a phrase you could translate.",
  "",
  "Four things are NOT translated, because they are labels rather than",
  "language: a person's name (write it exactly as the note said it — the app",
  "matches it against the roster), a client or site name, model numbers and",
  "fault codes, and a figure with its unit.",
].join("\n");
