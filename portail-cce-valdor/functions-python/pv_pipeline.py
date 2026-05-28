"""
PV Pipeline — Étapes 4 à 10 du pipeline de génération de Procès-Verbaux
Module dédié aux fonctions de traitement avancé du PV.

4. 📋 ANALYSE ODJ        → Mapping discussions → Points ordre du jour
5. 🏷️ CLASSIFICATION     → Catégorisation thématique + sentiment
6. ✍️ RÉDACTION          → Génération brouillon PV (résolutions, commentaires)
7. 🔄 RÉFLEXION          → Auto-critique + corrections automatiques (boucle)
8. ✅ VALIDATION USER    → Point de contrôle humain
9. 📊 COMPARAISON        → Vérification cohérence avec PV historiques (boucle)
10. 🧠 APPRENTISSAGE     → Mise à jour modèles avec corrections
"""

import json
import re
from datetime import datetime
from typing import Any, Optional

# Active learning imports (lazy — only used when db_client is available)
def _get_enhanced_prompt(base_prompt: str, db_client: Any = None, step: str = "drafting", meeting_id: str = None) -> str:
    """Enhance prompt with RLHF + active learning data if available."""
    if not db_client:
        return base_prompt
    try:
        from rlhf_engine import enhance_prompt_with_rlhf
        from active_learning import build_style_memory, inject_style_memory_into_prompt
        
        # Layer 1: RLHF preferences and policy
        enhanced = enhance_prompt_with_rlhf(base_prompt, db_client, step=step, meeting_id=meeting_id)
        
        # Layer 2: Active style memory
        style_memory = build_style_memory(db_client, max_entries=30)
        enhanced = inject_style_memory_into_prompt(enhanced, style_memory)
        
        return enhanced
    except Exception as e:
        print(f"[PVPipeline] Prompt enhancement skipped: {e}")
        return base_prompt


# ============================================================================
# STEP 4 — ANALYSE ODJ : Mapping discussions → Points ordre du jour
# ============================================================================

def analyze_odj_mapping(
    transcription: str,
    agenda_items: list,
    speaker_mapping: Optional[dict] = None,
    anthropic_client: Any = None,
    db_client: Any = None,
) -> dict:
    """
    Map transcription segments to agenda items (ODJ).
    Uses Claude to intelligently associate discussion segments with ODJ points.
    
    Returns:
        {
            "mappedItems": [...],
            "unmappedSegments": [...],
            "coveragePercent": float
        }
    """
    if not anthropic_client:
        raise ValueError("Anthropic client required for ODJ analysis")

    odj_list = "\n".join(
        f"{i+1}. [{item.get('id', f'odj-{i}')}] {item.get('title', 'Sans titre')}"
        f"{' [Objectif: ' + item['objective'] + ']' if item.get('objective') else ''}"
        for i, item in enumerate(agenda_items)
    )

    speaker_info = ""
    if speaker_mapping:
        speaker_info = "\n\nMAPPING DES LOCUTEURS:\n" + "\n".join(
            f"- {label} → {name}" for label, name in speaker_mapping.items()
        )

    base_prompt = f"""Tu es un expert en analyse de procès-verbaux municipaux québécois.

ORDRE DU JOUR DE LA RÉUNION:
{odj_list}
{speaker_info}

TRANSCRIPTION NETTOYÉE:
{transcription[:40000]}

TÂCHE:
Associe chaque segment de la transcription à un point de l'ordre du jour.
Pour chaque point, identifie les segments pertinents, les intervenants et un score de confiance.

RÈGLES STRICTES:
- Un segment ne peut être associé qu'à UN SEUL point de l'ODJ
- Si un segment ne correspond à aucun point, mets-le dans "unmappedSegments"
- Respecte l'ordre chronologique
- Ne déduis JAMAIS un contenu absent de la transcription

FORMAT JSON ATTENDU:
{{
  "mappedItems": [
    {{
      "odjItemId": "id-du-point",
      "odjTitle": "Titre du point",
      "odjOrder": 1,
      "transcriptSegments": ["Résumé fidèle du segment"],
      "speakers": ["M. Ross", "Mme Boutin"],
      "confidence": 0.95
    }}
  ],
  "unmappedSegments": ["Segments non associés"],
  "coveragePercent": 85.0
}}

Réponds UNIQUEMENT avec le JSON."""

    # Enhance with RLHF + active learning
    prompt = _get_enhanced_prompt(base_prompt, db_client, step="odj_analysis")

    message = anthropic_client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=8000,
        thinking={"type": "enabled", "budget_tokens": 8000},
        temperature=1,
        messages=[{"role": "user", "content": prompt}],
    )

    content = "".join(block.text for block in message.content if block.type == "text")
    return _parse_json_response(content)


