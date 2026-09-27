import os
import re
import math
import hashlib
from pathlib import Path
from typing import Any, Optional, List, Dict, Tuple
import python_calamine
import polars as pl

from nexau.archs.platform.path_helpers import (
    get_project_cache_dir,
    get_session_brain_dir,
)

def _col_index_to_letter(col_idx: int) -> str:
    """Convert 0-based column index to Excel column letter (0 -> 'A', 27 -> 'AB')."""
    result = []
    col_idx += 1
    while col_idx > 0:
        col_idx, remainder = divmod(col_idx - 1, 26)
        result.append(chr(65 + remainder))
    return "".join(reversed(result))

def _clean_val(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, float):
        if math.isnan(val) or math.isinf(val):
            return ""
        if val.is_integer():
            return str(int(val))
        return f"{val:.4f}".rstrip("0").rstrip(".")
    s = str(val).strip()
    return s

def _detect_block_type(grid: List[List[Any]]) -> str:
    """
    Classify 2D grid into one of 4 primitives:
    - text_block: 1 non-empty column or mostly single cell lines
    - kv_vertical: exactly 2 populated columns where col 0 is labels and col 1 is values
    - dense_table: rectangular table with header row and uniform columns
    - unstructured_table: irregular sparse grid or merged coordinates
    """
    if not grid or not grid[0]:
        return "text_block"
    
    nrows = len(grid)
    ncols = len(grid[0])
    
    if ncols == 1:
        return "text_block"
    
    # Check populated columns per row
    populated_per_row = [sum(1 for c in r if _clean_val(c)) for r in grid]
    max_pop = max(populated_per_row) if populated_per_row else 0
    min_pop = min(populated_per_row) if populated_per_row else 0
    
    if max_pop <= 1:
        return "text_block"
    
    # Key-Value Vertical check
    if ncols == 2 or max_pop == 2:
        # Check if first column has labels (text) and second has values
        col0_is_str = sum(1 for r in grid if isinstance(r[0], str) and _clean_val(r[0]))
        if col0_is_str >= (nrows * 0.6):
            return "kv_vertical"
            
    # Dense table check: uniform number of columns and header-like first row
    if min_pop >= (ncols * 0.6) and nrows >= 2:
        return "dense_table"
        
    return "unstructured_table"

def _render_dense_table_markdown(grid: List[List[Any]]) -> str:
    """Render a dense table with header and rows."""
    if not grid:
        return ""
    headers = [_clean_val(c) or f"Col_{idx+1}" for idx, c in enumerate(grid[0])]
    lines = []
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
    for r in grid[1:]:
        row_vals = [_clean_val(c) for c in r]
        # Pad or truncate to match headers
        while len(row_vals) < len(headers):
            row_vals.append("")
        row_vals = row_vals[:len(headers)]
        lines.append("| " + " | ".join(row_vals) + " |")
    return "\n".join(lines)

def _render_kv_vertical_markdown(grid: List[List[Any]]) -> str:
    """Render a 2-column key-value table."""
    lines = ["| Label | Value |", "|---|---|"]
    for r in grid:
        label = _clean_val(r[0]) if len(r) > 0 else ""
        val = _clean_val(r[1]) if len(r) > 1 else ""
        if label or val:
            lines.append(f"| {label} | {val} |")
    return "\n".join(lines)

def _render_unstructured_coordinate_grid(grid: List[List[Any]], start_row: int, start_col: int) -> str:
    """Render a 2D Visual Coordinate Grid with Excel column letters and row numbers."""
    ncols = len(grid[0]) if grid else 0
    col_letters = [_col_index_to_letter(start_col + i) for i in range(ncols)]
    
    lines = []
    lines.append("|   | " + " | ".join(col_letters) + " |")
    lines.append("|---|" + "|".join(["---"] * ncols) + "|")
    
    for i, row in enumerate(grid):
        row_num = start_row + i + 1
        cells = [_clean_val(c) for c in row]
        lines.append(f"| **{row_num}** | " + " | ".join(cells) + " |")
        
    return "\n".join(lines)

