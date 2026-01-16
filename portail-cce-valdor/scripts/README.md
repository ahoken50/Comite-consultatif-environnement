# Scripts de Migration

## migrate-agenda-item-ids.ts

### Objectif
Met à jour tous les `agendaItemId` des documents pour utiliser le nouveau format stable d'ID.

### Problème résolu
Avant, les IDs des sujets à l'ODJ changeaient à chaque chargement (`patched-{timestamp}-{index}`), cassant les associations avec les documents.

Maintenant, les IDs sont stables (`{meetingId}-item-{index}`), mais les anciens documents doivent être mis à jour.

### Comment exécuter

1. **Installer ts-node** (si pas déjà installé) :
   ```bash
   npm install -g ts-node
   ```

2. **Créer un fichier `.env.local`** à la racine avec vos variables Firebase :
   ```
   VITE_FIREBASE_API_KEY=your_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
   VITE_FIREBASE_PROJECT_ID=your_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   VITE_FIREBASE_APP_ID=your_app_id
   ```

3. **Exécuter le script** :
   ```bash
   ts-node scripts/migrate-agenda-item-ids.ts
   ```

### Ce que fait le script

1. Récupère toutes les assemblées (meetings)
2. Pour chaque assemblée, crée un mapping :
   - Ancien ID : `patched-1766181104638-7`
   - Nouvel ID : `wngV0cVjeS4GeoJ4xLBa-item-7`
3. Récupère tous les documents
4. Met à jour les `agendaItemId` des documents qui correspondent
5. Affiche un rapport détaillé

### Avertissement

⚠️ Ce script modifie directement la base de données. Il est recommandé de :
- Faire une sauvegarde avant
- Tester sur une base de développement d'abord
- Vérifier le rapport avant de confirmer

### Résultat attendu

Après l'exécution :
- Les documents seront associés aux bons sujets de l'ODJ
- Les pièces jointes s'afficheront dans l'interface
- Les liens document ↔ sujet fonctionneront correctement
