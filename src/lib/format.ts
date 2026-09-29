/**
 * Money and date helpers.
 *
 * The API rounds every monetary value to 2dp on write, so the client only has
 * to make sure it renders the same rounding the server stored.
 */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatMoney(value: unknown, symbol = '₹'): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return `${symbol}0.00`;
  const sign = n < 0 ? '-' : '';
  const [whole, frac] = Math.abs(round2(n)).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${symbol}${grouped}.${frac}`;
}

export function formatNumber(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? round2(n).toLocaleString() : '0';
}

/** SQLite stores dates as YYYY-MM-DD; parse as local midnight, not UTC. */
export function parseLocalDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return new Date(iso);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function today(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function isValidDate(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso ?? '') && !Number.isNaN(parseLocalDate(iso).getTime());
}

/** Human-readable label for an audit-log action. */
export function actionTone(action: string): 'create' | 'update' | 'delete' | 'neutral' {
  switch (action) {
    case 'CREATE':
      return 'create';
    case 'UPDATE':
      return 'update';
    case 'DELETE':
      return 'delete';
    case 'TRANSFER':
      return 'update';
    case 'LOGIN':
      return 'create';
    case 'LOGOUT':
      return 'neutral';
    case 'LOGIN_FAILED':
      return 'delete';
    default:
      return 'neutral';
  }
}
