import { useState } from 'react';
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserCheck, UserX } from 'lucide-react';
import { useApp } from '../store';
import { api, errMsg } from '../lib/api';
import { Badge, Button, Card, DataTable, EmptyState, Input, Modal, PageHeader, Select, Td, Th } from '../components/ui';
import type { Role, User } from '../types';
import { passwordHint, passwordProblems } from '../lib/passwords';

const BLANK = { username: '', full_name: '', role: 'viewer' as Role, password: '', company_ids: [] as number[] };

const ROLE_HELP: Record<Role, string> = {
  admin: 'Full access to every company, plus users, transfers and the audit log.',
  manager: 'Create and edit data, but only in the companies assigned below.',
  viewer: 'Read-only. No button in the app will be editable.',
};

export function UsersView() {
  const { users, companies, user, notify, confirm, refreshUsers } = useApp();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setForm(BLANK);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(BLANK);
    setFormOpen(true);
  };

  const openEdit = async (target: User) => {
    setEditing(target);
    setForm({
      username: target.username,
      full_name: target.full_name,
      role: target.role,
      password: '',
      company_ids: [],
    });
    setFormOpen(true);
    setLoadingCompanies(true);
    try {
      const ids = await api<number[]>(`/api/users/${target.id}/companies`);
      setForm((f) => ({ ...f, company_ids: ids }));
    } catch {
      notify('Could not load company assignments', 'error');
    } finally {
      setLoadingCompanies(false);
    }
  };

  /**
   * Admin-forced reset. Clears the must-change flag only if a new password is
   * actually supplied, so an accidental blank field does not silently strip a
   * user's forced-reset requirement.
   */
  const resetPassword = async (target: User) => {
    const next = window.prompt(
      `New password for ${target.username}\n\n` +
        'At least 10 characters, with an uppercase letter, a lowercase letter and a digit.\n' +
        'They will be signed out of every device.',
    );
    if (next === null) return;
    if (passwordProblems(next).length) {
      notify(`Password must contain ${passwordProblems(next).join(', ')}`, 'error');
      return;
    }
    try {
      await api(`/api/users/${target.id}`, {
        method: 'PUT',
        body: {
          username: target.username,
          full_name: target.full_name,
          role: target.role,
          active: target.active ?? 1,
          password: next,
        },
      });
      notify(`Password reset for ${target.username}. They have been signed out everywhere.`);
      await refreshUsers();
    } catch (error) {
      notify(errMsg(error, 'Could not reset password'), 'error');
    }
  };

  const save = async () => {
    if (editing) {
      // A blank password field means "leave the existing password alone".
      const body: Record<string, unknown> = {
        username: form.username,
        full_name: form.full_name,
        role: form.role,
        active: editing.active ?? 1,
        company_ids: form.company_ids,
      };
      if (form.password) body.password = form.password;
      try {
        await api(`/api/users/${editing.id}`, { method: 'PUT', body });
        notify('User updated');
        closeForm();
        await refreshUsers();
      } catch (error) {
        notify(errMsg(error, 'Could not update user'), 'error');
      }
      return;
    }

    if (form.password.length < 10) {
      notify('Password must be at least 10 characters', 'error');
      return;
    }
    setSaving(true);
    try {
      await api('/api/users', { method: 'POST', body: form });
      notify('User created');
      closeForm();
      await refreshUsers();
    } catch (error) {
      notify(errMsg(error, 'Could not create user'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (target: User) => {
    const next = target.active ? 0 : 1;
    if (!next) {
      const ok = await confirm(
        'Deactivate account',
        `Deactivate ${target.username}? Their sessions are revoked immediately and they cannot sign in again.`,
        { danger: true },
      );
      if (!ok) return;
    }
    try {
      await api(`/api/users/${target.id}`, {
        method: 'PUT',
        body: {
          username: target.username,
          full_name: target.full_name,
          role: target.role,
          active: next,
        },
      });
      notify(next ? 'Account activated' : 'Account deactivated');
      await refreshUsers();
    } catch (error) {
      notify(errMsg(error, 'Could not update account'), 'error');
    }
  };

  const remove = async (target: User) => {
    const ok = await confirm(
      'Delete user',
      `Permanently delete ${target.username}? Their audit history stays, but the account and its sessions are gone.`,
      { danger: true },
    );
    if (!ok) return;
    try {
      await api(`/api/users/${target.id}`, { method: 'DELETE' });
      notify('User deleted');
      await refreshUsers();
    } catch (error) {
      notify(errMsg(error, 'Could not delete user'), 'error');
    }
  };

  const toggleCompany = (id: number) =>
    setForm((f) => ({
      ...f,
      company_ids: f.company_ids.includes(id) ? f.company_ids.filter((c) => c !== id) : [...f.company_ids, id],
    }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description={`${users.length} account(s). Admins see every company; managers and viewers only see what you assign.`}
        actions={
          <Button onClick={openCreate}>
            <Plus size={16} /> New User
          </Button>
        }
      />

      {users.length === 0 ? (
        <Card>
          <EmptyState title="No users" hint="Create accounts to give your team access." />
        </Card>
      ) : (
        <DataTable
          empty=""
          headers={
            <>
              <Th>User</Th>
              <Th>Role</Th>
              <Th className="text-right">Companies</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </>
          }
        >
          {users.map((target) => (
            <tr key={target.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
              <Td>
                <p className="font-medium text-zinc-900 dark:text-white">
                  {target.full_name || target.username}
                  {target.id === user?.id && <span className="ml-2 text-[10px] uppercase text-zinc-400">you</span>}
                </p>
                <p className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">{target.username}</p>
              </Td>
              <Td>
                <Badge tone={target.role === 'admin' ? 'blue' : target.role === 'manager' ? 'green' : 'neutral'}>
                  {target.role}
                </Badge>
                {target.must_change_password ? (
                  <Badge tone="amber">must reset</Badge>
                ) : null}
              </Td>
              <Td className="text-right font-mono text-zinc-600 dark:text-zinc-300">
                {target.role === 'admin' ? 'all' : target.company_count ?? 0}
              </Td>
              <Td>
                <Badge tone={target.active ? 'green' : 'red'}>{target.active ? 'active' : 'disabled'}</Badge>
              </Td>
              <Td>
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" className="px-2 py-1" title="Edit" onClick={() => void openEdit(target)}>
                    <Pencil size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 py-1"
                    title="Reset password"
                    onClick={() => void resetPassword(target)}
                  >
                    <KeyRound size={15} />
                  </Button>
                  {target.id !== user?.id && (
                    <>
                      <Button
                        variant="ghost"
                        className="px-2 py-1"
                        title={target.active ? 'Deactivate' : 'Activate'}
                        onClick={() => void toggleActive(target)}
                      >
                        {target.active ? <UserX size={15} /> : <UserCheck size={15} />}
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-red-600 hover:text-red-700"
                        title="Delete"
                        onClick={() => void remove(target)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </DataTable>
      )}

      <Modal isOpen={formOpen} onClose={closeForm} title={editing ? `Edit ${editing.username}` : 'New user'} wide>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Username"
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              hint="Letters, digits, dot, underscore, hyphen. Minimum 3."
            />
            <Input
              label="Full name"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
            <Select
              label="Role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              options={[
                { value: 'admin', label: 'Admin' },
                { value: 'manager', label: 'Manager' },
                { value: 'viewer', label: 'Viewer' },
              ]}
            />
            <Input
              label={editing ? 'New password (leave blank to keep current)' : 'Temporary password'}
              type="password"
              autoComplete="new-password"
              required={!editing}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              hint={
                editing
                  ? 'Setting a password signs the user out everywhere and clears their must-reset flag.'
                  : `${passwordHint()} The user will be asked to change it.`
              }
            />
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-start gap-2">
            <ShieldCheck size={14} className="shrink-0 mt-0.5" />
            {ROLE_HELP[form.role]}
          </p>

          {form.role !== 'admin' && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Company access
              </p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {loadingCompanies
                  ? 'Loading current assignments…'
                  : form.company_ids.length === 0
                    ? 'None assigned yet. This user will see no companies.'
                    : `${form.company_ids.length} company(s) assigned.`}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                {companies.map((company) => (
                  <label
                    key={company.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <input
                      type="checkbox"
                      className="accent-zinc-900 dark:accent-zinc-100"
                      checked={form.company_ids.includes(company.id)}
                      onChange={() => toggleCompany(company.id)}
                    />
                    <span className="text-sm text-zinc-700 dark:text-zinc-200">{company.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={closeForm} type="button">
              Cancel
            </Button>
            <Button type="submit" disabled={saving || loadingCompanies}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create user'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
