"""
RLHF Engine — Reinforcement Learning from Human Feedback
=========================================================

Implements a practical RLHF system for PV generation optimization.
Instead of fine-tuning LLM weights (requires GPU), this engine:

1. REWARD COMPUTATION: Calculates reward signals from:
   - User corrections (fewer corrections = higher reward)
   - Quality scores from reflection step
   - Format scores from comparison step
   - User validation feedback (approved/rejected, comments)
   - Time-to-approval (faster approval = better generation)

2. POLICY OPTIMIZATION: Uses accumulated rewards to optimize:
   - Prompt templates (which instructions produce better PVs)
   - Temperature and generation parameters
   - Section weights (which parts need more detail)
   - Style preferences (formal level, terminology choices)

3. PREFERENCE LEARNING: Tracks human preferences over time:
   - Preferred resolution formats
   - Terminology choices (which terms get corrected)
   - Section ordering preferences
   - Detail level preferences per section type

Collections used:
- rlhf_rewards: Individual reward signals per meeting
- rlhf_policy: Current optimized policy parameters
- rlhf_preferences: Learned human preferences
- pv_learning: Existing learning data (read)
- ml_corrections: Existing correction data (read)
"""

import json
import math
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple


# =============================================================================
# REWARD FUNCTION — Core RLHF Signal
# =============================================================================

def compute_reward(
    user_corrections: List[Dict],
    quality_score: float,
    format_score: float,
    user_approved: bool,
    user_comments: str = "",
    time_to_approval_seconds: Optional[float] = None,
    reflection_iterations: int = 1,
) -> Dict:
    """
    Compute a composite reward signal from human feedback.
    
    Reward components (weighted):
    - correction_penalty: -0.1 per correction (max -3.0)
    - quality_reward: quality_score / 100 (0 to 1.0)
    - format_reward: format_score / 100 (0 to 1.0)
    - approval_reward: +1.0 if approved, -1.0 if rejected
    - speed_bonus: +0.5 if approved quickly (< 60s), 0 if slow
    - efficiency_bonus: +0.3 if fewer reflection iterations needed
    - sentiment_penalty: -0.5 if user comments contain negative sentiment
    
    Returns:
        {
            "totalReward": float (-5.0 to +3.0),
            "components": {...},
            "normalizedReward": float (0.0 to 1.0),
            "grade": "A" | "B" | "C" | "D" | "F"
        }
    """
    components = {}
    
    # 1. Correction penalty (fewer corrections = better)
    num_corrections = len(user_corrections)
    critical_corrections = sum(
        1 for c in user_corrections
        if c.get("severity") == "critical" or c.get("type") == "factual_error"
    )
    correction_penalty = -(num_corrections * 0.1) - (critical_corrections * 0.3)
    correction_penalty = max(correction_penalty, -3.0)  # Cap at -3.0
    components["correction_penalty"] = round(correction_penalty, 3)
    
    # 2. Quality reward from reflection step
    quality_reward = (quality_score / 100.0) if quality_score else 0.0
    components["quality_reward"] = round(quality_reward, 3)
    
    # 3. Format reward from comparison step
    format_reward = (format_score / 100.0) if format_score else 0.0
    components["format_reward"] = round(format_reward, 3)
    
    # 4. Approval reward (strongest signal)
    approval_reward = 1.0 if user_approved else -1.0
    components["approval_reward"] = approval_reward
    
    # 5. Speed bonus (quick approval = confident user = good generation)
    speed_bonus = 0.0
    if time_to_approval_seconds is not None and user_approved:
        if time_to_approval_seconds < 60:
            speed_bonus = 0.5
        elif time_to_approval_seconds < 180:
            speed_bonus = 0.3
        elif time_to_approval_seconds < 300:
            speed_bonus = 0.1
    components["speed_bonus"] = speed_bonus
    
    # 6. Efficiency bonus (fewer reflection iterations = better first draft)
    efficiency_bonus = max(0, 0.3 - (reflection_iterations - 1) * 0.1)
    components["efficiency_bonus"] = round(efficiency_bonus, 3)
    
    # 7. Sentiment analysis on user comments
    sentiment_penalty = 0.0
    if user_comments:
        negative_keywords = [
            "mauvais", "incorrect", "erreur", "faux", "manque", "oublié",
            "incomplet", "wrong", "bad", "missing", "error", "problème",
            "pas bon", "à refaire", "nul", "décevant"
        ]
        positive_keywords = [
            "bon", "bien", "excellent", "parfait", "correct", "good",
            "great", "perfect", "bravo", "super", "merci"
        ]
        comment_lower = user_comments.lower()
        neg_count = sum(1 for kw in negative_keywords if kw in comment_lower)
        pos_count = sum(1 for kw in positive_keywords if kw in comment_lower)
        sentiment_penalty = -(neg_count * 0.2) + (pos_count * 0.1)
        sentiment_penalty = max(-0.5, min(0.5, sentiment_penalty))
    components["sentiment_signal"] = round(sentiment_penalty, 3)
    
    # Weighted total reward
    weights = {
        "correction_penalty": 0.25,
        "quality_reward": 0.20,
        "format_reward": 0.15,
        "approval_reward": 0.20,
        "speed_bonus": 0.05,
        "efficiency_bonus": 0.05,
        "sentiment_signal": 0.10,
    }
    
    total_reward = sum(
        components[key] * weights[key]
        for key in weights
    )
    total_reward = round(total_reward, 4)
    
    # Normalize to 0-1 range (from theoretical -3.0 to +3.0)
    normalized = (total_reward + 3.0) / 6.0
    normalized = max(0.0, min(1.0, normalized))
    
    # Grade
    if normalized >= 0.85:
        grade = "A"
    elif normalized >= 0.70:
        grade = "B"
    elif normalized >= 0.55:
        grade = "C"
    elif normalized >= 0.40:
        grade = "D"
    else:
        grade = "F"
    
    return {
        "totalReward": total_reward,
        "components": components,
        "normalizedReward": round(normalized, 4),
        "grade": grade,
        "numCorrections": num_corrections,
        "criticalCorrections": critical_corrections,
    }


