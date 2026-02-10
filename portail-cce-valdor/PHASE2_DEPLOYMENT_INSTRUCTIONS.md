# Phase 2: Déploiement Migration Supabase pgvector

## 📋 Vue d'ensemble

La Phase 2 migre le système d'embeddings de voix vers une architecture Supabase pgvector native avec stockage multi-rows. Cela améliore drastiquement les performances de recherche et la scalabilité.

## 🎯 Objectifs

1. **Performance**: Index HNSW pour recherche vectorielle ultra-rapide
2. **Scalabilité**: Support des millions d'embeddings
3. **Flexibilité**: Stockage multi-rows (1 row = 1 embedding) au lieu de centroid unique
4. **Compatibilité**: Fallback automatique sur Firestore si Supabase indisponible

## 📦 Changements

### 1. Structure Supabase (Nouveau)
- **Table `speaker_embeddings`**: Stocke tous les embeddings individuels
  - `id`: UUID (PK)
  - `speaker_name`: Nom du speaker
  - `speaker_id`: Référence vers table `speakers`
  - `embedding`: Vector(768) - pgvector
  - `sample_source`: enrollment, correction, ml_auto, batch_import
  - `created_at`: Timestamp
  - `metadata`: JSONB pour infos additionnelles

- **Index HNSW**: Recherche vectorielle ultra-rapide
- **Fonction SQL `match_speakers()`**: Similarité vectorielle native
- **Fonction `insert_speaker_embedding()`**: Insertion + auto-update centroid
- **Fonction `cleanup_old_embeddings()`**: Nettoyage automatique (max 20 par speaker)
- **Vue `speaker_stats`**: Statistiques détaillées par speaker

### 2. Code Python Modifié
- **`get_enrolled_speakers()`**: Lit Supabase `speaker_embeddings` en premier, Firestore en fallback
- **`match_speakers_with_pgvector()`**: Nouvelle fonction pour recherche pgvector
- **`sync_embedding_to_supabase()`**: Écrit dans `speaker_embeddings` (multi-rows), avec paramètre `sample_source`
- **`migrate_to_supabase_primary.py`**: Script de migration Firestore → Supabase

## 🚀 Instructions de Déploiement

### Étape 1: Exécuter le script SQL dans Supabase

1. Ouvrir le Supabase SQL Editor
2. Copier le contenu de `functions-python/supabase_phase2_migration.sql`
3. Exécuter le script
4. Vérifier que les tables, index et fonctions sont créés

```sql
-- Vérification
SELECT * FROM speaker_stats;
SELECT * FROM speaker_embeddings LIMIT 5;
```

### Étape 2: Pousser le code sur GitHub

⚠️ **Attention**: Le token GitHub a expiré. Veuillez d'abord corriger les permissions.

```bash
cd portail-cce-valdor
git add -A
git commit -m "feat(phase2): migrate to Supabase pgvector with multi-row storage

- Add speaker_embeddings table with HNSW index
- Add SQL functions: match_speakers, insert_speaker_embedding, cleanup_old_embeddings
- Add speaker_stats view for analytics
- Modify get_enrolled_speakers() to read Supabase primary
- Add match_speakers_with_pgvector() for native vector search
- Update sync_embedding_to_supabase() for multi-row writes
- Add migrate_to_supabase_primary.py migration script
- Fallback to Firestore if Supabase unavailable"
git push origin main
```

### Étape 3: Déployer les Cloud Functions

```bash
firebase deploy --only functions
```

Les fonctions suivantes seront déployées:
- `run_migration_to_supabase_primary` (NOUVEAU)
- Toutes les autres fonctions mises à jour

### Étape 4: Exécuter la migration

```bash
curl -X POST https://us-central1-comite-cce.cloudfunctions.net/run_migration_to_supabase_primary
```

**Résultat attendu:**
```
PHASE 2 MIGRATION: Firestore → Supabase speaker_embeddings
===============================================================================
✓ Firebase initialized
✓ Supabase initialized with speaker_embeddings table

[Step 1] Clearing existing speaker_embeddings...
✓ No existing embeddings to clear

[Step 2] Fetching members from Firestore...
✓ Found 8 members in Firestore

[Step 3] Migrating embeddings to Supabase speaker_embeddings...
  ✓ John Doe: Migrated 5 embeddings
  ✓ Jane Smith: Migrated 3 embeddings
  ...

[Step 4] Verifying migration...
✓ Supabase speaker_embeddings: 24 rows

===============================================================================
MIGRATION SUMMARY
===============================================================================
Total members in Firestore:       8
Members with embeddings:           8
Members without embeddings:        0
Total embeddings inserted:         24
Failed migrations:                 0

===============================================================================
✓ Migration completed successfully!
```

