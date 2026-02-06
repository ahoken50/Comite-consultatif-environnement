"""
Speaker Identification Module - Multi-Strategy System

Combines 5 strategies to identify speakers in transcriptions:
1. Voice Embedding (50%) - PyAnnote via Modal
2. Contextual AI (25%) - GROQ analysis
3. Linguistic Patterns (10%) - Role-based keywords
4. Name Mentions (10%) - "Merci Michaël" detection
5. Auto-Identification (5%) - "Je suis X" detection
"""

import os
import re
import requests
import math
from typing import Dict, List, Optional, Tuple

# Linguistic patterns for role detection
# NOTE: "J'ouvre la séance" = Secrétaire (not Président)
LINGUISTIC_PATTERNS = {
    "secrétaire": [
        r"j'ouvre la séance",
        r"la séance est ouverte",
        r"je déclare la séance ouverte",
        r"nous avons le quorum",
    ],
    "président": [
        r"en tant que président",
        r"monsieur le président.*je",  
        r"à titre de président",
    ],
    "proposeur": [
        r"je propose",
        r"je fait la proposition",
        r"je suggère que nous",
    ],
    "secondeur": [
        r"j'appuie",
        r"je seconde",
        r"je soutiens la proposition",
    ],
}

# Name mention patterns
NAME_MENTION_PATTERNS = [
    r"merci\s+(\w+)",
    r"monsieur\s+(\w+)",
    r"madame\s+(\w+)",
    r"la parole à\s+(\w+)",
    r"(\w+)\s+a la parole",
]

# Auto-identification patterns
AUTO_ID_PATTERNS = [
    r"je\s+suis\s+(\w+)",
    r"ici\s+(\w+)",
    r"c'est\s+(\w+)\s+qui\s+parle",
    r"(\w+)\s+à\s+l'appareil",
]


def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Calculate cosine similarity between two vectors (pure Python, no numpy)."""
    if len(a) != len(b):
        return 0.0
    
    dot_product = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    
    if norm_a == 0 or norm_b == 0:
        return 0.0
    
    return dot_product / (norm_a * norm_b)


async def voice_embedding_strategy(
    audio_segment_url: str,
    known_speakers: List[Dict],
    modal_endpoint: str
) -> Dict[str, float]:
    """
    Strategy 1: Voice Embedding (50% weight)
    Compare audio segment with known speaker embeddings.
    """
    try:
        # Call Modal to generate embedding for the segment
        response = requests.post(
            modal_endpoint,
            json={"url": audio_segment_url},
            timeout=120
        )
        
        if not response.ok:
            print(f"[VoiceEmbed] Modal error: {response.status_code}")
            return {}
        
        segment_embedding = response.json()
        
        # Compare with all known speakers
        scores = {}
        for speaker in known_speakers:
            if speaker.get("embedding"):
                similarity = cosine_similarity(segment_embedding, speaker["embedding"])
                # Convert similarity (-1 to 1) to score (0 to 1)
                scores[speaker["name"]] = (similarity + 1) / 2
        
        return scores
        
    except Exception as e:
        print(f"[VoiceEmbed] Error: {e}")
        return {}


def contextual_ai_strategy(
    transcript_segment: str,
    meeting_context: Dict,
    known_members: List[str]
) -> Dict[str, float]:
    """
    Strategy 2: Contextual AI Analysis (25% weight)
    Use GROQ to analyze who might be speaking based on content.
    """
    try:
        groq_api_key = os.environ.get("GROQ_API_KEY")
        if not groq_api_key:
            print("[ContextAI] GROQ_API_KEY not configured")
            return {}
        
        # Build prompt
        prompt = f"""Analyse ce segment de transcription d'une réunion du Comité Consultatif en Environnement.

Contexte de la réunion:
- Type: {meeting_context.get('type', 'Régulière')}
- Membres présents: {', '.join(known_members)}

Segment à analyser:
"{transcript_segment}"

Basé sur le contenu, le ton et le contexte, estime qui parle parmi les membres présents.
Retourne un JSON avec les probabilités pour chaque membre. Exemple:
{{"Jean Dupont": 0.7, "Marie Martin": 0.2}}

