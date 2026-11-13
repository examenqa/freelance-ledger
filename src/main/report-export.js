const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeXml(value) {
  return escapeHtml(value);
}

function escapeHtmlWithBreaks(value) {
  return escapeHtml(value).replaceAll("\n", "<br />");
}

function displayCellHtml(value) {
  if (value && typeof value === "object" && value.kind === "currency-reference") {
    return `<span class="money-primary">${escapeHtml(value.value)}</span><small class="money-reference">${escapeHtml(value.reference)}</small>`;
  }
  return escapeHtmlWithBreaks(value);
}

function reportHtml(report = {}) {
  const summaries = report.summary || [];
  const headers = report.columns || [];
  const rows = report.displayRows || report.rows || [];
  const title = escapeHtml(report.title || "Payment Tracker Report");
  const applicationTitle = escapeHtml(report.applicationTitle || "ExamenQA Payment Tracker");
  const period = escapeHtml(report.period || "All records");
  const generatedAt = escapeHtml(report.generatedAt || new Date().toLocaleString());
  const summaryHtml = summaries
    .map(
      (summary) => `<article><span>${escapeHtml(summary.label)}</span><strong>${escapeHtml(summary.value)}</strong>${summary.detail ? `<small>${escapeHtml(summary.detail)}</small>` : ""}</article>`,
    )
    .join("");
  const visibleColumns = headers.map((column, index) => ({ ...column, index })).filter(column => !column.pdfHidden);
  const headHtml = visibleColumns.map((column) => `<th${column.pdfNoWrap === true ? ' class="pdf-nowrap"' : ""}>${escapeHtml(column.pdfLabel || column.label)}</th>`).join("");
  const bodyHtml = rows.length
    ? rows
        .map(
          (row) =>
            `<tr>${visibleColumns.map(column => `<td${column.pdfNoWrap === true ? ' class="pdf-nowrap"' : ""}>${displayCellHtml(row[column.index] ?? "")}</td>`).join("")}</tr>`,
        )
        .join("")
    : `<tr><td colspan="${Math.max(visibleColumns.length, 1)}" class="empty">${escapeHtml(report.emptyMessage || "No records to export for the selected filters.")}</td></tr>`;
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        @page { margin: 12mm 10mm 15mm; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #111827; background: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        h1, p { margin: 0; }
        .report-head { margin: 0 0 16px; }
        .application-title { color: #0f766e; font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
        h1 { margin-top: 4px; font-size: 22px; line-height: 1.2; }
        .report-meta { margin-top: 5px; color: #475569; font-size: 12px; }
        .report-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 16px; }
        .report-summary article { border: 1px solid #dbe3ea; border-radius: 8px; padding: 9px; break-inside: avoid; }
        .report-summary span { display: block; color: #475569; font-size: 9px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
        .report-summary strong { display: block; margin-top: 5px; font-size: 14px; }
        .report-summary small { display: block; margin-top: 3px; color: #64748b; font-size: 10px; }
        .money-primary { display: block; white-space: nowrap; }
        .money-reference { display: block; margin-top: 3px; color: #64748b; font-size: 8px; line-height: 1.35; }
        table { width: 100%; border-collapse: collapse; table-layout: auto; }
        thead { display: table-header-group; }
        tr { break-inside: avoid; page-break-inside: avoid; }
        th, td { padding: 7px 8px; border-bottom: 1px solid #dbe3ea; vertical-align: top; text-align: left; overflow-wrap: anywhere; font-size: 10px; }
        .pdf-nowrap { white-space: nowrap; overflow-wrap: normal; }
        th { background: #f1f5f9; color: #334155; font-size: 8px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
        .empty { padding: 20px 8px; color: #64748b; font-style: italic; }
      </style>
    </head>
    <body>
      <main>
        <header class="report-head">
          <p class="application-title">${applicationTitle}</p>
          <h1>${title}</h1>
          <p class="report-meta">Period: ${period} &middot; Generated: ${generatedAt}</p>
        </header>
        ${summaryHtml ? `<section class="report-summary">${summaryHtml}</section>` : ""}
        <table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>
      </main>
    </body>
  </html>`;
}

function columnName(index) {
  let result = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function excelDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return Math.round((date.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
}

function cellXml(reference, value, kind = "text") {
  if (value === null || value === undefined || value === "") return `<c r="${reference}"/>`;
  if (kind === "title" || kind === "section" || kind === "header") {
    const style = kind === "title" ? 5 : kind === "section" ? 6 : 7;
    return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }
  if (kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return `<c r="${reference}" s="1"><v>${excelDate(value)}</v></c>`;
  }
  if (["number", "usd", "inr", "decimal"].includes(kind) && Number.isFinite(Number(value))) {
    const style = kind === "usd" ? 2 : kind === "inr" ? 3 : kind === "decimal" ? 4 : 0;
    return `<c r="${reference}" s="${style}"><v>${Number(value)}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function zipStore(entries) {
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8");
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, content);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(Buffer.concat([central, name]));
    offset += local.length + name.length + content.length;
  }
  const directoryBuffer = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directoryBuffer, end]);
}

function xlsxBuffer(report = {}) {
  const columns = report.columns || [];
  const reportRows = report.rows || [];
  const summary = report.xlsxSummary || [];
  const sheetName = String(report.sheetName || "Records").slice(0, 31);
  const rows = [
    [{ value: report.applicationTitle || "ExamenQA Payment Tracker", kind: "title" }],
    [{ value: report.title || "Payment Tracker Report", kind: "section" }],
    [{ value: `Period: ${report.period || "All records"}`, kind: "text" }],
    [{ value: `Generated: ${report.generatedAt || new Date().toLocaleString()}`, kind: "text" }],
    [],
    [{ value: "Summary", kind: "section" }],
    [{ value: "Metric", kind: "header" }, { value: "Value", kind: "header" }, { value: "USD", kind: "header" }, { value: "INR", kind: "header" }, { value: "Details", kind: "header" }],
    ...summary.map((item) => [
      { value: item.label, kind: "text" },
      { value: item.value ?? "", kind: item.valueKind || "text" },
      { value: item.usd ?? "", kind: "usd" },
      { value: item.inr ?? "", kind: "inr" },
      { value: item.detail ?? "", kind: "text" },
    ]),
    [],
    columns.map((column) => ({ value: column.label, kind: "header" })),
    ...reportRows.map((row) => columns.map((column, index) => ({ value: row[index] ?? "", kind: column.kind || "text" }))),
  ];
  const headerRow = 9 + summary.length;
  const rowXml = rows
    .map((row, rowIndex) => {
      if (!row.length) return `<row r="${rowIndex + 1}"/>`;
      return `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => cellXml(`${columnName(columnIndex)}${rowIndex + 1}`, cell.value, cell.kind)).join("")}</row>`;
    })
    .join("");
  const widths = [
    ...columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.min(Math.max(column.width || 15, 10), 42)}" customWidth="1"/>`),
    ...(columns.length < 5 ? [`<col min="5" max="5" width="22" customWidth="1"/>`] : []),
  ].join("");
  const dataLastColumn = columnName(Math.max(columns.length, 1) - 1);
  const lastColumn = columnName(Math.max(columns.length, 5) - 1);
  const lastRow = Math.max(rows.length, 1);
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
      <cols>${widths}</cols><sheetData>${rowXml}</sheetData><autoFilter ref="A${headerRow}:${dataLastColumn}${Math.max(headerRow, lastRow)}"/>
    </worksheet>`;
  return zipStore([
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00"/><numFmt numFmtId="166" formatCode="[$₹-en-IN]#,##0.00"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Aptos"/></font><font><b/><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="14"/><name val="Aptos Display"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>` },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml },
  ]);
}

module.exports = { escapeHtml, reportHtml, xlsxBuffer };
