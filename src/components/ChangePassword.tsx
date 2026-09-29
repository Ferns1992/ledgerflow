import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useApp } from '../store';
import { passwordHint, passwordProblems } from '../lib/passwords';
import { Button, Card, Input, Modal } from './ui';

/**
 * Self-service password change, available to any signed-in user.
 *
 * The server verifies the current password before accepting a new one and
 * revokes every other session for that account, so a stolen cookie is
 * invalidated the moment the real owner rotates their password.
 */
export function ChangePasswordModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { changePassword } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError('');
    onClose();
  };

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
    if (next === current) {
      setError('The new password must be different from the current one.');
      return;
    }

    setSaving(true);
    try {
      await changePassword(current, next);
      close();
    } catch {
      // The store surfaces the server's message; keep the form open.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Change password">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Changing your password signs out every other device, including this
          browser tab's other sessions.
        </p>
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
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={close} type="button">
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Updating…' : 'Update password'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Standalone card, for anyone who prefers a full page over a modal. */
export function ChangePasswordCard() {
  const { user } = useApp();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <span className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
            <KeyRound size={17} />
          </span>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-zinc-900 dark:text-white">Your password</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Signed in as {user?.full_name || user?.username}. Anyone with your current password can read and
              change the data in every company you have access to.
            </p>
            <Button variant="outline" className="mt-4" onClick={() => setOpen(true)}>
              <KeyRound size={15} /> Change password
            </Button>
          </div>
        </div>
      </Card>
      <ChangePasswordModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
