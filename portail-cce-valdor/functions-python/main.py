import functions_framework
import json
import os
from datetime import datetime, timedelta
from google.cloud import firestore
from google.cloud import tasks_v2
from google.protobuf import timestamp_pb2
from speechmatics.models import BatchTranscriptionJob
from speechmatics.client import BatchClient
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Firestore client
db = firestore.client()

# Speechmatics credentials
SPEECHMATICS_API_KEY = os.environ.get('SPEECHMATICS_API_KEY')
SPEECHMATICS_WORKSPACE_ID = os.environ.get('SPEECHMATICS_WORKSPACE_ID')


@functions_framework.http
def process_meeting_transcription(request):
    """
    HTTP Cloud Function to process meeting transcription requests.
    
    Expected JSON payload:
    {
        "meetingId": "string",
        "audioUrl": "string",
        "meetingTitle": "string",
        "language": "string"
    }
    """
    try:
        request_json = request.get_json()
        meeting_id = request_json.get('meetingId')
        audio_url = request_json.get('audioUrl')
        meeting_title = request_json.get('meetingTitle')
        language = request_json.get('language', 'en')

        if not all([meeting_id, audio_url, meeting_title]):
            return {'error': 'Missing required fields'}, 400

        # Create Speechmatics batch transcription job
        client = BatchClient(api_key=SPEECHMATICS_API_KEY)
        
        job = BatchTranscriptionJob(
            language=language,
            workspace_id=SPEECHMATICS_WORKSPACE_ID
        )
        
        submitted_job = client.submit_job(job, audio_url)
        job_id = submitted_job.id

        # Store job metadata in Firestore
        db.collection('meetings').document(meeting_id).update({
            'transcriptionJobId': job_id,
            'transcriptionStatus': 'processing',
            'jobStartTime': datetime.utcnow(),
            'audioUrl': audio_url,
            'language': language
        })

        logger.info(f"Transcription job {job_id} submitted for meeting {meeting_id}")
        
        return {
            'success': True,
            'jobId': job_id,
            'meetingId': meeting_id
        }, 200

    except Exception as e:
        logger.error(f"Error processing transcription: {str(e)}")
        return {'error': str(e)}, 500


@functions_framework.cloud_event
def monitor_speechmatics_jobs(cloud_event):
    """
    Cloud Scheduler triggered function to monitor Speechmatics transcription jobs.
    
    Checks all meetings with transcriptionStatus="processing" and updates them
    when jobs complete or fail. Non-blocking operation that doesn't require
    client-side polling.
    
    Triggered by: Cloud Scheduler (typically every 2-5 minutes)
    """
    try:
        logger.info("Starting Speechmatics job monitoring")
        
        # Initialize Speechmatics client
        client = BatchClient(api_key=SPEECHMATICS_API_KEY)
        
        # Query all meetings with processing status
        processing_meetings = db.collection('meetings').where(
            'transcriptionStatus', '==', 'processing'
        ).stream()
        
        updated_count = 0
        failed_count = 0
        
        for meeting_doc in processing_meetings:
            try:
                meeting_data = meeting_doc.to_dict()
                meeting_id = meeting_doc.id
                job_id = meeting_data.get('transcriptionJobId')
                
                if not job_id:
                    logger.warning(f"Meeting {meeting_id} missing transcriptionJobId")
                    continue
                
                # Get job status from Speechmatics
                job = client.get_job(job_id)
                
                logger.info(f"Job {job_id} status: {job.status}")
                
                # Handle completed jobs
                if job.status == 'done':
                    # Retrieve transcript
                    transcript_response = client.get_job_transcript(job_id)
                    
                    # Extract transcript text from response
                    transcript_text = ""
                    if hasattr(transcript_response, 'messages'):
                        for message in transcript_response.messages:
                            if hasattr(message, 'data') and hasattr(message.data, 'results'):
                                for result in message.data.results:
                                    if hasattr(result, 'alternatives') and result.alternatives:
                                        transcript_text += result.alternatives[0].get('transcript', '')
                    
                    # Update Firestore with completed status and transcript
                    db.collection('meetings').document(meeting_id).update({
                        'transcriptionStatus': 'completed',
                        'transcript': transcript_text,
                        'jobCompletionTime': datetime.utcnow(),
                        'jobStatus': job.status
                    })
                    
                    logger.info(f"Meeting {meeting_id} transcription completed")
                    updated_count += 1
                
                # Handle failed jobs
                elif job.status == 'rejected':
                    error_message = getattr(job, 'error_message', 'Unknown error')
                    
                    db.collection('meetings').document(meeting_id).update({
                        'transcriptionStatus': 'failed',
                        'transcriptionError': error_message,
                        'jobCompletionTime': datetime.utcnow(),
                        'jobStatus': job.status
                    })
                    
                    logger.error(f"Meeting {meeting_id} transcription failed: {error_message}")
                    failed_count += 1
                
                # Job still processing - no action needed
                elif job.status == 'submitted':
                    logger.info(f"Job {job_id} still processing")
                    
            except Exception as e:
                logger.error(f"Error processing job for meeting {meeting_id}: {str(e)}")
                failed_count += 1
                continue
        
        summary = {
            'status': 'success',
            'timestamp': datetime.utcnow().isoformat(),
            'jobsUpdated': updated_count,
            'jobsFailed': failed_count,
            'message': f"Processed {updated_count + failed_count} meetings"
        }
        
        logger.info(f"Monitoring complete: {summary}")
        return summary
        
    except Exception as e:
        logger.error(f"Critical error in job monitoring: {str(e)}")
        return {
            'status': 'error',
            'timestamp': datetime.utcnow().isoformat(),
            'error': str(e)
        }
