# Phase 2: Migration Supabase pgvector - Todo

## Implémentation en cours

### Backend Python
- [x] Créer la nouvelle table `speaker_embeddings` dans Supabase (SQL)
- [x] Créer l'index HNSW pour performance
- [x] Créer la fonction SQL `match_speakers(target_embedding)`
- [x] Modifier `get_enrolled_speakers()` pour lire Supabase primaire
- [x] Modifier `match_speakers()` pour utiliser pgvector `<->`
- [x] Modifier `sync_embedding_to_supabase()` pour écrire multi-rows
- [x] Créer script de migration `migrate_to_supabase_primary.py`
- [x] Ajouter la nouvelle Cloud Function

### Frontend TypeScript
- [ ] Vérifier compatibilité (pas de changements attendus)
- [ ] Tests manuels dans l'interface

### Documentation
- [x] Documenter l'architecture post-migration
- [x] Mettre à jour les instructions de déploiement

## Déploiement
- [ ] Pousser les commits sur GitHub (en attente permissions bot)
- [ ] Exécuter le script SQL dans Supabase (supabase_phase2_migration.sql)
- [ ] Déployer les Cloud Functions
- [ ] Exécuter la migration Firestore → Supabase
- [ ] Vérifier les résultats (logs + Supabase)
- [ ] Tests complets du système

## Phase 3 (Future)
- [ ] Dashboard de performance ML
- [ ] Tests de charge
- [ ] Documentation complète