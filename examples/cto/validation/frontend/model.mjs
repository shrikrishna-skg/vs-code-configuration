const PERIODS = new Set(['Monthly', 'Quarterly']);

export function createReport(reports, { title, period } = {}) {
  const trimmed = String(title ?? '').trim();
  if (!trimmed) throw new Error('Title is required');
  if (!PERIODS.has(period)) throw new Error('Invalid period');

  const id = reports.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  const report = { id, title: trimmed, period, status: 'draft', archived: false };
  return [...reports, report];
}

export function filterReports(reports, { query = '', status = 'all', includeArchived = false } = {}) {
  const q = query.trim().toLowerCase();
  return reports.filter((r) => {
    if (!includeArchived && r.archived) return false;
    if (status !== 'all' && r.status !== status) return false;
    if (q && !r.title.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function toggleArchived(reports, id) {
  if (!reports.some((r) => r.id === id)) throw new Error(`Unknown report id: ${id}`);
  return reports.map((r) => (r.id === id ? { ...r, archived: !r.archived } : r));
}