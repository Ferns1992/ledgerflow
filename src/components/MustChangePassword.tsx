import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useApp } from '../store';
import { passwordHint, passwordProblems } from '../lib/passwords';
import { Button, Card, Input } from './ui';

/** Blocking screen shown until a flagged account sets a new password. */
export function MustChangePassword() {
  const { changePassword, user, logout } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (next.length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }
    const issues = passwordProblems(next);
    if (issues.length) {
      setError(`Password must include ${issues.join(', ')}.`);
      return;
    }
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      await changePassword(current, next);
    } catch {
      // The store shows the server's message; keep the user on this screen.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-zinc-100 dark:bg-zinc-950">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-amber-500 text-white mb-4">
            <KeyRound size={20} />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Choose a new password</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {user?.full_name || user?.username} is still using the default password. Pick a private one to continue.
          </p>
        </div>

        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <Input
              label="Current password"
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <Input
              label="New password"
              type="password"
              required
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              hint={passwordHint()}
            />
            <Input
              label="Confirm new password"
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <Button type="submit" disabled={saving} className="!w-full justify-center">
              {saving ? 'Saving…' : 'Set password and continue'}
            </Button>
            <button
              type="button"
              onClick={() => void logout()}
              className="!w-full text-center text-xs text-zinc-500 dark:text-zinc-400 hover:underline"
            >
              Sign out instead
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}
