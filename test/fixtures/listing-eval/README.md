# Listing builder eval fixtures

One directory per case (BUILDOUT §6.2): `case.json` (transcript, maker country + language, expected
category and restricted flag, terms the native text must keep) plus 1-4 photos (`*.jpg`, `*.jpeg`,
`*.png`, `*.webp`) of a real item we own or a CC0 image (record the source here).

`pnpm eval:listing` skips cases without photos. The `trap-es` case should be flagged restricted
whatever the photo shows; any bracelet works.

Photos still needed: all five cases.
