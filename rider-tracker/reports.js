function escapeCsv(value) {
  const stringValue = value == null ? '' : String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function buildDailyCsv({ riderId, date, summary, stores, anomalies }) {
  const sections = [];

  sections.push(['Rider', riderId]);
  sections.push(['Date', date]);
  sections.push([]);
  sections.push(['Summary']);
  sections.push(['Metric', 'Value']);
  for (const [key, value] of Object.entries(summary)) {
    sections.push([key, value]);
  }

  sections.push([]);
  sections.push(['Stores']);
  sections.push(['Store ID', 'Store Name', 'Visited', 'Visit Time', 'Dwell Minutes', 'Orders', 'Address']);
  for (const store of stores) {
    sections.push([
      store.id,
      store.name,
      store.visited ? 'Yes' : 'No',
      store.visitTime || '',
      store.dwellMinutes,
      store.orderCount,
      store.address || '',
    ]);
  }

  sections.push([]);
  sections.push(['Anomalies']);
  sections.push(['Type', 'Severity', 'Label', 'Details']);
  for (const anomaly of anomalies) {
    sections.push([anomaly.type, anomaly.severity, anomaly.label, anomaly.details]);
  }

  return sections.map(row => row.map(escapeCsv).join(',')).join('\n');
}

function escapePdfText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildDailyPdf({ riderId, date, summary, stores, anomalies }) {
  const lines = [
    'Rider Tracker Daily Report',
    `Rider: ${riderId}`,
    `Date: ${date}`,
    '',
    'Summary',
    ...Object.entries(summary).map(([key, value]) => `${key}: ${value}`),
    '',
    'Stores',
    ...stores.map(store =>
      `${store.name} | ${store.id} | visited=${store.visited ? 'yes' : 'no'} | visit=${store.visitTime || 'n/a'} | dwell=${store.dwellMinutes} min`
    ),
    '',
    'Anomalies',
    ...(anomalies.length
      ? anomalies.map(item => `${item.severity.toUpperCase()} | ${item.label} | ${item.details}`)
      : ['None']),
  ];

  const pageHeight = 792;
  const startY = 760;
  const lineHeight = 14;
  const textOps = ['BT', '/F1 11 Tf'];

  lines.forEach((line, index) => {
    const y = startY - index * lineHeight;
    if (y < 40) return;
    textOps.push(`1 0 0 1 40 ${y} Tm (${escapePdfText(line)}) Tj`);
  });
  textOps.push('ET');

  const contentStream = textOps.join('\n');
  const contentLength = Buffer.byteLength(contentStream, 'utf8');

  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${pageHeight}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj`,
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${contentLength} >> stream\n${contentStream}\nendstream endobj`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${object}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

module.exports = {
  buildDailyCsv,
  buildDailyPdf,
};
