"""
Speaker Identification Module - Multi-Strategy System

Combines 5 strategies to identify speakers in transcriptions:
1. Voice Embedding (70%) - PyAnnote via Modal (primary signal)
2. Contextual AI (15%) - GROQ analysis (secondary)  
3. Linguistic Patterns (5%) - Role-based keywords
4. Name Mentions (5%) - "Merci Michaël" detection
5. Auto-Identification (5%) - "Je suis X" detection

NOTE: The actual fusion happens in main.py identify_speakers_in_transcript()
with slightly different weights when voice is unavailable.
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
    known_members: List[Dict]  # Changed from List[str] to List[Dict] to include roles
) -> Dict[str, float]:
    """
    Strategy 2: Contextual AI Analysis (25% weight)
    Use GROQ to analyze who might be speaking based on content and ROLE.
    """
    try:
        groq_api_key = os.environ.get("GROQ_API_KEY")
        if not groq_api_key:
            return {}
        
        # Format members with roles for the prompt
        members_list_str = ""
        for m in known_members:
            # Handle both dict (from main.py) and str (fallback)
            if isinstance(m, dict):
                role = m.get("role", "Membre")
                members_list_str += f"- {m.get('name')} ({role})\n"
            else:
                members_list_str += f"- {m} (Membre)\n"

        # Build prompt
        prompt = f"""Analyse ce segment de réunion du Comité Consultatif en Environnement (CCE).
Ton but est d'identifier l'intervenant en fonction de son RÔLE et de ses propos.

Contexte:
- Type: {meeting_context.get('type', 'Régulière')}
- Membres présents et leurs rôles:
{members_list_str}

Règles d'identification:
1. Le PRÉSIDENT mène la réunion, donne la parole ("La parole est à..."), et appelle au vote.
2. Le SECRÉTAIRE note les présences, lit l'ordre du jour ou les résolutions techniques.
3. Les CONSEILLERS posent des questions politiques ou font des commentaires sur les citoyens.
4. Les CITOYENS / MEMBRES posent des questions techniques ou partagent des avis.

Segment à analyser:
"{transcript_segment}"

Tâche:
Estime qui parle parmi les membres listés ci-dessus.
Retourne un JSON strict avec les probabilités (0.0 à 1.0).
Exemple: {{"Jean Dupont": 0.8, "Marie Martin": 0.1}}

Retourne UNIQUEMENT le JSON."""

        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {groq_api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "llama-3.1-8b-instant",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1, # Lower temperature for more deterministic role matching
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
    previous_speaker: Optional[str] = None,
    speaker_profile_counts: Optional[Dict[str, int]] = None,
    confidence_threshold: float = 0.35  # Increased from 0.2 for fewer false positives
) -> Tuple[Optional[str], float]:
    """
    Fusible adaptatif de scores multi-stratégies (Option B + Améliorations de précision).
    
    1. Analyse l'ambiguïté de la biométrie (Entropie / marge vocale).
    2. Ajuste dynamiquement les poids entre Voix et IA Contextuelle.
    3. Applique des bonus de transition (Markov) et des filtres de sécurité.
    """
    # 1. ÉVALUATION DE L'AMBIGUÏTÉ VOCALE (Pondération Dynamique)
    base_voice_weight = 0.70
    base_context_weight = 0.15
    
    sorted_voice = sorted(voice_scores.items(), key=lambda x: x[1], reverse=True)
    
    if len(sorted_voice) >= 2:
        top_name, top_score = sorted_voice[0]
        runner_up_name, runner_up_score = sorted_voice[1]
        margin = top_score - runner_up_score
        
        # Si la marge est faible (< 0.15), la voix est ambiguë
        if margin < 0.15:
            # Réduire le poids de la voix au profit de l'IA sémantique
            ambiguity_factor = (0.15 - margin) / 0.15  # Va de 0 (marge 0.15) à 1.0 (marge 0.0)
            voice_weight = base_voice_weight - (ambiguity_factor * 0.35)  # Descend jusqu'à 0.35
            context_weight = base_context_weight + (ambiguity_factor * 0.35)  # Monte jusqu'à 0.50
            print(f"[Fusion] Ambiguïté biométrique détectée (marge={margin:.3f}). Voix calibrée à {voice_weight:.2f}, IA à {context_weight:.2f}")
        else:
            voice_weight = base_voice_weight
            context_weight = base_context_weight
    else:
        voice_weight = base_voice_weight
        context_weight = base_context_weight

    weights = {
        "voice": voice_weight,
        "context": context_weight,
        "linguistic": 0.05,
        "mention": 0.05,
        "auto_id": 0.05
    }
    
    # 2. COLLECTE DES CANDIDATS
    all_candidates = set()
    all_candidates.update(voice_scores.keys())
    all_candidates.update(context_scores.keys())
    all_candidates.update(linguistic_scores.keys())
    all_candidates.update(mention_scores.keys())
    all_candidates.update(auto_id_scores.keys())
    
    if not all_candidates:
        return None, 0.0
    
    # 3. CALCUL DU SCORE COMBINÉ ET TRANSITIONS (Markov Chain)
    combined_scores = {}
    for name in all_candidates:
        score = 0.0
        score += weights["voice"] * voice_scores.get(name, 0.0)
        score += weights["context"] * context_scores.get(name, 0.0)
        score += weights["linguistic"] * linguistic_scores.get(name, 0.0)
        score += weights["mention"] * mention_scores.get(name, 0.0)
        score += weights["auto_id"] * auto_id_scores.get(name, 0.0)
        
        # Appliquer un bonus modéré (+0.08) si c'est le locuteur précédent qui continue
        if previous_speaker and name == previous_speaker:
            score += 0.08
            
        combined_scores[name] = score
    
    # Trouver le meilleur candidat
    best_match = max(combined_scores, key=combined_scores.get)
    best_score = combined_scores[best_match]
    
    # 4. SEUIL DE CONFIANCE ADAPTATIF
    # Si le candidat retenu a un profil vocal faible (peu de samples), on augmente le seuil d'acceptation requis
    adapted_threshold = confidence_threshold
    if speaker_profile_counts and best_match in speaker_profile_counts:
        sample_count = speaker_profile_counts.get(best_match, 0)
        if sample_count < 3:
            adapted_threshold += 0.15  # Exiger une preuve plus forte si le profil vocal est embryonnaire
            print(f"[Fusion] Profil faible pour '{best_match}' ({sample_count} samples). Seuil rehaussé à {adapted_threshold:.2f}")
    
    # Retourner seulement s'il dépasse le seuil adapté
    if best_score >= adapted_threshold:
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
