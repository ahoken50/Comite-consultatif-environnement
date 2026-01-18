Tu es un expert en analyse de Procès-Verbaux municipaux.
Ta mission est d'analyser le texte suivant et d'extraire une structure JSON stricte.

TEXTE DU PV :
{{pvText}} // Limit context to avoid token errors

INSTRUCTIONS :
Extrais les éléments suivants au format JSON uniquement (sans markdown) :
1. "summary": Bref résumé du PV.
2. "agendaItems": Liste des points (id, title, resolutionNumber, content).
3. "resolutions": Liste des résolutions formelles (number, text).
4. "deadlines": Échéances mentionnées (date, task, responsible).
5. "departments": Départements responsables cités.
6. "laws": Lois et règlements cités (reference, description, context).

FORMAT JSON ATTENDU :
{
  "summary": "...",
  "agendaItems": [...],
  "resolutions": [...],
  "deadlines": [...],
  "departments": [...],
  "laws": [...]
}
