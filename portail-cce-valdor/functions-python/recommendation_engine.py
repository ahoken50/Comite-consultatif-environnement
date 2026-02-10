"""
Recommendation Engine — Prédiction intelligente de résolutions et patterns
==========================================================================

Système de recommandation basé sur l'historique des réunions du CCE.
Analyse les patterns récurrents pour:

1. PRÉDICTION DE RÉSOLUTIONS: Suggérer des résolutions probables
   basées sur les mots-clés et catégories de l'ordre du jour
   
2. DÉTECTION DE PATTERNS: Identifier les thèmes récurrents et
   les cycles saisonniers (ex: arrosage en été, déneigement en hiver)
   
3. SUGGESTIONS PROACTIVES: Recommander des points à aborder
   basés sur les résolutions passées non résolues

4. TEMPLATES DE RÉSOLUTION: Proposer des modèles de résolution
   basés sur les résolutions similaires passées

Collections utilisées:
- meetings: Données historiques des réunions (read)
- pv_learning: Données d'apprentissage (read)
- recommendations_cache: Cache des recommandations (write)
- resolution_templates: Templates de résolutions apprises (read/write)
"""

import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple


# =============================================================================
# FEATURE EXTRACTION — Extract features from meeting data
# =============================================================================

def extract_meeting_features(meeting_data: Dict) -> Dict:
    """
    Extract ML-ready features from a meeting document.
    
    Returns:
        {
            "keywords": ["arrosage", "pelouse", ...],
            "categories": ["environnement", "réglementation"],
            "sentiment": "positive",
            "month": 6,
            "season": "summer",
            "resolutionTypes": ["interdiction", "approbation"],
            "resolutionCount": 5,
            "commentCount": 3,
            "attendeeCount": 8,
            "duration": 120,  # minutes
        }
    """
    features = {
        "keywords": [],
        "categories": [],
        "sentiment": "neutral",
        "month": 0,
        "season": "unknown",
        "resolutionTypes": [],
        "resolutionCount": 0,
        "commentCount": 0,
        "attendeeCount": 0,
        "duration": 0,
    }
    
    # Extract date features
    date_str = meeting_data.get("date", "")
    if date_str:
        try:
            if isinstance(date_str, str):
                # Handle various date formats
                for fmt in ["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y"]:
                    try:
                        dt = datetime.strptime(date_str[:10], fmt)
                        features["month"] = dt.month
                        features["season"] = _get_season(dt.month)
                        break
                    except ValueError:
                        continue
        except Exception:
            pass
    
    # Extract from agenda items
    agenda_items = meeting_data.get("agendaItems", [])
    for item in agenda_items:
        title = item.get("title", "")
        description = item.get("description", "")
        text = f"{title} {description}".lower()
        
        # Extract keywords
        keywords = _extract_keywords(text)
        features["keywords"].extend(keywords)
        
        # Extract categories
        categories = _categorize_text(text)
        features["categories"].extend(categories)
    
    # Extract from minutes/PV content
    minutes = meeting_data.get("minutes", "") or ""
    minutes_draft = meeting_data.get("minutesDraft", {})
    if isinstance(minutes_draft, dict):
        minutes = minutes or minutes_draft.get("content", "")
    
    if minutes:
        # Count resolutions and comments
        resolution_matches = re.findall(
            r'(?:RÉSOLUTION|RESOLUTION|R[ÉE]S\.)\s*(?:N[°o]?\s*)?(\d{2}-\d{2,3})',
            minutes, re.IGNORECASE
        )
        features["resolutionCount"] = len(resolution_matches)
        
        comment_matches = re.findall(
            r'(?:COMMENTAIRE|COM\.)\s*(?:N[°o]?\s*)?(\d{2}-[A-Z])',
            minutes, re.IGNORECASE
        )
        features["commentCount"] = len(comment_matches)
        
        # Extract resolution types
        features["resolutionTypes"] = _extract_resolution_types(minutes)
        
        # Extract more keywords from minutes
        minutes_keywords = _extract_keywords(minutes.lower())
        features["keywords"].extend(minutes_keywords)
    
    # Attendees
    attendees = meeting_data.get("attendees", {})
    if isinstance(attendees, dict):
        present = attendees.get("present", [])
        features["attendeeCount"] = len(present) if isinstance(present, list) else 0
    
    # Deduplicate
    features["keywords"] = list(set(features["keywords"]))[:30]
    features["categories"] = list(set(features["categories"]))
    
    return features