# =============================================================================
# POLICY OPTIMIZATION — Adjust generation parameters based on rewards
# =============================================================================

def optimize_policy(
    db_client: Any,
    lookback_meetings: int = 20,
) -> Dict:
    """
    Analyze accumulated rewards and optimize generation policy.
    
    Reads from rlhf_rewards collection and updates rlhf_policy.
    
    Policy parameters optimized:
    - temperature: Lower if too many hallucinations, higher if too rigid
    - detail_level: More detail for sections that get "missing_info" corrections
    - formality_level: Adjust based on style corrections
    - resolution_format: Learn preferred resolution format
    - section_weights: Which sections need more attention
    - prompt_modifiers: Additional instructions based on common corrections
    
    Returns the updated policy.
    """
    if not db_client:
        return _get_default_policy()
    
    try:
        # 1. Fetch recent rewards
        rewards_query = db_client.collection("rlhf_rewards").order_by(
            "timestamp", direction="DESCENDING"
        ).limit(lookback_meetings)
        
        rewards = []
        for doc in rewards_query.stream():
            rewards.append(doc.to_dict())
        
        if len(rewards) < 3:
            print(f"[RLHF] Not enough reward data ({len(rewards)} meetings). Using defaults.")
            return _get_default_policy()
        
        # 2. Fetch correction patterns from ml_corrections and pv_learning
        correction_patterns = _analyze_correction_patterns(db_client)
        
        # 3. Compute optimized parameters
        policy = _compute_optimized_policy(rewards, correction_patterns)
        
        # 4. Store updated policy
        db_client.collection("rlhf_policy").document("current").set({
            **policy,
            "updatedAt": datetime.now().isoformat(),
            "basedOnMeetings": len(rewards),
            "version": policy.get("version", 0) + 1,
        }, merge=True)
        
        print(f"[RLHF] Policy optimized based on {len(rewards)} meetings. "
              f"Avg reward: {policy['avgReward']:.3f}")
        
        return policy
        
    except Exception as e:
        print(f"[RLHF] Policy optimization error: {e}")
        import traceback
        traceback.print_exc()
        return _get_default_policy()


def get_current_policy(db_client: Any) -> Dict:
    """
    Retrieve the current optimized policy parameters.
    Falls back to defaults if no policy exists.
    """
    if not db_client:
        return _get_default_policy()
    
    try:
        doc = db_client.collection("rlhf_policy").document("current").get()
        if doc.exists:
            policy = doc.to_dict()
            # Check if policy is stale (> 30 days old)
            updated_at = policy.get("updatedAt", "")
            if updated_at:
                try:
                    last_update = datetime.fromisoformat(updated_at)
                    if (datetime.now() - last_update).days > 30:
                        print("[RLHF] Policy is stale (>30 days). Re-optimizing...")
                        return optimize_policy(db_client)
                except (ValueError, TypeError):
                    pass
            return policy
        return _get_default_policy()
    except Exception as e:
        print(f"[RLHF] Error fetching policy: {e}")
        return _get_default_policy()


