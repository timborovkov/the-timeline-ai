# Product screenshots

Marketing pages reference exact filenames; `screenshot-inventory.test.ts` checks that the referenced assets exist. Keep captions and filenames aligned with the current UI.

Capture from the verified fictional [demo corpus](../../../../../docs/demo-corpus.md), never customer data. Keep the fictional-example label on public examples. Recapture affected views when UI/citation behavior changes rather than treating an old image as evidence of current behavior.

## Recapture

Capture matching `<stem>-light.png` and `<stem>-dark.png` files from the same
fictional seed and framing. Inventory tests require both variants for each public
slot. [Public design](../../../../../docs/design/public.md) owns theme selection,
loading frames and presentation.

Export the root `.env`, run `bun run db:migrate` and `bun run demo:seed`, start
the web app, then run `bun run capture:marketing-screenshots`.
Desktop shots are 1440×900 at device scale 2 (2880×1800 PNG); mobile shots are
390×844 at device scale 2 (780×1688 PNG). Both themes are captured in one run. Timeline readiness uses a loaded moment,
so a persisted seed clock does not need to fall on today’s date.
Copy the PNGs from `/tmp/marketing-screenshots` into this directory. The script
also copies dark mobile images to the existing unthemed filenames.
