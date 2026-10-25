# sportswire-pipeline

Batch jobs for Sports Wire Live: news and match ingestion, AI write-ups, translation, social posting, video sync.
It reads and writes the shared Postgres (Neon) database; the website lives elsewhere.

Do not edit `src/` here. It is copied from the website repo by `scripts/syncPipeline.mjs`; changes made here are overwritten.

Workflows run on GitHub Actions (public repo, free minutes) and are started by an external scheduler via `workflow_dispatch`.
Credentials are repository secrets and variables only; none are stored in this code.
