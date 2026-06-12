# Object relationship proposals use bundle-local refs

Object relationship proposals can depend on endpoint objects that do not exist
yet, such as a single evidence bundle proposing "Create John Doe", "Create Acme",
and "Link John Doe to Acme". We will represent those dependencies with
bundle-local refs in proposal payloads (`localRef` on create-object items and
`fromRef` / `toRef` on relationship items), resolve them only within the same
approval bundle, and apply object creates before relationship items when a
reviewer accepts the whole bundle. This keeps the first relationship slice
proposal-backed and reviewable without inventing placeholder database rows or
silently accepting dependent object creates from a relationship line item.
