# Voice bake-off

Picks the speech-to-text vendor for Smart Notes **on your audio**, not on a
leaderboard. Run it before the feature is built, and again any time a new model
claims the crown.

```bash
npm run bakeoff
```

Needs `ELEVENLABS_API_KEY` in the environment and at least one case below.
Without either it prints what's missing and exits green.

## Why this exists

The published benchmarks rank models on voice-agent clips, European parliament
recordings and corporate earnings calls. None of that is a tech in a van with
the engine running, saying an Australian street name and a job number. The
leaderboard picks the shortlist; this picks the vendor.

It also scores the right thing. **`routed` is the headline number** — every hard
expectation met, so the note needed no human rescue. A transcript that mangles
"condensate" but still lands on job 337 assigned to Luke routes perfectly. One
that's 98% word-perfect but hears "Wyndham" as "Windham" files work against the
wrong site. Word error rate averages those two together and tells you nothing;
it's reported for comparison with published figures, and it is not the verdict.

## Collecting the recordings

Aim for **25–30**, from real techs in real conditions. Deliberately include the
hard stuff, because the easy stuff already works:

- engine running, windows down, on the road
- a roof with wind, a plant room with a compressor two metres away
- a customer or a radio talking in the background
- street names, staff first names, job numbers read aloud, model strings
- at least a few in every language your crew actually speaks

Record them the way the app will: phone held normally, one take, no re-dos. A
tidy studio recording proves nothing.

## Writing a case

Drop the audio in `audio/` and a JSON file next to it in `cases/`. The filename
becomes the case id.

`cases/van-01.json`:

```json
{
  "audio": "van-01.m4a",
  "conditions": "van idling, windows down, driving",
  "speaker": "Luke",
  "language": "en",
  "truth": "Finished the two upstairs heads at 36 Wyndham Street, condensate line's still to run, Luke needs to order three 600 grills by Friday for job 337.",
  "expect": {
    "job": "337",
    "site": "36 Wyndham Street",
    "people": ["Luke"],
    "terms": ["condensate", "grills"]
  }
}
```

- **`truth`** — type out what was actually said, word for word. Do this once;
  it's permanent, and it's what makes re-testing a future vendor an afternoon
  instead of a re-record.
- **`expect.job` / `site` / `people`** are **hard** — they drive routing, and
  missing one fails the case.
- **`expect.terms`** are **soft** — reported, never fatal.
- Every case needs at least one hard expectation. Spoken numbers are handled:
  write `"337"` whether it was said as "three three seven" or "three hundred and
  thirty seven".
- **Every expectation must actually appear in `truth`**, and the parser refuses
  the case if it doesn't. An expectation that isn't in the audio fails every
  vendor for a reason that has nothing to do with the vendor — which reads as
  evidence and isn't. The usual slip is naming the person who *recorded* the
  note under `people`; if they never said their own name, that's `speaker`.

## The vocabulary file

`vocab.json` holds the keyterm pools — the words the transcriber is biased
toward. Pools are filled in priority order (`people`, `sites`, `clients`,
`equipment`, `vocab`) up to the cap.

```json
{
  "people": ["Luke", "Mick", "Dave"],
  "sites": ["Wyndham Street", "Papakura", "Karaka"],
  "clients": ["Harrison", "Smith and Sons"],
  "equipment": ["PUMY-SP112", "Bosch 5000"],
  "vocab": ["condensate", "penetrations", "grilles", "commissioning"]
}
```

**These must be your real lists** — every tech, every client, every street — not
the words that appear in the recordings. Seeding a case's own answers as
keyterms measures nothing except your ability to write down what you already
know, and the harness throws if it spots it.

> **The cap is 100 terms and that's a real constraint.** ElevenLabs' own docs
> disagree with themselves — the capabilities overview says 1,000 for batch, the
> API reference and their skills repo both say 100. We default to 100. If a run
> with `max` raised doesn't 422, the overview was right and the production
> keyterm builder can be much less fussy about what it sends.

## Reading the output

Failures print first, each with what was heard instead. Real output, from three
synthetic cases:

```
── scribe_v2 · bare ──
  FAILED van-01             WER   3.7% · terms 2/2  [Luke · van idling, windows down]
           ✗ wyndham street → "windermere street" (0.65)
  ROUTED roof-02            WER   0.0% · terms 1/1  [Mick · roof, wind]
  ROUTED plant-03           WER  20.0% · terms 0/2  [Dave · plant room, compressor]
           · PUMY-SP112 → "pumice p112" (0.64)
           · manometer → "barometer" (0.78)

═══ SCORECARD ═══

  scribe_v2 · bare          routed   2/3   (66.7%)  hard 9/10   soft 3/5  mean WER 7.9%
  scribe_v2 · 47 keyterms   routed   3/3  (100.0%)  hard 10/10  soft 5/5  mean WER 0.0%
```

Look at `van-01`: **3.7% word error rate and it still failed.** One street name
out of thirty words, and the note would have filed against the wrong site. Then
look at `plant-03`: 20% WER, two mangled trade terms, and it routed perfectly —
a tech fixes "barometer" on the review card in a second. That inversion is the
entire reason this harness exists and the reason WER is the small number on the
right rather than the verdict.

Two configurations run every time — bare and with keyterms — because the gap
between them is the measurement that matters most: it tells you how much of your
accuracy is bought by feeding it your own vocabulary, which is the one lever the
product actually controls.

Every run is written to `results/` with the full transcripts, so a surprising
score can be read rather than guessed at.

## What isn't committed

Recordings are real voices; case files carry client names and site addresses.
The harness is committed, the evidence never is — `audio/`, `cases/`,
`vocab.json` and `results/` are all gitignored. Keep them somewhere shared and
private, and keep them forever: they are the asset, not the harness.
