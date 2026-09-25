-- 002: make headings searchable by keyword, weighted above body text.
-- The ingest pipeline stores the chunk's context header ("runbook > Alerts > NimbusUnderReplicated")
-- in metadata.context. Weight A (heading path) vs B (body) lets ts_rank_cd rank a heading match
-- above a passing mention in the body: the same idea as BM25F's per-field boosts.
-- Dropping the column also drops its GIN index; adding a STORED generated column rewrites the table.
ALTER TABLE chunks DROP COLUMN tsv;
ALTER TABLE chunks ADD COLUMN tsv tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(metadata->>'context', '')), 'A') ||
  setweight(to_tsvector('english', content), 'B')
) STORED;
CREATE INDEX chunks_tsv_gin ON chunks USING gin (tsv);