# =============================================================================
# PATTERN DETECTION — Identify recurring themes and cycles
# =============================================================================

def detect_patterns(
    db_client: Any,
    lookback_meetings: int = 30,
) -> Dict:
    """
    Analyze historical meetings to detect recurring patterns.
    
    Returns:
        {
            "recurringThemes": [
                {"theme": "arrosage", "frequency": 0.6, "seasons": ["summer"], "avgResolutions": 2},
                ...
            ],
            "seasonalPatterns": {
                "spring": ["nettoyage", "plantation"],
                "summer": ["arrosage", "pesticides"],
                "fall": ["feuilles", "compostage"],
                "winter": ["déneigement", "sel"]
            },
            "unresolvedItems": [
                {"topic": "règlement arrosage", "firstMentioned": "2024-03", "mentions": 3},
                ...
            ],
            "trendingTopics": ["biodiversité", "îlots de chaleur"],
            "resolutionPatterns": {
                "interdiction": {"count": 5, "keywords": ["arrosage", "pesticides"]},
                ...
            }
        }
    """
    if not db_client:
        return _empty_patterns()
    
    try:
        # Fetch historical meetings
        meetings_query = db_client.collection("meetings").order_by(
            "date", direction="DESCENDING"
        ).limit(lookback_meetings)
        
        meetings = []
        for doc in meetings_query.stream():
            data = doc.to_dict()
            data["_id"] = doc.id
            meetings.append(data)
        
        if len(meetings) < 3:
            return _empty_patterns()
        
        # Extract features from all meetings
        all_features = [extract_meeting_features(m) for m in meetings]
        
        # 1. Recurring themes
        keyword_counter = Counter()
        keyword_seasons = defaultdict(set)
        keyword_meetings = defaultdict(int)
        
        for features in all_features:
            for kw in features["keywords"]:
                keyword_counter[kw] += 1
                keyword_seasons[kw].add(features["season"])
                keyword_meetings[kw] += 1
        
        total_meetings = len(all_features)
        recurring_themes = []
        for kw, count in keyword_counter.most_common(20):
            if count >= 2:  # Appeared in at least 2 meetings
                recurring_themes.append({
                    "theme": kw,
                    "frequency": round(count / total_meetings, 2),
                    "seasons": list(keyword_seasons[kw]),
                    "mentions": count,
                })
        
        # 2. Seasonal patterns
        seasonal_patterns = defaultdict(list)
        season_keyword_counts = defaultdict(lambda: Counter())
        
        for features in all_features:
            season = features["season"]
            for kw in features["keywords"]:
                season_keyword_counts[season][kw] += 1
        
        for season, counter in season_keyword_counts.items():
            # Get top keywords for each season
            top_keywords = [kw for kw, count in counter.most_common(10) if count >= 2]
            seasonal_patterns[season] = top_keywords
        
        # 3. Trending topics (more frequent in recent meetings)
        recent_keywords = Counter()
        older_keywords = Counter()
        mid = len(all_features) // 2
        
        for features in all_features[:mid]:
            for kw in features["keywords"]:
                recent_keywords[kw] += 1
        
        for features in all_features[mid:]:
            for kw in features["keywords"]:
                older_keywords[kw] += 1
        
        trending = []
        for kw, recent_count in recent_keywords.items():
            older_count = older_keywords.get(kw, 0)
            if recent_count > older_count + 1:
                trending.append(kw)
        
        # 4. Resolution patterns
        resolution_patterns = defaultdict(lambda: {"count": 0, "keywords": []})
        for features in all_features:
            for res_type in features["resolutionTypes"]:
                resolution_patterns[res_type]["count"] += 1
                resolution_patterns[res_type]["keywords"].extend(features["keywords"][:5])
        
        # Deduplicate keywords in resolution patterns
        for res_type in resolution_patterns:
            kws = resolution_patterns[res_type]["keywords"]
            resolution_patterns[res_type]["keywords"] = list(set(kws))[:10]
        
        return {
            "recurringThemes": recurring_themes,
            "seasonalPatterns": dict(seasonal_patterns),
            "trendingTopics": trending[:10],
            "resolutionPatterns": dict(resolution_patterns),
            "totalMeetingsAnalyzed": total_meetings,
        }
        
    except Exception as e:
        print(f"[Recommendation] Error detecting patterns: {e}")
        import traceback
        traceback.print_exc()
        return _empty_patterns()


# =============================================================================
# RESOLUTION PREDICTION — Suggest probable resolutions
# =============================================================================

