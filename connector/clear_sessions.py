import asyncio
import sys
from pathlib import Path

# Add NexAU to path
_nexau_dir = Path(__file__).resolve().parent.parent / "NexAU"
if _nexau_dir.exists() and str(_nexau_dir) not in sys.path:
    sys.path.insert(0, str(_nexau_dir))

sys.path.append(str(Path.cwd()))

from nexau.archs.session.orm import ComparisonFilter
from nexau.archs.session.models import SessionModel, AgentRunActionModel
from nexau.archs.session.session_manager import get_session_manager

async def clear_all():
    sm = get_session_manager()
    eng = sm._engine
    sessions = await eng.find_many(SessionModel, filters=[])
    for s in sessions:
        await eng.delete(AgentRunActionModel, filters=ComparisonFilter.eq("session_id", s.session_id))
        await eng.delete(SessionModel, filters=ComparisonFilter.eq("session_id", s.session_id))
    print(f"Cleared {len(sessions)} sessions.")
    
asyncio.run(clear_all())