# ============================================================================
# STEP 5 — CLASSIFICATION : Catégorisation thématique + sentiment
# ============================================================================

def classify_agenda_items(
    meeting_date: str,
    odj_analysis: dict,
    anthropic_client: Any = None,
    db_client: Any = None,
) -> dict:
    """
    Classify each agenda item by theme, sentiment, issue type, priority.
    
    Returns:
        {
            "items": [...],
            "globalThemes": [...],
            "globalSentiment": "positive" | "neutral" | "negative" | "mixed"
        }
    """
    if not anthropic_client:
        raise ValueError("Anthropic client required for classification")

    items_summary = "\n".join(
        f"- [{item['odjItemId']}] {item['odjTitle']}: "
        f"{' | '.join(item.get('transcriptSegments', []))[:300]}"
        for item in odj_analysis.get("mappedItems", [])
    )

    base_prompt = f"""Tu es un analyste spécialisé en gouvernance municipale et environnement au Québec.

CONTEXTE: Réunion du Comité Consultatif en Environnement (CCE) de Val-d'Or
DATE: {meeting_date}

POINTS ANALYSÉS:
{items_summary}

TÂCHE:
Pour chaque point, détermine:
1. CATÉGORIES (parmi: environnement, urbanisme, eau, déchets, biodiversité, énergie, transport, réglementation, budget, consultation_publique, gouvernance, autre)
2. SENTIMENT (positive, neutral, negative, mixed)
3. TYPE D'ISSUE (resolution, comment, decision, information)
4. PRIORITÉ (high, medium, low)
5. MOTS-CLÉS (max 5)
6. RÉSUMÉ (une phrase)

FORMAT JSON ATTENDU:
{{
  "items": [
    {{
      "odjItemId": "id",
      "odjTitle": "Titre",
      "categories": ["environnement"],
      "sentiment": "positive",
      "issueType": "resolution",
      "priority": "high",
      "keywords": ["mot1", "mot2"],
      "summary": "Résumé en une phrase"
    }}
  ],
  "globalThemes": ["thème1", "thème2"],
  "globalSentiment": "positive"
}}

Réponds UNIQUEMENT avec le JSON."""

    # Enhance with RLHF + active learning
    prompt = _get_enhanced_prompt(base_prompt, db_client, step="classification")

    message = anthropic_client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=6000,
        thinking={"type": "enabled", "budget_tokens": 6000},
        temperature=1,
        messages=[{"role": "user", "content": prompt}],
    )

    content = "".join(block.text for block in message.content if block.type == "text")
    return _parse_json_response(content)


# ============================================================================
# STEP 7 — RÉFLEXION : Auto-critique + corrections automatiques (boucle)
# ============================================================================

