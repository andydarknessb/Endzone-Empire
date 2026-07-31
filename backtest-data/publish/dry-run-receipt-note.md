# About dry-run-receipt.json

This file is copied byte for byte from the Gate-2 extraction's own output
(`backtest-data/snapshot/dry-run-receipt.json`). It proves one thing only:
that the extraction's dry run and the apply that followed it were planned
under the identical configuration digest (`planDigest`) - the same pinned
sources, the same target seasons, the same SQL surface, the same oracle
settings, and the same database and role identity - before a single row was
written.

It does NOT prove that the dry run and the apply captured byte-identical
data. They are two separate transactions against a live database, so their
row counts may legitimately differ between the two; the receipt's
`rowCounts` and `wouldWrite` fields describe what the dry run observed,
not what this publication's chunks contain. That is `manifest.json`'s job,
both the sealed Gate-2 extraction manifest and this publication's own
chunk-level manifest.
