# LedgerFlow

Double-entry accounting, fixed assets, and purchase records for small
businesses. Multi-company, with real authentication and per-role permissions.

Runs as a single Node process over a SQLite file. No external database, no
build-time services, no telemetry.

---

## Contents

- [What it does](#what-it-does)
- [Security model](#security-model)
- [Running it locally](#running-it-locally)
- [Configuration](#configuration)
- [Deploying](#deploying)
- [Backups and restore](#backups-and-restore)
- [How the money maths works](#how-the-money-maths-works)
- [API reference](#api-reference)
- [Project layout](#project-layout)

---

## What it does

| Module | What it is for |
| --- | --- |
| **Vouchers** | Journal entries. Every voucher is a double entry: one debit ledger, one credit ledger, a positive amount, an optional tax, and a narration. The server rejects same-ledger debits and ledgers from another company. |
| **Ledgers** | The accounts a voucher posts against. Each is grouped as Direct/Indirect Income or Expense, which is what the P&L is derived from. |
| **Assets** | Fixed assets with straight-line depreciation. Book value and accumulated depreciation are computed to a chosen "as of" date. |
| **Taxes** | Named rates (e.g. GST 18%) scoped to one company, selectable on any voucher. |
| **Purchase Orders** | Local and Import POs with line items. Amount per line is always quantity × rate, never typed. Next PO number is suggested automatically. |
| **Goods Receipts** | What actually arrived, optionally linked to a PO. Selecting a PO pulls its supplier and lines across, so the receipt cannot silently disagree with the order. |
| **Companies** | Tenant boundary. Every ledger, voucher, asset, tax, PO and GRN belongs to exactly one company and is never visible from another. |
| **Users** | Admin / manager / viewer, assigned to companies. |
| **Audit Log** | Every write, with the account that made it. Append-only. |
| **Transfers** | Admin-only movement of a ledger, voucher or asset between companies. |

CSV import is available for ledgers, vouchers and assets. Exports are Excel
(xlsx) and PDF for the main tables.

---

## Security model

The original build had no authentication at all and a plaintext `admin`/`admin`
account. That is gone. What replaced it:

**Passwords** are hashed with scrypt (`N=32768, r=8, p=1`, 64-byte key, 16-byte
random salt) using `node:crypto`. No third-party crypto dependency. A login
against a non-existent username still performs a hash comparison, so a missing
account and a wrong password take the same time and cannot be told apart.

**Sessions** are opaque 32-byte random tokens in an `HttpOnly`, `SameSite=Lax`
cookie. Only a SHA-256 hash of the token is stored, and in production that hash
is peppered with `SESSION_PEPPER`, so a stolen database alone cannot be used to
forge a cookie. Sessions are revocable server-side, and deactivating a user
deletes all of their sessions immediately.

**Roles**

| Role | Can do |
| --- | --- |
| `admin` | Everything, in every company, plus user management, inter-company transfers and the audit log. |
| `manager` | Create, edit and delete — but only inside companies they are assigned to. |
| `viewer` | Read-only. Every write route returns 403. |

Tenant isolation is enforced on the server for every single route. A company
the caller cannot access returns **404, not 403**, so the app does not confirm
that another tenant exists. The UI hides buttons a role cannot use, but that is
cosmetic — the server never trusts the client about permissions.

**Other measures**

- Login rate limiting: 5 failed attempts per username+IP, then a 15-minute
  block. Set `TRUST_PROXY=true` only behind a proxy you control, otherwise a
  client can spoof its address.
- CSRF: `SameSite=Lax` plus a required `X-Requested-With: ledgerflow` header on
  every mutating request, which a cross-site form cannot set.
- CSP with no third-party origins, plus `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy` and COOP. No external fonts or
  scripts are loaded at all.
- The first admin is flagged `must_change_password` and cannot use the app until
  it sets a real one. The app also detects any account still sitting on the
  literal password `admin` and forces a change.
- Every write is recorded in `event_logs` with the acting username, taken from
  the session, never from request input.

**Known limitations, stated plainly**

- Money is stored as SQLite `REAL`, not minor units. All writes are validated
  and rounded to 2 decimal places, but binary floating point cannot represent
  every decimal exactly. A full migration to integer paise is the correct fix
  and has not been done.
- The rate limiter is in-process. It works correctly for the single-instance
  deployment this project targets; running several replicas behind a load
  balancer would need shared state.
- The app must be reached over HTTPS (it is, behind Cloudflare) for the
  `Secure` cookie flag to be meaningful.

---

## Running it locally

Requires Node 20 or newer.

```bash
npm install
cp .env.example .env      # then set SESSION_PEPPER
npm run dev               # http://localhost:3000
```

In dev, Express serves the API and mounts Vite in middleware mode, so there is
one process and one port, with HMR intact.

Production build and run:

```bash
npm run build             # -> dist/ (client) and dist-server/ (server)
npm start                 # node dist-server/server.js
```

Type checking, client and server separately:

```bash
npm run typecheck
```

The first boot seeds an admin from `INITIAL_ADMIN_PASSWORD` (default `admin`
if unset) and flags it for a password change. **Set it in `.env` before the
first run.**

---

## Configuration

All configuration is environment variables. See `.env.example`.

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | — | `production` enables the static file server and requires `SESSION_PEPPER`. |
| `PORT` | `3000` | |
| `DB_PATH` | `./data/accounting.db` | Parent directory is created on boot. |
| `STATIC_DIR` | `$PWD/dist` | Where the built client lives. |
| `SESSION_PEPPER` | — | **Required in production.** `openssl rand -hex 32`. |
| `INITIAL_ADMIN_PASSWORD` | `admin` | Only used when the users table is empty. |
| `SESSION_TTL_HOURS` | `12` | |
| `LOGIN_MAX_ATTEMPTS` | `5` | Before a 15-minute block. |
| `SECURE_COOKIES` | `false` | Set `true` behind HTTPS. Adds `Secure` and HSTS. |
| `TRUST_PROXY` | `false` | Only enable behind a proxy you control. |
| `BACKUP_DIR` | `/app/backups` | Where snapshots are written. |
| `BACKUP_RETENTION_DAYS` | `30` | |

`SESSION_PEPPER` is refused at startup in production if unset, rather than
silently degrading to an unpeppered hash.

---

## Deploying

The app is published through the existing `cloudflared` tunnel on the VPS, and
binds to loopback only. It has no route to the public internet other than the
tunnel.

```bash
git clone https://github.com/Ferns1992/ledgerflow.git
cd ledgerflow
cp .env.example .env
# set SESSION_PEPPER and INITIAL_ADMIN_PASSWORD
docker compose up -d --build
```

The container runs as the unprivileged `node` user, the data directory lives on
a named volume (`ledgerflow_data`), and a healthcheck hits `/api/health`.

The database path must be bind-mounted rather than kept inside the volume if you
want snapshots to land on the host. See the deployment section below for the
exact `docker-compose.yml` used in production.

---

## Backups and restore

**Snapshots use SQLite's online backup API, not a file copy.** The database runs
in WAL mode, so recent writes sit in `accounting.db-wal` and are not yet in the
main file. Copying a live database can capture a torn state that will not open.
`better-sqlite3`'s `backup()` takes a consistent snapshot through a read
transaction while the app keeps serving.

Every snapshot is verified with `PRAGMA integrity_check` and reopened before it
is allowed to take its final filename. A backup that cannot be opened is worse
than no backup, because it looks like a safety net until the day it is needed.
A failed snapshot leaves no `.partial` file and does not prune anything old.

Retention is applied only *after* a verified snapshot exists, so a failed run
can never leave you with zero backups.

### Taking one by hand

```bash
docker exec ledgerflow node scripts/backup.mjs
```

### Off-site mirror

`deploy/ledgerflow-r2-sync.sh` runs on the **host**, never in the container, so
the R2 credentials in `/root/.config/rclone/rclone.conf` are not reachable by
anything the web app can touch. It uses `rclone copy`, never `sync`, so a
partial upload can never delete remote history. Remote retention is applied
independently of local retention.

### Nightly schedule

```ini
# /etc/systemd/system/ledgerflow-backup.service
[Unit]
Description=LedgerFlow SQLite snapshot and R2 mirror
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker exec ledgerflow node scripts/backup.mjs
ExecStart=/usr/local/bin/ledgerflow-r2-sync.sh
```

```ini
# /etc/systemd/system/ledgerflow-backup.timer
[Unit]
Description=Nightly LedgerFlow backup

[Timer]
OnCalendar=*-*-* 03:47:00
Persistent=true
RandomizedDelaySec=900

[Install]
WantedBy=timers.target
```

Staggered away from the Nexus timer at 03:17 so the two do not contend for the
same 1 GB of RAM.

```bash
systemctl enable --now ledgerflow-backup.timer
systemctl list-timers ledgerflow-backup.timer
```

### Restoring

```bash
ledgerflow-restore.sh                        # list snapshots
ledgerflow-restore.sh ledgerflow-2026-09-29-03-47-00.db
ledgerflow-restore.sh <name>.db --from-r2    # pull from R2 first
```

The restore refuses to run without a typed confirmation, verifies the snapshot
before touching anything, saves the current database as `pre-restore-<stamp>.db`
so the restore is itself reversible, and clears the `-wal`/`-shm` sidecars —
leaving them behind would let SQLite replay the previous journal over the
restored file.

---

## How the money maths works

**Double entry.** A voucher is `debit_ledger` + `credit_ledger` + amount. The
amount increases the debit ledger and decreases the credit one. Both legs must
be in the same company.

**P&L.** Income and expense totals are derived from ledger groups:

- a voucher touching an **Income** group ledger adds to income
- a voucher touching an **Expense** group ledger adds to expenses
- `profit = income − expenses`

When both legs are classified (for example an expense paid out of cash), each
side is counted and the total is halved, so the split always reconciles with the
voucher totals.

**Balances.** `opening_balance + Σ debits − Σ credits`, with tax added to the
debit side. Computed in the browser from the loaded company bundle, so it stays
consistent with what is on screen.

**Depreciation.** Straight line: `cost × rate% × years since purchase`, where a
year is 365.25 days. Only assets whose purchase date is on or before the chosen
"as of" date depreciate, and a fully depreciated asset stops at zero rather
than going negative.

---

## API reference

All responses are JSON. Mutating requests require an `X-Requested-With:
ledgerflow` header. Every route requires a session except `/api/health` and
`/api/login`.

| Method | Path | Who |
| --- | --- | --- |
| `GET` | `/api/health` | anyone |
| `POST` | `/api/login` | anyone |
| `GET` | `/api/me` | any |
| `POST` | `/api/logout` | any |
| `POST` | `/api/me/password` | any |
| `GET` | `/api/logs` | admin |
| `GET` `POST` | `/api/users` | admin |
| `PUT` `DELETE` | `/api/users/:id` | admin |
| `GET` | `/api/users/:id/companies` | admin |
| `GET` | `/api/companies` | any |
| `POST` `PUT` | `/api/companies`, `/api/companies/:id` | admin, manager |
| `DELETE` | `/api/companies/:id` | admin |
| `GET` | `/api/companies/:id/bundle` | any (one request, all company data) |
| `GET` `POST` `PUT` `DELETE` | `/api/ledgers…` | read: any · write: admin, manager |
| `GET` `POST` `PUT` `DELETE` | `/api/transactions…` | read: any · write: admin, manager |
| `GET` `POST` `PUT` `DELETE` | `/api/assets…` | read: any · write: admin, manager |
| `GET` `POST` `PUT` `DELETE` | `/api/taxes…` | read: any · write: admin, manager |
| `GET` `POST` `PUT` `DELETE` | `/api/purchase-orders…` | read: any · write: admin, manager |
| `GET` `POST` `PUT` `DELETE` | `/api/grns…` | read: any · write: admin, manager |
| `GET` | `/api/next-number/po`, `/api/next-number/grn` | any |
| `POST` | `/api/transfers/:type` | admin |

`POST /api/ledgers/bulk`, `/api/transactions/bulk` and `/api/assets/bulk` accept
CSV-mapped arrays, capped at 10,000 rows.

### Deleting a ledger that has vouchers

`DELETE /api/ledgers/:id` returns **409** with
`{ transactionCount, canCascade }` instead of silently deleting every voucher
that references it. An admin can then force it with
`?cascade=true`, which is audited as a force-delete. Managers cannot.

### Inter-company transfers

A voucher cannot simply be re-stamped with a new `company_id`: it would keep
pointing at ledgers that stayed behind, and the read query joins on those
ledgers, so the row would vanish from both companies. So a transfer moves the
referenced ledgers too, and **refuses** if any of them are shared with vouchers
remaining in the source company — one ledger cannot be split across two
companies in this schema.

---

## Project layout

```
server.ts              Express app, schema, migrations, auth, all routes
scripts/backup.mjs     Verified SQLite snapshot (run inside the container)
deploy/
  ledgerflow-r2-sync.sh    off-site mirror, host-side, rclone copy
  ledgerflow-restore.sh    verified, reversible restore
src/
  App.tsx              routes, auth gate
  store.tsx            session, company data, notifications, confirm dialogs
  types.ts             domain types + UI permission helpers
  components/          shell, login, forced password change, UI primitives
  views/               one file per module
  lib/                 api client, formatting, CSV/XLSX/PDF export
```

### Data integrity notes

- `ON DELETE CASCADE` from company down to children, so deleting a company
  cannot orphan rows. It is done inside a transaction.
- `ON DELETE RESTRICT` from vouchers to ledgers, so a ledger with vouchers
  cannot vanish underneath them.
- `foreign_keys = ON` on every connection. SQLite defaults it **off**, which is
  a common way for this kind of schema to rot.
- `synchronous = FULL` with WAL, and a checkpoint on shutdown, so a hard kill
  cannot lose a committed voucher.

---

## Licence

See the repository.
