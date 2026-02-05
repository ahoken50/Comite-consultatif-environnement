#!/bin/bash

# Configuration
PROJECT_ID="votre-projet-id" # À remplacer
REGION="us-central1"
REPOSITORY="gcf-artifacts"

echo "Setting up Lifecycle Policy for Artifact Registry to save costs..."

# Define policy JSON
cat > policy.json <<EOF
{
  "rulePriority": 1,
  "description": "Delete images older than 30 days",
  "condition": {
    "tagState": "ANY",
    "olderThan": "30d"
  },
  "action": {
    "type": "DELETE"
  }
}
EOF

# Apply policy (Dry run first recommended manually, but this applies it)
# Requires 'gcloud' CLI installed and authenticated
echo "Applying policy to $REPOSITORY in $REGION..."
gcloud artifacts repositories set-cleanup-policies $REPOSITORY \
  --project=$PROJECT_ID \
  --location=$REGION \
  --policy=policy.json

echo "Done! Old images will be automatically deleted."
rm policy.json