# =============================================================================
# PREFERENCE LEARNING — Track human preferences over time
# =============================================================================

def record_preference(
    db_client: Any,
    meeting_id: str,
    preference_type: str,
    original_value: str,
    corrected_value: str,
    context: Optional[Dict] = None,
) -> None:
    """
    Record a human preference signal.
    
    Types:
    - "terminology": User corrected a term (e.g., "résolution" → "décision")
    - "format": User changed formatting
    - "style": User adjusted formality/tone
    - "content": User added/removed content
    - "structure": User reordered sections
    """
    if not db_client:
        return
    
    try:
        db_client.collection("rlhf_preferences").add({
            "meetingId": meeting_id,
            "type": preference_type,
            "original": original_value,
            "corrected": corrected_value,
            "context": context or {},
            "timestamp": datetime.now().isoformat(),
        })
    except Exception as e:
        print(f"[RLHF] Error recording preference: {e}")


def get_learned_preferences(db_client: Any, limit: int = 100) -> Dict:
    """
    Aggregate learned preferences into actionable rules.
    
    Returns:
        {
            "terminology": {"old_term": "preferred_term", ...},
            "styleRules": ["rule1", "rule2", ...],
            "formatPreferences": {...},
            "contentGuidelines": [...],
        }
    """
    if not db_client:
        return {"terminology": {}, "styleRules": [], "formatPreferences": {}, "contentGuidelines": []}
    
    try:
        prefs_query = db_client.collection("rlhf_preferences").order_by(
            "timestamp", direction="DESCENDING"
        ).limit(limit)
        
        terminology = {}
        style_rules = []
        format_prefs = {}
        content_guidelines = []
        
        for doc in prefs_query.stream():
            pref = doc.to_dict()
            pref_type = pref.get("type", "")
            
            if pref_type == "terminology":
                original = pref.get("original", "")
                corrected = pref.get("corrected", "")
                if original and corrected:
                    # Count occurrences — most frequent correction wins
                    key = original.lower().strip()
                    if key not in terminology:
                        terminology[key] = {"preferred": corrected, "count": 0}
                    terminology[key]["count"] += 1
                    terminology[key]["preferred"] = corrected
                    
            elif pref_type == "style":
                rule = pref.get("corrected", "")
                if rule and rule not in style_rules:
                    style_rules.append(rule)
                    
            elif pref_type == "format":
                fmt_key = pref.get("context", {}).get("section", "general")
                format_prefs[fmt_key] = pref.get("corrected", "")
                
            elif pref_type == "content":
                guideline = pref.get("corrected", "")
                if guideline and guideline not in content_guidelines:
                    content_guidelines.append(guideline)
        
        # Clean terminology — only keep corrections with 2+ occurrences
        stable_terminology = {
            k: v["preferred"] for k, v in terminology.items()
            if v["count"] >= 2
        }
        
        return {
            "terminology": stable_terminology,
            "styleRules": style_rules[-20:],  # Keep last 20
            "formatPreferences": format_prefs,
            "contentGuidelines": content_guidelines[-10:],
        }
        
    except Exception as e:
        print(f"[RLHF] Error fetching preferences: {e}")
        return {"terminology": {}, "styleRules": [], "formatPreferences": {}, "contentGuidelines": []}


# =============================================================================
# PROMPT ENHANCEMENT — Inject learned preferences into prompts
# =============================================================================

