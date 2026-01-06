# Python Cloud Functions pour CCE Val-d'Or

## Transcription Whisper

Cette fonction utilise OpenAI Whisper pour transcrire les enregistrements audio des réunions.

### Configuration

Configurer les secrets Firebase :
```bash
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set ANTHROPIC_API_KEY
```

### Déploiement

```bash
cd functions-python
pip install -r requirements.txt
firebase deploy --only functions:transcribeWhisper
```
