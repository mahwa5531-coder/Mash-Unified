import os
import urllib.request
import urllib.parse
import json

def test_file_viewers_endpoints():
    base_url = "http://127.0.0.1:8000"
    base_dir = os.path.abspath("scratch/demo_files")

    # 1. Python file contract
    py_path = os.path.join(base_dir, "sample_python.py").replace("\\", "/")
    url = f"{base_url}/files/content?path={urllib.parse.quote(py_path)}"
    with urllib.request.urlopen(url) as res:
        assert res.status == 200
        data = json.loads(res.read().decode("utf-8"))
        assert "calculate_anomaly_score" in data.get("content", "")

    # 2. C file contract
    c_path = os.path.join(base_dir, "sample_c.c").replace("\\", "/")
    url = f"{base_url}/files/content?path={urllib.parse.quote(c_path)}"
    with urllib.request.urlopen(url) as res:
        assert res.status == 200
        data = json.loads(res.read().decode("utf-8"))
        assert "AuditVoucher" in data.get("content", "")

    # 3. Rust file contract
    rs_path = os.path.join(base_dir, "sample_rust.rs").replace("\\", "/")
    url = f"{base_url}/files/content?path={urllib.parse.quote(rs_path)}"
    with urllib.request.urlopen(url) as res:
        assert res.status == 200
        data = json.loads(res.read().decode("utf-8"))
        assert "reconcile_ledger" in data.get("content", "")

    # 4. CSV raw file contract (for CsvViewer)
    csv_path = os.path.join(base_dir, "sample_data.csv").replace("\\", "/")
    url = f"{base_url}/files/content?path={urllib.parse.quote(csv_path)}&raw=true"
    with urllib.request.urlopen(url) as res:
        assert res.status == 200
        raw_text = res.read().decode("utf-8")
        assert "Transaction_ID,Vendor_Name" in raw_text

    # 5. Excel binary fallback contract
    xlsx_path = os.path.join(base_dir, "sample_ledger.xlsx").replace("\\", "/")
    url = f"{base_url}/files/content?path={urllib.parse.quote(xlsx_path)}&raw=true"
    with urllib.request.urlopen(url) as res:
        assert res.status == 200
        raw_bytes = res.read()
        assert len(raw_bytes) > 0

    print("All file viewer contracts verified successfully.")

if __name__ == "__main__":
    test_file_viewers_endpoints()
