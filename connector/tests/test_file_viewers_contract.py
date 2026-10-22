import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))
from app.main import app, lifespan


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"

@pytest.mark.anyio
async def test_file_viewers_endpoints(tmp_path):
    demo_dir = tmp_path / "demo_files"
    demo_dir.mkdir(parents=True, exist_ok=True)

    py_file = demo_dir / "sample_python.py"
    py_file.write_text("def calculate_anomaly_score():\n    return 0.99\n", encoding="utf-8")

    c_file = demo_dir / "sample_c.c"
    c_file.write_text("struct AuditVoucher {\n    int id;\n};\n", encoding="utf-8")

    rs_file = demo_dir / "sample_rust.rs"
    rs_file.write_text("fn reconcile_ledger() -> bool { true }\n", encoding="utf-8")

    csv_file = demo_dir / "sample_data.csv"
    csv_file.write_text("Transaction_ID,Vendor_Name\n101,Acme Corp\n", encoding="utf-8")

    xlsx_file = demo_dir / "sample_ledger.xlsx"
    xlsx_file.write_bytes(b"PK\x03\x04mock_excel_bytes")

    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30.0) as client:
            # Register workspace folder as project
            proj_res = await client.post("/api/projects", json={
                "user_id": "test_viewer_user",
                "name": "Viewer Test Project",
                "local_folder_path": str(demo_dir)
            })
            assert proj_res.status_code == 200

            # 1. Python file contract
            res = await client.get("/files/content", params={"path": str(py_file).replace("\\", "/")})
            assert res.status_code == 200
            data = res.json()
            assert "calculate_anomaly_score" in data.get("content", "")

            # 2. C file contract
            res = await client.get("/files/content", params={"path": str(c_file).replace("\\", "/")})
            assert res.status_code == 200
            data = res.json()
            assert "AuditVoucher" in data.get("content", "")

            # 3. Rust file contract
            res = await client.get("/files/content", params={"path": str(rs_file).replace("\\", "/")})
            assert res.status_code == 200
            data = res.json()
            assert "reconcile_ledger" in data.get("content", "")

            # 4. CSV raw file contract (for CsvViewer)
            res = await client.get("/files/content", params={"path": str(csv_file).replace("\\", "/"), "raw": "true"})
            assert res.status_code == 200
            assert "Transaction_ID,Vendor_Name" in res.text

            # 5. Excel binary fallback contract
            res = await client.get("/files/content", params={"path": str(xlsx_file).replace("\\", "/"), "raw": "true"})
            assert res.status_code == 200
            assert len(res.content) > 0

            # 6. File under 10MB (2MB) read in full without truncation or synthetic banner
            medium_file = demo_dir / "medium_file.txt"
            medium_content = "DATA_LINE\n" * 200_000  # ~2 MB
            medium_file.write_text(medium_content, encoding="utf-8")
            res = await client.get("/files/content", params={"path": str(medium_file).replace("\\", "/")})
            assert res.status_code == 200
            data = res.json()
            assert data.get("is_truncated") is not True
            assert "[MASH SAFE PREVIEW:" not in data.get("content", "")
            assert len(data.get("content", "")) == len(medium_content)

            # 7. File exceeding 10MB cleanly truncated with is_truncated=True and no synthetic banner
            huge_file = demo_dir / "huge_file.txt"
            huge_line = "CHUNK_OF_LOG_DATA_FOR_AUDIT_VERIFICATION_TESTING\n"  # 49 chars
            # Write 210_000 lines ~ 10.29 MB
            with open(huge_file, "w", encoding="utf-8") as f:
                for _ in range(210_000):
                    f.write(huge_line)
            res = await client.get("/files/content", params={"path": str(huge_file).replace("\\", "/")})
            assert res.status_code == 200
            data = res.json()
            assert data.get("is_truncated") is True
            assert "[MASH SAFE PREVIEW:" not in data.get("content", "")
            assert len(data.get("content", "")) <= 10_000_000
            assert data.get("content", "").startswith("CHUNK_OF_LOG_DATA")

            # 8. File exceeding 10MB with early newline followed by minified single line preserves ~10MB
            minified_file = demo_dir / "minified_huge.json"
            with open(minified_file, "w", encoding="utf-8") as f:
                f.write("// header\n" + "A" * 10_500_000)
            res = await client.get("/files/content", params={"path": str(minified_file).replace("\\", "/")})
            assert res.status_code == 200
            data = res.json()
            assert data.get("is_truncated") is True
            # Must retain ~10MB preview instead of collapsing down to 10 bytes of '// header\n'
            assert len(data.get("content", "")) == 10_000_000