def enhance_prompt_with_rlhf(
    base_prompt: str,
    db_client: Any,
    step: str = "drafting",
) -> str:
    """
    Enhance a base prompt with RLHF-learned preferences and policy parameters.
    
    This is the key integration point — it injects learned knowledge into
    the generation prompts so the AI improves over time.
    """
    policy = get_current_policy(db_client)
    preferences = get_learned_preferences(db_client)
    
    enhancements = []
    
    # 1. Inject terminology preferences
    if preferences.get("terminology"):
        terms = preferences["terminology"]
        if terms:
            term_rules = "\n".join(
                f"  - Utilise &quot;{v}&quot; au lieu de &quot;{k}&quot;"
                for k, v in list(terms.items())[:15]
            )
            enhancements.append(
                f"\n\nTERMINOLOGIE APPRISE (basée sur les corrections précédentes):\n{term_rules}"
            )
    
    # 2. Inject style rules
    if preferences.get("styleRules"):
        rules = "\n".join(f"  - {r}" for r in preferences["styleRules"][:10])
        enhancements.append(
            f"\n\nRÈGLES DE STYLE APPRISES:\n{rules}"
        )
    
    # 3. Inject policy-driven instructions
    prompt_modifiers = policy.get("promptModifiers", [])
    if prompt_modifiers:
        mods = "\n".join(f"  - {m}" for m in prompt_modifiers[:10])
        enhancements.append(
            f"\n\nINSTRUCTIONS D'AMÉLIORATION (basées sur le feedback):\n{mods}"
        )
    
    # 4. Inject section-specific guidance
    section_weights = policy.get("sectionWeights", {})
    if section_weights and step == "drafting":
        high_attention = [
            section for section, weight in section_weights.items()
            if weight > 0.7
        ]
        if high_attention:
            enhancements.append(
                f"\n\nSECTIONS NÉCESSITANT PLUS DE DÉTAIL: {', '.join(high_attention)}"
            )
    
    # 5. Inject common error avoidance
    common_errors = policy.get("commonErrors", [])
    if common_errors:
        errors = "\n".join(f"  - ÉVITE: {e}" for e in common_errors[:8])
        enhancements.append(
            f"\n\nERREURS FRÉQUENTES À ÉVITER:\n{errors}"
        )
    
    # 6. Content guidelines
    if preferences.get("contentGuidelines"):
        guidelines = "\n".join(f"  - {g}" for g in preferences["contentGuidelines"][:5])
        enhancements.append(
            f"\n\nDIRECTIVES DE CONTENU APPRISES:\n{guidelines}"
        )
    
    if enhancements:
        enhanced = base_prompt + "\n" + "\n".join(enhancements)
        return enhanced
    
    return base_prompt


# =============================================================================
# EMBEDDING IMPROVEMENT — Active learning for voice embeddings
# =============================================================================

def compute_embedding_reward(
    db_client: Any,
    member_id: str,
    was_correct: bool,
    confidence: float,
    correction_source: str = "user",
) -> float:
    """
    Compute a reward signal for voice embedding quality.
    
    Higher reward = embedding is performing well.
    Lower reward = embedding needs retraining/more samples.
    
    This feeds into the active learning loop to prioritize
    which members need more voice samples.
    """
    # Base reward from correctness
    if was_correct:
        reward = 0.5 + (confidence * 0.5)  # 0.5 to 1.0
    else:
        reward = -(1.0 - confidence) * 0.5  # -0.5 to 0.0
    
    # Bonus for user-verified corrections (stronger signal)
    if correction_source == "user":
        reward *= 1.2
    
    # Store the embedding reward
    if db_client:
        try:
            db_client.collection("rlhf_embedding_rewards").add({
                "memberId": member_id,
                "wasCorrect": was_correct,
                "confidence": confidence,
                "reward": round(reward, 4),
                "source": correction_source,
                "timestamp": datetime.now().isoformat(),
            })
        except Exception as e:
            print(f"[RLHF] Error storing embedding reward: {e}")
    
    return reward


def get_members_needing_improvement(db_client: Any, top_n: int = 5) -> List[Dict]:
    """
    Identify members whose voice embeddings need the most improvement,
    based on accumulated embedding rewards.
    
    Returns members sorted by priority (lowest reward = highest priority).
    """
    if not db_client:
        return []
    
    try:
        # Aggregate rewards per member
        member_rewards = {}
        
        rewards_query = db_client.collection("rlhf_embedding_rewards").order_by(
            "timestamp", direction="DESCENDING"
        ).limit(500)
        
        for doc in rewards_query.stream():
            data = doc.to_dict()
            mid = data.get("memberId", "")
            if mid:
                if mid not in member_rewards:
                    member_rewards[mid] = {
                        "totalReward": 0,
                        "count": 0,
                        "correctCount": 0,
                        "wrongCount": 0,
                    }
                member_rewards[mid]["totalReward"] += data.get("reward", 0)
                member_rewards[mid]["count"] += 1
                if data.get("wasCorrect"):
                    member_rewards[mid]["correctCount"] += 1
                else:
                    member_rewards[mid]["wrongCount"] += 1
        
        # Calculate average reward and accuracy per member
        results = []
        for mid, stats in member_rewards.items():
            avg_reward = stats["totalReward"] / max(stats["count"], 1)
            accuracy = stats["correctCount"] / max(stats["count"], 1)
            
            # Fetch member info
            try:
                member_doc = db_client.collection("members").document(mid).get()
                if member_doc.exists:
                    member = member_doc.to_dict()
                    results.append({
                        "memberId": mid,
                        "memberName": member.get("displayName") or member.get("name", "Unknown"),
                        "avgReward": round(avg_reward, 4),
                        "accuracy": round(accuracy, 4),
                        "totalEvaluations": stats["count"],
                        "voiceSampleCount": member.get("voiceSampleCount", 0),
                        "priority": round(1.0 - avg_reward, 4),  # Higher priority = lower reward
                    })
            except Exception:
                pass
        
        # Sort by priority (highest first)
        results.sort(key=lambda x: x["priority"], reverse=True)
        return results[:top_n]
        
    except Exception as e:
        print(f"[RLHF] Error getting members needing improvement: {e}")
        return []


