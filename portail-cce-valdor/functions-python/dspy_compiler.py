"""
DSPy-style Reactive Prompt Compiler for CCE Val-d'Or
======================================================
This module implements a lightweight, serverless-friendly prompt compiler 
inspired by the DSPy framework. It eliminates static prompt engineering by:

1. SIGNATURE DEFINITION: Defines formal, declarative structures for inputs and outputs.
2. DYNAMIC BOOTSTRAP FEW-SHOT SELECTOR: Queries historical Firestore meetings 
   to inject the most contextually relevant past minutes/resolutions as exemplars.
3. DYNAMIC INSTRUCTION TELEPROMPTER: Translates user corrections from Firestore 
   `ml_corrections` into explicit legal/style rules dynamically compiled into the prompt.
4. AUTO-CALIBRATION: Dynamically adjusts model temperature and constraints based 
   on recent reward statistics to minimize legal hallucinations.
"""

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


# =============================================================================
# 📋 DSPY SIGNATURE DEFINITIONS
# =============================================================================

class DraftingSignature:
    """Formal DSPy-style signature for Procès-Verbaux (PV) generation."""
    
    INPUT_FIELDS = {
        "transcription": "Transcription textuelle text-to-speech brute ou nettoyée des délibérations du comité.",
        "agenda": "Ordre du jour structuré de la séance, décrivant chaque point (ODJ).",
        "attendance": "Liste officielle des membres actifs du CCE pour le contrôle des présences.",
        "style_guidelines": "Directives de style apprises issues de l'apprentissage actif RLHF.",
        "exemplars": "Exemples historiques réels (Few-Shot) similaires de résolutions approuvées à Val-d'Or."
    }
    
    OUTPUT_FIELDS = {
        "pv_draft": "Le procès-verbal complet rédigé sous forme légale.",
        "resolutions": "JSON structuré des résolutions votées (proposeur, vote, conditions).",
        "comments": "Remarques complémentaires sur les débats, non résolutoires."
    }
    
    CONSTRAINTS = [
        "1. Chaque proposition doit obligatoirement inclure l'initiateur (ex: 'Il est proposé par M. X...') et le type de vote (ex: '...et résolu à l'unanimité des membres').",
        "2. Les références géospatiales, numéros de lots cadastraux et articles de règlements de zonage (ex: 'zone H-300', 'article 12.3') doivent être transcrits avec une précision absolue de 100 % sans aucune modification.",
        "3. Le style doit être neutre, factuel, officiel, rédigé à la troisième personne du pluriel ou au passif.",
        "4. Les membres archivés ou inactifs NE DOIVENT PAS être comptabilisés dans le quorum ou mentionnés comme participants actifs."
    ]


# =============================================================================
# 🚀 DYNAMIC BOOTSTRAP FEW-SHOT SELECTOR
# =============================================================================

def select_few_shot_examples(
    db_client: Any, 
    current_themes: List[str], 
    max_examples: int = 2
) -> str:
    """
    Select the most semantically relevant historical meetings to act as 
    few-shot demonstrations for the compiler.
    
    It scans validated 'meetings' in Firestore, computing a simple Jaccard-like 
    overlap score based on agenda/transcription themes.
    """
    if not db_client:
        return ""
        
    try:
        # Get past finalized meetings
        meetings_ref = db_client.collection("meetings")
        query = meetings_ref.where("status", "==", "completed").limit(10)
        docs = query.stream()
        
        candidates = []
        for doc in docs:
            m_data = doc.to_dict()
            meeting_id = doc.id
            minutes_content = m_data.get("minutes") or m_data.get("minutesDraft", {}).get("content", "")
            
            if not minutes_content or len(minutes_content) < 500:
                continue
                
            # Extract themes from past classification if available, otherwise use basic title search
            past_themes = []
            if "classification" in m_data:
                past_themes = [
                    item.get("theme", "").lower() 
                    for item in m_data["classification"].get("items", [])
                ]
            else:
                title = m_data.get("title", "").lower()
                past_themes = title.split()
                
            # Compute intersection score with current themes
            overlap = 0
            for t in current_themes:
                t_lower = t.lower()
                if any(t_lower in pt or pt in t_lower for pt in past_themes):
                    overlap += 1
                    
            candidates.append({
                "id": meeting_id,
                "date": m_data.get("date", "Date inconnue"),
                "number": m_data.get("number", ""),
                "content": minutes_content[:2000],  # Truncate to avoid context window explosion
                "score": overlap
            })
            
        # Sort candidates (highest score first)
        candidates.sort(key=lambda x: x["score"], reverse=True)
        selected = candidates[:max_examples]
        
        if not selected:
            return ""
            
        few_shot_str = "\n\n=== EXEMPLES HISTORIQUES DE RÉFÉRENCE DE VAL-D'OR ===\n"
        for i, cand in enumerate(selected, 1):
            few_shot_str += f"\nEXEMPLE {i} (Séance n°{cand['number']} du {cand['date']}) :\n"
            few_shot_str += f"--- DEBUT EXEMPLE ---\n{cand['content']}\n--- FIN EXEMPLE ---\n"
            
        return few_shot_str
        
    except Exception as e:
        print(f"[DSPyCompiler] Error selecting few-shot examples: {e}")
        return ""


