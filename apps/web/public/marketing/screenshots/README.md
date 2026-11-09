# Product screenshots

Place the Product Screenshots files named in the website copy plan here, using
the exact filenames (for example `11-timeline-dark.png`). Public slots now also
keep a matching `<stem>-light.png` twin so a later theme-aware component can
swap without recapture.

Marketing pages currently look up each inventory filename and serve that PNG
as-is. If a file is missing, the page shows a labeled placeholder with that
filename so the slot stays easy to swap. `screenshot-inventory.test.ts` also
fails when any referenced public marketing file is absent, so a missing asset
cannot ship as a silent placeholder.

Do not commit customer data. The committed set is from a fictional Acme Labs
`demo:seed` capture (November 2026 numbered citations). Recapture overdue,
dealflow, Ask, and Agent tools slots from a current seed rather than keeping
August/clipped library files. Ask screenshots are stored examples from that
demo. Keep the fictional-example label on every public product shot.

## Recapture

Export the root `.env`, run `bun run db:migrate` and `bun run demo:seed` (or
`bun run dev:seed` when vectors are not needed), start the web app, then:

```bash
bun run capture:marketing-screenshots
```

Desktop shots are 1440×900 at device scale 2 (2880×1800 RGB PNG). Mobile shots
are 390×844 at device scale 2 (780×1688). Both themes are captured in one run
so light/dark pairs share the seed clock, route, framing, and UI state. The
script also copies the dark mobile files onto the unthemed
`53-timeline-mobile.png` / `54-ask-recap-mobile.png` names still referenced by
inventory. Copy the PNGs from `/tmp/marketing-screenshots` into this directory.
Public slots serve the committed PNG bytes unoptimized.
