import os
import sys
import pytest
from pathlib import Path
import httpx

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
