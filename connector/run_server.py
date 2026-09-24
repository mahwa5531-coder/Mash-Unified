import os
import sys
from pathlib import Path

backend_dir = Path(__file__).parent.resolve()
nexau_dir = (backend_dir.parent / 'NexAU').resolve()
sys.path.insert(0, str(nexau_dir))
sys.path.insert(0, str(backend_dir))

import uvicorn

if __name__ == '__main__':
    from app.main import app
    uvicorn.run(app, host='127.0.0.1', port=8000, log_level='info')