# =============================================================================
# INTERNAL HELPERS
# =============================================================================

def _get_default_policy() -> Dict:
    """Default policy parameters when no RLHF data is available."""
    return {
        "version": 0,
        "temperature": 1.0,
        "detailLevel": "standard",  # "minimal" | "standard" | "detailed"
        "formalityLevel": "formal",  # "casual" | "formal" | "very_formal"
        "sectionWeights": {
            "header": 0.5,
            "presences": 0.6,
            "resolutions": 0.9,
            "comments": 0.7,
            "discussions": 0.6,
            "closing": 0.4,
        },
        "promptModifiers": [],
        "commonErrors": [],
        "avgReward": 0.5,
        "rewardTrend": "stable",
    }


def _analyze_correction_patterns(db_client: Any) -> Dict:
    """
    Analyze patterns in corrections from pv_learning and ml_corrections.
    
    Returns:
        {
            "commonErrorTypes": {"factual_error": 5, "style": 3, ...},
            "commonLocations": {"header": 2, "resolutions": 4, ...},
            "terminologyCorrections": [{"from": "X", "to": "Y", "count": 3}],
            "avgCorrectionsPerMeeting": float,
        }
    """
    patterns = {
        "commonErrorTypes": {},
        "commonLocations": {},
        "terminologyCorrections": [],
        "avgCorrectionsPerMeeting": 0,
    }
    
    try:
        # Analyze pv_learning collection
        learning_docs = list(
            db_client.collection("pv_learning").order_by(
                "timestamp", direction="DESCENDING"
            ).limit(50).stream()
        )
        
        total_corrections = 0
        meeting_count = len(learning_docs)
        term_corrections = {}
        
        for doc in learning_docs:
            data = doc.to_dict()
            corrections = data.get("corrections", [])
            total_corrections += len(corrections)
            
            for c in corrections:
                # Count error types
                err_type = c.get("type", "unknown")
                patterns["commonErrorTypes"][err_type] = \
                    patterns["commonErrorTypes"].get(err_type, 0) + 1
                
                # Count locations
                location = c.get("location", "unknown")
                # Extract section from location (e.g., "Point 3, paragraphe 2" → "resolutions")
                section = _extract_section_from_location(location)
                patterns["commonLocations"][section] = \
                    patterns["commonLocations"].get(section, 0) + 1
                
                # Track terminology corrections
                if err_type == "terminology" or err_type == "style":
                    fix = c.get("fix", "")
                    if "→" in fix:
                        parts = fix.split("→")
                        if len(parts) == 2:
                            key = parts[0].strip().lower()
                            if key not in term_corrections:
                                term_corrections[key] = {"to": parts[1].strip(), "count": 0}
                            term_corrections[key]["count"] += 1
        
        if meeting_count > 0:
            patterns["avgCorrectionsPerMeeting"] = round(total_corrections / meeting_count, 1)
        
        patterns["terminologyCorrections"] = [
            {"from": k, "to": v["to"], "count": v["count"]}
            for k, v in sorted(term_corrections.items(), key=lambda x: x[1]["count"], reverse=True)
        ][:20]
        
    except Exception as e:
        print(f"[RLHF] Error analyzing correction patterns: {e}")
    
    return patterns


