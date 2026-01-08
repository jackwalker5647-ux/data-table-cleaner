import "./App.css";
import { useMemo, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Analytics } from "@vercel/analytics/react";

/* ---------- parsing helpers ---------- */

function splitLine(line, delimiter) {
  const src = line ?? "";
  if (delimiter) return src.split(delimiter);

  if (src.includes("\t")) return src.split("\t");
  if (src.includes(";")) return src.split(";");
  if (src.includes("|")) return src.split("|");

  // fallback: 2+ spaces
  return src.split(/ {2,}/);
}

function normalizeCell(cell, collapseSpaces) {
  const s = (cell ?? "").toString();
  if (!collapseSpaces) return s; // keep exactly
  return s.trim().replace(/\s+/g, " ");
}

function rowHasAnyValue(row) {
  return row.some((c) => (c ?? "").toString().trim() !== "");
}

function removeEmptyColumns(table) {
  if (table.length === 0) return table;

  const maxCols = Math.max(...table.map((r) => r.length));
  const colHasValue = Array(maxCols).fill(false);

  for (const row of table) {
    for (let j = 0; j < maxCols; j++) {
      const v = (row[j] ?? "").toString().trim();
      if (v !== "") colHasValue[j] = true;
    }
  }

  return table.map((row) => row.filter((_, j) => colHasValue[j]));
}

function parseRowsSimple(lines, delimiter, collapseSpaces) {
  return lines.map((line) =>
    splitLine(line, delimiter).map((c) => normalizeCell(c, collapseSpaces))
  );
}

// Lower score = better
function scoreTable(table) {
  const rowLengths = table.map((r) => r.length).filter((n) => n > 0);
  if (rowLengths.length === 0) return Infinity;

  const maxCols = Math.max(...rowLengths);
  if (maxCols <= 1) return Infinity;

  const counts = new Map();
  for (const n of rowLengths) counts.set(n, (counts.get(n) || 0) + 1);

  let bestCount = 0;
  let modeCols = 0;
  for (const [cols, freq] of counts.entries()) {
    if (freq > bestCount) {
      bestCount = freq;
      modeCols = cols;
    }
  }

  const inconsistent = rowLengths.length - bestCount;
  const raggedPenalty = rowLengths.reduce(
    (sum, n) => sum + Math.abs(n - modeCols),
    0
  );

  return inconsistent * 10 + raggedPenalty;
}

