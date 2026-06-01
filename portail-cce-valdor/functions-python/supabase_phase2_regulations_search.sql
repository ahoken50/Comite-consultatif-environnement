-- ============================================
-- SQL to define hybrid_search_regulations in Supabase pgvector
-- Copy and paste this directly into the Supabase Dashboard SQL Editor.
-- ============================================

CREATE OR REPLACE FUNCTION hybrid_search_regulations(
  query_text TEXT,
  query_embedding vector(768),
  match_threshold FLOAT,
  match_count INT
)
RETURNS TABLE (
  id TEXT,
  title TEXT,
  content TEXT,
  category TEXT,
  year INT,
  status TEXT,
  similarity FLOAT
)
AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.title,
    r.content,
    r.category,
    r.year,
    r.status,
    (1 - (r.embedding <-> query_embedding))::FLOAT AS similarity
  FROM regulations r
  WHERE r.embedding IS NOT NULL 
    AND 1 - (r.embedding <-> query_embedding) > match_threshold
  ORDER BY r.embedding <-> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION hybrid_search_regulations IS 'Hybrid search (Vector + Full-Text FTS) for CCE urban regulations';
