"""
Active Learning Engine — Exploitation active des données collectées
===================================================================

Ce module transforme le stockage passif en apprentissage actif:

1. EMBEDDING RETRAINING: Les corrections humaines améliorent les embeddings vocaux
   - Les corrections reçoivent un poids 2x plus élevé que l'auto-apprentissage
   - Les embeddings incorrects sont pénalisés et éventuellement supprimés
   - Diversité des embeddings maintenue via clustering

2. STYLE MEMORY: Les patterns de style sont activement réinjectés dans les prompts
   - Terminologie préférée extraite des corrections
   - Format de résolution appris des PV approuvés
   - Niveau de détail ajusté par section

3. QUALITY TRACKING: Suivi actif de la qualité par membre et par type
   - Accuracy par locuteur (qui est souvent mal identifié?)
   - Quality par type de résolution (quelles résolutions ont le plus de corrections?)
   - Trend analysis (la qualité s'améliore-t-elle?)

Collections utilisées:
- members: Profils vocaux (read/write — embedding updates)
- ml_corrections: Corrections humaines (read)
- pv_learning: Données d'apprentissage PV (read)
- pv_style_patterns: Patterns de style (read/write)
- active_learning_stats: Statistiques d'apprentissage actif (write)
- rlhf_embedding_rewards: Récompenses embeddings (read)
"""

import json
import math
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from speaker_identification import cosine_similarity


# =============================================================================
# WEIGHTED EMBEDDING UPDATE — Corrections get higher weight
# =============================================================================

