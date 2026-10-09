const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESC[ch]);
}

export function renderReports(reports) {
  if (!reports || reports.length === 0) {
    return '<p class="empty-state">No reports match your filters</p>';
  }

  const cards = reports.map((report) => {
    const id = escapeHtml(report.id);
    const label = report.archived ? 'Restore' : 'Archive';
    return (
      `<article class="report-card" data-report-id="${id}">` +
      `<h3>${escapeHtml(report.title)}</h3>` +
      `<p class="report-meta">${escapeHtml(report.period)} · ${escapeHtml(report.status)}</p>` +
      `<button type="button" data-action="archive" data-id="${id}">${label}</button>` +
      `</article>`
    );
  });

  return `<div class="report-list">${cards.join('')}</div>`;
}