def predict_resolutions(
    db_client: Any,
    current_agenda: List[Dict],
    current_date: str = "",
    meeting_context: Optional[Dict] = None,
) -> Dict:
    """
    Predict probable resolutions based on the current agenda and historical data.
    
    Uses a similarity-based approach:
    1. Extract features from current agenda
    2. Find similar past meetings
    3. Suggest resolutions based on what was resolved in similar meetings
    
    Returns:
        {
            "predictions": [
                {
                    "odjItemId": "item-1",
                    "odjTitle": "Règlement sur l'arrosage",
                    "predictedType": "interdiction",
                    "confidence": 0.85,
                    "basedOn": ["Réunion 2024-06-15", "Réunion 2023-07-10"],
                    "suggestedTemplate": "IL EST RÉSOLU que...",
                    "keywords": ["arrosage", "eau", "pelouse"],
                },
                ...
            ],
            "generalSuggestions": [
                "Basé sur les réunions précédentes, considérer un suivi sur...",
                ...
            ],
            "seasonalRelevance": ["arrosage", "pesticides"],
        }
    """
    if not db_client:
        return {"predictions": [], "generalSuggestions": [], "seasonalRelevance": []}
    
    try:
        # 1. Extract features from current agenda
        current_features = {
            "keywords": [],
            "categories": [],
        }
        
        for item in current_agenda:
            title = item.get("title", "")
            description = item.get("description", "") or item.get("objective", "")
            text = f"{title} {description}".lower()
            current_features["keywords"].extend(_extract_keywords(text))
            current_features["categories"].extend(_categorize_text(text))
        
        current_features["keywords"] = list(set(current_features["keywords"]))
        current_features["categories"] = list(set(current_features["categories"]))
        
        # 2. Get current season
        current_season = "unknown"
        if current_date:
            try:
                dt = datetime.strptime(current_date[:10], "%Y-%m-%d")
                current_season = _get_season(dt.month)
            except ValueError:
                pass
        
        # 3. Detect patterns
        patterns = detect_patterns(db_client, lookback_meetings=30)
        
        # 4. Fetch resolution templates
        templates = _get_resolution_templates(db_client)
        
        # 5. Generate predictions per agenda item
        predictions = []
        for item in current_agenda:
            title = item.get("title", "")
            item_id = item.get("id", "")
            text = f"{title} {item.get('description', '')}".lower()
            item_keywords = _extract_keywords(text)
            item_categories = _categorize_text(text)
            
            # Find matching resolution patterns
            best_match_type = None
            best_confidence = 0.0
            based_on = []
            
            for res_type, pattern_data in patterns.get("resolutionPatterns", {}).items():
                pattern_keywords = pattern_data.get("keywords", [])
                overlap = len(set(item_keywords) & set(pattern_keywords))
                if overlap > 0:
                    confidence = min(0.95, overlap / max(len(item_keywords), 1) * 0.8)
                    if confidence > best_confidence:
                        best_confidence = confidence
                        best_match_type = res_type
            
            # Find matching template
            suggested_template = ""
            if best_match_type and best_match_type in templates:
                suggested_template = templates[best_match_type]
            
            if best_confidence > 0.3:
                predictions.append({
                    "odjItemId": item_id,
                    "odjTitle": title,
                    "predictedType": best_match_type or "information",
                    "confidence": round(best_confidence, 2),
                    "suggestedTemplate": suggested_template,
                    "keywords": item_keywords[:5],
                    "categories": item_categories,
                })
        
        # 6. General suggestions
        general_suggestions = []
        
        # Seasonal relevance
        seasonal_keywords = patterns.get("seasonalPatterns", {}).get(current_season, [])
        if seasonal_keywords:
            general_suggestions.append(
                f"Sujets saisonniers typiques ({current_season}): {', '.join(seasonal_keywords[:5])}"
            )
        
        # Trending topics not on agenda
        trending = patterns.get("trendingTopics", [])
        agenda_keywords = set(current_features["keywords"])
        missing_trending = [t for t in trending if t not in agenda_keywords]
        if missing_trending:
            general_suggestions.append(
                f"Sujets tendance non à l'ordre du jour: {', '.join(missing_trending[:3])}"
            )
        
        # Recurring themes
        recurring = patterns.get("recurringThemes", [])
        high_freq = [t["theme"] for t in recurring if t["frequency"] > 0.4]
        if high_freq:
            general_suggestions.append(
                f"Thèmes récurrents (>{40}% des réunions): {', '.join(high_freq[:5])}"
            )
        
        return {
            "predictions": predictions,
            "generalSuggestions": general_suggestions,
            "seasonalRelevance": seasonal_keywords[:5],
            "patterns": {
                "totalMeetingsAnalyzed": patterns.get("totalMeetingsAnalyzed", 0),
                "recurringThemes": len(patterns.get("recurringThemes", [])),
                "trendingTopics": trending[:5],
            },
        }
        
    except Exception as e:
        print(f"[Recommendation] Error predicting resolutions: {e}")
        import traceback
        traceback.print_exc()
        return {"predictions": [], "generalSuggestions": [], "seasonalRelevance": []}


