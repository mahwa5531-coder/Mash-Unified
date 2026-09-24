"use client";

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  Table, BarChart2, TrendingUp, Search, Copy, Download, 
  Check, FileSpreadsheet, ChevronLeft, ChevronRight, Loader2 
} from 'lucide-react';
import { BASE_URL, fetchExcelData } from '../../utils/apiClient';

export interface ExcelWorkbookData {
  type: 'excel';
  filename: string;
  path?: string;
  sheets?: Record<string, (string | number)[][]>;
  sheet_names: string[];
  active_sheet?: string;
  total_rows?: number;
  total_cols?: number;
  page?: number;
  page_size?: number;
  total_pages?: number;
  headers?: string[];
  columns?: string[];
  rows?: (string | number)[][];
}

interface ExcelViewerProps {
  data: ExcelWorkbookData;
  filename: string;
  path?: string;
}

// Convert column index (0-based) to Excel letters (A, B, ... Z, AA, AB ...)
function getColumnLetter(colIndex: number): string {
  let letter = '';
  let temp = colIndex;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

export default function ExcelViewer({ data, filename, path }: ExcelViewerProps) {
  const sheetNames = useMemo(() => {
    if (data.sheet_names && data.sheet_names.length > 0) return data.sheet_names;
    if (data.sheets) return Object.keys(data.sheets);
    return ['Sheet1'];
  }, [data.sheet_names, data.sheets]);

  const [activeSheet, setActiveSheet] = useState<string>(data.active_sheet || sheetNames[0] || 'Sheet1');
  const [currentPage, setCurrentPage] = useState<number>(data.page || 0);
  const [pageSize] = useState<number>(data.page_size || 200);
  const [totalRows, setTotalRows] = useState<number>(data.total_rows || (data.sheets?.[sheetNames[0]]?.length || 0));
  const [totalPages, setTotalPages] = useState<number>(data.total_pages || Math.max(1, Math.ceil((data.total_rows || 1) / (data.page_size || 200))));
  
  // Current page rows
  const [pageRows, setPageRows] = useState<(string | number)[][]>(() => {
    if (data.rows && data.rows.length > 0) return data.rows;
    if (data.sheets && data.sheets[activeSheet]) return data.sheets[activeSheet];
    return [];
  });

  const [headers, setHeaders] = useState<string[]>(() => {
    if (data.headers && data.headers.length > 0) return data.headers;
    if (data.rows && data.rows.length > 0) return data.rows[0].map(String);
    return [];
  });

  const [isLoadingPage, setIsLoadingPage] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'table' | 'chart'>('table');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  // Chart configuration state
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');
  const [xAxisColIdx, setXAxisColIdx] = useState<number>(0);
  const [yAxisColIdx, setYAxisColIdx] = useState<number>(1);
  const [hoveredPoint, setHoveredPoint] = useState<{ label: string; value: number; x: number; y: number } | null>(null);

  // Update state when initial data prop changes
  useEffect(() => {
    if (Array.isArray(data.rows)) {
      setPageRows(data.rows);
    } else if (data.sheets && data.sheets[activeSheet]) {
      setPageRows(data.sheets[activeSheet]);
    }
    if (Array.isArray(data.headers)) {
      setHeaders(data.headers);
    }
    if (data.total_rows !== undefined) {
      setTotalRows(data.total_rows);
      setTotalPages(data.total_pages || Math.max(1, Math.ceil(data.total_rows / pageSize)));
    }
    if (data.active_sheet) {
      setActiveSheet(data.active_sheet);
    }
  }, [data, activeSheet, pageSize]);

  // Max columns count in current sheet
  const maxCols = useMemo(() => {
    let max = headers.length;
    for (const row of pageRows) {
      if (row.length > max) max = row.length;
    }
    return Math.max(max, 1);
  }, [pageRows, headers]);

  // Detect which columns are numeric for charting
  const numericColIndices = useMemo(() => {
    const indices: number[] = [];
    if (pageRows.length === 0) return indices;
    
    // Test non-header rows
    const testRows = pageRows.slice(currentPage === 0 ? 1 : 0, 30);
    for (let c = 0; c < maxCols; c++) {
      let numericCount = 0;
      let nonBlankCount = 0;
      for (const row of testRows) {
        const val = row[c];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          nonBlankCount++;
          const num = Number(String(val).replace(/[$,,%]/g, ''));
          if (!isNaN(num)) numericCount++;
        }
      }
      if (nonBlankCount > 0 && numericCount / nonBlankCount >= 0.7) {
        indices.push(c);
      }
    }
    return indices;
  }, [pageRows, maxCols, currentPage]);

  // Auto-select valid numeric column for Y axis if not set
  useEffect(() => {
    if (numericColIndices.length > 0 && !numericColIndices.includes(yAxisColIdx)) {
      setYAxisColIdx(numericColIndices[0]);
    }
    if (numericColIndices.includes(xAxisColIdx) && numericColIndices.length > 1) {
      const nonNumeric = Array.from({ length: maxCols }, (_, i) => i).find(i => !numericColIndices.includes(i));
      if (nonNumeric !== undefined) setXAxisColIdx(nonNumeric);
    }
  }, [numericColIndices, yAxisColIdx, xAxisColIdx, maxCols]);

  // Load a specific page or sheet via Rust endpoint
  const loadPage = useCallback(async (targetSheet: string, targetPage: number) => {
    if (!path) return;
    setIsLoadingPage(true);
    try {
      const resp = await fetchExcelData(path, targetSheet, targetPage, pageSize);
      if (resp && resp.type === 'excel') {
        setActiveSheet(resp.active_sheet || targetSheet);
        setCurrentPage(resp.page !== undefined ? resp.page : targetPage);
        setTotalRows(resp.total_rows || 0);
        setTotalPages(resp.total_pages || Math.max(1, Math.ceil((resp.total_rows || 1) / pageSize)));
        if (resp.rows) setPageRows(resp.rows);
        if (resp.headers && resp.headers.length > 0) setHeaders(resp.headers);
      }
    } catch (err) {
      console.warn("Failed to load excel page:", err);
    } finally {
      setIsLoadingPage(false);
    }
  }, [path, pageSize]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 0 || newPage >= totalPages || newPage === currentPage) return;
    loadPage(activeSheet, newPage);
  };

  const handleSheetChange = (newSheet: string) => {
    if (newSheet === activeSheet) return;
    setActiveSheet(newSheet);
    setCurrentPage(0);
    setSearchQuery('');
    loadPage(newSheet, 0);
  };

  // Filter rows based on search query
  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return pageRows;
    const q = searchQuery.toLowerCase();
    return pageRows.filter(row => 
      row.some(cell => String(cell || '').toLowerCase().includes(q))
    );
  }, [pageRows, searchQuery]);

  const handleCopySheet = async () => {
    if (pageRows.length === 0) return;
    const tsv = pageRows.map(r => r.join('\t')).join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleDownload = () => {
    if (!path) return;
    const downloadUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path)}&raw=true`;
    window.open(downloadUrl, '_blank');
  };

  // Chart data extraction & calculations
  const chartData = useMemo(() => {
    if (viewMode !== 'chart') return { points: [], sum: 0, avg: 0, min: 0, max: 0 };
    const rowsToUse = pageRows.slice(currentPage === 0 ? 1 : 0);
    const points: { label: string; value: number }[] = [];
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;

    for (const row of rowsToUse) {
      const rawX = row[xAxisColIdx];
      const rawY = row[yAxisColIdx];
      if (rawY === undefined || rawY === null || String(rawY).trim() === '') continue;
      const num = Number(String(rawY).replace(/[$,,%]/g, ''));
      if (isNaN(num)) continue;

      const label = rawX !== undefined && rawX !== null ? String(rawX) : `Row ${points.length + 1}`;
      points.push({ label, value: num });
      sum += num;
      if (num < min) min = num;
      if (num > max) max = num;
    }

    const avg = points.length > 0 ? sum / points.length : 0;
    return {
      points: points.slice(0, 80),
      sum,
      avg,
      min: min === Infinity ? 0 : min,
      max: max === -Infinity ? 0 : max,
    };
  }, [viewMode, pageRows, currentPage, xAxisColIdx, yAxisColIdx]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#111111] text-zinc-800 dark:text-zinc-200 select-text overflow-hidden font-sans">
      
      {/* Top Controls Toolbar */}
      <div className="px-3.5 py-2 bg-zinc-50 dark:bg-[#161616] border-b border-zinc-200 dark:border-[#242424] flex items-center justify-between gap-3 shrink-0">
        
        {/* Left: Info & View Mode Toggle */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-5 h-5 rounded bg-emerald-500/10 dark:bg-emerald-950/80 border border-emerald-500/30 dark:border-emerald-700/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
            <FileSpreadsheet size={12} />
          </div>
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate">{filename}</span>
          <span className="text-[10.5px] text-zinc-500 font-mono hidden sm:inline">
            ({totalRows.toLocaleString()} rows, {maxCols} cols)
          </span>

          {/* Table / Chart Toggle */}
          <div className="flex items-center bg-zinc-100 dark:bg-[#1e1e1e] border border-zinc-200 dark:border-[#2b2b2b] rounded-lg p-0.5 ml-2">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                viewMode === 'table' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
              title="Table View"
            >
              <Table size={11} />
              <span>Table</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('chart')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                viewMode === 'chart' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
              title="Analytics & Charts View"
            >
              <BarChart2 size={11} />
              <span>Chart</span>
            </button>
          </div>
        </div>

        {/* Right: Search, Copy & Download Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {viewMode === 'table' && (
            <div className="flex items-center bg-zinc-100 dark:bg-[#1e1e1e] border border-zinc-200 dark:border-[#2b2b2b] rounded-md px-2 py-0.5 text-xs text-zinc-800 dark:text-zinc-300">
              <Search size={12} className="text-zinc-400 dark:text-zinc-500 mr-1.5 shrink-0" />
              <input 
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search page..."
                className="bg-transparent text-[11px] placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none w-20 sm:w-28 tracking-tight"
              />
            </div>
          )}

          {/* Copy TSV */}
          <button
            type="button"
            onClick={handleCopySheet}
            className="flex items-center gap-1 px-2 py-1 bg-zinc-100 hover:bg-zinc-200 dark:bg-[#1e1e1e] dark:hover:bg-[#262626] border border-zinc-200 hover:border-zinc-300 dark:border-[#2b2b2b] rounded-md text-[11px] text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
            title="Copy page as tab-separated values"
          >
            {copied ? <Check size={12} className="text-emerald-500 dark:text-emerald-400" /> : <Copy size={12} />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {/* Download Original File */}
          {path && (
            <button
              type="button"
              onClick={handleDownload}
              className="p-1 hover:bg-zinc-100 dark:hover:bg-[#262626] border border-zinc-200 dark:border-[#2b2b2b] rounded-md text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors cursor-pointer"
              title="Download original file"
            >
              <Download size={13} />
            </button>
          )}
        </div>

      </div>

      {/* Main Content Area: Table Grid or Chart Canvas */}
      <div className="flex-1 overflow-auto custom-scrollbar relative">
        {isLoadingPage && (
          <div className="absolute inset-0 bg-[#111111]/70 backdrop-blur-xs z-40 flex items-center justify-center gap-2 text-xs font-mono text-zinc-400">
            <Loader2 size={16} className="animate-spin text-emerald-500" />
            <span>Streaming rows from Rust engine...</span>
          </div>
        )}

        {viewMode === 'table' ? (
          filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-xs text-zinc-500 font-mono">
              <span>No data in sheet or match filter</span>
            </div>
          ) : (
            <table className="w-full border-collapse text-[12px] font-mono select-text">
              {/* Top Column Letters Header (A, B, C...) */}
              <thead className="sticky top-0 z-20 bg-zinc-100 dark:bg-[#171717] border-b border-zinc-200 dark:border-[#2a2a2a] shadow-sm">
                <tr>
                  {/* Top-left corner row number header */}
                  <th className="w-14 min-w-14 bg-zinc-200 dark:bg-[#191919] text-zinc-500 dark:text-[#707070] font-normal text-[11px] px-2 py-1 text-center border-r border-zinc-300 dark:border-[#262626] sticky left-0 z-30 select-none">
                    #
                  </th>
                  {Array.from({ length: maxCols }).map((_, colIdx) => {
                    const colName = headers[colIdx] || '';
                    return (
                      <th
                        key={colIdx}
                        className="px-3 py-1 bg-zinc-100 dark:bg-[#171717] text-zinc-600 dark:text-[#858585] font-medium text-[11px] text-left border-r border-zinc-200 dark:border-[#242424] min-w-[120px] select-none"
                      >
                        <div className="flex items-center justify-between">
                          <span>{getColumnLetter(colIdx)}</span>
                          {colName && (
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-normal truncate max-w-[85px]" title={colName}>
                              {colName}
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              {/* Data Rows */}
              <tbody className="divide-y divide-zinc-200 dark:divide-[#1e1e1e]">
                {filteredRows.map((row, rowIdx) => {
                  const globalRowIdx = (currentPage * pageSize) + rowIdx + 1;
                  const isHeaderRow = currentPage === 0 && rowIdx === 0;
                  return (
                    <tr 
                      key={rowIdx} 
                      className={`hover:bg-zinc-50 dark:hover:bg-[#1c1c1c] transition-colors ${
                        isHeaderRow ? 'bg-zinc-100 dark:bg-[#151515] font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-800 dark:text-zinc-300'
                      }`}
                    >
                      {/* Row Number Column */}
                      <td className="w-14 min-w-14 bg-zinc-100 dark:bg-[#161616] text-zinc-500 dark:text-[#606060] text-[10.5px] px-2 py-1.5 text-center border-r border-zinc-200 dark:border-[#242424] sticky left-0 z-10 select-none">
                        {globalRowIdx}
                      </td>

                      {/* Data Cells */}
                      {Array.from({ length: maxCols }).map((_, colIdx) => {
                        const cellVal = row[colIdx] !== undefined ? String(row[colIdx]) : '';
                        const isNumeric = cellVal.trim() !== '' && !isNaN(Number(cellVal.replace(/[$,,%]/g, '')));
                        return (
                          <td
                            key={colIdx}
                            className={`px-3 py-1.5 border-r border-zinc-200 dark:border-[#1f1f1f] truncate max-w-[280px] ${
                              isNumeric && !isHeaderRow ? 'text-right font-mono' : 'text-left'
                            }`}
                            title={cellVal}
                          >
                            {cellVal}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : (
          /* High-Performance SVG Chart Canvas (Zero Dependencies, 120fps) */
          <div className="p-5 flex flex-col gap-4 max-w-5xl mx-auto">
            {/* Chart Config Bar */}
            <div className="bg-zinc-50 dark:bg-[#171717] border border-zinc-200 dark:border-[#262626] rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-3">
                {/* Chart Type Selector */}
                <div className="flex items-center bg-zinc-100 dark:bg-[#1f1f1f] border border-zinc-200 dark:border-[#2b2b2b] rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => setChartType('bar')}
                    className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                      chartType === 'bar' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    Bar Chart
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartType('line')}
                    className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                      chartType === 'line' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                  >
                    Line Chart
                  </button>
                </div>

                {/* X-Axis Selector */}
                <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>X (Label):</span>
                  <select
                    value={xAxisColIdx}
                    onChange={(e) => setXAxisColIdx(Number(e.target.value))}
                    className="bg-white dark:bg-[#1f1f1f] border border-zinc-200 dark:border-[#2e2e2e] rounded px-2 py-1 text-zinc-800 dark:text-zinc-200 text-xs outline-none"
                  >
                    {Array.from({ length: maxCols }).map((_, cIdx) => (
                      <option key={cIdx} value={cIdx}>
                        Col {getColumnLetter(cIdx)} {headers[cIdx] ? `(${headers[cIdx]})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Y-Axis Selector */}
                <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>Y (Value):</span>
                  <select
                    value={yAxisColIdx}
                    onChange={(e) => setYAxisColIdx(Number(e.target.value))}
                    className="bg-white dark:bg-[#1f1f1f] border border-zinc-200 dark:border-[#2e2e2e] rounded px-2 py-1 text-zinc-800 dark:text-zinc-200 text-xs outline-none"
                  >
                    {Array.from({ length: maxCols }).map((_, cIdx) => (
                      <option key={cIdx} value={cIdx}>
                        Col {getColumnLetter(cIdx)} {headers[cIdx] ? `(${headers[cIdx]})` : ''}
                        {numericColIndices.includes(cIdx) ? ' ★' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Metric Highlights Pill */}
              <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                <span className="bg-white dark:bg-[#1f1f1f] px-2 py-0.5 rounded border border-zinc-200 dark:border-[#2c2c2c]">
                  Sum: <strong className="text-zinc-800 dark:text-zinc-200 font-semibold">{chartData.sum.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                </span>
                <span className="bg-white dark:bg-[#1f1f1f] px-2 py-0.5 rounded border border-zinc-200 dark:border-[#2c2c2c]">
                  Avg: <strong className="text-zinc-800 dark:text-zinc-200 font-semibold">{chartData.avg.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                </span>
                <span className="bg-white dark:bg-[#1f1f1f] px-2 py-0.5 rounded border border-zinc-200 dark:border-[#2c2c2c]">
                  Max: <strong className="text-zinc-800 dark:text-zinc-200 font-semibold">{chartData.max.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                </span>
              </div>
            </div>

            {/* SVG Visualizer */}
            {chartData.points.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-xs text-zinc-500 font-mono">
                <span>No numeric data found in selected column {getColumnLetter(yAxisColIdx)}</span>
              </div>
            ) : (
              <div className="bg-[#161616] border border-[#262626] rounded-xl p-4 relative shadow-md">
                <div className="w-full h-80 relative">
                  <svg 
                    className="w-full h-full overflow-visible" 
                    viewBox="0 0 800 280" 
                    preserveAspectRatio="none"
                    onMouseLeave={() => setHoveredPoint(null)}
                  >
                    <defs>
                      <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Grid lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                      const yVal = 240 - ratio * 200;
                      return (
                        <g key={ratio}>
                          <line x1="40" y1={yVal} x2="780" y2={yVal} stroke="#252525" strokeDasharray="3 3" />
                          <text x="32" y={yVal + 3} textAnchor="end" fill="#555" fontSize="10" fontFamily="monospace">
                            {((chartData.min + (chartData.max - chartData.min) * ratio) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                          </text>
                        </g>
                      );
                    })}

                    {/* Chart Render */}
                    {(() => {
                      const points = chartData.points;
                      const count = points.length;
                      const plotWidth = 740;
                      const range = Math.max(chartData.max - chartData.min, 0.0001);

                      if (chartType === 'bar') {
                        const barWidth = Math.max(3, Math.min(24, (plotWidth / count) * 0.7));
                        return points.map((p, idx) => {
                          const x = 50 + idx * (plotWidth / count);
                          const h = Math.max(2, ((p.value - chartData.min) / range) * 200);
                          const y = 240 - h;
                          return (
                            <rect
                              key={idx}
                              x={x}
                              y={y}
                              width={barWidth}
                              height={h}
                              rx={2}
                              className="fill-emerald-500 hover:fill-emerald-400 transition-colors cursor-pointer"
                              onMouseEnter={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setHoveredPoint({ label: p.label, value: p.value, x: rect.left, y: rect.top });
                              }}
                            />
                          );
                        });
                      } else {
                        // Line Chart
                        const coords = points.map((p, idx) => {
                          const x = 50 + idx * (plotWidth / Math.max(count - 1, 1));
                          const y = 240 - Math.max(2, ((p.value - chartData.min) / range) * 200);
                          return { x, y, ...p };
                        });
                        const pathD = coords.reduce((acc, c, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`, '');
                        const areaD = `${pathD} L ${coords[coords.length - 1].x} 240 L ${coords[0].x} 240 Z`;

                        return (
                          <g>
                            <path d={areaD} fill="url(#chartGradient)" />
                            <path d={pathD} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                            {coords.map((c, idx) => (
                              <circle
                                key={idx}
                                cx={c.x}
                                cy={c.y}
                                r={3.5}
                                className="fill-[#10b981] stroke-[#161616] stroke-2 hover:r-5 transition-all cursor-pointer"
                                onMouseEnter={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setHoveredPoint({ label: c.label, value: c.value, x: rect.left, y: rect.top });
                                }}
                              />
                            ))}
                          </g>
                        );
                      }
                    })()}
                  </svg>

                  {/* Tooltip */}
                  {hoveredPoint && (
                    <div 
                      className="absolute z-30 pointer-events-none bg-zinc-900/95 border border-zinc-700 text-white rounded-md px-2 py-1 text-xs shadow-xl backdrop-blur-md"
                      style={{
                        top: 20,
                        right: 20,
                      }}
                    >
                      <div className="font-medium text-zinc-200">{hoveredPoint.label}</div>
                      <div className="text-emerald-400 font-mono font-semibold">
                        {hoveredPoint.value.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Footer: Pagination Bar & Sheet Switcher */}
      <div className="bg-zinc-50 dark:bg-[#141414] border-t border-zinc-200 dark:border-[#242424] px-3.5 py-1.5 flex flex-wrap items-center justify-between gap-3 shrink-0 select-none text-xs">
        
        {/* Left: Sheet Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar max-w-[50%]">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 font-semibold mr-1 shrink-0">
            Sheets:
          </span>
          {sheetNames.map((sName) => {
            const isActive = sName === activeSheet;
            return (
              <button
                key={sName}
                type="button"
                onClick={() => handleSheetChange(sName)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer truncate max-w-[140px] ${
                  isActive
                    ? 'bg-white dark:bg-[#222222] text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-[#333333] shadow-xs'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-[#1a1a1a] border border-transparent'
                }`}
              >
                {sName}
              </button>
            );
          })}
        </div>

        {/* Right: Pagination Controls */}
        <div className="flex items-center gap-2.5 ml-auto">
          <span className="text-[11px] text-zinc-500 font-mono">
            {totalRows > 0 ? (
              <>
                Rows {((currentPage * pageSize) + 1).toLocaleString()} - {Math.min((currentPage + 1) * pageSize, totalRows).toLocaleString()} of {totalRows.toLocaleString()}
              </>
            ) : '0 rows'}
          </span>

          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-[#1a1a1a] border border-zinc-200 dark:border-[#2a2a2a] rounded-md p-0.5">
            <button
              type="button"
              disabled={currentPage <= 0 || isLoadingPage}
              onClick={() => handlePageChange(currentPage - 1)}
              className="p-1 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:text-zinc-300 dark:disabled:text-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              title="Previous Page"
            >
              <ChevronLeft size={13} />
            </button>

            <span className="text-[11px] font-mono px-2 text-zinc-700 dark:text-zinc-300">
              Page {currentPage + 1} / {totalPages}
            </span>

            <button
              type="button"
              disabled={currentPage >= totalPages - 1 || isLoadingPage}
              onClick={() => handlePageChange(currentPage + 1)}
              className="p-1 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:text-zinc-300 dark:disabled:text-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              title="Next Page"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>

      </div>

    </div>
  );
}