# =============================================================================
# ✍️ DYNAMIC INSTRUCTION TELEPROMPTER
# =============================================================================

def compile_prompt_directives(db_client: Any) -> Tuple[List[str], List[str]]:
    """
    Query the `ml_corrections` collection, analyze common patterns in human edits,
    and dynamically compile positive rules and negative constraints.
    
    This acts as a DSPy Teleprompter (Prompt Optimizer).
    """
    learned_rules = []
    errors_to_avoid = []
    
    if not db_client:
        return learned_rules, errors_to_avoid
        
    try:
        # Fetch recent user corrections
        corrections_ref = db_client.collection("ml_corrections")
        query = corrections_ref.order_by("timestamp", direction="DESCENDING").limit(50)
        docs = query.stream()
        
        # Analyze terminology corrections
        terminology_counts = {}
        style_corrections = []
        factual_errors = []
        
        for doc in docs:
            data = doc.to_dict()
            corr_type = data.get("type", "style")
            
            if corr_type == "terminology":
                original = data.get("original", "").strip()
                replacement = data.get("replacement", "").strip()
                if original and replacement:
                    pair = (original.lower(), replacement)
                    terminology_counts[pair] = terminology_counts.get(pair, 0) + 1
            elif corr_type == "style":
                desc = data.get("description", "")
                if desc:
                    style_corrections.append(desc)
            elif corr_type == "factual_error":
                desc = data.get("description", "")
                if desc:
                    factual_errors.append(desc)
                    
        # 1. Compile terminology instructions (Top 8 most repeated corrections)
        sorted_terms = sorted(terminology_counts.items(), key=lambda x: x[1], reverse=True)
        for (orig, rep), count in sorted_terms[:8]:
            learned_rules.append(f"Utilise systématiquement le terme officiel '{rep}' au lieu de '{orig}'.")
            errors_to_avoid.append(f"N'utilise jamais le terme '{orig}' (corrige-le en '{rep}').")
            
        # 2. Compile style rules from common descriptions
        if style_corrections:
            # Basic clustering: check for common words in style descriptions
            if any("unanimité" in s.lower() for s in style_corrections):
                learned_rules.append("Assure-toi que chaque adoption de résolution mentionne explicitement si elle a été faite 'à l'unanimité'.")
            if any("propose" in s.lower() or "proposé" in s.lower() for s in style_corrections):
                learned_rules.append("Mentionne toujours le nom du membre qui propose la résolution (ex: 'Il est proposé par...').")
            if any("détail" in s.lower() or "court" in s.lower() for s in style_corrections):
                learned_rules.append("Détaille précisément les motifs écologiques dans le préambule avant la section résolutoire.")
                
        # 3. Compile error constraints from factual corrections
        for err in factual_errors[:5]:
            errors_to_avoid.append(f"Évite l'erreur factuelle relevée précédemment : {err}")
            
    except Exception as e:
        print(f"[DSPyCompiler] Error compiling prompt directives: {e}")
        
    return learned_rules, errors_to_avoid


# =============================================================================
# 🎛️ HYPERPARAMETER AUTO-CALIBRATION
# =============================================================================

