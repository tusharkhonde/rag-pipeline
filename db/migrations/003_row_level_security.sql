-- 003: Row-Level Security as defense in depth for tenant isolation.
--
-- The repository layer already filters every query by client. RLS makes the database enforce
-- it too, so a forgotten WHERE clause (or a SQL injection) still can't read another tenant's rows.
--
-- How it's wired:
--  * rag_app is a NOLOGIN, least-privilege role. Tenant-scoped transactions switch to it with
--    SET LOCAL ROLE rag_app and set app.client_id (see services/api/src/db/tenant.ts). The
--    connecting user is a superuser, and superusers always bypass RLS: that's why we switch role.
--  * rag_app has no privileges on `clients`, so tenant code can't even read credential hashes.
--  * If app.client_id is unset, the policies compare against NULL and match nothing (fail closed).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rag_app') THEN
    CREATE ROLE rag_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO rag_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON collections, documents, chunks TO rag_app;

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks      ENABLE ROW LEVEL SECURITY;

-- NULLIF: after a SET LOCAL ends, the setting reads as '' (not NULL) for the rest of the session.
CREATE POLICY tenant_isolation ON collections
  USING      (client_id = NULLIF(current_setting('app.client_id', true), '')::uuid)
  WITH CHECK (client_id = NULLIF(current_setting('app.client_id', true), '')::uuid);

-- The subquery on collections is itself filtered by the policy above, so these policies
-- follow ownership through the collection without duplicating client_id on every table.
CREATE POLICY tenant_isolation ON documents
  USING      (collection_id IN (SELECT id FROM collections))
  WITH CHECK (collection_id IN (SELECT id FROM collections));

CREATE POLICY tenant_isolation ON chunks
  USING      (collection_id IN (SELECT id FROM collections))
  WITH CHECK (collection_id IN (SELECT id FROM collections));
