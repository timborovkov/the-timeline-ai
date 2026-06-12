# Captured files share document storage

Captured Files should reuse the existing document, version, chunk, blob, and
embedding storage path instead of introducing a parallel file model. The shared
storage keeps extraction, search, citation, and later promotion behavior
consistent, while product semantics distinguish unpromoted captured files from
curated Documents so conversational attachments do not flood the document drive.
Because the product is not yet production-bound, the migration should reshape
the schema directly instead of preserving compatibility shims for the old
"every captured file is a document" model.