def calibrate_hyperparameters(db_client: Any) -> Dict[str, Any]:
    """
    Analyze the reward and correction rate of the 5 most recent meetings,
    and dynamically tune LLM parameters (temperature, max iterations).
    
    If the correction rate is high, it lowers the temperature to force 
    maximum determinism. If the reward is high, it keeps defaults.
    """
    params = {
        "temperature": 0.3,
        "max_reflection_iterations": 3,
        "detail_emphasis": False
    }
    
    if not db_client:
        return params
        
    try:
        rewards_ref = db_client.collection("rlhf_rewards")
        query = rewards_ref.order_by("timestamp", direction="DESCENDING").limit(5)
        docs = list(query.stream())
        
        if not docs:
            return params
            
        total_reward = 0.0
        num_corrections = 0
        for doc in docs:
            data = doc.to_dict()
            total_reward += data.get("totalReward", 1.0)
            # Fetch correction count if stored
            num_corrections += len(data.get("components", {}).get("user_corrections", []))
            
        avg_reward = total_reward / len(docs)
        avg_corrections = num_corrections / len(docs)
        
        print(f"[DSPyCompiler] Calibration metrics -> Avg reward: {avg_reward:.2f}, Avg corrections: {avg_corrections:.1f}")
        
        # Adjust Temperature based on correction volume
        if avg_corrections > 5 or avg_reward < 0.2:
            # Low quality / High corrections -> Drop temperature to minimal creative drift
            params["temperature"] = 0.1
            params["max_reflection_iterations"] = 4
            params["detail_emphasis"] = True
            print("[DSPyCompiler] Calibrated model to MAXIMUM DETERMINISM (low temperature + high reflection)")
        elif avg_corrections > 2:
            params["temperature"] = 0.2
            params["max_reflection_iterations"] = 3
            print("[DSPyCompiler] Calibrated model to BALANCED MODE (temperature: 0.2)")
        else:
            # Excellent quality -> Keep standard temperature
            params["temperature"] = 0.3
            params["max_reflection_iterations"] = 2
            print("[DSPyCompiler] Calibrated model to STANDARD PERFORMANCE (temperature: 0.3)")
            
    except Exception as e:
        print(f"[DSPyCompiler] Error calibrating hyperparameters: {e}")
        
    return params


# =============================================================================
# 🧩 PROMPT COMPILATION ENGINE
# =============================================================================

def compile_dspy_prompt(
    db_client: Any,
    base_prompt: str,
    current_themes: List[str] = None
) -> str:
    """
    Compile the complete dynamic prompt system by assembling:
    1. The Declarative Signature
    2. Dynamically Bootstrapped Few-Shot Exemplars
    3. Compiled Active Learning Directives
    4. Structural and Legal Constraints
    
    Returns the fully compiled, highly optimized system prompt.
    """
    print("[DSPyCompiler] Starting prompt compilation...")
    
    # 1. Compile active directives (teleprompter)
    learned_rules, errors_to_avoid = compile_prompt_directives(db_client)
    
    # 2. Calibrate parameters
    calibrated_params = calibrate_hyperparameters(db_client)
    
    # Assemble compiled prompt components
    compiled = []
    compiled.append("=== SIGNATURE DU COMPILATEUR DE PROMPTS CCE (DSPY-COMPILER) ===")
    compiled.append("Vous êtes le Compilateur de Procès-Verbaux de Val-d'Or.")
    compiled.append(f"Température calibrée d'exécution : {calibrated_params['temperature']}")
    
    # Input/Output schema definition
    compiled.append("\n=== SCHEMA DE SIGNATURE FORMEL ===")
    compiled.append("ENTRÉES COMPILÉES :")
    for field, desc in DraftingSignature.INPUT_FIELDS.items():
        compiled.append(f"  - {field}: {desc}")
        
    compiled.append("\nSORTIES CONFORMES ATTENDUES (JSON STRICT OU TEXTE STRUCTURÉ) :")
    for field, desc in DraftingSignature.OUTPUT_FIELDS.items():
        compiled.append(f"  - {field}: {desc}")
        
    # Inject Active Rules
    compiled.append("\n=== DIRECTIVES DE RÉDACTION ACTIVES (COMPILÉES PAR IA) ===")
    if learned_rules:
        compiled.append("RÈGLES DE STYLE ET DE TERMINOLOGIE APPRISES :")
        for i, rule in enumerate(learned_rules, 1):
            compiled.append(f"  {i}. {rule}")
    else:
        compiled.append("  - (Aucune règle personnalisée pour le moment - utiliser le style standard).")
        
    # Inject Negative Constraints
    compiled.append("\n=== CONTRAINTES STRICTES & ERREURS À ÉVITER (COMPILÉES PAR IA) ===")
    # Add signature level constraints
    all_constraints = DraftingSignature.CONSTRAINTS + errors_to_avoid
    for i, const in enumerate(all_constraints, 1):
        compiled.append(f"  {i}. {const}")
        
    # Add Base Prompt instructions to avoid losing standard requirements
    compiled.append("\n=== DIRECTIVES DE RÉDACTION DE BASE ===")
    compiled.append(base_prompt)
    
    # Inject Bootstrapped Examples if themes are provided
    if current_themes:
        exemplars_str = select_few_shot_examples(db_client, current_themes)
        if exemplars_str:
            compiled.append(exemplars_str)
            
    compiled.append("\n=================== FIN DE SIGNATURE COMPILÉE ===================")
    
    compiled_prompt = "\n".join(compiled)
    print(f"[DSPyCompiler] Prompt compiled successfully. Length: {len(compiled_prompt)} characters.")
    return compiled_prompt
