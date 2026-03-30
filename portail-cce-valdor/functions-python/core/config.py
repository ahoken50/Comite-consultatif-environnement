import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# =============================================================================
# SINGLETON CLIENTS (Lazy Loading Pattern)
# =============================================================================
_clients = {
    "openai": None,
    "anthropic": None,
    "resend_configured": False
}

def get_openai_client():
    """Get or create OpenAI client (Singleton)"""
    if _clients["openai"] is None:
        import openai
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            print("[System] Warning: OPENAI_API_KEY not found")
        else:
            _clients["openai"] = openai.OpenAI(api_key=api_key)
            print("[System] OpenAI client initialized (Cold Start)")
    return _clients["openai"]

def get_anthropic_client():
    """Get or create Anthropic client (Singleton)"""
    if _clients["anthropic"] is None:
        from anthropic import Anthropic
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
             raise ValueError("ANTHROPIC_API_KEY not configured on server.")
        _clients["anthropic"] = Anthropic(api_key=api_key)
        print("[System] Anthropic client initialized (Cold Start)")
    return _clients["anthropic"]

def configure_resend():
    """Configure Resend API key once (Singleton)"""
    if not _clients["resend_configured"]:
        import resend
        api_key = os.environ.get("RESEND_API_KEY")
        if not api_key:
             raise ValueError("RESEND_API_KEY not configured")
        resend.api_key = api_key
        _clients["resend_configured"] = True
        print("[System] Resend configured (Cold Start)")

# Constants
MAX_WHISPER_SIZE_MB = 25
SEGMENT_DURATION_MINUTES = 10
SUPPORTED_FORMATS = ['mp3', 'mp4', 'm4a', 'wav', 'webm', 'mpeg', 'mpga', 'oga', 'ogg']