function chooseBestTableSimple(lines, collapseSpaces) {
  const candidates = [
    { name: "tabs", delim: "\t" },
    { name: "pipe", delim: "|" },
    { name: "semicolon", delim: ";" },
    { name: "spaces", delim: null },
  ];

  let best = [];
  let bestDetected = "auto";
  let bestScore = Infinity;

  for (const c of candidates) {
    const parsed = parseRowsSimple(
      lines,
      c.delim === null ? null : c.delim,
      collapseSpaces
    );
    const s = scoreTable(parsed);
    if (s < bestScore) {
      best = parsed;
      bestDetected = c.name;
      bestScore = s;
    }
  }

  return { table: best, detected: bestDetected };
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- markdown ---------- */

function escapeMarkdownCell(s) {
  return (s ?? "")
    .toString()
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|");
}

function toMarkdownTable(data) {
  if (!data || data.length === 0) return "";

  const maxCols = Math.max(...data.map((r) => r.length));
  const padded = data.map((r) => {
    const row = Array.from({ length: maxCols }, (_, i) => r[i] ?? "");
    return row.map(escapeMarkdownCell);
  });

  const header = padded[0];
  const body = padded.slice(1);

  const headerLine = `| ${header.join(" | ")} |`;
  const separatorLine = `| ${header.map(() => "---").join(" | ")} |`;
  const bodyLines = body.map((row) => `| ${row.join(" | ")} |`);

  return [headerLine, separatorLine, ...bodyLines].join("\n");
}

/* ---------- app ---------- */

const EXAMPLE_TEXT = `Name | Age | City
Alice | 24 | London
Bob | 30 | Madrid
Carla | 28 | Barcelona`;

export default function App() {
  const [text, setText] = useState("");
  const [customDelimiter, setCustomDelimiter] = useState("");

  // Imported table (used for XLSX input)
  const [importedTable, setImportedTable] = useState(null);
  const [importedMeta, setImportedMeta] = useState("");

  // Options (defaults ON)
  const [excludeFirstRowExport, setExcludeFirstRowExport] = useState(false);
  const [removeEmptyRowsOpt, setRemoveEmptyRowsOpt] = useState(true);
  const [removeEmptyColsOpt, setRemoveEmptyColsOpt] = useState(true);
  const [collapseSpacesOpt, setCollapseSpacesOpt] = useState(true);

  // Drag/drop state
  const [isDragging, setIsDragging] = useState(false);
  const [fileInfo, setFileInfo] = useState("");
  const [fileError, setFileError] = useState("");

  const normalizedText = text.replace(/\r\n/g, "\n");
  const hasAnyText = normalizedText.trim().length > 0;
  const hasAnyInput = hasAnyText || (importedTable && importedTable.length > 0);

  function applyCleaning(t) {
    let out = t.map((row) => row.map((c) => normalizeCell(c, collapseSpacesOpt)));
    if (removeEmptyRowsOpt) out = out.filter(rowHasAnyValue);
    if (removeEmptyColsOpt) out = removeEmptyColumns(out);
    return out;
  }

  function loadTextFile(file) {
    setFileError("");
    setImportedTable(null);
    setImportedMeta("");

    const maxBytes = 10 * 1024 * 1024; // 10 MB
    if (file.size > maxBytes) {
      setFileError("File too large. Please use a smaller file (≤ 10MB).");
      return;
    }

    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!["csv", "txt"].includes(ext)) {
      setFileError("Unsupported file type. Please drop a .csv or .txt file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const contents = reader.result?.toString() ?? "";
      setText(contents);
      setCustomDelimiter("");
      setFileInfo(`Loaded: ${file.name}`);
    };
    reader.onerror = () => setFileError("Could not read file.");
    reader.readAsText(file);
  }

  function loadXlsxFile(file) {
    setFileError("");
    setText("");
    setCustomDelimiter("");

    const maxBytes = 10 * 1024 * 1024; // 10 MB
    if (file.size > maxBytes) {
      setFileError("XLSX file too large. Please use ≤ 10MB or export a smaller CSV from Excel.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = reader.result;
        const wb = XLSX.read(data, { type: "array" });
        const firstSheetName = wb.SheetNames?.[0];
        if (!firstSheetName) {
          setFileError("Could not find a sheet in this XLSX.");
          return;
        }

        const ws = wb.Sheets[firstSheetName];
        const aoa = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          raw: false,
          blankrows: true,
          defval: "",
        });

        const table = (Array.isArray(aoa) ? aoa : []).map((row) => {
          const arr = Array.isArray(row) ? row : [row];
          return arr.map((v) => (v ?? "").toString());
        });

        setImportedTable(table);
        setImportedMeta(`XLSX: ${file.name} • Sheet: ${firstSheetName}`);
        setFileInfo(`Loaded: ${file.name}`);
      } catch {
        setFileError("Could not read XLSX. Try saving as CSV and dropping that instead.");
      }
    };
    reader.onerror = () => setFileError("Could not read file.");
    reader.readAsArrayBuffer(file);
  }

  function loadFile(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (ext === "xlsx") return loadXlsxFile(file);
    if (ext === "csv" || ext === "txt") return loadTextFile(file);
    setFileError("Unsupported file type. Please use .csv, .txt, or .xlsx.");
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  const { table, detected } = useMemo(() => {
    if (importedTable && importedTable.length > 0) {
      return { table: applyCleaning(importedTable), detected: "xlsx" };
    }

    const lines = normalizedText.split("\n").filter((l) => l.length > 0);

    if (customDelimiter) {
      const parsed = parseRowsSimple(lines, customDelimiter, collapseSpacesOpt);
      return { table: applyCleaning(parsed), detected: `custom (${customDelimiter})` };
    }

    const looksLikeCSV =
      lines.length > 0 &&
      lines.some((r) => r.includes(",")) &&
      !lines.some((r) => r.includes("|") || r.includes(";"));

    if (looksLikeCSV) {
      const parsed = Papa.parse(normalizedText, { skipEmptyLines: true });
      const raw = (Array.isArray(parsed.data) ? parsed.data : []).map((row) => {
        const arr = Array.isArray(row) ? row : [row];
        return arr.map((c) => (c ?? "").toString());
      });
      return { table: applyCleaning(raw), detected: "csv" };
    }

    const result = chooseBestTableSimple(lines, collapseSpacesOpt);
    return { table: applyCleaning(result.table), detected: result.detected };
  }, [
    importedTable,
    normalizedText,
    customDelimiter,
    removeEmptyRowsOpt,
    removeEmptyColsOpt,
    collapseSpacesOpt,
  ]);

  const hasTable = table.length > 0 && table.some((r) => r.length > 1);

  const previewHeader = hasTable ? table[0] : null;
  const previewBody = hasTable ? table.slice(1) : [];

  const exportTable = excludeFirstRowExport && table.length > 0 ? table.slice(1) : table;

  const cellWhiteSpace = collapseSpacesOpt ? "nowrap" : "pre";

  function loadExample() {
    setText(EXAMPLE_TEXT);
    setCustomDelimiter("|");
    setImportedTable(null);
    setImportedMeta("");
    setFileInfo("Loaded: example data");
    setFileError("");
  }

  return (
    <div className="container">
      <div className="header">
        <h1>Clean Table Tool</h1>
        <p>Paste a messy table, or drop a file to clean/export it.</p>
      </div>

      <div
        className="card"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        style={{
          outline: isDragging ? "2px solid rgba(110, 231, 255, 0.6)" : "none",
          outlineOffset: 6,
        }}
      >
        {/* ✅ Privacy line + example button (kept) */}
        <div
          className="small"
          style={{
            marginBottom: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span>Runs entirely in your browser — nothing you paste is uploaded or stored.</span>

          <button
            type="button"
            onClick={loadExample}
            style={{
              padding: "8px 10px",
              borderRadius: 12,
              border: "1px solid rgba(255, 255, 255, 0.16)",
              background: "rgba(255, 255, 255, 0.06)",
              color: "rgba(255,255,255,0.92)",
              cursor: "pointer",
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            Try an example
          </button>
        </div>

        <div className="small" style={{ marginBottom: 10 }}>
          Drag & drop a <strong>.csv</strong>, <strong>.txt</strong>, or <strong>.xlsx</strong> here, or{" "}
          <label style={{ textDecoration: "underline", cursor: "pointer" }}>
            choose a file
            <input
              type="file"
              accept=".csv,.txt,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFile(f);
                e.target.value = "";
              }}
            />
          </label>
          .
        </div>

        {fileInfo && <div className="small">{fileInfo}</div>}
        {importedMeta && <div className="small">{importedMeta}</div>}
        {fileError && (
          <div className="small" style={{ marginTop: 6 }}>
            <strong>Error:</strong> {fileError}
          </div>
        )}

        {/* ✅ textarea (overlay example button removed) */}
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (importedTable) {
              setImportedTable(null);
              setImportedMeta("");
            }
          }}
          placeholder={`Paste here, e.g.
Name | Age | City
Alice | 24 | London
Bob | 30 | Madrid`}
        />

        {hasAnyInput && (
          <>
            <div className="small" style={{ marginTop: 10 }}>
              Detected delimiter: <strong>{detected}</strong>
            </div>

            {!importedTable && (
              <div className="small" style={{ marginTop: 6 }}>
                Enter your delimiter (any character(s)):&nbsp;
                <input
                  type="text"
                  value={customDelimiter}
                  onChange={(e) => setCustomDelimiter(e.target.value)}
                  placeholder="e.g. |  or  ::"
                  style={{ width: 80, padding: "4px 6px", marginLeft: 6 }} // ✅ half width
                />
                <button onClick={() => setCustomDelimiter("")} style={{ marginLeft: 8, padding: "6px 10px" }}>
                  Auto
                </button>
              </div>
            )}

            <div className="small" style={{ marginTop: 10 }}>
              <label style={{ marginRight: 14 }}>
                <input
                  type="checkbox"
                  checked={excludeFirstRowExport}
                  onChange={(e) => setExcludeFirstRowExport(e.target.checked)}
                  style={{ marginRight: 6 }}
                />
                Exclude first row from export
              </label>

              <label style={{ marginRight: 14 }}>
                <input
                  type="checkbox"
                  checked={removeEmptyRowsOpt}
                  onChange={(e) => setRemoveEmptyRowsOpt(e.target.checked)}
                  style={{ marginRight: 6 }}
                />
                Remove empty rows
              </label>

              <label style={{ marginRight: 14 }}>
                <input
                  type="checkbox"
                  checked={removeEmptyColsOpt}
                  onChange={(e) => setRemoveEmptyColsOpt(e.target.checked)}
                  style={{ marginRight: 6 }}
                />
                Remove empty columns
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={collapseSpacesOpt}
                  onChange={(e) => setCollapseSpacesOpt(e.target.checked)}
                  style={{ marginRight: 6 }}
                />
                Collapse spaces in cells
              </label>
            </div>
          </>
        )}

        {hasTable ? (
          <>
            <div className="tableWrap" style={{ marginTop: 14 }}>
              <table>
                <thead>
                  <tr>
                    {previewHeader.map((cell, j) => (
                      <th key={`h-${j}`} style={{ whiteSpace: cellWhiteSpace }}>
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewBody.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} style={{ whiteSpace: cellWhiteSpace }}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="actions">
              <button
                onClick={() => {
                  const tsv = exportTable.map((r) => r.join("\t")).join("\n");
                  navigator.clipboard.writeText(tsv);
                  alert("Copied! Now paste into Excel or Google Sheets.");
                }}
              >
                Copy for Excel / Google Sheets
              </button>

              <button
                onClick={() => {
                  const md = toMarkdownTable(exportTable);
                  navigator.clipboard.writeText(md);
                  alert("Copied as Markdown table!");
                }}
              >
                Copy as Markdown
              </button>

              <button
                onClick={() => {
                  const csv = Papa.unparse(exportTable);
                  downloadTextFile("table.csv", csv, "text/csv;charset=utf-8");
                }}
              >
                Download CSV
              </button>

              <button
                onClick={() => {
                  const ws = XLSX.utils.aoa_to_sheet(exportTable);
                  const wb = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(wb, ws, "Table");
                  XLSX.writeFile(wb, "table.xlsx");
                }}
              >
                Download XLSX
              </button>

              <button
                onClick={() => {
                  setText("");
                  setCustomDelimiter("");
                  setImportedTable(null);
                  setImportedMeta("");
                  setFileInfo("");
                  setFileError("");
                  setExcludeFirstRowExport(false);
                  setRemoveEmptyRowsOpt(true);
                  setRemoveEmptyColsOpt(true);
                  setCollapseSpacesOpt(true);
                }}
              >
                Clear all
              </button>
            </div>
          </>
        ) : (
          hasAnyInput && (
            <div className="small" style={{ marginTop: 12 }}>
              No table detected yet. If your columns are separated by a character (like <strong>|</strong>,{" "}
              <strong>;</strong>, or <strong>::</strong>), enter it above.
            </div>
          )
        )}
      </div>

      {/* ---- content sections ---- */}
      <div className="card" style={{ marginTop: 18 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>Common uses</h2>
        <ul style={{ margin: 0, paddingLeft: 18, color: "rgba(255,255,255,0.78)" }}>
          <li>Cleaning tables copied from PDFs</li>
          <li>Fixing tables pasted from emails</li>
          <li>Normalising scraped website tables</li>
          <li>Cleaning Excel / CSV files before sharing</li>
          <li>Generating Markdown tables for docs or Notion</li>
        </ul>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>FAQ</h2>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Does this upload my data?</div>
          <div style={{ color: "rgba(255,255,255,0.78)", lineHeight: 1.5 }}>
            No. Everything runs entirely in your browser. Nothing is uploaded, stored, or logged.
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>What file types are supported?</div>
          <div style={{ color: "rgba(255,255,255,0.78)", lineHeight: 1.5 }}>
            You can paste text or drop <strong>.csv</strong>, <strong>.txt</strong>, or <strong>.xlsx</strong> files.
            For XLSX files, only the first sheet is used.
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Is there a size limit?</div>
          <div style={{ color: "rgba(255,255,255,0.78)", lineHeight: 1.5 }}>
            Yes — files up to 10MB are supported. For very large spreadsheets, export a smaller CSV first.
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 18,
          textAlign: "center",
          color: "rgba(255,255,255,0.70)",
          fontSize: 14,
        }}
      >
        Built as a simple, private utility. No tracking. No uploads.
      </div>
      <Analytics />
    </div>
  );
}