def reflect_on_draft(
    pv_draft: str,
    transcription: str,
    iteration_number: int,
    previous_issues: Optional[str] = None,
    anthropic_client: Any = None,
    db_client: Any = None,
) -> dict:
    """
    Self-critique loop: analyze PV draft for errors, inconsistencies, hallucinations.
    
    Returns:
        {
            "issues": [...],
            "correctedContent": "...",
            "qualityScore": int (0-100)
        }
    """
    if not anthropic_client:
        raise ValueError("Anthropic client required for reflection")

    previous_context = ""
    if previous_issues:
        previous_context = (
            f"\n\nPROBLÈMES CORRIGÉS LORS DES ITÉRATIONS PRÉCÉDENTES:\n{previous_issues}\n"
            "Ne répète PAS ces corrections. Cherche de NOUVEAUX problèmes."
        )

    base_prompt = f"""Tu es un réviseur expert de procès-verbaux municipaux. Itération #{iteration_number}.

BROUILLON DU PV À RÉVISER:
{pv_draft[:40000]}

TRANSCRIPTION ORIGINALE (SOURCE DE VÉRITÉ):
{transcription[:30000]}
{previous_context}

TÂCHE:
Effectue une auto-critique rigoureuse en vérifiant:
1. ERREURS FACTUELLES : Le PV dit-il quelque chose absent de la transcription?
2. INFORMATIONS MANQUANTES : Discussions importantes omises?
3. FORMATAGE : Numérotation correcte? Blocs RÉSOLUTION/COMMENTAIRE bien formés?
4. INCOHÉRENCES : Contradictions internes?
5. HALLUCINATIONS : Informations inventées?
6. STYLE : Conforme au style administratif québécois?

RÈGLES:
- Sois IMPITOYABLE dans ta critique
- Chaque problème doit avoir une correction concrète
- Si le PV est correct, retourne une liste vide d'issues
- Applique les corrections et retourne le contenu corrigé
- Attribue un score de qualité de 0 à 100

FORMAT JSON ATTENDU:
{{
  "issues": [
    {{
      "type": "factual_error",
      "severity": "critical",
      "location": "Point 3, paragraphe 2",
      "description": "Description du problème",
      "suggestedFix": "Correction proposée",
      "applied": true
    }}
  ],
  "correctedContent": "Le PV corrigé complet...",
  "qualityScore": 85
}}

Réponds UNIQUEMENT avec le JSON."""

    # Enhance with RLHF + active learning (especially important for reflection)
    prompt = _get_enhanced_prompt(base_prompt, db_client, step="reflection")

    message = anthropic_client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=20000,
        thinking={"type": "enabled", "budget_tokens": 12000},
        temperature=1,
        messages=[{"role": "user", "content": prompt}],
    )

    content = "".join(block.text for block in message.content if block.type == "text")
    return _parse_json_response(content)


def run_reflection_loop(
    pv_draft: str,
    transcription: str,
    max_iterations: int = 3,
    min_quality_score: int = 90,
    anthropic_client: Any = None,
    db_client: Any = None,
) -> dict:
    """
    Run the full reflection loop until quality threshold is met or max iterations reached.
    
    Returns:
        {
            "iterations": [...],
            "totalIssuesFound": int,
            "totalIssuesFixed": int,
            "finalContent": str,
            "qualityScore": int
        }
    """
    iterations = []
    current_content = pv_draft
    total_issues_found = 0
    total_issues_fixed = 0
    quality_score = 0
    previous_issues_summary = []

    for i in range(1, max_iterations + 1):
        print(f"[Reflection] Iteration {i}/{max_iterations}")

        previous_str = "\n".join(previous_issues_summary) if previous_issues_summary else None

        result = reflect_on_draft(
            pv_draft=current_content,
            transcription=transcription,
            iteration_number=i,
            previous_issues=previous_str,
            anthropic_client=anthropic_client,
            db_client=db_client,
        )

        issues = result.get("issues", [])
        quality_score = result.get("qualityScore", 0)
        corrected = result.get("correctedContent", current_content)

        iterations.append({
            "iterationNumber": i,
            "issues": issues,
            "correctedContent": corrected,
        })

        total_issues_found += len(issues)
        total_issues_fixed += sum(1 for issue in issues if issue.get("applied", False))

        # Track previous issues
        previous_issues_summary.extend(
            f"- [{issue.get('type')}] {issue.get('description')}"
            for issue in issues
        )

        # Update content
        if corrected:
            current_content = corrected

        # Stop early if quality is high enough or no issues found
        if quality_score >= min_quality_score or len(issues) == 0:
            print(f"[Reflection] Stopping at iteration {i}: score={quality_score}, issues={len(issues)}")
            break

    return {
        "iterations": iterations,
        "totalIssuesFound": total_issues_found,
        "totalIssuesFixed": total_issues_fixed,
        "finalContent": current_content,
        "qualityScore": quality_score,
    }


