# Comment exécuter le script de migration

## Option 1 : Localement (Recommandé - Plus simple)

1. **Ouvrir un terminal** dans le dossier du projet :
   ```bash
   cd "c:\Users\micro\Documents\Comite consultatif environnement\portail-cce-valdor"
   ```

2. **Installer ts-node** (si pas déjà fait) :
   ```bash
   npm install -g ts-node
   ```

3. **Exécuter le script** :
   ```bash
   npx ts-node scripts/migrate-agenda-item-ids.ts
   ```

Le script va :
- Se connecter à Firebase avec vos variables d'environnement locales (`.env.local`)
- Afficher ce qu'il va faire
- Mettre à jour tous les documents
- Afficher un rapport

**Avantages** :
- Pas besoin de GitHub Actions
- Vous voyez les résultats en temps réel
- Plus rapide à tester

---

## Option 2 : Via GitHub Actions

Si vous préférez quand même utiliser GitHub Actions, le problème actuel est que le workflow utilise toujours `npm ci` au lieu de `npm install`.

**Solution** : Créer un `package-lock.json` localement et le commit :
```bash
npm install
git add package-lock.json
git commit -m "Add package-lock.json"
git push
```

Ensuite, le workflow avec `npm ci` fonctionnera.

---

## Quelle option choisir ?

**Recommandation** : Utilisez l'**Option 1 (localement)**. C'est :
- Plus rapide
- Plus simple
- Vous permet de voir les logs en temps réel
- Évite les problèmes de GitHub Actions
