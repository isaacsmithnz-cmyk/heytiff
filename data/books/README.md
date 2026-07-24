# Data books — the ingestion inbox

Drop manufacturer data books (PDFs) here before an extraction pass. **Everything
in this folder except this README is gitignored**: the books are ingestion
sources, never redistributed, and only the *facts* extracted from them are
committed (as pack JSON under `../packs/`). See the data-usage rules in
`docs/universal-table-schema.md`.

Name files so provenance is unambiguous, because every extracted row has to
cite the book it came from:

```
<brand>-<range>-<edition>.pdf
mitsubishi-city-multi-MEES21K029.pdf
daikin-alira-x-2025.pdf
```

Record where each book came from (public download vs dealer portal) in the
pack's `meta.json` `sources[]`, along with its edition code — the extraction
brief in `../packs/AGENTS.md` explains the rest.
