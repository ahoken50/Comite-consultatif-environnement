#!/bin/bash

# Configuration
PROJECT_ID="comite-cce" # À vérifier avec 'firebase projects:list'

echo "🔍 Analyse des secrets pour $PROJECT_ID..."

# Liste des secrets
SECRETS=$(gcloud secrets list --project="$PROJECT_ID" --format="value(name)")

for SECRET_FULL_NAME in $SECRETS; do
  SECRET_NAME=$(basename "$SECRET_FULL_NAME")
  echo "------------------------------------------------"
  echo "🔐 Traitement du secret : $SECRET_NAME"
  
  # Récupérer la dernière version active (celle utilisée)
  LATEST_VERSION=$(gcloud secrets versions list "$SECRET_NAME" --project="$PROJECT_ID" --filter="state:ENABLED" --sort-by="~createTime" --limit=1 --format="value(name)")
  
  if [ -z "$LATEST_VERSION" ]; then
    echo "⚠️  Aucune version active trouvée."
    continue
  fi
  
  echo "✅ Version actuelle (à garder) : $LATEST_VERSION"
  
  # Lister les versions ENABLED qui ne sont PAS la dernière
  # Note: On garde seulement la dernière pour être sûr.
  OLD_VERSIONS=$(gcloud secrets versions list "$SECRET_NAME" --project="$PROJECT_ID" --filter="state:ENABLED AND NOT name:$LATEST_VERSION" --format="value(name)")
  
  if [ -z "$OLD_VERSIONS" ]; then
    echo "✨ Aucune vieille version à nettoyer."
  else
    for VERSION in $OLD_VERSIONS; do
       echo "🗑️  Destruction de la version obsolète : $VERSION"
       # DANGER : Décommenter la ligne suivante pour exécuter réellement
       # gcloud secrets versions destroy "$VERSION" --secret="$SECRET_NAME" --project="$PROJECT_ID" --quiet
       echo "   (Simulation) -> gcloud secrets versions destroy $VERSION"
    done
  fi
done

echo "------------------------------------------------"
echo "ℹ️  Ce script est en mode SIMULATION par défaut."
echo "ℹ️  Ouvrez le fichier et décommentez la ligne 'gcloud secrets versions destroy' pour activer."
