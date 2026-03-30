def get_cors_headers(req):
    """
    Generate robust CORS headers supporting credentials and dynamic origins.
    Using * with credentials is not allowed, so we must reflect the origin.
    """
    origin = req.headers.get("Origin")
    allowed = [
        "https://comite-cce.web.app", 
        "http://localhost:5173", 
        "http://localhost:5174", 
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5000",
        "http://127.0.0.1:5001"
    ]
    if origin not in allowed:
        origin = allowed[0] # Default to production or safe origin
        
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "3600"
    }
