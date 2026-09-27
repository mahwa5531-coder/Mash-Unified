import os
import hashlib
from pathlib import Path
from typing import Optional
import polars as pl

from nexau.archs.platform.path_helpers import (
    get_project_cache_dir,
    get_session_brain_dir,
)

def parse_csv_to_markdown(
    file_path: str,
    project_id: Optional[str] = None,
    session_id: Optional[str] = None,
    max_inline_rows: int = 100,
) -> str:
    """
    Parse a CSV file into clean Markdown. If rows > 100, generates a Parquet file
    in project/session cache and returns column schema, storage path, and preview.
    """
    path_obj = Path(file_path)
    if not path_obj.exists():
        return f"Error: CSV file not found at {file_path}"
        
    stem = path_obj.stem
    path_hash = hashlib.sha256(str(path_obj.resolve()).lower().encode()).hexdigest()[:8]
    bundle_name = f"{stem}_{path_hash}_fast_bundle"
    cache_dir: Path
    if session_id:
        cache_dir = get_session_brain_dir(session_id, None) / "cache" / bundle_name
    elif project_id:
        cache_dir = get_project_cache_dir(project_id) / bundle_name
    else:
        cache_dir = Path.home() / ".nexau" / "cache" / bundle_name
        
    # Read with Polars with automatic encoding & ragged line handling
    try:
        df = pl.read_csv(
            str(path_obj),
            infer_schema_length=10000,
            ignore_errors=True,
            truncate_ragged_lines=True,
        )
    except Exception:
        try:
            df = pl.read_csv(
                str(path_obj),
                encoding="latin1",
                infer_schema_length=10000,
                ignore_errors=True,
                truncate_ragged_lines=True,
            )
        except Exception as e:
            return f"Error reading CSV {file_path}: {e}"
        
    total_rows = len(df)
    cols = df.columns
    
    output_parts = [
        f"# CSV Dataset: {path_obj.name}",
        f"**Dimensions:** {total_rows} rows, {len(cols)} columns",
    ]
    
    if total_rows <= max_inline_rows:
        # Inline Markdown table
        headers = [str(c) for c in cols]
        lines = []
        lines.append("| " + " | ".join(headers) + " |")
        lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
        for row in df.iter_rows():
            row_str = [str(v) if v is not None else "" for v in row]
            lines.append("| " + " | ".join(row_str) + " |")
        output_parts.append("\n".join(lines))
    else:
        # Export to Parquet
        cache_dir.mkdir(parents=True, exist_ok=True)
        parquet_path = cache_dir / f"{stem}.parquet"
        df.write_parquet(parquet_path)
        
        output_parts.append(f"**Storage:** `{parquet_path}`")
        output_parts.append(f"**Schema:** `{cols}`")
        
        # Sample 5 rows
        sample_df = df.head(5)
        headers = [str(c) for c in cols]
        lines = []
        lines.append("| " + " | ".join(headers) + " |")
        lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
        for row in sample_df.iter_rows():
            row_str = [str(v) if v is not None else "" for v in row]
            lines.append("| " + " | ".join(row_str) + " |")
            
        output_parts.append(f"**Sample Preview (First 5 Rows):**\n" + "\n".join(lines))
        output_parts.append(
            f"> [!TIP]\n"
            f"> To analyze or query this full {total_rows}-row dataset, run Python with polars (or write a Python script):\n"
            f"> `python -c \"import polars as pl; df = pl.read_parquet(r'{parquet_path}'); print(df.describe())\"`\n"
        )

    return "\n".join(output_parts)