# ============================================================================
# STEP 9 — COMPARAISON : Vérification cohérence avec PV historiques
# ============================================================================

def compare_with_historical(
    current_pv: str,
    historical_pvs: list,
    meeting_number: int,
    anthropic_client: Any = None,
    db_client: Any = None,
) -> dict:
    """
    Compare current PV with historical PVs for consistency.
    
    Args:
        historical_pvs: List of {"date": str, "content": str}
    
    Returns:
        {
            "consistencyChecks": [...],
            "formatScore": int (0-100),
            "corrections": [...],
            "correctedContent": str
        }
    """
    if not anthropic_client:
        raise ValueError("Anthropic client required for comparison")

    if not historical_pvs:
        return {
            "consistencyChecks": [{
                "type": "format",
                "status": "pass",
                "message": "Aucun PV historique disponible pour comparaison",
            }],
            "formatScore": 100,
            "corrections": [],
            "correctedContent": current_pv,
        }

    historical_context = "\n".join(
        f"\n--- PV HISTORIQUE #{i+1} ({pv['date']}) ---\n{pv['content'][:5000]}"
        for i, pv in enumerate(historical_pvs)
    )

    prompt = f"""Tu es un expert en contrôle qualité de procès-verbaux municipaux.

PV ACTUEL (Assemblée #{meeting_number}):
{current_pv[:30000]}

PV HISTORIQUES POUR COMPARAISON:
{historical_context}

TÂCHE:
Compare le PV actuel avec les PV historiques et vérifie:
1. NUMÉROTATION : Les numéros de résolutions/commentaires suivent-ils la séquence?
2. FORMAT : Le format est-il cohérent avec les PV précédents?
3. TERMINOLOGIE : Les termes utilisés sont-ils les mêmes?
4. PRÉSENCES : Les noms sont-ils orthographiés de la même façon?
5. STYLE DE RÉSOLUTION : Les résolutions suivent-elles le même patron?

FORMAT JSON ATTENDU:
{{
  "consistencyChecks": [
    {{
      "type": "terminology",
      "status": "warning",
      "message": "Description de l'incohérence",
      "suggestion": "Correction proposée"
    }}
  ],
  "formatScore": 90,
  "corrections": [
    {{
      "location": "Header",
      "before": "texte original",
      "after": "texte corrigé",
      "reason": "Raison de la correction"
    }}
  ],
  "correctedContent": "Le PV corrigé..."
}}

Réponds UNIQUEMENT avec le JSON."""

    message = anthropic_client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=20000,
        thinking={"type": "enabled", "budget_tokens": 10000},
        temperature=1,
        messages=[{"role": "user", "content": prompt}],
    )

    content = "".join(block.text for block in message.content if block.type == "text")
    return _parse_json_response(content)


# ============================================================================
# STEP 10 — APPRENTISSAGE : Mise à jour modèles avec corrections
# ============================================================================