# =============================================================================
# RESOLUTION TEMPLATE LEARNING
# =============================================================================

def learn_resolution_template(
    db_client: Any,
    resolution_type: str,
    resolution_text: str,
    keywords: List[str],
    meeting_id: str,
) -> None:
    """
    Learn a resolution template from an approved PV.
    Stores the template for future recommendations.
    """
    if not db_client:
        return
    
    try:
        # Generalize the resolution text into a template
        template = _generalize_resolution(resolution_text)
        
        db_client.collection("resolution_templates").add({
            "type": resolution_type,
            "template": template,
            "originalText": resolution_text[:500],
            "keywords": keywords[:10],
            "meetingId": meeting_id,
            "timestamp": datetime.now().isoformat(),
        })
        
        print(f"[Recommendation] Learned template for type '{resolution_type}'")
        
    except Exception as e:
        print(f"[Recommendation] Error learning template: {e}")


# =============================================================================
# INTERNAL HELPERS
# =============================================================================

# Environmental keywords relevant to CCE Val-d'Or
DOMAIN_KEYWORDS = {
    "eau": ["eau", "arrosage", "aqueduc", "puits", "nappe", "rivière", "lac", "bassin", "drainage", "inondation"],
    "déchets": ["déchet", "recyclage", "compost", "poubelle", "collecte", "écocentre", "matière résiduelle"],
    "biodiversité": ["biodiversité", "faune", "flore", "arbre", "forêt", "espèce", "habitat", "milieu humide"],
    "énergie": ["énergie", "électricité", "solaire", "éolien", "gaz", "chauffage", "isolation"],
    "transport": ["transport", "vélo", "autobus", "stationnement", "circulation", "piste cyclable"],
    "urbanisme": ["urbanisme", "zonage", "construction", "terrain", "lotissement", "densification"],
    "réglementation": ["règlement", "bylaw", "interdiction", "permis", "amende", "conformité"],
    "consultation": ["consultation", "citoyen", "participation", "sondage", "audience"],
    "pesticides": ["pesticide", "herbicide", "insecticide", "pelouse", "gazon", "traitement"],
    "climat": ["climat", "GES", "carbone", "adaptation", "résilience", "îlot de chaleur"],
}


def _extract_keywords(text: str) -> List[str]:
    """Extract domain-relevant keywords from text."""
    keywords = []
    text_lower = text.lower()
    
    for category, terms in DOMAIN_KEYWORDS.items():
        for term in terms:
            if term in text_lower:
                keywords.append(term)
    
    # Also extract significant words (>4 chars, not stopwords)
    stopwords = {
        "dans", "pour", "avec", "cette", "sont", "être", "avoir", "fait",
        "plus", "tout", "nous", "vous", "leur", "même", "aussi", "comme",
        "mais", "donc", "alors", "très", "bien", "peut", "doit", "sera",
        "entre", "après", "avant", "depuis", "pendant", "encore", "autre",
        "point", "ordre", "jour", "réunion", "comité", "monsieur", "madame",
    }
    
    words = re.findall(r'\b[a-zàâäéèêëïîôùûüÿç]{5,}\b', text_lower)
    for word in words:
        if word not in stopwords and word not in keywords:
            keywords.append(word)
    
    return list(set(keywords))[:20]


def _categorize_text(text: str) -> List[str]:
    """Categorize text into domain categories."""
    categories = []
    text_lower = text.lower()
    
    for category, terms in DOMAIN_KEYWORDS.items():
        for term in terms:
            if term in text_lower:
                categories.append(category)
                break
    
    return list(set(categories))


def _get_season(month: int) -> str:
    """Get season from month number (Quebec seasons)."""
    if month in (3, 4, 5):
        return "spring"
    elif month in (6, 7, 8):
        return "summer"
    elif month in (9, 10, 11):
        return "fall"
    else:
        return "winter"


