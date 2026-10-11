import sys, os
sys.path.insert(0, os.path.abspath("connector"))
sys.path.insert(0, os.path.abspath("NexAU"))

import io
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi import HTTPException
from fastapi.datastructures import UploadFile

from app.routers.uploads import upload_file, MAX_UPLOAD_SIZE_BYTES


@pytest.mark.asyncio
async def test_upload_within_limit():
    engine = AsyncMock()
    engine.find_first.return_value = None

    data = b"Hello world within 30 MB"
    file = UploadFile(filename="small.txt", file=io.BytesIO(data))
    
    with patch("app.routers.uploads.get_session_brain_dir") as mock_dir:
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_dir.return_value = tmpdir
            res = await upload_file("sess_test", file, engine)
            assert res["status"] == "success"
            assert res["size"] == len(data)


@pytest.mark.asyncio
async def test_upload_exceeds_limit():
    engine = AsyncMock()
    engine.find_first.return_value = None

    # Simulate chunk stream exceeding 30 MB
    chunk_size = 1024 * 1024  # 1 MB
    mock_file = AsyncMock()
    # Return 31 chunks of 1 MB
    chunks = [b"x" * chunk_size] * 31
    mock_file.read.side_effect = chunks

    upload_item = UploadFile(io.BytesIO(), filename="oversized.bin")
    upload_item.read = mock_file.read

    with patch("app.routers.uploads.get_session_brain_dir") as mock_dir:
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            mock_dir.return_value = tmpdir
            with pytest.raises(HTTPException) as exc_info:
                await upload_file("sess_test", upload_item, engine)
            assert exc_info.value.status_code == 413
            assert "exceeds maximum allowed size of 30 MB" in exc_info.value.detail
