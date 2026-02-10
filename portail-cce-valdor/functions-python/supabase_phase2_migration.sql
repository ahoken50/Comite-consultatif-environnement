-- ============================================
-- Phase 2: Migration Supabase pgvector
-- Table multi-rows pour embeddings speaker
-- ============================================

-- 1. Créer la nouvelle table speaker_embeddings (multi-rows: 1 row = 1 embedding)
CREATE TABLE IF NOT EXISTS speaker_embeddings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    speaker_name TEXT NOT NULL,
    speaker_id UUID REFERENCES speakers(id) ON DELETE CASCADE,
    embedding vector(768) NOT NULL,  -- Embedding dimension (ajuster selon votre modèle)
    sample_source TEXT NOT NULL CHECK (sample_source IN ('enrollment', 'correction', 'ml_auto', 'batch_import')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb  -- Pour stocker des infos supplémentaires (segment_id, confidence, etc.)
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
DECLARE
    result_record RECORD;
BEGIN
    -- Retourner les speakers avec leurs scores de similarité
    -- Utilise l'opérateur <-> pour la distance cosine (converti en similarité)
    RETURN QUERY
    SELECT 
        se.speaker_name,
        se.speaker_id,
        -- Distance cosine convertie en similarité (0..1)
        (1 - (se.embedding <-> target_embedding))::FLOAT AS similarity,
        -- Nombre d'embeddings qui matchent bien (cosine > 0.5)
        COUNT(*) FILTER (WHERE (1 - (se.embedding <-> target_embedding)) > 0.5) AS match_count,
        -- Similarité moyenne de tous les embeddings du speaker
        AVG(1 - (se.embedding <-> target_embedding))::FLOAT AS avg_similarity,
        -- Sources des embeddings
        ARRAY_AGG(DISTINCT se.sample_source) AS sample_sources
    FROM speaker_embeddings se
    -- Utilise l'index HNSW pour filtrer les candidats
    WHERE se.embedding <-> target_embedding < 1.0  -- Distance < 1.0 (similarity > 0)
    GROUP BY se.speaker_name, se.speaker_id
    ORDER BY avg_similarity DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- 6. Créer la fonction pour insérer un embedding
CREATE OR REPLACE FUNCTION insert_speaker_embedding(
    p_speaker_name TEXT,
    p_embedding vector(768),
    p_sample_source TEXT DEFAULT 'ml_auto',
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
    v_speaker_id UUID;
    v_embedding_id UUID;
BEGIN
    -- Récupérer ou créer le speaker dans la table speakers
    SELECT id INTO v_speaker_id 
    FROM speakers 
    WHERE name = p_speaker_name 
    LIMIT 1;
    
    IF v_speaker_id IS NULL THEN
        -- Créer un nouveau speaker si n'existe pas
        INSERT INTO speakers (name, embedding, created_at)
        VALUES (p_speaker_name, p_embedding, NOW())
        RETURNING id INTO v_speaker_id;
        
        -- Mettre à jour l'embedding principal (centroid sera recalculé plus tard)
        UPDATE speakers 
        SET embedding = p_embedding
        WHERE id = v_speaker_id;
    END IF;
    
    -- Insérer l'embedding dans speaker_embeddings
    INSERT INTO speaker_embeddings (speaker_name, speaker_id, embedding, sample_source, metadata)
    VALUES (p_speaker_name, v_speaker_id, p_embedding, p_sample_source, p_metadata)
    RETURNING id INTO v_embedding_id;
    
    -- Recalculer et mettre à jour le centroid dans la table speakers
    UPDATE speakers s
    SET embedding = (
        SELECT COALESCE(AVG(e.embedding), p_embedding)
        FROM speaker_embeddings e
        WHERE e.speaker_id = s.id
    ),
    updated_at = NOW()
    WHERE s.id = v_speaker_id;
    
    RETURN v_embedding_id;
END;
$$ LANGUAGE plpgsql;

-- 7. Créer la fonction pour nettoyer les embeddings obsolètes
CREATE OR REPLACE FUNCTION cleanup_old_embeddings(p_speaker_name TEXT, keep_latest_n INTEGER DEFAULT 20)
RETURNS INTEGER AS $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    WITH ranked AS (
        SELECT id,
        ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
        FROM speaker_embeddings
        WHERE speaker_name = p_speaker_name
    )
    DELETE FROM speaker_embeddings
    WHERE id IN (SELECT id FROM ranked WHERE rn > keep_latest_n);
    
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 8. Créer une vue pour les statistiques par speaker
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
COMMENT ON TABLE speaker_embeddings IS 'Table multi-rows pour stocker tous les embeddings de voix par speaker (Phase 2)';
COMMENT ON INDEX speaker_embeddings_embedding_idx IS 'Index HNSW pour recherche vectorielle ultra-rapide';
COMMENT ON FUNCTION match_speakers IS 'Recherche les speakers les plus similaires à un embedding donné';
COMMENT ON FUNCTION insert_speaker_embedding IS 'Insère un embedding et met à jour le centroid du speaker';
COMMENT ON FUNCTION cleanup_old_embeddings IS 'Nettoie les anciens embeddings pour garder la taille gérable';
COMMENT ON VIEW speaker_stats IS 'Statistiques détaillées par speaker';