import React, { useState } from 'react';
import { Company } from '../types';
import { Button } from '../App';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  companies: Company[];
  currentCompanyId: number;
  onTransfer: (targetCompanyId: number) => Promise<void>;
  itemName: string;
}

export function TransferModal({ isOpen, onClose, companies, currentCompanyId, onTransfer, itemName }: TransferModalProps) {
  const [targetCompanyId, setTargetCompanyId] = useState<number | ''>('');
  const [isTransferring, setIsTransferring] = useState(false);

  if (!isOpen) return null;

  const handleTransfer = async () => {
    if (!targetCompanyId) return;
    setIsTransferring(true);
    await onTransfer(Number(targetCompanyId));
    setIsTransferring(false);
    onClose();
  };

  const availableCompanies = companies.filter(c => c.id !== currentCompanyId);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Transfer {itemName}</h2>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Select Target Company
            </label>
            <select
              required
              value={targetCompanyId}
              onChange={(e) => setTargetCompanyId(Number(e.target.value))}
              className="w-full px-3 py-2 bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-lg focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 focus:border-transparent transition-shadow text-zinc-900 dark:text-white"
            >
              <option value="">Select a company...</option>
              {availableCompanies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="p-6 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-3 bg-zinc-50 dark:bg-zinc-900/50">
          <Button variant="outline" onClick={onClose} disabled={isTransferring}>
            Cancel
          </Button>
          <Button onClick={handleTransfer} disabled={!targetCompanyId || isTransferring}>
            {isTransferring ? 'Transferring...' : 'Transfer'}
          </Button>
        </div>
      </div>
    </div>
  );
}