def _compute_optimized_policy(rewards: List[Dict], correction_patterns: Dict) -> Dict:
    """
    Compute optimized policy parameters from reward history and correction patterns.
    """
    policy = _get_default_policy()
    
    if not rewards:
        return policy
    
    # 1. Compute average reward and trend
    recent_rewards = [r.get("normalizedReward", 0.5) for r in rewards[:5]]
    older_rewards = [r.get("normalizedReward", 0.5) for r in rewards[5:]]
    
    avg_recent = sum(recent_rewards) / max(len(recent_rewards), 1)
    avg_older = sum(older_rewards) / max(len(older_rewards), 1) if older_rewards else avg_recent
    
    policy["avgReward"] = round(avg_recent, 4)
    
    if avg_recent > avg_older + 0.05:
        policy["rewardTrend"] = "improving"
    elif avg_recent < avg_older - 0.05:
        policy["rewardTrend"] = "declining"
    else:
        policy["rewardTrend"] = "stable"
    
    # 2. Adjust temperature based on hallucination rate
    error_types = correction_patterns.get("commonErrorTypes", {})
    hallucination_count = error_types.get("hallucination", 0) + error_types.get("factual_error", 0)
    total_errors = sum(error_types.values()) if error_types else 0
    
    if total_errors > 0:
        hallucination_rate = hallucination_count / total_errors
        if hallucination_rate > 0.3:
            policy["temperature"] = 1.0  # Keep at 1 (required for extended thinking)
            policy["promptModifiers"].append(
                "CRITIQUE: Vérifie CHAQUE fait contre la transcription. Ne déduis RIEN."
            )
        elif hallucination_rate < 0.1:
            policy["temperature"] = 1.0
    
    # 3. Adjust detail level based on "missing_info" corrections
    missing_info_count = error_types.get("missing_info", 0)
    if total_errors > 0:
        missing_rate = missing_info_count / total_errors
        if missing_rate > 0.3:
            policy["detailLevel"] = "detailed"
            policy["promptModifiers"].append(
                "Inclus PLUS de détails dans chaque section. Les PV précédents manquaient d'information."
            )
        elif missing_rate < 0.1:
            policy["detailLevel"] = "standard"
    
    # 4. Adjust section weights based on where errors occur
    locations = correction_patterns.get("commonLocations", {})
    total_location_errors = sum(locations.values()) if locations else 0
    if total_location_errors > 0:
        for section, count in locations.items():
            weight = 0.5 + (count / total_location_errors) * 0.5
            policy["sectionWeights"][section] = round(min(1.0, weight), 2)
    
    # 5. Build common errors list
    common_errors = []
    for err_type, count in sorted(error_types.items(), key=lambda x: x[1], reverse=True):
        if count >= 2:
            error_descriptions = {
                "factual_error": "Erreurs factuelles — vérifier chaque fait contre la transcription",
                "missing_info": "Informations manquantes — inclure tous les détails discutés",
                "formatting": "Problèmes de formatage — respecter le format standard du CCE",
                "inconsistency": "Incohérences internes — vérifier la cohérence entre sections",
                "hallucination": "Hallucinations — ne JAMAIS inventer d'information",
                "style": "Problèmes de style — maintenir le ton administratif québécois",
                "terminology": "Terminologie incorrecte — utiliser les termes officiels du CCE",
            }
            desc = error_descriptions.get(err_type, f"Erreur de type '{err_type}'")
            common_errors.append(f"{desc} ({count} occurrences)")
    
    policy["commonErrors"] = common_errors[:8]
    
    # 6. Add terminology corrections as prompt modifiers
    term_corrections = correction_patterns.get("terminologyCorrections", [])
    if term_corrections:
        for tc in term_corrections[:5]:
            if tc["count"] >= 2:
                policy["promptModifiers"].append(
                    f"Utilise &quot;{tc['to']}&quot; au lieu de &quot;{tc['from']}&quot;"
                )
    
    # 7. Adjust formality based on style corrections
    style_count = error_types.get("style", 0)
    if style_count > 3:
        policy["formalityLevel"] = "very_formal"
        policy["promptModifiers"].append(
            "Adopte un ton TRÈS formel et administratif. Évite tout langage familier."
        )
    
    return policy


def _extract_section_from_location(location: str) -> str:
    """Extract section name from a location string."""
    location_lower = location.lower()
    
    if any(kw in location_lower for kw in ["résolution", "resolution"]):
        return "resolutions"
    elif any(kw in location_lower for kw in ["commentaire", "comment"]):
        return "comments"
    elif any(kw in location_lower for kw in ["header", "en-tête", "entête"]):
        return "header"
    elif any(kw in location_lower for kw in ["présence", "presence", "quorum"]):
        return "presences"
    elif any(kw in location_lower for kw in ["discussion", "point"]):
        return "discussions"
    elif any(kw in location_lower for kw in ["clôture", "cloture", "fermeture", "levée"]):
        return "closing"
    else:
        return "general"