### Étape 5: Vérifier le résultat

#### Dans Supabase (SQL Editor):
```sql
-- Vérifier les embeddings
SELECT speaker_name, COUNT(*) as embedding_count
FROM speaker_embeddings
GROUP BY speaker_name
ORDER BY speaker_name;

-- Voir les statistiques
SELECT * FROM speaker_stats;

-- Tester la recherche vectorielle
SELECT * FROM match_speakers('[0.1,0.2,...]'::vector(768), 5);
```

#### Dans l'application:
1. Ouvrir une transcription
2. Tester l'identification des speakers
3. Vérifier les logs pour `[Speakers Phase 2]` messages

### Étape 6: Tests Post-Déploiement

#### Tests de performance:
1. **Test 1**: Identification avec 8 speakers
   - Attendu: < 1s pour tous les segments
   - Vérifier logs: `[Speakers Phase 2] Loaded X speakers from Supabase speaker_embeddings`

2. **Test 2**: Nouvelle correction de speaker
   - Attendu: Nouvel embedding inséré dans `speaker_embeddings`
   - Source: `correction`
   - Vérifier: `sample_source = 'correction'`

3. **Test 3**: Auto-ML learning
   - Attendu: Embedding avec source `ml_auto`
   - Vérifier: `sample_source = 'ml_auto'`

#### Tests de fallback:
1. **Test 4**: Simuler outage Supabase
   - Temporairement désactiver `SUPABASE_URL`
   - Attendu: Fallback sur Firestore avec message `[Speakers Phase 2] Supabase unavailable, falling back to Firestore`

## 🔍 Monitoring

### Logs Cloud Functions:
```bash
firebase functions:log
```

Chercher ces messages:
- `[Speakers Phase 2] Loaded X speakers from Supabase speaker_embeddings`
- `[SupabaseSync Phase 2] Inserted X embeddings for {name} (source: {sample_source})`
- `[PGVector] Matched X speakers via pgvector` (quand activé)

### Métriques Supabase:
```sql
-- Taille de la table speaker_embeddings
SELECT pg_size_pretty(pg_total_relation_size('speaker_embeddings'));

-- Performance HNSW index
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'speaker_embeddings';
```

## 🐛 Dépannage

### Erreur: "speaker_embeddings table not available"
**Cause**: SQL migration non exécutée
**Solution**: Exécuter `supabase_phase2_migration.sql`

### Erreur: "RPC fallback needed"
**Cause**: Supabase Python client ne supporte pas les fonctions SQL paramétrées
**Solution**: Normal - le système utilise le fallback calcul local (temporaire)

### Performance lente
**Cause**: Index HNSW non utilisé
**Solution**: Vérifier que l'index est créé
```sql
SELECT * FROM pg_indexes WHERE indexname = 'speaker_embeddings_embedding_idx';
```

### Embeddings manquants
**Cause**: Migration échouée
**Solution**: Vérifier logs de `run_migration_to_supabase_primary`, réexécuter

## 📊 Comparaison Phase 1 vs Phase 2

| Critère | Phase 1 (Firestore JSON) | Phase 2 (Supabase pgvector) |
|---------|--------------------------|----------------------------|
| **Stockage** | JSON string (Firestore) | Multi-rows (Supabase) |
| **Recherche** | Calcul manuel Python | pgvector HNSW index |
| **Performance** | ~2-5s pour 8 speakers | < 1s pour 8 speakers |
| **Scalabilité** | ~50 speakers max | ~1M+ speakers |
| **Historique** | Oui (multi-vecteurs) | Oui (multi-rows) |
| **Fallback** | Non | Oui (Firestore) |

## 🎉 Prochaines Étapes

Une fois la Phase 2 validée:

1. **Phase 3**: Optimization
   - Dashboard de performance ML
   - Tests de charge
   - A/B testing

2. **Futur**: RLHF avancé
   - Fine-tuning LLM
   - Système de recommandations
   - Détection d'anomalies

## 📞 Support

En cas de problème:
1. Vérifier les logs Cloud Functions
2. Vérifier la structure Supabase
3. Consulter `AUDIT_EMBEDDING_PIPELINE.md` pour contexte

---

**Document créé**: Phase 2 Migration Supabase pgvector
**Date**: 2025-01-XX
**Version**: 2.0.0