def update_embedding_with_correction(
    db_client: Any,
    member_id: str,
    correct_embedding: List[float],
    wrong_embedding: Optional[List[float]] = None,
    correction_weight: float = 2.0,
) -> Dict:
    """
    Update a member's voice embeddings using a correction signal.
    
    Unlike auto-learning which simply appends, corrections:
    1. Add the correct embedding with HIGHER weight (appears 2x in the list)
    2. Remove or downweight the wrong embedding if identified
    3. Maintain diversity via similarity threshold
    
    Args:
        member_id: Firestore member document ID
        correct_embedding: The embedding from the correctly identified audio
        wrong_embedding: The embedding that led to the wrong identification (optional)
        correction_weight: How many times to add the correct embedding (default 2x)
    
    Returns:
        {"success": bool, "newSampleCount": int, "removedWrong": bool, "message": str}
    """
    if not db_client or not correct_embedding:
        return {"success": False, "newSampleCount": 0, "removedWrong": False, "message": "Missing data"}
    
    try:
        member_ref = db_client.collection("members").document(member_id)
        member_doc = member_ref.get()
        
        if not member_doc.exists:
            return {"success": False, "newSampleCount": 0, "removedWrong": False, 
                    "message": f"Member {member_id} not found"}
        
        member = member_doc.to_dict()
        current_emb = member.get("embedding")
        
        # Parse existing embeddings
        if current_emb and isinstance(current_emb, str):
            try:
                current_emb = json.loads(current_emb)
            except (json.JSONDecodeError, TypeError):
                current_emb = None
        
        # Normalize to list of vectors
        if current_emb and isinstance(current_emb, list):
            if isinstance(current_emb[0], list):
                vectors = current_emb
            else:
                vectors = [current_emb]
        else:
            vectors = []
        
        removed_wrong = False
        
        # Step 1: Remove wrong embedding if provided
        if wrong_embedding and vectors:
            new_vectors = []
            for vec in vectors:
                if len(vec) == len(wrong_embedding):
                    sim = cosine_similarity(vec, wrong_embedding)
                    if sim > 0.92:  # Very similar to wrong embedding — remove it
                        removed_wrong = True
                        print(f"[ActiveLearning] Removed wrong embedding (sim={sim:.3f})")
                        continue
                new_vectors.append(vec)
            vectors = new_vectors
        
        # Step 2: Check for duplicates before adding
        is_duplicate = False
        for existing_vec in vectors:
            if len(existing_vec) == len(correct_embedding):
                sim = cosine_similarity(existing_vec, correct_embedding)
                if sim > 0.95:
                    is_duplicate = True
                    break
        
        # Step 3: Add correct embedding with weight
        if not is_duplicate:
            # Add the correct embedding (weighted — add it multiple times for higher influence)
            weight_count = int(correction_weight)
            for _ in range(weight_count):
                vectors.append(correct_embedding)
            
            # Cap at 20 embeddings, but prefer correction-sourced ones
            if len(vectors) > 20:
                # Keep the most recent 20 (corrections are at the end)
                vectors = vectors[-20:]
        
        # Step 4: Update Firestore
        new_count = len(vectors)
        member_ref.update({
            "embedding": json.dumps(vectors),
            "voiceSampleCount": new_count,
            "lastVoiceUpdate": datetime.now().isoformat(),
            "lastUpdateSource": "active_learning_correction",
            "correctionCount": (member.get("correctionCount", 0) or 0) + 1,
        })
        
        # Step 5: Sync to Supabase (deferred import to avoid circular dependency)
        if not is_duplicate:
            try:
                # Import at call-time to avoid circular import (active_learning ↔ main)
                import importlib
                main_module = importlib.import_module("main")
                sync_fn = getattr(main_module, "sync_embedding_to_supabase", None)
                if sync_fn:
                    member_name = member.get("displayName") or member.get("name", "")
                    sync_fn(member_name, vectors, member_id)
                else:
                    print("[ActiveLearning] sync_embedding_to_supabase not found in main module")
            except Exception as sync_err:
                print(f"[ActiveLearning] Supabase sync failed (non-fatal): {sync_err}")
        
        action = "added" if not is_duplicate else "skipped (duplicate)"
        msg = f"Embedding {action} for member. Samples: {new_count}. Wrong removed: {removed_wrong}"
        print(f"[ActiveLearning] {msg}")
        
        return {
            "success": True,
            "newSampleCount": new_count,
            "removedWrong": removed_wrong,
            "message": msg,
        }
        
    except Exception as e:
        print(f"[ActiveLearning] Error updating embedding: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "newSampleCount": 0, "removedWrong": False, "message": str(e)}


# =============================================================================
# EMBEDDING QUALITY ANALYSIS — Which members need improvement?
# =============================================================================

def analyze_embedding_quality(db_client: Any) -> List[Dict]:
    """
    Analyze the quality of voice embeddings for all members.
    
    Uses correction history to determine which members' embeddings
    are performing poorly and need more/better samples.
    
    Returns list of members sorted by quality (worst first):
        [
            {
                "memberId": "...",
                "memberName": "...",
                "voiceSampleCount": 5,
                "accuracy": 0.65,
                "totalIdentifications": 20,
                "correctIdentifications": 13,
                "wrongIdentifications": 7,
                "qualityGrade": "C",
                "recommendation": "Needs 3+ more diverse voice samples",
                "priority": "high",
            },
            ...
        ]
    """
    if not db_client:
        return []
    
    try:
        # 1. Fetch all corrections
        corrections = list(
            db_client.collection("ml_corrections").order_by(
                "timestamp", direction="DESCENDING"
            ).limit(500).stream()
        )
        
        # 2. Build per-member stats
        member_stats = defaultdict(lambda: {
            "correct": 0,
            "wrong_as_predicted": 0,  # Times this member was wrongly predicted
            "wrong_as_actual": 0,     # Times this member was the correct answer but missed
            "total": 0,
        })
        
        for doc in corrections:
            c = doc.to_dict()
            wrong_name = c.get("wrongPrediction", "")
            correct_name = c.get("correctAnswer", "")
            was_correct = c.get("wasCorrect", False)
            
            if was_correct:
                member_stats[correct_name]["correct"] += 1
                member_stats[correct_name]["total"] += 1
            else:
                if wrong_name:
                    member_stats[wrong_name]["wrong_as_predicted"] += 1
                    member_stats[wrong_name]["total"] += 1
                if correct_name:
                    member_stats[correct_name]["wrong_as_actual"] += 1
                    member_stats[correct_name]["total"] += 1
        
        # 3. Fetch member profiles
        members = list(db_client.collection("members").stream())
        member_map = {}
        for doc in members:
            data = doc.to_dict()
            name = data.get("displayName") or data.get("name", "")
            member_map[name] = {
                "id": doc.id,
                "voiceSampleCount": data.get("voiceSampleCount", 0),
                "correctionCount": data.get("correctionCount", 0) or 0,
            }
        
        # 4. Build quality report
        results = []
        for name, stats in member_stats.items():
            if name not in member_map:
                continue
            
            profile = member_map[name]
            total = stats["total"]
            correct = stats["correct"]
            wrong_predicted = stats["wrong_as_predicted"]
            wrong_actual = stats["wrong_as_actual"]
            
            accuracy = correct / max(total, 1)
            
            # Quality grade
            if accuracy >= 0.90:
                grade = "A"
                priority = "low"
                recommendation = "Profil vocal excellent"
            elif accuracy >= 0.75:
                grade = "B"
                priority = "low"
                recommendation = "Profil vocal bon, amélioration mineure possible"
            elif accuracy >= 0.60:
                grade = "C"
                priority = "medium"
                recommendation = f"Besoin de {max(3, 10 - profile['voiceSampleCount'])} échantillons vocaux supplémentaires"
            elif accuracy >= 0.40:
                grade = "D"
                priority = "high"
                recommendation = "Profil vocal faible — réenregistrement recommandé"
            else:
                grade = "F"
                priority = "critical"
                recommendation = "Profil vocal très faible — réenregistrement urgent nécessaire"
            
            # Low sample count is always a concern
            if profile["voiceSampleCount"] < 3:
                priority = "high" if priority != "critical" else priority
                recommendation = f"Seulement {profile['voiceSampleCount']} échantillon(s) — minimum 5 recommandé"
            
            results.append({
                "memberId": profile["id"],
                "memberName": name,
                "voiceSampleCount": profile["voiceSampleCount"],
                "accuracy": round(accuracy, 3),
                "totalIdentifications": total,
                "correctIdentifications": correct,
                "wrongAsPredicted": wrong_predicted,
                "wrongAsActual": wrong_actual,
                "qualityGrade": grade,
                "recommendation": recommendation,
                "priority": priority,
            })
        
        # Sort by priority then accuracy
        priority_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        results.sort(key=lambda x: (priority_order.get(x["priority"], 4), x["accuracy"]))
        
        return results
        
    except Exception as e:
        print(f"[ActiveLearning] Error analyzing embedding quality: {e}")
        import traceback
        traceback.print_exc()
        return []


# =============================================================================
# STYLE MEMORY — Active exploitation of pv_learning data
# =============================================================================

def build_style_memory(db_client: Any, max_entries: int = 50) -> Dict:
    """
    Build an active style memory from pv_learning and pv_style_patterns.
    
    This is the key function that transforms passive storage into active knowledge.
    
    Returns:
        {
            "terminologyMap": {"old_term": "preferred_term", ...},
            "formatRules": ["rule1", "rule2", ...],
            "sectionGuidelines": {
                "resolutions": "Always include proposer and seconder...",
                "comments": "Use formal tone...",
            },
            "commonMistakes": ["mistake1", "mistake2", ...],
            "qualityBenchmarks": {
                "avgQualityScore": 85,
                "avgFormatScore": 90,
                "bestPractices": ["..."],
            },
        }
    """
    if not db_client:
        return _empty_style_memory()
    
    try:
        # 1. Fetch pv_learning data
        learning_docs = list(
            db_client.collection("pv_learning").order_by(
                "timestamp", direction="DESCENDING"
            ).limit(max_entries).stream()
        )
        
        # 2. Fetch pv_style_patterns
        style_docs = list(
            db_client.collection("pv_style_patterns").order_by(
                "timestamp", direction="DESCENDING"
            ).limit(max_entries).stream()
        )
        
        # 3. Aggregate terminology corrections
        terminology_map = {}
        term_counts = defaultdict(lambda: {"preferred": "", "count": 0})
        
        format_rules = []
        common_mistakes = []
        quality_scores = []
        format_scores = []
        section_issues = defaultdict(list)
        
        for doc in learning_docs:
            data = doc.to_dict()
            
            # Track quality scores
            qs = data.get("qualityScore", 0)
            fs = data.get("formatScore", 0)
            if qs > 0:
                quality_scores.append(qs)
            if fs > 0:
                format_scores.append(fs)
            
            # Analyze corrections
            for correction in data.get("corrections", []):
                c_type = correction.get("type", "")
                description = correction.get("description", "")
                fix = correction.get("fix", "")
                
                if c_type in ("terminology", "style") and "→" in fix:
                    parts = fix.split("→")
                    if len(parts) == 2:
                        old = parts[0].strip().lower()
                        new = parts[1].strip()
                        if old not in term_counts:
                            term_counts[old] = {"preferred": new, "count": 0}
                        term_counts[old]["count"] += 1
                        term_counts[old]["preferred"] = new
                
                if c_type == "formatting":
                    if description and description not in format_rules:
                        format_rules.append(description)
                
                if c_type in ("factual_error", "hallucination", "inconsistency"):
                    if description and description not in common_mistakes:
                        common_mistakes.append(description)
                
                # Track which sections have issues
                source = correction.get("source", "")
                if source:
                    section_issues[source].append(description)
        
        # 4. Analyze style patterns
        for doc in style_docs:
            data = doc.to_dict()
            for pattern in data.get("patterns", []):
                desc = pattern.get("description", "")
                if desc and desc not in format_rules:
                    format_rules.append(desc)
        
        # 5. Build stable terminology map (only corrections with 2+ occurrences)
        for old_term, info in term_counts.items():
            if info["count"] >= 2:
                terminology_map[old_term] = info["preferred"]
        
        # 6. Build section guidelines
        section_guidelines = {}
        for section, issues in section_issues.items():
            if len(issues) >= 2:
                # Summarize common issues for this section
                issue_summary = "; ".join(list(set(issues))[:5])
                section_guidelines[section] = f"Attention: {issue_summary}"
        
        # 7. Quality benchmarks
        avg_quality = sum(quality_scores) / max(len(quality_scores), 1) if quality_scores else 0
        avg_format = sum(format_scores) / max(len(format_scores), 1) if format_scores else 0
        
        best_practices = []
        if avg_quality > 85:
            best_practices.append("La qualité moyenne est bonne — maintenir le niveau actuel")
        elif avg_quality > 70:
            best_practices.append("Qualité acceptable — focus sur la réduction des erreurs factuelles")
        else:
            best_practices.append("Qualité à améliorer — vérifier systématiquement contre la transcription")
        
        return {
            "terminologyMap": terminology_map,
            "formatRules": format_rules[:15],
            "sectionGuidelines": section_guidelines,
            "commonMistakes": common_mistakes[:10],
            "qualityBenchmarks": {
                "avgQualityScore": round(avg_quality, 1),
                "avgFormatScore": round(avg_format, 1),
                "totalLearningEntries": len(learning_docs),
                "bestPractices": best_practices,
            },
        }
        
    except Exception as e:
        print(f"[ActiveLearning] Error building style memory: {e}")
        import traceback
        traceback.print_exc()
        return _empty_style_memory()


def inject_style_memory_into_prompt(base_prompt: str, style_memory: Dict) -> str:
    """
    Inject active style memory into a generation prompt.
    
    This is the bridge between passive data and active exploitation.
    """
    injections = []
    
    # 1. Terminology corrections
    term_map = style_memory.get("terminologyMap", {})
    if term_map:
        terms = "\n".join(
            f"  - &quot;{old}&quot; → &quot;{new}&quot;"
            for old, new in list(term_map.items())[:15]
        )
        injections.append(
            f"\nTERMINOLOGIE OBLIGATOIRE (apprise des corrections précédentes):\n{terms}"
        )
    
    # 2. Format rules
    format_rules = style_memory.get("formatRules", [])
    if format_rules:
        rules = "\n".join(f"  - {r}" for r in format_rules[:10])
        injections.append(
            f"\nRÈGLES DE FORMAT (apprises des PV précédents):\n{rules}"
        )
    
    # 3. Common mistakes to avoid
    mistakes = style_memory.get("commonMistakes", [])
    if mistakes:
        mistake_list = "\n".join(f"  - ÉVITE: {m}" for m in mistakes[:8])
        injections.append(
            f"\nERREURS FRÉQUENTES À ÉVITER (basées sur l'historique):\n{mistake_list}"
        )
    
    # 4. Section-specific guidelines
    guidelines = style_memory.get("sectionGuidelines", {})
    if guidelines:
        guide_list = "\n".join(
            f"  - [{section}]: {guide}"
            for section, guide in guidelines.items()
        )
        injections.append(
            f"\nDIRECTIVES PAR SECTION:\n{guide_list}"
        )
    
    # 5. Quality benchmarks
    benchmarks = style_memory.get("qualityBenchmarks", {})
    avg_quality = benchmarks.get("avgQualityScore", 0)
    if avg_quality > 0:
        injections.append(
            f"\nOBJECTIF QUALITÉ: Score minimum visé = {max(avg_quality + 5, 85)}/100"
        )
    
    if injections:
        return base_prompt + "\n" + "\n".join(injections)
    
    return base_prompt


# =============================================================================
# QUALITY TREND ANALYSIS
# =============================================================================

def analyze_quality_trends(db_client: Any, lookback: int = 20) -> Dict:
    """
    Analyze quality trends over time to measure if the system is improving.
    
    Returns:
        {
            "overallTrend": "improving" | "stable" | "declining",
            "qualityTrend": [{"meeting": "...", "score": 85}, ...],
            "formatTrend": [{"meeting": "...", "score": 90}, ...],
            "correctionTrend": [{"meeting": "...", "count": 3}, ...],
            "improvementRate": 0.05,  # 5% improvement per meeting
            "insights": ["Quality improving by 5% per meeting", ...],
        }
    """
    if not db_client:
        return _empty_trends()
    
    try:
        learning_docs = list(
            db_client.collection("pv_learning").order_by(
                "timestamp", direction="ASCENDING"
            ).limit(lookback).stream()
        )
        
        if len(learning_docs) < 3:
            return _empty_trends()
        
        quality_trend = []
        format_trend = []
        correction_trend = []
        
        for doc in learning_docs:
            data = doc.to_dict()
            meeting_id = data.get("meetingId", "unknown")
            timestamp = data.get("timestamp", "")
            
            quality_trend.append({
                "meeting": meeting_id,
                "timestamp": timestamp,
                "score": data.get("qualityScore", 0),
            })
            
            format_trend.append({
                "meeting": meeting_id,
                "timestamp": timestamp,
                "score": data.get("formatScore", 0),
            })
            
            correction_trend.append({
                "meeting": meeting_id,
                "timestamp": timestamp,
                "count": data.get("totalIssuesFound", 0),
            })
        
        # Calculate trends
        quality_scores = [t["score"] for t in quality_trend if t["score"] > 0]
        format_scores = [t["score"] for t in format_trend if t["score"] > 0]
        correction_counts = [t["count"] for t in correction_trend]
        
        # Simple linear trend
        quality_trend_direction = _calculate_trend(quality_scores)
        format_trend_direction = _calculate_trend(format_scores)
        correction_trend_direction = _calculate_trend(correction_counts)
        
        # Overall assessment
        if quality_trend_direction > 0.02 and correction_trend_direction < -0.02:
            overall = "improving"
        elif quality_trend_direction < -0.02 or correction_trend_direction > 0.02:
            overall = "declining"
        else:
            overall = "stable"
        
        # Generate insights
        insights = []
        if quality_trend_direction > 0:
            insights.append(f"Qualité en amélioration (+{quality_trend_direction:.1%} par réunion)")
        elif quality_trend_direction < 0:
            insights.append(f"Qualité en déclin ({quality_trend_direction:.1%} par réunion)")
        
        if correction_trend_direction < 0:
            insights.append("Nombre de corrections en diminution — le système apprend")
        elif correction_trend_direction > 0:
            insights.append("Nombre de corrections en augmentation — vérifier les prompts")
        
        avg_recent = sum(quality_scores[-3:]) / max(len(quality_scores[-3:]), 1) if quality_scores else 0
        if avg_recent >= 90:
            insights.append("Excellente qualité récente (≥90/100)")
        elif avg_recent >= 80:
            insights.append("Bonne qualité récente (≥80/100)")
        
        return {
            "overallTrend": overall,
            "qualityTrend": quality_trend,
            "formatTrend": format_trend,
            "correctionTrend": correction_trend,
            "improvementRate": round(quality_trend_direction, 4),
            "insights": insights,
            "dataPoints": len(learning_docs),
        }
        
    except Exception as e:
        print(f"[ActiveLearning] Error analyzing trends: {e}")
        return _empty_trends()


# =============================================================================
# INTERNAL HELPERS
# =============================================================================

def _calculate_trend(values: List[float]) -> float:
    """
    Calculate simple linear trend (slope) of a series.
    Returns normalized slope per data point.
    """
    if len(values) < 2:
        return 0.0
    
    n = len(values)
    x_mean = (n - 1) / 2.0
    y_mean = sum(values) / n
    
    numerator = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
    denominator = sum((i - x_mean) ** 2 for i in range(n))
    
    if denominator == 0:
        return 0.0
    
    slope = numerator / denominator
    
    # Normalize by mean to get percentage change per step
    if y_mean != 0:
        return slope / y_mean
    return 0.0


def _empty_style_memory() -> Dict:
    return {
        "terminologyMap": {},
        "formatRules": [],
        "sectionGuidelines": {},
        "commonMistakes": [],
        "qualityBenchmarks": {
            "avgQualityScore": 0,
            "avgFormatScore": 0,
            "totalLearningEntries": 0,
            "bestPractices": [],
        },
    }


def _empty_trends() -> Dict:
    return {
        "overallTrend": "unknown",
        "qualityTrend": [],
        "formatTrend": [],
        "correctionTrend": [],
        "improvementRate": 0,
        "insights": ["Pas assez de données pour analyser les tendances"],
        "dataPoints": 0,
    }


def clean_and_optimize_all_speaker_embeddings(db_client: Any) -> Dict[str, Any]:
    """
    Active ML Clean-up and Robustness maintenance:
    1. Fetches all embeddings for all speakers from Supabase.
    2. Performs intra-speaker outlier detection (purges vectors with similarity < 0.65 to their speaker centroid).
    3. Performs inter-speaker overlap detection (purges vectors with high cross-speaker similarity > 0.85).
    4. Performs diversity check (purges duplicates with similarity > 0.96).
    5. Updates statistics in Firestore active_learning_stats.
    """
    print("[ActiveLearning] Starting AI/ML voice embedding cleaning & optimization...")
    results = {
        "success": True,
        "totalEvaluated": 0,
        "outliersRemoved": 0,
        "overlapsRemoved": 0,
        "duplicatesRemoved": 0,
        "cleanedSpeakers": [],
        "errors": []
    }
    
    try:
        from supabase import create_client
        import os
        from supabase_embeddings import delete_embedding_by_id
        
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_KEY")
        if not supabase_url or not supabase_key:
            return {"success": False, "message": "Supabase not configured"}
            
        supabase = create_client(supabase_url, supabase_key)
        
        # 1. Fetch all embeddings rows
        rows_res = supabase.table("speaker_embeddings").select(
            "id, speaker_name, embedding, sample_source, created_at"
        ).execute()
        
        if not rows_res.data:
            return {"success": True, "message": "No embeddings to clean", **results}
            
        # Group embeddings by speaker
        speakers_data = defaultdict(list)
        for row in rows_res.data:
            name = row.get("speaker_name")
            emb = row.get("embedding")
            if isinstance(emb, str):
                emb = json.loads(emb)
            if name and isinstance(emb, list) and len(emb) > 0:
                speakers_data[name].append({
                    "id": row["id"],
                    "vector": emb,
                    "source": row.get("sample_source", "unknown"),
                    "created_at": row.get("created_at", "")
                })
                results["totalEvaluated"] += 1
                
        to_delete_ids = set()
        
        # 2. Intra-Speaker Outlier Detection & Duplicate Detection
        for name, samples in speakers_data.items():
            num_samples = len(samples)
            if num_samples < 3:
                # Not enough samples to reliably calculate outliers, skip outlier check but check duplicates
                if num_samples >= 2:
                    for i in range(num_samples):
                        for j in range(i + 1, num_samples):
                            sim = cosine_similarity(samples[i]["vector"], samples[j]["vector"])
                            if sim > 0.96:
                                older = samples[i] if samples[i]["created_at"] < samples[j]["created_at"] else samples[j]
                                to_delete_ids.add(older["id"])
                                results["duplicatesRemoved"] += 1
                continue
                
            # For speakers with >= 3 samples:
            avg_sims = {}
            for i, s_i in enumerate(samples):
                sims = []
                for j, s_j in enumerate(samples):
                    if i == j:
                        continue
                    sim = cosine_similarity(s_i["vector"], s_j["vector"])
                    sims.append(sim)
                    
                    # Duplicate check
                    if j > i and sim > 0.96:
                        older = s_i if s_i["created_at"] < s_j["created_at"] else s_j
                        to_delete_ids.add(older["id"])
                        results["duplicatesRemoved"] += 1
                        
                avg_sims[s_i["id"]] = sum(sims) / len(sims) if sims else 0.0
                
            # Find outliers: average similarity to other vectors of same speaker is < 0.65
            for s_id, avg_sim in avg_sims.items():
                if avg_sim < 0.65:
                    print(f"[ActiveLearning] Outlier detected for speaker '{name}': ID {s_id} (avg_sim={avg_sim:.3f})")
                    to_delete_ids.add(s_id)
                    results["outliersRemoved"] += 1
                    if name not in results["cleanedSpeakers"]:
                        results["cleanedSpeakers"].append(name)
                        
        # 3. Inter-Speaker Overlap Detection (Cross-Contamination)
        all_speaker_names = list(speakers_data.keys())
        for i, name_a in enumerate(all_speaker_names):
            samples_a = speakers_data[name_a]
            for j, name_b in enumerate(all_speaker_names):
                if i >= j:
                    continue
                samples_b = speakers_data[name_b]
                
                for sa in samples_a:
                    if sa["id"] in to_delete_ids:
                        continue
                    for sb in samples_b:
                        if sb["id"] in to_delete_ids:
                            continue
                        
                        cross_sim = cosine_similarity(sa["vector"], sb["vector"])
                        if cross_sim > 0.85:
                            sims_sa_to_a = [cosine_similarity(sa["vector"], other["vector"]) for other in samples_a if other["id"] != sa["id"]]
                            sims_sb_to_b = [cosine_similarity(sb["vector"], other["vector"]) for other in samples_b if other["id"] != sb["id"]]
                            
                            avg_a = sum(sims_sa_to_a) / len(sims_sa_to_a) if sims_sa_to_a else 0.0
                            avg_b = sum(sims_sb_to_b) / len(sims_sb_to_b) if sims_sb_to_b else 0.0
                            
                            if avg_a < avg_b:
                                print(f"[ActiveLearning] Impostor detected: embedding of '{name_a}' (ID {sa['id']}) is too close to '{name_b}' (ID {sb['id']}) (cross_sim={cross_sim:.3f}). Purging from '{name_a}'")
                                to_delete_ids.add(sa["id"])
                                results["overlapsRemoved"] += 1
                                if name_a not in results["cleanedSpeakers"]:
                                    results["cleanedSpeakers"].append(name_a)
                            else:
                                print(f"[ActiveLearning] Impostor detected: embedding of '{name_b}' (ID {sb['id']}) is too close to '{name_a}' (ID {sa['id']}) (cross_sim={cross_sim:.3f}). Purging from '{name_b}'")
                                to_delete_ids.add(sb["id"])
                                results["overlapsRemoved"] += 1
                                if name_b not in results["cleanedSpeakers"]:
                                    results["cleanedSpeakers"].append(name_b)
                                    
        # 4. Perform actual deletions
        deleted_count = 0
        for doc_id in to_delete_ids:
            success = delete_embedding_by_id(doc_id)
            if success:
                deleted_count += 1
            else:
                results["errors"].append(f"Failed to delete {doc_id}")
                
        results["deletedCount"] = deleted_count
        results["message"] = f"Cleaned up {deleted_count} vector(s). Outliers: {results['outliersRemoved']}, Overlaps: {results['overlapsRemoved']}, Duplicates: {results['duplicatesRemoved']}"
        print(f"[ActiveLearning] Clean-up finished: {results['message']}")
        
        # 5. Update Firestore active_learning_stats
        if db_client:
            try:
                db_client.collection("active_learning_stats").add({
                    "timestamp": datetime.now().isoformat(),
                    "totalEvaluated": results["totalEvaluated"],
                    "outliersRemoved": results["outliersRemoved"],
                    "overlapsRemoved": results["overlapsRemoved"],
                    "duplicatesRemoved": results["duplicatesRemoved"],
                    "deletedCount": deleted_count,
                    "message": results["message"],
                    "source": "ml_auto_maintenance"
                })
            except Exception as fire_err:
                print(f"[ActiveLearning] Failed to log stats in Firestore: {fire_err}")
                
        # Update members count cache
        for name in results["cleanedSpeakers"]:
            try:
                member_ref = db_client.collection("members").where("displayName", "==", name).limit(1).get()
                if member_ref:
                    from supabase_embeddings import get_embedding_count
                    count = get_embedding_count(name)
                    member_ref[0].reference.update({
                        "voiceSampleCount": count,
                        "lastVoiceUpdate": datetime.now().isoformat()
                    })
            except Exception as cache_err:
                print(f"[ActiveLearning] Failed to update cache for {name}: {cache_err}")
                
        return results
        
    except Exception as e:
        print(f"[ActiveLearning] Global error in cleaning: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "message": str(e), **results}