def record_learning(
    db_client: Any,
    meeting_id: str,
    reflection_result: dict,
    comparison_result: dict,
    user_feedback: str = "",
    user_approved: bool = True,
    user_edits: str = "",
    time_to_approval: float = None,
) -> dict:
    """
    Record learning data from the pipeline for future improvements.
    Stores corrections, patterns, and feedback in Firestore.
    
    Returns:
        {
            "modelsUpdated": [...],
            "feedbackRecorded": bool,
            "stylePatterns": int,
            "terminologyUpdates": int,
            "nextMeetingHints": [...]
        }
    """
    models_updated = []
    style_patterns = 0
    terminology_updates = 0
    next_meeting_hints = []

    try:
        # 1. Collect all corrections
        all_corrections = []

        for iteration in reflection_result.get("iterations", []):
            for issue in iteration.get("issues", []):
                all_corrections.append({
                    "type": issue.get("type", "unknown"),
                    "severity": issue.get("severity", "minor"),
                    "description": issue.get("description", ""),
                    "fix": issue.get("suggestedFix", ""),
                    "source": "reflection",
                    "applied": issue.get("applied", False),
                })

        for correction in comparison_result.get("corrections", []):
            all_corrections.append({
                "type": "format",
                "severity": "minor",
                "description": correction.get("reason", ""),
                "fix": f"{correction.get('before', '')} → {correction.get('after', '')}",
                "source": "comparison",
                "applied": True,
            })

        # 2. Store in Firestore
        if db_client and all_corrections:
            learning_ref = db_client.collection("pv_learning").document()
            learning_ref.set({
                "meetingId": meeting_id,
                "timestamp": datetime.now().isoformat(),
                "corrections": all_corrections,
                "userFeedback": user_feedback,
                "qualityScore": reflection_result.get("qualityScore", 0),
                "formatScore": comparison_result.get("formatScore", 0),
                "totalIssuesFound": reflection_result.get("totalIssuesFound", 0),
                "totalIssuesFixed": reflection_result.get("totalIssuesFixed", 0),
            })
            models_updated.append("feedback_model")
            print(f"[Learning] Recorded {len(all_corrections)} corrections for meeting {meeting_id}")

        # 3. Count style patterns
        style_patterns = sum(
            1 for c in all_corrections
            if c["type"] in ("style", "formatting")
        )
        if style_patterns > 0:
            models_updated.append("style_patterns")

        # 4. Count terminology updates
        terminology_updates = sum(
            1 for check in comparison_result.get("consistencyChecks", [])
            if check.get("type") == "terminology"
        )
        if terminology_updates > 0:
            models_updated.append("terminology_model")

        # 5. Generate hints for next meeting
        quality_score = reflection_result.get("qualityScore", 0)
        format_score = comparison_result.get("formatScore", 0)

        if quality_score < 80:
            next_meeting_hints.append(
                "Améliorer la qualité audio pour une meilleure transcription"
            )
        if format_score < 80:
            next_meeting_hints.append(
                "Revoir le format du PV pour plus de cohérence avec les précédents"
            )

        low_confidence = [
            c for c in comparison_result.get("consistencyChecks", [])
            if c.get("status") in ("warning", "fail")
        ]
        if low_confidence:
            next_meeting_hints.append(
                f"{len(low_confidence)} point(s) de cohérence à surveiller"
            )

        # 6. Store aggregated style patterns for future use
        if db_client and style_patterns > 0:
            style_ref = db_client.collection("pv_style_patterns").document(meeting_id)
            style_issues = [
                c for c in all_corrections if c["type"] in ("style", "formatting")
            ]
            style_ref.set({
                "meetingId": meeting_id,
                "timestamp": datetime.now().isoformat(),
                "patterns": style_issues,
                "count": style_patterns,
            })

        # 7. RLHF: Compute and store reward signal
        try:
            from rlhf_engine import compute_reward

            reward = compute_reward(
                user_corrections=all_corrections,
                quality_score=reflection_result.get("qualityScore", 0),
                format_score=comparison_result.get("formatScore", 0),
                user_approved=user_approved,
                user_comments=user_feedback,
                time_to_approval_seconds=time_to_approval,
                reflection_iterations=len(reflection_result.get("iterations", [])),
            )

            if db_client:
                db_client.collection("rlhf_rewards").add({
                    "meetingId": meeting_id,
                    "timestamp": datetime.now().isoformat(),
                    **reward,
                })
                models_updated.append("rlhf_reward")
                print(f"[Learning] RLHF reward: {reward['totalReward']:.4f} (grade: {reward['grade']})")

                # Record terminology preferences from corrections
                from rlhf_engine import record_preference
                for c in all_corrections:
                    if c.get("type") in ("terminology", "style") and c.get("fix", "").count("\u2192") == 1:
                        parts = c["fix"].split("\u2192")
                        if len(parts) == 2:
                            record_preference(
                                db_client=db_client,
                                meeting_id=meeting_id,
                                preference_type=c["type"],
                                original_value=parts[0].strip(),
                                corrected_value=parts[1].strip(),
                            )

        except Exception as rlhf_err:
            print(f"[Learning] RLHF reward computation skipped: {rlhf_err}")

        # 8. Detect and record user edit preferences
        if user_edits and db_client:
            try:
                from rlhf_engine import record_preference as rec_pref
                rec_pref(
                    db_client=db_client,
                    meeting_id=meeting_id,
                    preference_type="content",
                    original_value="auto-generated",
                    corrected_value=user_edits[:500],
                    context={"source": "user_validation_edits"},
                )
            except Exception:
                pass

    except Exception as e:
        print(f"[Learning] Error recording learning data: {e}")
        import traceback
        traceback.print_exc()

    return {
        "modelsUpdated": models_updated,
        "feedbackRecorded": len(models_updated) > 0,
        "stylePatterns": style_patterns,
        "terminologyUpdates": terminology_updates,
        "nextMeetingHints": next_meeting_hints,
    }


