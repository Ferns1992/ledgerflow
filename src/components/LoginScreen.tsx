import React, { useState } from 'react';
import { Lock, LogIn } from 'lucide-react';
import { useApp } from '../store';
import { Button, Card, Input } from './ui';

/** Presented when booting, and on every route while signed out. */
export function LoginScreen() {
  const { login, loggingIn } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    try {
      await login(username.trim(), password);
    } catch {
      // The store already surfaced the message; keep the form filled so the
      // user can correct a typo instead of retyping everything.
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-zinc-100 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 mb-4">
            <Lock size={20} />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">LedgerFlow</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Sign in to your accounting workspace</p>
        </div>

        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <Input
              label="Username"
              required
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <Input
              label="Password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" disabled={loggingIn} className="!w-full justify-center">
              <LogIn size={16} /> {loggingIn ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>

        <p className="text-center text-[11px] text-zinc-400 dark:text-zinc-600 mt-6">
          Sessions are cookie-based and expire after 12 hours.
        </p>
      </div>
    </div>
  );
}