def _extract_resolution_types(minutes_text: str) -> List[str]:
    """Extract resolution types from PV text."""
    types = []
    text_lower = minutes_text.lower()
    
    type_patterns = {
        "approbation": [r"il est résolu d'approuver", r"approuvé à l'unanimité", r"adoption"],
        "interdiction": [r"il est résolu d'interdire", r"interdiction de", r"interdit"],
        "recommandation": [r"il est recommandé", r"recommandation", r"suggéré"],
        "mandat": [r"il est résolu de mandater", r"mandat", r"confier le mandat"],
        "information": [r"prend acte", r"prend note", r"information"],
        "report": [r"reporté", r"remis à", r"ajourné"],
        "création": [r"créer un comité", r"mettre en place", r"établir"],
        "modification": [r"modifier le règlement", r"amendement", r"modification"],
    }
    
    for res_type, patterns in type_patterns.items():
        for pattern in patterns:
            if re.search(pattern, text_lower):
                types.append(res_type)
                break
    
    return list(set(types))


def _get_resolution_templates(db_client: Any) -> Dict[str, str]:
    """Fetch learned resolution templates from Firestore."""
    templates = {}
    
    if not db_client:
        return _get_default_templates()
    
    try:
        docs = list(
            db_client.collection("resolution_templates").order_by(
                "timestamp", direction="DESCENDING"
            ).limit(50).stream()
        )
        
        # Group by type, keep most recent
        for doc in docs:
            data = doc.to_dict()
            res_type = data.get("type", "")
            if res_type and res_type not in templates:
                templates[res_type] = data.get("template", "")
        
        # Fill in defaults for missing types
        defaults = _get_default_templates()
        for res_type, template in defaults.items():
            if res_type not in templates:
                templates[res_type] = template
        
        return templates
        
    except Exception:
        return _get_default_templates()


def _get_default_templates() -> Dict[str, str]:
    """Default resolution templates for CCE Val-d'Or."""
    return {
        "approbation": "IL EST RÉSOLU d'approuver [OBJET] tel que présenté.\n\nProposé par: [PROPOSEUR]\nAppuyé par: [SECONDEUR]\nAdoptée à l'unanimité.",
        "interdiction": "IL EST RÉSOLU d'interdire [OBJET] sur le territoire de la Ville de Val-d'Or, conformément au règlement [NUMÉRO].\n\nProposé par: [PROPOSEUR]\nAppuyé par: [SECONDEUR]\nAdoptée à l'unanimité.",
        "recommandation": "IL EST RÉSOLU de recommander au conseil municipal [ACTION] concernant [OBJET].\n\nProposé par: [PROPOSEUR]\nAppuyé par: [SECONDEUR]\nAdoptée à l'unanimité.",
        "mandat": "IL EST RÉSOLU de mandater [PERSONNE/SERVICE] afin de [ACTION] dans un délai de [DÉLAI].\n\nProposé par: [PROPOSEUR]\nAppuyé par: [SECONDEUR]\nAdoptée à l'unanimité.",
        "information": "COMMENTAIRE — Le comité prend acte de [INFORMATION] présentée par [PERSONNE].",
        "modification": "IL EST RÉSOLU de modifier [RÈGLEMENT/POLITIQUE] afin de [CHANGEMENT].\n\nProposé par: [PROPOSEUR]\nAppuyé par: [SECONDEUR]\nAdoptée à l'unanimité.",
    }


def _generalize_resolution(text: str) -> str:
    """
    Generalize a specific resolution into a reusable template.
    Replace specific names, dates, numbers with placeholders.
    """
    template = text
    
    # Replace specific names (M./Mme + Name)
    template = re.sub(
        r'(?:M\.|Mme|Monsieur|Madame)\s+[A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]+)?',
        '[PERSONNE]',
        template
    )
    
    # Replace dates
    template = re.sub(
        r'\d{1,2}\s+(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+\d{4}',
        '[DATE]',
        template
    )
    
    # Replace resolution numbers
    template = re.sub(r'\d{2}-\d{2,3}', '[NUMÉRO]', template)
    
    # Replace specific amounts
    template = re.sub(r'\d+[\s,.]?\d*\s*\$', '[MONTANT]', template)
    
    return template


def _empty_patterns() -> Dict:
    """Return empty patterns structure."""
    return {
        "recurringThemes": [],
        "seasonalPatterns": {},
        "trendingTopics": [],
        "resolutionPatterns": {},
        "totalMeetingsAnalyzed": 0,
    }