import datetime
from firebase_admin import firestore
from firebase_functions import firestore_fn
from .firebase_init import db

@firestore_fn.on_document_updated(
    document="meetings/{meetingId}",
    region="us-central1"
)
def on_meeting_updated(event: firestore_fn.Event[firestore_fn.Change[firestore_fn.DocumentSnapshot]]) -> None:
    """
    Trigger that fires when a Meeting is updated.
    Syncs changes to LinkedResolutions within Projects to ensure data integrity.
    """
    meeting_id = event.params.get("meetingId")
    if not meeting_id:
        return

    before_data = event.data.before.to_dict() or {}
    after_data = event.data.after.to_dict() or {}

    before_agenda = before_data.get("agendaItems", [])
    after_agenda = after_data.get("agendaItems", [])

    # We only care if agendaItems have changed (especially minuteEntries)
    if before_agenda == after_agenda and before_data.get("title") == after_data.get("title") and before_data.get("date") == after_data.get("date"):
        return

    print(f"[Triggers] Meeting {meetingId} updated. Verifying linked projects...")

    # For each agenda item that has linked projects
    updates_needed = {} # projectId -> [list of modified linkedResolutions]
    
    # Pre-calculate a lookup for the new resolutions
    # Key: f"{meetingId}_{agendaItemId}_{entryNumber}" OR entryIndex
    new_entries_lookup = {}
    for item in after_agenda:
        item_id = item.get("id")
        entries = item.get("minuteEntries", [])
        for i, entry in enumerate(entries):
            key = f"{item_id}_{entry.get('number', '')}_{i}"
            new_entries_lookup[key] = {
                "content": entry.get("content", ""),
                "title": item.get("title", ""),
                "type": entry.get("type", "resolution"),
                "number": entry.get("number", "")
            }

    # Find all projects that hold linkedResolutions from this meeting
    projects_ref = db.collection("projects").where("linkedMeetingIds", "array_contains", meeting_id)
    projects_snap = projects_ref.stream()

    for project in projects_snap:
        proj_data = project.to_dict()
        linked_resolutions = proj_data.get("linkedResolutions", [])
        
        has_changes = False
        new_linked_resolutions = []
        
        for lr in linked_resolutions:
            # Only check resolutions from THIS meeting
            if lr.get("meetingId") == meeting_id:
                agenda_item_id = lr.get("agendaItemId", "")
                entry_number = lr.get("entryNumber", "")
                entry_index = lr.get("entryIndex", 0)
                
                # Check if it was modified
                key = f"{agenda_item_id}_{entry_number}_{entry_index}"
                new_entry_data = new_entries_lookup.get(key)
                
                if new_entry_data:
                    # Check if anything changed
                    new_content = new_entry_data["content"]
                    # If content exceeded 200 chars in original logic, we need to handle it.
                    # Usually we just take the first few or let the frontend slice it.
                    # Let's just sync the exact content from the DB.
                    if lr.get("entryContent") != new_content or \
                       lr.get("meetingTitle") != after_data.get("title") or \
                       lr.get("meetingDate") != after_data.get("date"):
                        
                        lr["entryContent"] = new_content
                        lr["meetingTitle"] = after_data.get("title", "")
                        lr["meetingDate"] = after_data.get("date", "")
                        lr["entryType"] = new_entry_data["type"]
                        lr["agendaItemTitle"] = new_entry_data["title"]
                        has_changes = True

            new_linked_resolutions.append(lr)
            
        if has_changes:
            print(f"[Triggers] Syncing resolutions for Project {project.id}")
            db.collection("projects").document(project.id).update({
                "linkedResolutions": new_linked_resolutions,
                "dateUpdated": datetime.datetime.now().isoformat()
            })

@firestore_fn.on_document_deleted(
    document="meetings/{meetingId}",
    region="us-central1"
)
def on_meeting_deleted(event: firestore_fn.Event[firestore_fn.DocumentSnapshot]) -> None:
    """
    Trigger that fires when a Meeting is deleted.
    Removes the meeting ID AND all its linkedResolutions from all Projects.
    """
    meeting_id = event.params.get("meetingId")
    if not meeting_id:
        return

    print(f"[Triggers] Meeting {meetingId} deleted. Cleaning up linked projects...")

    projects_ref = db.collection("projects").where("linkedMeetingIds", "array_contains", meeting_id)
    projects_snap = projects_ref.stream()

    for project in projects_snap:
        proj_data = project.to_dict()
        
        # Remove from linkedMeetingIds
        meeting_ids = proj_data.get("linkedMeetingIds", [])
        new_meeting_ids = [m for m in meeting_ids if m != meeting_id]
        
        # Remove from linkedResolutions
        linked_resolutions = proj_data.get("linkedResolutions", [])
        new_linked_resolutions = [r for r in linked_resolutions if r.get("meetingId") != meeting_id]
        
        db.collection("projects").document(project.id).update({
            "linkedMeetingIds": new_meeting_ids,
            "linkedResolutions": new_linked_resolutions,
            "dateUpdated": datetime.datetime.now().isoformat()
        })
        print(f"[Triggers] Cleaned up Project {project.id}")


@firestore_fn.on_document_updated(
    document="council_recommendations/{recommendationId}",
    region="us-central1"
)
def on_recommendation_updated(event: firestore_fn.Event[firestore_fn.Change[firestore_fn.DocumentSnapshot]]) -> None:
    """
    Trigger that fires when a CouncilRecommendation is updated.
    If it becomes 'accepted', log a comment in the linked project.
    """
    recommendation_id = event.params.get("recommendationId")
    if not recommendation_id:
        return

    before_data = event.data.before.to_dict() or {}
    after_data = event.data.after.to_dict() or {}

    before_status = before_data.get("status")
    after_status = after_data.get("status")

    if before_status == after_status or after_status != "accepted":
        return

    print(f"[Triggers] Recommendation {recommendationId} was accepted. Updating projects...")

    linked_project_ids = after_data.get("linkedProjectIds", [])
    if not linked_project_ids:
        # Legacy fallback
        p_id = after_data.get("projectId")
        if p_id:
            linked_project_ids = [p_id]

    import uuid
    for p_id in linked_project_ids:
        comment_content = (
            f"✅ **Recommandation acceptée** par le conseil municipal.\n\n"
            f"Résolution: {after_data.get('councilResolutionNumber', 'N/A')}\n"
            f"Réunion CCE d'origine: {after_data.get('meetingDate', 'N/A')}\n"
        )
        
        new_comment = {
            "id": str(uuid.uuid4()),
            "userId": "system_auto",
            "userName": "Système (Automatisé)",
            "content": comment_content,
            "createdAt": datetime.datetime.now().isoformat()
        }
        
        # Atomic array union for comments
        db.collection("projects").document(p_id).update({
            "comments": firestore.ArrayUnion([new_comment]),
            "dateUpdated": datetime.datetime.now().isoformat()
        })
        print(f"[Triggers] Added auto-comment to Project {p_id}")
