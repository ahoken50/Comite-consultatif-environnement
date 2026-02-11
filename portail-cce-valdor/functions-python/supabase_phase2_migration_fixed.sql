-- ============================================
-- Phase 2: Migration Supabase pgvector (FIXED)
-- Table multi-rows pour embeddings speaker
-- FIX: speaker_id est maintenant nullable
-- ============================================

-- 1. Créer la nouvelle table speaker_embeddings (multi-rows: 1 row = 1 embedding)
-- FIX: speaker_id UUID REFERENCES speakers(id) ON DELETE SET NULL (au lieu de CASCADE et nullable)
DROP TABLE IF EXISTS speaker_embeddings CASCADE;
CREATE TABLE speaker_embeddings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    speaker_name TEXT NOT NULL,
    speaker_id UUID REFERENCES speakers(id) ON DELETE SET NULL,
    embedding vector(768) NOT NULL,
    sample_source TEXT NOT NULL CHECK (sample_source IN ('enrollment', 'correction', 'ml_auto', 'batch_import')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 2. Créer un index HNSW pour la recherche vectorielle ultra-rapide
CREATE INDEX IF NOT EXISTS speaker_embeddings_embedding_idx 
ON speaker_embeddings 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 3. Créer un index composite pour les requêtes par speaker
CREATE INDEX IF NOT EXISTS speaker_embeddings_speaker_name_idx 
ON speaker_embeddings(speaker_name);

-- 4. Créer un index pour filtrer par source
CREATE INDEX IF NOT EXISTS speaker_embeddings_source_idx 
ON speaker_embeddings(sample_source);

-- 5. Créer la fonction match_speakers pour la similarité vectorielle
CREATE OR REPLACE FUNCTION match_speakers(target_embedding vector(768), limit_count INTEGER DEFAULT 10)
RETURNS TABLE (
    speaker_name TEXT,
    speaker_id UUID,
    similarity FLOAT,
    match_count INTEGER,
    avg_similarity FLOAT,
    sample_sources TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        se.speaker_name,
        se.speaker_id,
        (1 - (se.embedding <-> target_embedding))::FLOAT AS similarity,
        COUNT(*) FILTER (WHERE (1 - (se.embedding <-> target_embedding)) > 0.5) AS match_count,
        AVG(1 - (se.embedding <-> target_embedding))::FLOAT AS avg_similarity,
        ARRAY_AGG(DISTINCT se.sample_source) AS sample_sources
    FROM speaker_embeddings se
    WHERE se.embedding <-> target_embedding < 1.0
    GROUP BY se.speaker_name, se.speaker_id
    ORDER BY avg_similarity DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- 6. Créer la fonction pour insérer un embedding (simplifiée - sans contrainte speaker_id)
CREATE OR REPLACE FUNCTION insert_speaker_embedding(
    p_speaker_name TEXT,
    p_embedding vector(768),
    p_sample_source TEXT DEFAULT 'ml_auto',
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
    v_embedding_id UUID;
BEGIN
    -- Insérer l'embedding directement dans speaker_embeddings
    -- speaker_id peut être NULL et sera rempli plus tard si nécessaire
    INSERT INTO speaker_embeddings (speaker_name, speaker_id, embedding, sample_source, metadata)
    VALUES (p_speaker_name, NULL, p_embedding, p_sample_source, p_metadata)
    RETURNING id INTO v_embedding_id;
    
    RETURN v_embedding_id;
END;
$$ LANGUAGE plpgsql;

-- 7. Créer une vue pour les statistiques par speaker
CREATE OR REPLACE VIEW speaker_stats AS
SELECT 
    s.name AS speaker_name,
    s.id AS speaker_id,
    s.role,
    COUNT(se.id) AS total_embeddings,
    COUNT(se.id) FILTER (WHERE se.sample_source = 'enrollment') AS enrollment_count,
    COUNT(se.id) FILTER (WHERE se.sample_source = 'correction') AS correction_count,
    COUNT(se.id) FILTER (WHERE se.sample_source = 'ml_auto') AS ml_auto_count,
    COUNT(se.id) FILTER (WHERE se.sample_source = 'batch_import') AS batch_import_count,
    MIN(se.created_at) AS first_embedding_date,
    MAX(se.created_at) AS last_embedding_date,
    s.created_at AS enrollment_date
FROM speakers s
LEFT JOIN speaker_embeddings se ON s.id = se.speaker_id
GROUP BY s.name, s.id, s.role, s.created_at
ORDER BY s.name;

-- Commentaires de documentation
COMMENT ON TABLE speaker_embeddings IS 'Table multi-rows pour stocker tous les embeddings de voix par speaker (Phase 2 - FIXED: speaker_id nullable)';