# ============================================================================
# FULL PIPELINE ORCHESTRATOR (server-side)
# ============================================================================

def run_pv_pipeline(
    db_client: Any,
    anthropic_client: Any,
    meeting_id: str,
    transcription: str,
    agenda_items: list,
    meeting_date: str,
    meeting_number: int,
    speaker_mapping: Optional[dict] = None,
    historical_pvs: Optional[list] = None,
    max_reflection_iterations: int = 3,
    min_quality_score: int = 90,
) -> dict:
    """
    Run the complete PV pipeline (steps 4-10) server-side.
    Steps 1-3 (transcription, identification, cleaning) are handled client-side or separately.
    
    Returns the full pipeline result with all step outputs.
    """
    print(f"[PVPipeline] Starting pipeline for meeting {meeting_id}")
    pipeline_start = datetime.now()
    results = {}

    # STEP 4: Analyse ODJ
    print("[PVPipeline] Step 4: ODJ Analysis")
    odj_analysis = analyze_odj_mapping(
        transcription=transcription,
        agenda_items=agenda_items,
        speaker_mapping=speaker_mapping,
        anthropic_client=anthropic_client,
        db_client=db_client,
    )
    results["odj_analysis"] = odj_analysis

    # STEP 5: Classification
    print("[PVPipeline] Step 5: Classification")
    classification = classify_agenda_items(
        meeting_date=meeting_date,
        odj_analysis=odj_analysis,
        anthropic_client=anthropic_client,
        db_client=db_client,
    )
    results["classification"] = classification

    # STEP 6: Rédaction — delegated to generate_minutes_claude
    results["drafting"] = {
        "status": "delegated_to_generate_minutes_claude",
        "odjAnalysis": odj_analysis,
        "classification": classification,
    }

    pipeline_duration = (datetime.now() - pipeline_start).total_seconds()
    print(f"[PVPipeline] Steps 4-5 completed in {pipeline_duration:.1f}s")

    return {
        "success": True,
        "meetingId": meeting_id,
        "results": results,
        "pipelineDuration": pipeline_duration,
    }


# ============================================================================
# UTILITY: Parse JSON from AI response
# ============================================================================

def _parse_json_response(content: str) -> dict:
    """Parse JSON from AI response, handling common formatting issues."""
    # Remove code fences
    cleaned = content.replace("```json", "").replace("```", "")

    # Find JSON object
    start = cleaned.find("{")
    end = cleaned.rfind("}")

    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"No valid JSON found in response: {content[:200]}")

    json_str = cleaned[start:end + 1]

    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        # Try to fix common issues — remove trailing commas
        json_str = re.sub(r',\s*}', '}', json_str)
        json_str = re.sub(r',\s*]', ']', json_str)

        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            raise ValueError(f"Failed to parse JSON: {e}\nContent: {json_str[:500]}")