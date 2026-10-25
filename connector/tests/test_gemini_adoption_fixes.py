"""
Unit tests for Gemini CLI adoption fixes in MASH:
1. Atomic file writing in LocalSandbox (os.replace).
2. BOM-aware decoding in read_file (UTF-8, UTF-16 LE/BE, UTF-32).
3. RFC 9110 compliant HEAD pre-flight support for PDF and file viewers.
"""

import os
import sys
import tempfile
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
from app.main import app, lifespan
from nexau.archs.sandbox.local_sandbox import LocalSandbox
from nexau.archs.tool.builtin.file_tools.read_file import _read_text_lossy


def test_atomic_file_write_preserves_content_and_overwrites():
    sandbox = LocalSandbox()
    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "audit_paper.txt"
        test_file.write_text("INITIAL REVENUE: $100,000", encoding="utf-8")

        # Overwrite with new content
        res = sandbox.write_file(str(test_file), "UPDATED REVENUE: $125,000", encoding="utf-8")
        assert res.status.value == "success"

        # Verify target file has updated content
        assert test_file.read_text(encoding="utf-8") == "UPDATED REVENUE: $125,000"

        # Verify no temporary files remain in directory
        temp_files = list(Path(tmpdir).glob(".*.tmp_*"))
        assert len(temp_files) == 0


def test_bom_aware_reading_utf16_and_utf32():
    sandbox = LocalSandbox()
    with tempfile.TemporaryDirectory() as tmpdir:
        p_utf8 = Path(tmpdir) / "test_utf8.txt"
        p_utf8_bom = Path(tmpdir) / "test_utf8_bom.txt"
        p_utf16_le = Path(tmpdir) / "test_utf16_le.txt"
        p_utf16_le_raw = Path(tmpdir) / "test_utf16_le_raw.txt"
        p_utf16_be = Path(tmpdir) / "test_utf16_be.txt"
        p_utf32_le = Path(tmpdir) / "test_utf32_le.txt"

        expected_text = "Audit Verification: Balance = $5,420,100.25\nNo variance detected."

        p_utf8.write_text(expected_text, encoding="utf-8")
        p_utf8_bom.write_bytes(b"\xef\xbb\xbf" + expected_text.encode("utf-8"))
        p_utf16_le.write_bytes(b"\xff\xfe" + expected_text.encode("utf-16-le"))
        p_utf16_le_raw.write_bytes(expected_text.encode("utf-16-le"))
        p_utf16_be.write_bytes(b"\xfe\xff" + expected_text.encode("utf-16-be"))
        p_utf32_le.write_bytes(b"\xff\xfe\x00\x00" + expected_text.encode("utf-32-le"))

        read_utf8 = _read_text_lossy(str(p_utf8), sandbox)
        read_utf8_bom = _read_text_lossy(str(p_utf8_bom), sandbox)
        read_utf16_le = _read_text_lossy(str(p_utf16_le), sandbox)
        read_utf16_le_raw = _read_text_lossy(str(p_utf16_le_raw), sandbox)
        read_utf16_be = _read_text_lossy(str(p_utf16_be), sandbox)
        read_utf32_le = _read_text_lossy(str(p_utf32_le), sandbox)

        # Assert no null bytes in text files
        for name, txt in [
            ("utf8", read_utf8),
            ("utf8_bom", read_utf8_bom),
            ("utf16_le", read_utf16_le),
            ("utf16_le_raw", read_utf16_le_raw),
            ("utf16_be", read_utf16_be),
            ("utf32_le", read_utf32_le),
        ]:
            assert "\x00" not in txt, f"Null bytes found in {name}"
            assert "Audit Verification" in txt, f"Content mismatch in {name}"
            assert "$5,420,100.25" in txt, f"Amount mismatch in {name}"


@pytest.mark.anyio
async def test_pdf_and_file_head_preflight_rfc9110(tmp_path):
    demo_pdf = tmp_path / "audit_report.pdf"
    raw_pdf_bytes = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"
    demo_pdf.write_bytes(raw_pdf_bytes)

    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            # Register workspace folder to authorize access
            proj_res = await client.post("/api/projects", json={
                "user_id": "test_viewer_user",
                "name": "PDF Preflight Project",
                "local_folder_path": str(tmp_path)
            })
            assert proj_res.status_code == 200

            # 1. Test HEAD pre-flight (PDF-DEFECT-1)
            head_res = await client.head("/files/content", params={"path": str(demo_pdf)})
            assert head_res.status_code == 200
            assert head_res.headers.get("content-type") == "application/pdf"
            assert head_res.headers.get("accept-ranges") == "bytes"
            assert int(head_res.headers.get("content-length", 0)) == len(raw_pdf_bytes)
            assert len(head_res.content) == 0, "HEAD response must have 0 body bytes per RFC 9110"

            # 2. Test GET fetch
            get_res = await client.get("/files/content", params={"path": str(demo_pdf)})
            assert get_res.status_code == 200
            assert get_res.content == raw_pdf_bytes


