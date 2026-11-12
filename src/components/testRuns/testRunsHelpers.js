export const RUN_RESULT_FILTERS = ['All', 'Passed', 'Failed', 'Blocked', 'Untested'];
export const HISTORY_OUTCOME_FILTERS = ['All', 'Pass', 'Fail', 'Blocked', 'Not Run'];

export function formatShortTimestamp(value) {
  if (!value) return '—';
  const raw = String(value);
  if (raw.includes('T')) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().replace('T', ' ').slice(0, 16);
    }
  }
  return raw;
}
