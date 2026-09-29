import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Role = 'admin' | 'manager' | 'viewer';

export interface User {
  id: number;
  username: string;
  role: Role;
  full_name: string;
  active?: number;
  must_change_password?: number;
  company_count?: number;
}

/**
 * UI-side permission helpers. The server enforces every one of these
 * independently — these only decide which controls to render, so a read-only
 * account is never shown a button that is guaranteed to be rejected.
 */
export function canWrite(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'manager';
}

export function isAdmin(user: User | null | undefined): boolean {
  return user?.role === 'admin';
}

export interface Company {
  id: number;
  name: string;
  address: string;
  gstin: string;
  currency_symbol: string;
  created_at: string;
}

export interface Tax {
  id: number;
  company_id: number;
  name: string;
  rate: number;
}

export interface Ledger {
  id: number;
  company_id: number;
  name: string;
  group_name: string;
  opening_balance: number;
}

export interface Transaction {
  id: number;
  company_id: number;
  date: string;
  debit_ledger_id: number;
  credit_ledger_id: number;
  amount: number;
  tax_id?: number | null;
  tax_amount: number;
  narration: string;
  debit_ledger_name?: string;
  credit_ledger_name?: string;
}

export interface Asset {
  id: number;
  company_id: number;
  name: string;
  value: number;
  purchase_date: string;
  depreciation_rate: number;
}

export interface POItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface PurchaseOrder {
  id: number;
  company_id: number;
  type: 'LPO' | 'IPO';
  po_number: string;
  date: string;
  supplier: string;
  total_amount: number;
  status: string;
  /** Serialised JSON array; the API always returns a string. */
  items: string;
}

export interface GRNItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface GRN {
  id: number;
  company_id: number;
  grn_number: string;
  date: string;
  po_id: number | null;
  supplier: string;
  total_amount: number;
  status: string;
  /** Serialised JSON array; the API always returns a string. */
  items: string;
}

export interface EventLog {
  id: number;
  user_name: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  details: string;
  timestamp: string;
}

/** Ledger groups the P&L engine understands. */
export const INCOME_GROUPS = ['Direct Incomes', 'Indirect Incomes'] as const;
export const EXPENSE_GROUPS = ['Direct Expenses', 'Indirect Expenses'] as const;

/**
 * Balance-sheet accounts. These are deliberately *not* income or expense:
 * cash, bank and receivables are assets and payables are liabilities, so
 * counting them in the P&L would misstate profit. A voucher that moves money
 * into cash ("Bank Dr / Receivables Cr") is a collection, not revenue, and
 * must leave the profit and loss statement untouched.
 */
export const BALANCE_GROUPS = ['Assets', 'Liabilities'] as const;

export const LEDGER_GROUPS = [...INCOME_GROUPS, ...EXPENSE_GROUPS, ...BALANCE_GROUPS] as const;
export type LedgerGroup = (typeof LEDGER_GROUPS)[number];

/** Parses a stored `items` column without letting bad data crash a view. */
export function parseItems<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
