-- ============================================
-- SQL Migration: Supabase Phase 2 RLS Policies
-- Allow public select on speakers and speaker_embeddings tables
-- ============================================

-- 1. Enable RLS on speaker_embeddings
ALTER TABLE speaker_embeddings ENABLE ROW LEVEL SECURITY;

-- 2. Create public SELECT policy for speaker_embeddings
DROP POLICY IF EXISTS "Allow public select on speaker_embeddings" ON speaker_embeddings;
CREATE POLICY "Allow public select on speaker_embeddings" 
ON speaker_embeddings FOR SELECT 
TO anon, authenticated
USING (true);

-- 3. Enable RLS on speakers
ALTER TABLE speakers ENABLE ROW LEVEL SECURITY;

-- 4. Create public SELECT policy for speakers
DROP POLICY IF EXISTS "Allow public select on speakers" ON speakers;
CREATE POLICY "Allow public select on speakers" 
ON speakers FOR SELECT 
TO anon, authenticated
USING (true);

COMMENT ON POLICY "Allow public select on speaker_embeddings" ON speaker_embeddings IS 'Permet à l''application frontend de lire les empreintes vocales pour afficher la qualité sur le dashboard';
COMMENT ON POLICY "Allow public select on speakers" ON speakers IS 'Permet à l''application frontend de lire la liste des locuteurs enregistrés';