def parse_excel_to_markdown(
    file_path: str,
    project_id: Optional[str] = None,
    session_id: Optional[str] = None,
    max_inline_rows: int = 100,
    sheet_name: Optional[str] = None,
) -> str:
    """
    Parse an Excel workbook (.xlsx, .xls) into clean Markdown with automatic
    spatial island detection, 4 layout primitives, and Parquet caching for >100 rows.
    Supports targeted `sheet_name` extraction and automatic Sheet Index pagination for large workbooks.
    """
    path_obj = Path(file_path)
    if not path_obj.exists():
        return f"Error: Excel file not found at {file_path}"
        
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
        
    try:
        wb = python_calamine.CalamineWorkbook.from_path(str(path_obj))
        sheet_names = wb.sheet_names
        sheets_data = []
        for name in sheet_names:
            sheet = wb.get_sheet_by_name(name)
            total_h = getattr(sheet, "total_height", getattr(sheet, "height", 0))
            if total_h > 2000:
                # Large tabular dataset: stream first 100 rows using iter_rows() to prevent 2GB+ MemoryError
                head_rows = []
                for _, row in zip(range(100), sheet.iter_rows()):
                    head_rows.append(row)
                sheets_data.append((name, head_rows, total_h, True))
            else:
                sheets_data.append((name, sheet.to_python(), total_h, False))
    except Exception as e:
        # Fallback for HTML-disguised .xls files (e.g. government/tax portal exports)
        try:
            import pandas as pd
            dfs = pd.read_html(str(path_obj))
            sheet_names = [f"Table_{i+1}" for i in range(len(dfs))]
            sheets_data = []
            for name, df in zip(sheet_names, dfs):
                headers = [str(c) for c in df.columns]
                rows = [headers] + df.values.tolist()
                sheets_data.append((name, rows, len(rows), False))
        except Exception:
            return f"Error reading file: {e}"
        
    if sheet_name:
        req_norm = sheet_name.strip().lower()
        matched = [(name, grid, th, is_l) for name, grid, th, is_l in sheets_data if name.strip().lower() == req_norm]
        if not matched:
            # Handle Excel's 31-character truncation or substring match
            matched = [
                (name, grid, th, is_l) for name, grid, th, is_l in sheets_data
                if req_norm.startswith(name.strip().lower()) or name.strip().lower().startswith(req_norm) or name.strip().lower() in req_norm
            ]
        if not matched:
            available = ", ".join(f"'{s}'" for s in sheet_names)
            return f"Sheet '{sheet_name}' not found in workbook '{path_obj.name}'. Available sheets ({len(sheet_names)}): {available}"
        sheets_data = matched
        output_parts = [
            f"# Excel Sheet: {matched[0][0]} (from {path_obj.name})",
            f"**Workbook Total Sheets ({len(sheet_names)}):** {', '.join(sheet_names[:10])}{'...' if len(sheet_names) > 10 else ''}\n",
        ]
    else:
        output_parts = [
            f"# Excel Workbook: {path_obj.name}",
            f"**Sheets ({len(sheet_names)}):** {', '.join(sheet_names)}\n",
        ]
    
    # Cap multi-sheet workbooks to protect LLM context window
    MAX_FULL_SHEETS = 2
    is_multi_sheet = len(sheets_data) > 3 and not sheet_name
    index_rows = []
    
    for s_idx, (cur_sheet_name, raw_grid, sheet_total_h, is_large) in enumerate(sheets_data, 1):
        if not raw_grid or not any(any(_clean_val(c) for c in row) for row in raw_grid):
            output_parts.append(f"## Sheet {s_idx}: {cur_sheet_name} (Empty)")
            continue

        # Find non-empty bounding box
        min_r, max_r = len(raw_grid), -1
        min_c, max_c = 100000, -1
        for r_idx, row in enumerate(raw_grid):
            for c_idx, val in enumerate(row):
                if _clean_val(val):
                    if r_idx < min_r: min_r = r_idx
                    if r_idx > max_r: max_r = r_idx
                    if c_idx < min_c: min_c = c_idx
                    if c_idx > max_c: max_c = c_idx

        if max_r == -1:
            output_parts.append(f"## Sheet {s_idx}: {cur_sheet_name} (Empty)")
            continue

        # Trim grid to bounding box
        bounded_grid = [row[min_c : max_c + 1] for row in raw_grid[min_r : max_r + 1]]
        total_rows = sheet_total_h if is_large else len(bounded_grid)
        total_cols = len(bounded_grid[0]) if bounded_grid else 0

        start_cell = f"{_col_index_to_letter(min_c)}{min_r + 1}"
        end_cell = f"{_col_index_to_letter(max_c)}{min_r + total_rows}"
        loc_str = f"{cur_sheet_name}!{start_cell}:{end_cell}"

        # Partition or classify the grid
        block_type = "dense_table" if is_large else _detect_block_type(bounded_grid)

        if is_multi_sheet and s_idx > MAX_FULL_SHEETS:
            index_rows.append(f"| {s_idx} | `{cur_sheet_name}` | {total_rows} rows, {total_cols} cols | `{block_type}` |")
            continue

        output_parts.append(f"## Sheet {s_idx}: {cur_sheet_name} ({total_rows} rows, {total_cols} cols)")
        output_parts.append(f"**Location:** `{loc_str}`")
        output_parts.append(f"**Type:** `{block_type}`")

        if block_type == "dense_table":
            if total_rows <= max_inline_rows:
                output_parts.append(_render_dense_table_markdown(bounded_grid))
            else:
                # Export to Parquet
                cache_dir.mkdir(parents=True, exist_ok=True)
                clean_sheet_stem = re.sub(r"[^\w\-]", "_", cur_sheet_name)
                parquet_path = cache_dir / f"{stem}_{clean_sheet_stem}.parquet"
                
                # Fast direct conversion with Polars (streaming in compiled Rust)
                try:
                    df = pl.read_excel(str(path_obj), sheet_name=cur_sheet_name, engine="calamine")
                    df.write_parquet(parquet_path)
                    unique_headers = list(df.columns)
                except Exception:
                    headers = [_clean_val(c) or f"col_{i+1}" for i, c in enumerate(bounded_grid[0])]
                    seen: Dict[str, int] = {}
                    unique_headers = []
                    for h in headers:
                        if h in seen:
                            seen[h] += 1
                            unique_headers.append(f"{h}_{seen[h]}")
                        else:
                            seen[h] = 0
                            unique_headers.append(h)
                    data_rows = bounded_grid[1:]
                    col_data = {h: [] for h in unique_headers}
                    for r in data_rows:
                        for i, h in enumerate(unique_headers):
                            val = r[i] if i < len(r) else None
                            col_data[h].append(val)
                    df = pl.DataFrame(col_data, strict=False)
                    df.write_parquet(parquet_path)
                
                output_parts.append(f"**Storage:** `{parquet_path}`")
                output_parts.append(f"**Schema:** `{unique_headers}`")
                output_parts.append(f"**Sample Preview (First 5 Rows):**\n" + _render_dense_table_markdown(bounded_grid[:6]))
                output_parts.append(f"> [!TIP]\n> Query this dataset with DuckDB in Python:\n> `duckdb.read_parquet(r'{parquet_path}')`\n")
        elif block_type == "kv_vertical":
            output_parts.append(_render_kv_vertical_markdown(bounded_grid))
        elif block_type == "unstructured_table":
            output_parts.append(_render_unstructured_coordinate_grid(bounded_grid, min_r, min_c))
        else: # text_block
            for r in bounded_grid:
                val = " ".join(_clean_val(c) for c in r if _clean_val(c))
                if val:
                    output_parts.append(f"> {val}")
                    
        output_parts.append("\n---\n")

    if index_rows:
        output_parts.append(f"## Workbook Sheet Index (Sheets {MAX_FULL_SHEETS + 1} to {len(sheets_data)})\n")
        output_parts.append("| # | Sheet Name | Dimensions | Type |")
        output_parts.append("|---|---|---|---|")
        output_parts.extend(index_rows)
        output_parts.append(
            f"\n> [!IMPORTANT]\n"
            f"> The table above is a summary index of remaining sheets. You do NOT have the data rows for these sheets in context yet.\n"
            f"> To read the data from any indexed sheet, call: `view_file(file_path=\"{file_path}\", sheet_name=\"<Sheet Name>\")`\n"
            f"> NEVER guess or hallucinate financial numbers without inspecting the specific sheet!\n"
        )

    return "\n".join(output_parts)