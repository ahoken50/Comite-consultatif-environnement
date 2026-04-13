import sys

path = 'portail-cce-valdor/functions-python/ai_agents/webhooks.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'from ai_agents.transcription import format_speechmatics_output, format_timestamp, clean_hallucinations, build_context_prompt\n',
    'from ai_agents.transcription import format_speechmatics_output, format_timestamp, clean_hallucinations, build_context_prompt, submit_speechmatics_job\n'
)

content = content.replace(
    '        try:\n            print(f"[Speaker ID] Starting identification for meeting {meeting_id}")',
    '        speaker_mapping = {}\n        warnings = {}\n        unidentified = []\n        try:\n            print(f"[Speaker ID] Starting identification for meeting {meeting_id}")'
)

content = content.replace(
    'speaker_mapping = {}  # {"S0": "Michaël Ross", ...}',
    '# speaker_mapping already initialized at top'
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('Done!')