Retourne UNIQUEMENT le JSON, sans explication."""

        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {groq_api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "llama-3.1-8b-instant",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
                "max_tokens": 200
            },
            timeout=30
        )
        
        if not response.ok:
            print(f"[ContextAI] GROQ error: {response.status_code}")
            return {}
        
        result = response.json()
        content = result["choices"][0]["message"]["content"]
        
        # Parse JSON from response
        import json
        scores = json.loads(content)
        return scores
        
    except Exception as e:
        print(f"[ContextAI] Error: {e}")
        return {}


def linguistic_pattern_strategy(
    transcript_segment: str,
    known_members: List[Dict]
) -> Dict[str, float]:
    """
    Strategy 3: Linguistic Patterns (10% weight)
    Detect role-based patterns like "J'ouvre la séance" = Secrétaire.
    """
    text_lower = transcript_segment.lower()
    scores = {}
    
    for role, patterns in LINGUISTIC_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower):
                # Find member with this role
                for member in known_members:
                    member_role = member.get("role", "").lower()
                    if role in member_role or (role == "secrétaire" and "secretaire" in member_role):
                        scores[member["name"]] = scores.get(member["name"], 0) + 0.8
                        break
    
    return scores


def name_mention_strategy(
    transcript_segment: str,
    previous_speaker: Optional[str],
    known_members: List[str]
) -> Dict[str, float]:
    """
    Strategy 4: Name Mention Detection (10% weight)
    If someone says "Merci Michaël", the next speaker might be Michaël.
    """
    text_lower = transcript_segment.lower()
    scores = {}
    
    for pattern in NAME_MENTION_PATTERNS:
        matches = re.findall(pattern, text_lower)
        for match in matches:
            # Check if mentioned name matches a known member
            for member in known_members:
                if match.lower() in member.lower():
                    # This segment likely addresses this member
                    scores[member] = scores.get(member, 0) + 0.6
    
    return scores


def auto_identification_strategy(
    transcript_segment: str,
    known_members: List[str]
) -> Dict[str, float]:
    """
    Strategy 5: Auto-Identification (5% weight)
    Detect when someone says "Je suis X" or "Ici X".
    """
    text_lower = transcript_segment.lower()
    scores = {}
    
    for pattern in AUTO_ID_PATTERNS:
        matches = re.findall(pattern, text_lower)
        for match in matches:
            for member in known_members:
                if match.lower() in member.lower():
                    # Strong indication - person identifies themselves
                    scores[member] = 1.0
    
    return scores


def fuse_scores(
    voice_scores: Dict[str, float],
    context_scores: Dict[str, float],
    linguistic_scores: Dict[str, float],
    mention_scores: Dict[str, float],
    auto_id_scores: Dict[str, float],
    confidence_threshold: float = 0.2  # Lowered from 0.6 - weighted scores rarely exceed 0.5
) -> Tuple[Optional[str], float]:
    """
    Fuse all strategy scores with weighted combination.
    
    Weights:
    - Voice Embedding: 50%
    - Contextual AI: 25%
    - Linguistic Patterns: 10%
    - Name Mentions: 10%
    - Auto-ID: 5%
    """
    # Weights (Updated: Voice priority 70%)
    weights = {
        "voice": 0.70,        # Increased from 0.50
        "context": 0.15,      # Decreased from 0.25
        "linguistic": 0.05,   # Decreased from 0.10
        "mention": 0.05,      # Decreased from 0.10
        "auto_id": 0.05
    }
    
    # Collect all candidate names
    all_candidates = set()
    all_candidates.update(voice_scores.keys())
    all_candidates.update(context_scores.keys())
    all_candidates.update(linguistic_scores.keys())
    all_candidates.update(mention_scores.keys())
    all_candidates.update(auto_id_scores.keys())
    
    if not all_candidates:
        return None, 0.0
    
    # Calculate weighted score for each candidate
    combined_scores = {}
    for name in all_candidates:
        score = 0.0
        score += weights["voice"] * voice_scores.get(name, 0)
        score += weights["context"] * context_scores.get(name, 0)
        score += weights["linguistic"] * linguistic_scores.get(name, 0)
        score += weights["mention"] * mention_scores.get(name, 0)
        score += weights["auto_id"] * auto_id_scores.get(name, 0)
        combined_scores[name] = score
    
    # Find best match
    best_match = max(combined_scores, key=combined_scores.get)
    best_score = combined_scores[best_match]
    
    # Return only if above threshold
    if best_score >= confidence_threshold:
        return best_match, best_score
    
    return None, best_score


async def identify_speaker(
    speaker_label: str,
    transcript_segment: str,
    audio_segment_url: Optional[str],
    known_speakers: List[Dict],
    meeting_context: Dict,
    previous_identifications: Dict[str, str],
    modal_endpoint: str
) -> Tuple[str, float]:
    """
    Main function to identify a speaker using all strategies.
    
    Args:
        speaker_label: Original label (e.g., "Speaker 1")
        transcript_segment: What this speaker said
        audio_segment_url: URL to audio segment (optional)
        known_speakers: List of known speakers with embeddings and roles
        meeting_context: Meeting metadata
        previous_identifications: Already identified speakers in this meeting
        modal_endpoint: Modal endpoint URL for voice embeddings
    
    Returns:
        Tuple of (identified_name or original_label, confidence_score)
    """
    # Check if already identified
    if speaker_label in previous_identifications:
        return previous_identifications[speaker_label], 1.0
    
    known_member_names = [s["name"] for s in known_speakers]
    
    # Run all strategies
    voice_scores = {}
    if audio_segment_url:
        voice_scores = await voice_embedding_strategy(
            audio_segment_url, known_speakers, modal_endpoint
        )
    
    context_scores = contextual_ai_strategy(
        transcript_segment, meeting_context, known_member_names
    )
    
    linguistic_scores = linguistic_pattern_strategy(
        transcript_segment, known_speakers
    )
    
    mention_scores = name_mention_strategy(
        transcript_segment, 
        previous_identifications.get(speaker_label),
        known_member_names
    )
    
    auto_id_scores = auto_identification_strategy(
        transcript_segment, known_member_names
    )
    
    # Fuse scores
    identified_name, confidence = fuse_scores(
        voice_scores,
        context_scores,
        linguistic_scores,
        mention_scores,
        auto_id_scores
    )
    
    if identified_name:
        return identified_name, confidence
    
    return speaker_label, 0.0
