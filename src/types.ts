import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'manager' | 'viewer';
  full_name: string;
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
  tax_id?: number;
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
  items: string; // JSON string
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
  po_id: number;
  supplier: string;
  total_amount: number;
  status: string;
  items: string; // JSON string
}
