# Migration Automatique Phase 2 - Documentation

## 🎯 Vue d'ensemble

La migration automatique Phase 2 s'exécute de manière transparente lors du premier appel aux Cloud Functions, sans intervention manuelle requise.

## 🔄 Comment ça marche ?

### Détection automatique

Lorsque la fonction `get_enrolled_speakers()` est appelée:

1. **Vérifie si Supabase Phase 2 est prêt**
   - Teste si la table `speaker_embeddings` existe
   - Si non, tente une migration automatique

2. **Exécute la migration automatiquement**
   - Appelle `ensure_migration_completed()`
   - Migre tous les embeddings Firestore → Supabase
   - Marque la migration comme complétée dans Firestore

3. **Charge les speakers depuis Supabase**
   - Utilise la nouvelle structure multi-rows
   - Fallback sur Firestore si Supabase indisponible

### Flags de migration

La migration est trackée dans Firestore:
```json
{
  "collection": "system_config",
  "document": "migration_status",
  "data": {
    "phase2_migration_completed": true,
    "phase2_migration_timestamp": "2025-01-XXT12:34:56.789Z",
    "updated_at": "2025-01-XXT12:34:56.789Z"
  }
}
```

## 🚀 Scénarios de Déploiement

### Scénario 1: Déploiement avec SQL déjà exécuté ✅ RECOMMANDÉ

```bash
# 1. Exécuter le script SQL dans Supabase
# Ouvrir Supabase SQL Editor
# Exécuter: functions-python/supabase_phase2_migration.sql

# 2. Déployer les Cloud Functions
firebase deploy --only functions

# 3. La migration s'exécutera automatiquement lors du premier appel
# Aucune action manuelle requise!
```

### Scénario 2: Déploiement sans SQL (migration automatique)

```bash
# 1. Déployer les Cloud Functions
firebase deploy --only functions

# 2. La première fois que vous utilisez l'application:
# - La migration automatique détectera que Phase 2 n'est pas prêt
# - Exécutera le script SQL via Supabase client
# - Migra les embeddings Firestore → Supabase
# - Marquera la migration comme complétée

# ⚠️ Note: Le script SQL doit être exécuté manuellement dans Supabase
# La migration automatique ne peut PAS créer les tables SQL
```

## 🛠️ Endpoints de Contrôle

### Vérifier le statut de migration

```bash
curl https://us-central1-comite-cce.cloudfunctions.net/api_get_migration_status
```

**Réponse:**
```json
{
  "success": true,
  "status": {
    "migration_completed": false,
    "migration_timestamp": null,
    "supabase_ready": true,
    "firestore_migration_flag": false
  },
  "timestamp": "2025-01-XXT12:34:56.789Z"
}
```

### Déclencher la migration manuellement

```bash
curl -X POST https://us-central1-comite-cce.cloudfunctions.net/trigger_manual_migration
```

**Réponse:**
```json
{
  "success": true,
  "message": "Migration completed successfully",
  "migration_stats": {
    "total_embeddings": 24
  },
  "timestamp": "2025-01-XXT12:34:56.789Z"
}
```

### Réinitialiser le flag de migration (pour tests)

⚠️ **ATTENTION**: Cela permet de ré-exécuter la migration

```bash
curl -X POST https://us-central1-comite-cce.valdor.cloudfunctions.net/reset_migration_flag
```

## 📊 Workflow de Migration

```
┌─────────────────────────────────────────────────────────────┐
│  Déploiement Cloud Functions                                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Premier appel à get_enrolled_speakers()                     │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
              ┌───────────┴───────────┐
              │ speaker_embeddings    │
              │ existe-t-elle ?       │
              └───────────┬───────────┘
                    ┌──────┴──────┐
                    │             │
                   NON           OUI
                    │             │
                    ▼             ▼
        ┌──────────────────┐   ┌─────────────────┐
        │ Migration auto   │   │ Charger depuis  │
        │ (si SQL déployé) │   │ Supabase        │
        └────────┬─────────┘   └─────────────────┘
                 │
                 ▼
        ┌──────────────────┐
        │ Marquer flag     │
        │ completed = true │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │ Charger depuis   │
        │ Supabase         │
        └──────────────────┘
```

## 🔍 Logs à surveiller

### Migration automatique réussie
```
[Speakers Phase 2] Supabase Phase 2 tables not found
[Speakers Phase 2] Attempting auto-migration...
[AutoMigration] Migration not completed yet, starting...
PHASE 2 MIGRATION: Firestore → Supabase speaker_embeddings
...
✓ Migration completed successfully!
[AutoMigration] Automatic migration completed successfully
[Speakers Phase 2] Auto-migration successful, reloading...
[Speakers Phase 2] Loaded 8 speakers from Supabase speaker_embeddings
```

### Phase 2 déjà déployé
```
[Speakers Phase 2] Loaded 8 speakers from Supabase speaker_embeddings
```

### Fallback sur Firestore
```
[Speakers Phase 2] Supabase error (will fallback to Firestore): ...
[Speakers Phase 2] Supabase unavailable, falling back to Firestore
[Speakers Phase 2] Loaded 8 speakers from Firestore (fallback)
```

## 🐛 Dépannage

### Problème: "Migration not completed, function may not work correctly"

**Cause**: Migration automatique a échoué

**Solution 1**: Vérifier que le script SQL a été exécuté
```sql
SELECT * FROM speaker_stats;
```

**Solution 2**: Déclencher la migration manuellement
```bash
curl -X POST https://us-central1-comite-cce.cloudfunctions.net/trigger_manual_migration
```

**Solution 3**: Vérifier les logs Cloud Functions
```bash
firebase functions:log
```

### Problème: "speaker_embeddings table not found"

**Cause**: Script SQL non exécuté dans Supabase

**Solution**: Exécuter `supabase_phase2_migration.sql` dans Supabase SQL Editor

### Problème: Migration automatique ne s'exécute pas

**Cause**: Flag déjà marqué comme complété

**Solution**: Réinitialiser le flag
```bash
curl -X POST https://us-central1-comite-cce.cloudfunctions.net/reset_migration_flag
curl -X POST https://us-central1-comite-cce.cloudfunctions.net/trigger_manual_migration
```

## ✅ Checklist de déploiement

- [ ] Exécuter `supabase_phase2_migration.sql` dans Supabase SQL Editor
- [ ] Déployer les Cloud Functions: `firebase deploy --only functions`
- [ ] Vérifier le statut: `curl .../get_migration_status`
- [ ] Tester l'identification des speakers dans l'application
- [ ] Vérifier les logs pour `[Speakers Phase 2]`
- [ ] Confirmer que les embeddings sont dans Supabase: `SELECT * FROM speaker_stats`

## 📞 Support

En cas de problème:
1. Vérifier `get_migration_status` endpoint
2. Consulter les logs Cloud Functions
3. Vérifier que le script SQL a été exécuté
4. Réinitialiser et relancer si nécessaire

---

**Document créé**: Migration Automatique Phase 2
**Version**: 2.1.0
**Date**: 2025-01-XX