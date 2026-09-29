import express, { type NextFunction, type Request, type Response } from 'express';
import Database from 'better-sqlite3';
import compression from 'compression';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = 'lf_session';
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);

// Peppering the session hash means a stolen database is not enough to forge a
// cookie: the attacker also needs this value, which never touches disk. It is
// required in production rather than merely recommended, because an empty
// pepper silently degrades to a plain unsalted SHA-256 of the token.
const SESSION_SECRET_PEPPER = process.env.SESSION_PEPPER || '';
if (IS_PROD && !SESSION_SECRET_PEPPER) {
  console.error('[fatal] SESSION_PEPPER must be set when NODE_ENV=production. Refusing to start.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

// Default next to the app root rather than next to the compiled file, so a
// `node dist-server/server.js` run and a `tsx server.ts` run share one database.
const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'accounting.db');

// The data directory is on a Docker volume owned by the unprivileged runtime
// user. Creating it here means a fresh volume works without a manual chown.
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

// WAL keeps readers from blocking the writer, which matters because the SPA
// fires six parallel GETs on every company switch. busy_timeout stops a
// concurrent write from throwing SQLITE_BUSY instead of waiting.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = FULL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','manager','viewer')),
    full_name TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    gstin TEXT NOT NULL DEFAULT '',
    currency_symbol TEXT NOT NULL DEFAULT '₹',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS company_members (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (company_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS taxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    rate REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ledgers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    group_name TEXT NOT NULL DEFAULT '',
    opening_balance REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    debit_ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE RESTRICT,
    credit_ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE RESTRICT,
    amount REAL NOT NULL CHECK (amount > 0),
    tax_id INTEGER REFERENCES taxes(id) ON DELETE SET NULL,
    tax_amount REAL NOT NULL DEFAULT 0,
    narration TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    value REAL NOT NULL DEFAULT 0,
    purchase_date TEXT NOT NULL DEFAULT '',
    depreciation_rate REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('LPO','IPO')),
    po_number TEXT NOT NULL,
    date TEXT NOT NULL,
    supplier TEXT NOT NULL DEFAULT '',
    total_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Pending',
    items TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS grns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    grn_number TEXT NOT NULL,
    date TEXT NOT NULL,
    po_id INTEGER REFERENCES purchase_orders(id) ON DELETE SET NULL,
    supplier TEXT NOT NULL DEFAULT '',
    total_amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Received',
    items TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_name TEXT NOT NULL DEFAULT 'System',
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    details TEXT NOT NULL DEFAULT '',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_event_logs_ts ON event_logs(timestamp DESC);
`);

// ---------------------------------------------------------------------------
// Password hashing (scrypt, from node:crypto — no third-party dependency)
// ---------------------------------------------------------------------------
//
// Declared before the migration block below because that block calls
// hashPassword/verifyPassword at module-evaluation time, and function
// declarations hoist but the SCRYPT_N/R/P consts they close over do not.

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export function verifyPassword(plain: string, stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  try {
    const expected = Buffer.from(hashB64, 'base64');
    const derived = crypto.scryptSync(plain, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * Number(n) * Number(r) * 2,
    });
    return crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

// --- Migrations -------------------------------------------------------------
// Runs on every boot; each block is idempotent and guarded by a column check.

function tableHasColumn(table: string, column: string): boolean {
  const row = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return row.some((c) => c.name === column);
}

if (tableHasColumn('users', 'password')) {
  // Legacy plaintext column from the pre-auth build.
  //
  // `CREATE TABLE IF NOT EXISTS` is a no-op when `users` already exists, so a
  // database created by the old build has no `password_hash` column at all.
  // Without this ALTER the migration below would hash into a column that does
  // not exist and every existing account would be locked out permanently.
  if (!tableHasColumn('users', 'password_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  }
  if (!tableHasColumn('users', 'must_change_password')) {
    db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  }
  if (!tableHasColumn('users', 'active')) {
    db.exec('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  }

  const legacy = db.prepare('SELECT id, password FROM users WHERE password IS NOT NULL').all() as {
    id: number;
    password: string;
  }[];
  const migrate = db.transaction(() => {
    for (const row of legacy) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(row.password), row.id);
    }
  });
  migrate();

  // Drop the plaintext column so the old passwords cannot be read back out of
  // the file. SQLite's DROP COLUMN rebuilds the table, so this has to happen
  // only after every value has been carried over.
  db.exec('ALTER TABLE users DROP COLUMN password');
  console.log(`[migrate] rehashed ${legacy.length} legacy plaintext password(s)`);
}

// The admin seeded in the original build used the literal password "admin".
// Flag any account still on that password so the client forces a change on
// first login.
//
// This has to verify rather than compare hashes: scrypt salts are random, so
// `password_hash = hashPassword('admin')` never matches anything and the flag
// would silently never be set.
const stillDefault = db
  .prepare(`SELECT id, password_hash FROM users WHERE must_change_password = 0 AND password_hash IS NOT NULL`)
  .all() as { id: number; password_hash: string }[];
let flagged = 0;
for (const row of stillDefault) {
  if (verifyPassword('admin', row.password_hash)) {
    db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(row.id);
    flagged++;
  }
}
if (flagged > 0) console.log(`[migrate] flagged ${flagged} account(s) still on the default password`);

export function passwordProblems(plain: string): string[] {
  const issues: string[] = [];
  if (plain.length < 10) issues.push('at least 10 characters');
  if (!/[a-z]/.test(plain)) issues.push('a lowercase letter');
  if (!/[A-Z]/.test(plain)) issues.push('an uppercase letter');
  if (!/[0-9]/.test(plain)) issues.push('a digit');
  return issues;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const userCount = (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count;
if (userCount === 0) {
  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD || 'admin';
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, role, full_name, must_change_password)
       VALUES ('admin', ?, 'admin', 'System Administrator', ?)`,
    )
    .run(hashPassword(initialPassword), initialPassword === 'admin' ? 1 : 0);
  console.log(
    `[seed] created admin user (id ${info.lastInsertRowid})${
      initialPassword === 'admin' ? ' with the default password — change it on first login' : ''
    }`,
  );
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

class HttpError extends Error {
  status: number;
  payload: Record<string, unknown>;
  constructor(status: number, message: string, payload: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

const badRequest = (msg: string, payload?: Record<string, unknown>) => new HttpError(400, msg, payload);

/** Round to 2dp so repeated arithmetic cannot accumulate binary-float drift. */
function money(value: unknown, field: string, opts: { allowNegative?: boolean } = {}): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${field} must be a number`);
  if (!opts.allowNegative && n < 0) throw badRequest(`${field} must not be negative`);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function str(value: unknown, field: string, { max = 500, required = false } = {}): string {
  const s = value === undefined || value === null ? '' : String(value).trim();
  if (required && !s) throw badRequest(`${field} is required`);
  if (s.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return s;
}

function int(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${field} must be a positive integer`);
  return n;
}

function isoDate(value: unknown, field: string): string {
  const s = str(value, field, { max: 30, required: true });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest(`${field} must be formatted YYYY-MM-DD`);
  if (Number.isNaN(Date.parse(s))) throw badRequest(`${field} is not a real date`);
  return s;
}

const VALID_ROLES = ['admin', 'manager', 'viewer'] as const;
type Role = (typeof VALID_ROLES)[number];

function role(value: unknown, fallback: Role = 'viewer'): Role {
  const s = String(value ?? '').trim();
  return (VALID_ROLES as readonly string[]).includes(s) ? (s as Role) : fallback;
}

function parseItems(raw: unknown, field: string): string {
  if (raw === undefined || raw === null) return '[]';
  if (Array.isArray(raw)) return JSON.stringify(raw);
  if (typeof raw === 'string') {
    try {
      JSON.parse(raw);
      return raw;
    } catch {
      throw badRequest(`${field} must be valid JSON`);
    }
  }
  throw badRequest(`${field} must be an array`);
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

interface Actor {
  id: number;
  username: string;
  role: Role;
}

function logEvent(actor: Actor | null, action: string, entityType: string, entityId: number | null, details: string) {
  try {
    db.prepare(
      `INSERT INTO event_logs (user_id, user_name, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(actor?.id ?? null, actor?.username ?? 'System', action, entityType, entityId, details);
  } catch (e) {
    console.error('[audit] failed to write event log', e);
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const hashToken = (token: string) =>
  crypto.createHash('sha256').update(SESSION_SECRET_PEPPER + token).digest('hex');

function createSession(actor: Actor, req: Request): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_HOURS * 3600 * 1000);
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    hashToken(token),
    actor.id,
    now.toISOString(),
    expires.toISOString(),
    req.ip ?? null,
    str(req.get('user-agent') ?? '', 'user-agent', { max: 300 }) || null,
  );
  return token;
}

function destroySession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.SECURE_COOKIES === 'true',
    path: '/',
    maxAge: SESSION_TTL_HOURS * 3600 * 1000,
  });
}

function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}
purgeExpiredSessions();
setInterval(purgeExpiredSessions, 3600 * 1000).unref();

// ---------------------------------------------------------------------------
// Login rate limiting (in-process; single-instance app)
// ---------------------------------------------------------------------------

interface Attempt {
  count: number;
  firstAt: number;
  blockedUntil: number;
}

const attempts = new Map<string, Attempt>();
const MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, rec] of attempts) if (rec.firstAt < cutoff && rec.blockedUntil < Date.now()) attempts.delete(key);
}, 5 * 60 * 1000).unref();

function loginBlocked(key: string): number {
  const rec = attempts.get(key);
  if (!rec) return 0;
  if (rec.blockedUntil > Date.now()) return Math.ceil((rec.blockedUntil - Date.now()) / 1000);
  return 0;
}

function recordFailedLogin(key: string) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
    return;
  }
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) rec.blockedUntil = now + BLOCK_MS;
}

function clearLoginAttempts(key: string) {
  attempts.delete(key);
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
      sessionToken?: string;
      /** Populated by the cookie middleware below. */
      cookies: Record<string, string>;
    }
  }
}

function readSession(req: Request): Actor | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || typeof token !== 'string') return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hashToken(token)) as { id: number; username: string; role: Role; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return null;
  }
  const active = db.prepare('SELECT active FROM users WHERE id = ?').get(row.id) as { active: number } | undefined;
  if (!active || active.active !== 1) return null;
  (req as Request).sessionToken = token;
  return { id: row.id, username: row.username, role: row.role };
}

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const actor = readSession(req);
  if (!actor) return res.status(401).json({ error: 'Not authenticated' });
  req.actor = actor;
  next();
};

const requireRole =
  (...allowed: Role[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const actor = req.actor;
    if (!actor) return res.status(401).json({ error: 'Not authenticated' });
    if (!allowed.includes(actor.role)) {
      return res.status(403).json({ error: `Requires role: ${allowed.join(' or ')}` });
    }
    next();
  };

/** Block anything that is not a plain read for viewer accounts. */
const denyWrites = (_req: Request, res: Response, next: NextFunction) => {
  if (_req.actor?.role === 'viewer') return res.status(403).json({ error: 'Viewer accounts are read-only' });
  next();
};

function accessibleCompanyIds(actor: Actor): number[] | 'all' {
  if (actor.role === 'admin') return 'all';
  const rows = db.prepare('SELECT company_id FROM company_members WHERE user_id = ?').all(actor.id) as {
    company_id: number;
  }[];
  return rows.map((r) => r.company_id);
}

function assertCompanyAccess(req: Request, companyId: unknown): number {
  const id = int(companyId, 'companyId');
  const actor = req.actor!;
  const access = accessibleCompanyIds(actor);
  if (access !== 'all' && !access.includes(id)) {
    // 404 rather than 403 so we do not confirm the existence of other tenants.
    throw new HttpError(404, 'Company not found');
  }
  return id;
}

/** Session payload for the client: never includes the password hash. */
function publicUser(id: number) {
  return db
    .prepare('SELECT id, username, role, full_name, must_change_password, active FROM users WHERE id = ?')
    .get(id) as {
    id: number;
    username: string;
    role: Role;
    full_name: string;
    must_change_password: number;
    active: number;
  };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

async function startServer() {
  const app = express();
  app.set('trust proxy', process.env.TRUST_PROXY === 'true');
  app.disable('x-powered-by');
  // Reject thousands of queued JSON bodies rather than buffering them; the
  // largest legitimate payload is a 10k-row import.
  app.use(express.json({ limit: '10mb' }));

  // Compression, from node:zlib, so no dependency is added.
  //
  // The main JS bundle is ~1.1 MB and the CSS ~34 kB, so uncompressed every
  // cold page load pulls well over a megabyte through the tunnel. Gzip brings
  // that to roughly a third. Compression is skipped for event streams so
  // nothing buffers a chat response waiting for more data.
  app.use(
    compression({
      threshold: 1024,
      level: 6,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        const type = String(res.getHeader('Content-Type') || '');
        if (type.startsWith('text/event-stream')) return false;
        return compression.filter(req, res);
      },
    }),
  );

  // Cookie parsing without pulling in cookie-parser.
  app.use((req, _res, next) => {
    const header = req.headers.cookie;
    const jar: Record<string, string> = {};
    if (header) {
      for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        const k = part.slice(0, idx).trim();
        try {
          jar[k] = decodeURIComponent(part.slice(idx + 1).trim());
        } catch {
          /* ignore malformed cookie */
        }
      }
    }
    req.cookies = jar;
    next();
  });

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        // Vite injects a small inline style block for HMR/theme in dev only.
        ...(IS_PROD ? [] : ["style-src 'self' 'unsafe-inline'"]),
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join('; '),
    );
    if (process.env.SECURE_COOKIES === 'true') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // CSRF: SameSite=Lax plus a custom header that a cross-site form cannot set.
  //
  // `req.path` inside an app-level middleware is relative to the mount point.
  // Mounted at "/" that is the full path, but any later app.use('/api', ...)
  // would strip the prefix and silently re-open /login to this check, so the
  // comparison is made against the original URL instead.
  const CSRF_EXEMPT_PATHS = new Set(['/api/login']);
  app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const fullPath = req.originalUrl.split('?')[0];
      if (!CSRF_EXEMPT_PATHS.has(fullPath) && req.get('X-Requested-With') !== 'ledgerflow') {
        return res.status(403).json({ error: 'Missing X-Requested-With header' });
      }
    }
    next();
  });

  // Public routes ----------------------------------------------------------

  app.get('/api/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'error' });
    }
  });

  app.post('/api/login', (req, res) => {
    const username = str(req.body?.username, 'username', { max: 100 });
    const password = String(req.body?.password ?? '');
    const key = `${req.ip}|${username.toLowerCase()}`;

    const blockedFor = loginBlocked(key);
    if (blockedFor > 0) {
      return res
        .status(429)
        .json({ error: `Too many failed attempts. Try again in ${Math.ceil(blockedFor / 60)} minute(s).` });
    }

    const row = db
      .prepare('SELECT id, username, role, full_name, password_hash, active FROM users WHERE username = ?')
      .get(username) as
      | { id: number; username: string; role: Role; full_name: string; password_hash: string; active: number }
      | undefined;

    // Always run a hash comparison so a missing user and a wrong password
    // take the same amount of time.
    const ok = row
      ? verifyPassword(password, row.password_hash)
      : verifyPassword(password, hashPassword('decoy'));

    if (!row || !ok || row.active !== 1) {
      recordFailedLogin(key);
      logEvent(null, 'LOGIN_FAILED', 'USER', row?.id ?? null, `Failed login for "${username}"`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    clearLoginAttempts(key);
    const actor: Actor = { id: row.id, username: row.username, role: row.role };
    const token = createSession(actor, req);
    setSessionCookie(res, token);
    logEvent(actor, 'LOGIN', 'USER', row.id, `${row.username} signed in`);
    res.json(publicUser(row.id));
  });

  // Authenticated routes ---------------------------------------------------

  app.get('/api/me', requireAuth, (req, res) => {
    res.json(publicUser(req.actor!.id));
  });

  app.post('/api/logout', requireAuth, (req, res) => {
    if (req.sessionToken) destroySession(req.sessionToken);
    // Must match the flags used when the cookie was set, otherwise the browser
    // treats this as a different cookie and leaves the original in place.
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${
        process.env.SECURE_COOKIES === 'true' ? '; Secure' : ''
      }`,
    );
    logEvent(req.actor!, 'LOGOUT', 'USER', req.actor!.id, `${req.actor!.username} signed out`);
    res.json({ success: true });
  });

  app.post('/api/me/password', requireAuth, (req, res) => {
    const current = String(req.body?.current_password ?? '');
    const next = String(req.body?.new_password ?? '');
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.actor!.id) as {
      password_hash: string;
    };
    if (!verifyPassword(current, row.password_hash)) {
      throw new HttpError(400, 'Current password is incorrect');
    }
    const issues = passwordProblems(next);
    if (issues.length) throw badRequest(`Password must contain ${issues.join(', ')}`);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
      hashPassword(next),
      req.actor!.id,
    );
    // Changing a password invalidates every other session for that user.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(
      req.actor!.id,
      hashToken(req.sessionToken ?? ''),
    );
    logEvent(req.actor!, 'UPDATE', 'USER', req.actor!.id, 'Changed own password');
    res.json({ success: true });
  });

  // Audit log — admin only, and the join must not shadow the recorded name.
  app.get('/api/logs', requireAuth, requireRole('admin'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const logs = db
      .prepare(
        `SELECT l.id, l.user_name AS user_name, l.action, l.entity_type, l.entity_id, l.details, l.timestamp
         FROM event_logs l
         ORDER BY l.timestamp DESC, l.id DESC
         LIMIT ?`,
      )
      .all(limit);
    res.json(logs);
  });

  // Users — admin only -----------------------------------------------------

  app.get('/api/users', requireAuth, requireRole('admin'), (_req, res) => {
    const users = db
      .prepare(
        `SELECT u.id, u.username, u.role, u.full_name, u.active, u.must_change_password,
                (SELECT COUNT(*) FROM company_members m WHERE m.user_id = u.id) AS company_count
         FROM users u ORDER BY u.id`,
      )
      .all();
    res.json(users);
  });

  app.post('/api/users', requireAuth, requireRole('admin'), (req, res) => {
    const username = str(req.body?.username, 'username', { max: 100, required: true });
    if (!/^[A-Za-z0-9._-]{3,100}$/.test(username)) {
      throw badRequest('username may only contain letters, digits, dot, underscore and hyphen');
    }
    const password = String(req.body?.password ?? '');
    const issues = passwordProblems(password);
    if (issues.length) throw badRequest(`Password must contain ${issues.join(', ')}`);
    const newRole = role(req.body?.role);
    const fullName = str(req.body?.full_name, 'full_name', { max: 200 });

    try {
      const info = db
        .prepare(
          `INSERT INTO users (username, password_hash, role, full_name, must_change_password)
           VALUES (?, ?, ?, ?, 0)`,
        )
        .run(username, hashPassword(password), newRole, fullName);
      const companyIds: number[] = Array.isArray(req.body?.company_ids) ? req.body.company_ids : [];
      const grant = db.prepare('INSERT OR IGNORE INTO company_members (company_id, user_id) VALUES (?, ?)');
      for (const cid of companyIds) grant.run(int(cid, 'company_id'), Number(info.lastInsertRowid));
      logEvent(req.actor!, 'CREATE', 'USER', Number(info.lastInsertRowid), `Created user: ${username} (${newRole})`);
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new HttpError(409, 'Username already exists');
      throw e;
    }
  });

  app.put('/api/users/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = int(req.params.id, 'id');
    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as
      | { id: number; role: Role }
      | undefined;
    if (!target) throw new HttpError(404, 'User not found');

    const username = str(req.body?.username, 'username', { max: 100, required: true });
    if (!/^[A-Za-z0-9._-]{3,100}$/.test(username)) {
      throw badRequest('username may only contain letters, digits, dot, underscore and hyphen');
    }
    const newRole = role(req.body?.role, target.role);
    const fullName = str(req.body?.full_name, 'full_name', { max: 200 });

    // Do not let the last admin demote or disable themselves out of existence.
    if (id === req.actor!.id && newRole !== 'admin') {
      throw badRequest('You cannot remove your own admin role');
    }
    if (target.role === 'admin' && newRole !== 'admin') {
      const admins = (db.prepare(`SELECT COUNT(*) c FROM users WHERE role = 'admin' AND active = 1`).get() as {
        c: number;
      }).c;
      if (admins <= 1) throw badRequest('At least one active admin must remain');
    }

    try {
      db.prepare('UPDATE users SET username = ?, role = ?, full_name = ? WHERE id = ?').run(
        username,
        newRole,
        fullName,
        id,
      );
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new HttpError(409, 'Username already exists');
      throw e;
    }

    const password = req.body?.password ? String(req.body.password) : '';
    if (password) {
      const issues = passwordProblems(password);
      if (issues.length) throw badRequest(`Password must contain ${issues.join(', ')}`);
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
        hashPassword(password),
        id,
      );
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }

    const activeFlag = req.body?.active === undefined ? null : req.body.active ? 1 : 0;
    if (activeFlag !== null) {
      if (id === req.actor!.id && activeFlag === 0) throw badRequest('You cannot deactivate your own account');
      if (target.role === 'admin' && activeFlag === 0) {
        const admins = (db.prepare(`SELECT COUNT(*) c FROM users WHERE role = 'admin' AND active = 1`).get() as {
          c: number;
        }).c;
        if (admins <= 1) throw badRequest('At least one active admin must remain');
      }
      db.prepare('UPDATE users SET active = ? WHERE id = ?').run(activeFlag, id);
      if (!activeFlag) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }

    if (Array.isArray(req.body?.company_ids)) {
      db.prepare('DELETE FROM company_members WHERE user_id = ?').run(id);
      const grant = db.prepare('INSERT OR IGNORE INTO company_members (company_id, user_id) VALUES (?, ?)');
      for (const cid of req.body.company_ids) grant.run(int(cid, 'company_id'), id);
    }

    logEvent(req.actor!, 'UPDATE', 'USER', id, `Updated user: ${username} (${newRole})`);
    res.json({ success: true });
  });

  app.delete('/api/users/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = int(req.params.id, 'id');
    if (id === req.actor!.id) throw badRequest('You cannot delete your own account');
    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as
      | { id: number; role: Role }
      | undefined;
    if (!target) throw new HttpError(404, 'User not found');
    if (target.role === 'admin') {
      const admins = (db.prepare(`SELECT COUNT(*) c FROM users WHERE role = 'admin' AND active = 1`).get() as {
        c: number;
      }).c;
      if (admins <= 1) throw badRequest('At least one active admin must remain');
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    logEvent(req.actor!, 'DELETE', 'USER', id, `Deleted user ID: ${id}`);
    res.json({ success: true });
  });

  app.get('/api/users/:id/companies', requireAuth, requireRole('admin'), (req, res) => {
    const id = int(req.params.id, 'id');
    const rows = db.prepare('SELECT company_id FROM company_members WHERE user_id = ?').all(id) as {
      company_id: number;
    }[];
    res.json(rows.map((r) => r.company_id));
  });

  // Companies --------------------------------------------------------------

  app.get('/api/companies', requireAuth, (req, res) => {
    const access = accessibleCompanyIds(req.actor!);
    const rows =
      access === 'all'
        ? db.prepare('SELECT * FROM companies ORDER BY name').all()
        : (db
            .prepare(
              `SELECT c.* FROM companies c
               JOIN company_members m ON m.company_id = c.id
               WHERE m.user_id = ? ORDER BY c.name`,
            )
            .all(req.actor!.id) as unknown[]);
    res.json(rows);
  });

  app.post('/api/companies', requireAuth, requireRole('admin', 'manager'), (req, res) => {
    const name = str(req.body?.name, 'name', { max: 200, required: true });
    const address = str(req.body?.address, 'address', { max: 500 });
    const gstin = str(req.body?.gstin, 'gstin', { max: 40 });
    const currency = str(req.body?.currency_symbol, 'currency_symbol', { max: 8 }) || '₹';

    const create = db.transaction(() => {
      let companyId: number;
      try {
        companyId = Number(
          db
            .prepare('INSERT INTO companies (name, address, gstin, currency_symbol) VALUES (?, ?, ?, ?)')
            .run(name, address, gstin, currency).lastInsertRowid,
        );
      } catch (e) {
        if (String(e).includes('UNIQUE')) throw new HttpError(409, 'A company with that name already exists');
        throw e;
      }
      // The creator must be able to see the company they just made.
      db.prepare('INSERT OR IGNORE INTO company_members (company_id, user_id) VALUES (?, ?)').run(
        companyId,
        req.actor!.id,
      );
      const taxes = Array.isArray(req.body?.taxes) ? req.body.taxes : [];
      const insertTax = db.prepare('INSERT INTO taxes (company_id, name, rate) VALUES (?, ?, ?)');
      for (const t of taxes) {
        insertTax.run(companyId, str(t?.name, 'tax name', { max: 100, required: true }), money(t?.rate, 'tax rate'));
      }
      return companyId;
    });

    const companyId = create();
    logEvent(req.actor!, 'CREATE', 'COMPANY', companyId, `Created company: ${name}`);
    res.status(201).json({ id: companyId });
  });

  app.put('/api/companies/:id', requireAuth, requireRole('admin', 'manager'), (req, res) => {
    const id = assertCompanyAccess(req, req.params.id);
    const name = str(req.body?.name, 'name', { max: 200, required: true });
    try {
      db.prepare('UPDATE companies SET name = ?, address = ?, gstin = ?, currency_symbol = ? WHERE id = ?').run(
        name,
        str(req.body?.address, 'address', { max: 500 }),
        str(req.body?.gstin, 'gstin', { max: 40 }),
        str(req.body?.currency_symbol, 'currency_symbol', { max: 8 }) || '₹',
        id,
      );
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new HttpError(409, 'A company with that name already exists');
      throw e;
    }
    logEvent(req.actor!, 'UPDATE', 'COMPANY', id, `Updated company: ${name}`);
    res.json({ success: true });
  });

  app.delete('/api/companies/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = int(req.params.id, 'id');
    const counts = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM transactions WHERE company_id = ?) AS vouchers,
           (SELECT COUNT(*) FROM ledgers      WHERE company_id = ?) AS ledgers`,
      )
      .get(id, id) as { vouchers: number; ledgers: number };

    if ((counts.vouchers > 0 || counts.ledgers > 0) && req.query.cascade !== 'true') {
      throw new HttpError(409, 'Company still has accounting data', {
        vouchers: counts.vouchers,
        ledgers: counts.ledgers,
      });
    }

    // ON DELETE CASCADE on the child tables does the work, inside one txn.
    const wipe = db.transaction(() => {
      db.prepare('DELETE FROM transactions WHERE company_id = ?').run(id);
      db.prepare('DELETE FROM ledgers WHERE company_id = ?').run(id);
      db.prepare('DELETE FROM assets WHERE company_id = ?').run(id);
      db.prepare('DELETE FROM grns WHERE company_id = ?').run(id);
      db.prepare('DELETE FROM purchase_orders WHERE company_id = ?').run(id);
      db.prepare('DELETE FROM taxes WHERE company_id = ?').run(id);
      db.prepare('DELETE FROM companies WHERE id = ?').run(id);
    });
    wipe();
    logEvent(
      req.actor!,
      'DELETE',
      'COMPANY',
      id,
      `Deleted company ID: ${id} (${counts.vouchers} vouchers, ${counts.ledgers} ledgers)`,
    );
    res.json({ success: true });
  });

  // Company bundle ---------------------------------------------------------

  /**
   * Everything the SPA needs for one company, in a single response.
   *
   * The client used to fire six separate GETs per company switch, which meant
   * six HTTP round trips through the Cloudflare tunnel and six result-set
   * materialisations for what is almost always a few hundred rows. This runs
   * the reads inside one transaction so SQLite sees a consistent snapshot and
   * the six statements share a single transaction boundary.
   */
  app.get('/api/companies/:id/bundle', requireAuth, (req, res) => {
    const companyId = assertCompanyAccess(req, req.params.id);

    const read = db.transaction(() => ({
      ledgers: db.prepare('SELECT * FROM ledgers WHERE company_id = ? ORDER BY id').all(companyId),
      transactions: db
        .prepare(
          `SELECT t.*, dl.name AS debit_ledger_name, cl.name AS credit_ledger_name
           FROM transactions t
           JOIN ledgers dl ON dl.id = t.debit_ledger_id
           JOIN ledgers cl ON cl.id = t.credit_ledger_id
           WHERE t.company_id = ?
           ORDER BY t.date DESC, t.id DESC`,
        )
        .all(companyId),
      assets: db.prepare('SELECT * FROM assets WHERE company_id = ? ORDER BY id').all(companyId),
      taxes: db.prepare('SELECT * FROM taxes WHERE company_id = ? ORDER BY id').all(companyId),
      purchaseOrders: db
        .prepare('SELECT * FROM purchase_orders WHERE company_id = ? ORDER BY date DESC, id DESC')
        .all(companyId),
      grns: db.prepare('SELECT * FROM grns WHERE company_id = ? ORDER BY date DESC, id DESC').all(companyId),
    }));

    res.setHeader('Cache-Control', 'private, no-store');
    res.json(read());
  });

  // Ledgers ----------------------------------------------------------------

  app.get('/api/ledgers/:companyId', requireAuth, (req, res) => {
    const companyId = assertCompanyAccess(req, req.params.companyId);
    res.json(db.prepare('SELECT * FROM ledgers WHERE company_id = ? ORDER BY id').all(companyId));
  });

  app.post('/api/ledgers', requireAuth, denyWrites, (req, res) => {
    const companyId = assertCompanyAccess(req, req.body?.company_id);
    const name = str(req.body?.name, 'name', { max: 200, required: true });
    const result = db
      .prepare('INSERT INTO ledgers (company_id, name, group_name, opening_balance) VALUES (?, ?, ?, ?)')
      .run(companyId, name, str(req.body?.group_name, 'group_name', { max: 100 }), money(req.body?.opening_balance, 'opening_balance', { allowNegative: true }));
    logEvent(req.actor!, 'CREATE', 'LEDGER', Number(result.lastInsertRowid), `Created ledger: ${name}`);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  app.post('/api/ledgers/bulk', requireAuth, denyWrites, (req, res) => {
    const rows = req.body?.ledgers;
    if (!Array.isArray(rows) || rows.length === 0) throw badRequest('ledgers must be a non-empty array');
    if (rows.length > 10000) throw badRequest('Import is limited to 10000 rows at a time');

    const insert = db.prepare('INSERT INTO ledgers (company_id, name, group_name, opening_balance) VALUES (?, ?, ?, ?)');
    let count = 0;
    const run = db.transaction(() => {
      for (const l of rows) {
        insert.run(
          assertCompanyAccess(req, l?.company_id),
          str(l?.name, 'name', { max: 200, required: true }),
          str(l?.group_name, 'group_name', { max: 100 }),
          money(l?.opening_balance, 'opening_balance', { allowNegative: true }),
        );
        count++;
      }
    });
    run();
    logEvent(req.actor!, 'CREATE', 'LEDGER_BULK', null, `Imported ${count} ledgers`);
    res.status(201).json({ success: true, count });
  });

  app.put('/api/ledgers/:id', requireAuth, denyWrites, (req, res) => {
    const id = int(req.params.id, 'id');
    const row = db.prepare('SELECT company_id FROM ledgers WHERE id = ?').get(id) as
      | { company_id: number }
      | undefined;
    if (!row) throw new HttpError(404, 'Ledger not found');
    assertCompanyAccess(req, row.company_id);
    const name = str(req.body?.name, 'name', { max: 200, required: true });
    db.prepare('UPDATE ledgers SET name = ?, group_name = ?, opening_balance = ? WHERE id = ?').run(
      name,
      str(req.body?.group_name, 'group_name', { max: 100 }),
      money(req.body?.opening_balance, 'opening_balance', { allowNegative: true }),
      id,
    );
    logEvent(req.actor!, 'UPDATE', 'LEDGER', id, `Updated ledger: ${name}`);
    res.json({ success: true });
  });

  app.delete('/api/ledgers/:id', requireAuth, denyWrites, (req, res) => {
    const id = int(req.params.id, 'id');
    const row = db.prepare('SELECT company_id, name FROM ledgers WHERE id = ?').get(id) as
      | { company_id: number; name: string }
      | undefined;
    if (!row) throw new HttpError(404, 'Ledger not found');
    assertCompanyAccess(req, row.company_id);

    const used = (
      db
        .prepare(
          'SELECT COUNT(*) AS n FROM transactions WHERE debit_ledger_id = ? OR credit_ledger_id = ?',
        )
        .get(id, id) as { n: number }
    ).n;

    // Deleting a ledger used to silently delete every voucher touching it.
    // Refuse by default; only an admin can force it, and it is always audited.
    if (used > 0 && !(req.actor!.role === 'admin' && req.query.cascade === 'true')) {
      throw new HttpError(409, `"${row.name}" is used by ${used} voucher(s) and cannot be deleted`, {
        transactionCount: used,
        canCascade: req.actor!.role === 'admin',
      });
    }

    const purge = db.transaction(() => {
      if (used > 0) db.prepare('DELETE FROM transactions WHERE debit_ledger_id = ? OR credit_ledger_id = ?').run(id, id);
      db.prepare('DELETE FROM ledgers WHERE id = ?').run(id);
    });
    purge();
    logEvent(
      req.actor!,
      'DELETE',
      'LEDGER',
      id,
      used > 0
        ? `Force-deleted ledger "${row.name}" and ${used} dependent voucher(s)`
        : `Deleted ledger: ${row.name}`,
    );
    res.json({ success: true, deletedTransactions: used });
  });

  // Transactions (vouchers) ------------------------------------------------

  app.get('/api/transactions/:companyId', requireAuth, (req, res) => {
    const companyId = assertCompanyAccess(req, req.params.companyId);
    const rows = db
      .prepare(
        `SELECT t.*, dl.name AS debit_ledger_name, cl.name AS credit_ledger_name
         FROM transactions t
         JOIN ledgers dl ON dl.id = t.debit_ledger_id
         JOIN ledgers cl ON cl.id = t.credit_ledger_id
         WHERE t.company_id = ?
         ORDER BY t.date DESC, t.id DESC`,
      )
      .all(companyId);
    res.json(rows);
  });

  function validateVoucher(req: Request, body: Record<string, unknown>) {
    const companyId = assertCompanyAccess(req, body.company_id);
    const debit = int(body.debit_ledger_id, 'debit_ledger_id');
    const credit = int(body.credit_ledger_id, 'credit_ledger_id');
    if (debit === credit) throw badRequest('Debit and credit ledgers must be different');

    const owned = db
      .prepare('SELECT id FROM ledgers WHERE id IN (?, ?) AND company_id = ?')
      .all(debit, credit, companyId) as { id: number }[];
    if (owned.length !== 2) throw badRequest('Both ledgers must exist in the selected company');

    const amount = money(body.amount, 'amount');
    if (amount <= 0) throw badRequest('amount must be greater than zero');

    let taxId: number | null = null;
    let taxAmount = 0;
    if (body.tax_id) {
      taxId = int(body.tax_id, 'tax_id');
      const tax = db.prepare('SELECT id FROM taxes WHERE id = ? AND company_id = ?').get(taxId, companyId);
      if (!tax) throw badRequest('Selected tax does not belong to this company');
      taxAmount = money(body.tax_amount, 'tax_amount');
    }

    return {
      companyId,
      date: isoDate(body.date, 'date'),
      debit,
      credit,
      amount,
      taxId,
      taxAmount,
      narration: str(body.narration, 'narration', { max: 1000 }),
    };
  }

  app.post('/api/transactions', requireAuth, denyWrites, (req, res) => {
    const v = validateVoucher(req, req.body ?? {});
    const result = db
      .prepare(
        `INSERT INTO transactions
           (company_id, date, debit_ledger_id, credit_ledger_id, amount, tax_id, tax_amount, narration)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(v.companyId, v.date, v.debit, v.credit, v.amount, v.taxId, v.taxAmount, v.narration);
    logEvent(
      req.actor!,
      'CREATE',
      'TRANSACTION',
      Number(result.lastInsertRowid),
      `Voucher: ${v.amount} Dr ledger ${v.debit} / Cr ledger ${v.credit} on ${v.date}`,
    );
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  app.post('/api/transactions/bulk', requireAuth, denyWrites, (req, res) => {
    const rows = req.body?.transactions;
    if (!Array.isArray(rows) || rows.length === 0) throw badRequest('transactions must be a non-empty array');
    if (rows.length > 10000) throw badRequest('Import is limited to 10000 rows at a time');

    const insert = db.prepare(
      `INSERT INTO transactions
         (company_id, date, debit_ledger_id, credit_ledger_id, amount, tax_id, tax_amount, narration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let count = 0;
    const run = db.transaction(() => {
      for (const t of rows) {
        const v = validateVoucher(req, t ?? {});
        insert.run(v.companyId, v.date, v.debit, v.credit, v.amount, v.taxId, v.taxAmount, v.narration);
        count++;
      }
    });
    run();
    logEvent(req.actor!, 'CREATE', 'TRANSACTION_BULK', null, `Imported ${count} vouchers`);
    res.status(201).json({ success: true, count });
  });

  app.put('/api/transactions/:id', requireAuth, denyWrites, (req, res) => {
    const id = int(req.params.id, 'id');
    const existing = db.prepare('SELECT company_id FROM transactions WHERE id = ?').get(id) as
      | { company_id: number }
      | undefined;
    if (!existing) throw new HttpError(404, 'Voucher not found');
    assertCompanyAccess(req, existing.company_id);

    const v = validateVoucher(req, { ...(req.body ?? {}), company_id: existing.company_id });
    db.prepare(
      `UPDATE transactions
       SET date = ?, debit_ledger_id = ?, credit_ledger_id = ?, amount = ?, tax_id = ?, tax_amount = ?, narration = ?
       WHERE id = ?`,
    ).run(v.date, v.debit, v.credit, v.amount, v.taxId, v.taxAmount, v.narration, id);
    logEvent(req.actor!, 'UPDATE', 'TRANSACTION', id, `Updated voucher ${id} (amount ${v.amount})`);
    res.json({ success: true });
  });

  app.delete('/api/transactions/:id', requireAuth, denyWrites, (req, res) => {
    const id = int(req.params.id, 'id');
    const existing = db.prepare('SELECT company_id FROM transactions WHERE id = ?').get(id) as
      | { company_id: number }
      | undefined;
    if (!existing) throw new HttpError(404, 'Voucher not found');
    assertCompanyAccess(req, existing.company_id);
    db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    logEvent(req.actor!, 'DELETE', 'TRANSACTION', id, `Deleted voucher ID: ${id}`);
    res.json({ success: true });
  });

  // Assets -----------------------------------------------------------------

  app.get('/api/assets/:companyId', requireAuth, (req, res) => {
    const companyId = assertCompanyAccess(req, req.params.companyId);
    res.json(db.prepare('SELECT * FROM assets WHERE company_id = ? ORDER BY id').all(companyId));
  });

  app.post('/api/assets', requireAuth, denyWrites, (req, res) => {
    const companyId = assertCompanyAccess(req, req.body?.company_id);
    const name = str(req.body?.name, 'name', { max: 200, required: true });
    const result = db
      .prepare('INSERT INTO assets (company_id, name, value, purchase_date, depreciation_rate) VALUES (?, ?, ?, ?, ?)')
      .run(
        companyId,
        name,
        money(req.body?.value, 'value'),
        req.body?.purchase_date ? isoDate(req.body.purchase_date, 'purchase_date') : '',
        money(req.body?.depreciation_rate, 'depreciation_rate'),
      );
    logEvent(req.actor!, 'CREATE', 'ASSET', Number(result.lastInsertRowid), `Created asset: ${name}`);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  app.post('/api/assets/bulk', requireAuth, denyWrites, (req, res) => {
    const rows = req.body?.assets;
    if (!Array.isArray(rows) || rows.length === 0) throw badRequest('assets must be a non-empty array');
    if (rows.length > 10000) throw badRequest('Import is limited to 10000 rows at a time');

    const insert = db.prepare(
      'INSERT INTO assets (company_id, name, value, purchase_date, depreciation_rate) VALUES (?, ?, ?, ?, ?)',
    );
    let count = 0;
    const run = db.transaction(() => {
      for (const a of rows) {
        insert.run(
          assertCompanyAccess(req, a?.company_id),
          str(a?.name, 'name', { max: 200, required: true }),
          money(a?.value, 'value'),
          a?.purchase_date ? isoDate(a.purchase_date, 'purchase_date') : '',
          money(a?.depreciation_rate, 'depreciation_rate'),
        );
        count++;
      }
    });
    run();
    logEvent(req.actor!, 'CREATE', 'ASSET_BULK', null, `Imported ${count} assets`);
    res.status(201).json({ success: true, count });
  });

  app.put('/api/assets/:id', requireAuth, denyWrites, (req, res) => {
    const id = int(req.params.id, 'id');
    const existing = db.prepare('SELECT company_id FROM assets WHERE id = ?').get(id) as
      | { company_id: number }
      | undefined;
    if (!existing) throw new HttpError(404, 'Asset not found');
    assertCompanyAccess(req, existing.company_id);
    const name = str(req.body?.name, 'name', { max: 200, required: true });
    db.prepare('UPDATE assets SET name = ?, value = ?, purchase_date = ?, depreciation_rate = ? WHERE id = ?').run(
      name,
      money(req.body?.value, 'value'),
      req.body?.purchase_date ? isoDate(req.body.purchase_date, 'purchase_date') : '',
      money(req.body?.depreciation_rate, 'depreciation_rate'),
      id,
    );
    logEvent(req.actor!, 'UPDATE', 'ASSET', id, `Updated asset: ${name}`);
    res.json({ success: true });
  });

  app.delete('/api/assets/:id', requireAuth, denyWrites, (req, res) => {
    const id = int(req.params.id, 'id');
    const existing = db.prepare('SELECT company_id FROM assets WHERE id = ?').get(id) as
      | { company_id: number }
      | undefined;
    if (!existing) throw new HttpError(404, 'Asset not found');
    assertCompanyAccess(req, existing.company_id);
    db.prepare('DELETE FROM assets WHERE id = ?').run(id);
    logEvent(req.actor!, 'DELETE', 'ASSET', id, `Deleted asset ID: ${id}`);
    res.json({ success: true });
  });

  // Taxes ------------------------------------------------------------------

  app.get('/api/taxes/:companyId', requireAuth, (req, res) => {
    const companyId = assertCompanyAccess(req, req.params.companyId);
    res.json(db.prepare('SELECT * FROM taxes WHERE company_id = ? ORDER BY id').all(companyId));
  });

  app.post('/api/taxes', requireAuth, denyWrites, (req, res) => {
    const companyId = assertCompanyAccess(req, req.body?.company_id);
    const name = str(req.body?.name, 'name', { max: 100, required: true });
    const result = db
      .prepare('INSERT INTO taxes (company_id, name, rate) VALUES (?, ?, ?)')
      .run(companyId, name, money(req.body?.rate, 'rate'));
    logEvent(req.actor!, 'CREATE', 'TAX', Number(result.lastInsertRowid), `Created tax: ${name}`);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  app.put('/api/taxes/:id', requireAuth, denyWrites, (req, res) => {
    const id = int(req.params.id, 'id');
    const existing = db.prepare('SELECT company_id FROM taxes WHERE id = ?').get(id) as
      | { company_id: number }
      | undefined;
    if (!existing) throw new HttpError(404, 'Tax not found');
    assertCompanyAccess(req, existing.company_id);
    const name = str(req.body?.name, 'name', { max: 100, required: true });
    db.prepare('UPDATE taxes SET name = ?, rate = ? WHERE id = ?').run(name, money(req.body?.rate, 'rate'), id);
    logEvent(req.actor!, 'UPDATE', 'TAX', id, `Updated tax: ${name}`);
    res.json({ success: true });
  });

  app.delete('/api/taxes/:id', requireAuth, denyWrites, (req, res) => {
    const id = int(req.params.id, 'id');
    const row = db.prepare('SELECT company_id, name FROM taxes WHERE id = ?').get(id) as
      | { company_id: number; name: string }
      | undefined;
    if (!row) throw new HttpError(404, 'Tax not found');
    assertCompanyAccess(req, row.company_id);
    db.prepare('DELETE FROM taxes WHERE id = ?').run(id);
    logEvent(req.actor!, 'DELETE', 'TAX', id, `Deleted tax: ${row.name}`);
    res.json({ success: true });
  });

  // Purchase orders --------------------------------------------------------

  app.get('/api/purchase-orders', requireAuth, (req, res) => {
    const companyId = assertCompanyAccess(req, req.query.company_id);
    res.json(db.prepare('SELECT * FROM purchase_orders WHERE company_id = ? ORDER BY date DESC, id DESC').all(companyId));
  });

  app.post('/api/purchase-orders', requireAuth, denyWrites, (req, res) => {
    const companyId = assertCompanyAccess(req, req.body?.company_id);
    const type = String(req.body?.type ?? '') === 'IPO' ? 'IPO' : 'LPO';
    const poNumber = str(req.body?.po_number, 'po_number', { max: 60, required: true });
    const result = db
      .prepare(
        `INSERT INTO purchase_orders (company_id, type, po_number, date, supplier, total_amount, status, items)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        companyId,
        type,
        poNumber,
        isoDate(req.body?.date, 'date'),
        str(req.body?.supplier, 'supplier', { max: 200 }),
        money(req.body?.total_amount, 'total_amount'),
        str(req.body?.status, 'status', { max: 40 }) || 'Pending',
        parseItems(req.body?.items, 'items'),
      );
    logEvent(req.actor!, 'CREATE', 'PURCHASE_ORDER', Number(result.lastInsertRowid), `Created ${type}: ${poNumber}`);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  app.put('/api/purchase-orders/:id', requireAuth, denyWrites, (req, res) => {
    const id = int(req.params.id, 'id');
    const existing = db.prepare('SELECT company_id FROM purchase_orders WHERE id = ?').get(id) as
      | { company_id: number }
      | undefined;
    if (!existing) throw new HttpError(404, 'Purchase order not found');
    assertCompanyAccess(req, existing.company_id);
    db.prepare(
      `UPDATE purchase_orders
       SET type = ?, po_number = ?, date = ?, supplier = ?, total_amount = ?, status = ?, items = ?
       WHERE id = ?`,
    ).run(
      String(req.body?.type ?? '') === 'IPO' ? 'IPO' : 'LPO',
      str(req.body?.po_number, 'po_number', { max: 60, required: true }),
      isoDate(req.body?.date, 'date'),
      str(req.body?.supplier, 'supplier', { max: 200 }),
      money(req.body?.total_amount, 'total_amount'),
      str(req.body?.status, 'status', { max: 40 }) || 'Pending',
      parseItems(req.body?.items, 'items'),
      id,
    );
    logEvent(req.actor!, 'UPDATE', 'PURCHASE_ORDER', id, `Updated purchase order ID: ${id}`);
    res.json({ success: true });
  });

  app.delete('/api/purchase-orders/:id', requireAuth, denyWrites, (req, res) => {
    const id = int(req.params.id, 'id');
    const existing = db.prepare('SELECT company_id FROM purchase_orders WHERE id = ?').get(id) as
      | { company_id: number }
      | undefined;
    if (!existing) throw new HttpError(404, 'Purchase order not found');
    assertCompanyAccess(req, existing.company_id);
    db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(id);
    logEvent(req.actor!, 'DELETE', 'PURCHASE_ORDER', id, `Deleted purchase order ID: ${id}`);
    res.json({ success: true });
  });

  // GRNs -------------------------------------------------------------------

  app.get('/api/grns', requireAuth, (req, res) => {
    const companyId = assertCompanyAccess(req, req.query.company_id);
    res.json(db.prepare('SELECT * FROM grns WHERE company_id = ? ORDER BY date DESC, id DESC').all(companyId));
  });

  app.post('/api/grns', requireAuth, denyWrites, (req, res) => {
    const companyId = assertCompanyAccess(req, req.body?.company_id);
    let poId: number | null = null;
    if (req.body?.po_id) {
      poId = int(req.body.po_id, 'po_id');
      const po = db.prepare('SELECT id FROM purchase_orders WHERE id = ? AND company_id = ?').get(poId, companyId);
      if (!po) throw badRequest('Selected purchase order does not belong to this company');
    }
    const grnNumber = str(req.body?.grn_number, 'grn_number', { max: 60, required: true });
    const result = db
      .prepare(
        `INSERT INTO grns (company_id, grn_number, date, po_id, supplier, total_amount, status, items)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        companyId,
        grnNumber,
        isoDate(req.body?.date, 'date'),
        poId,
        str(req.body?.supplier, 'supplier', { max: 200 }),
        money(req.body?.total_amount, 'total_amount'),
        str(req.body?.status, 'status', { max: 40 }) || 'Received',
        parseItems(req.body?.items, 'items'),
      );
    logEvent(req.actor!, 'CREATE', 'GRN', Number(result.lastInsertRowid), `Created GRN: ${grnNumber}`);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  app.put('/api/grns/:id', requireAuth, denyWrites, (req, res) => {
    const id = int(req.params.id, 'id');
    const existing = db.prepare('SELECT company_id FROM grns WHERE id = ?').get(id) as
      | { company_id: number }
      | undefined;
    if (!existing) throw new HttpError(404, 'GRN not found');
    const companyId = assertCompanyAccess(req, existing.company_id);

    let poId: number | null = null;
    if (req.body?.po_id) {
      poId = int(req.body.po_id, 'po_id');
      const po = db.prepare('SELECT id FROM purchase_orders WHERE id = ? AND company_id = ?').get(poId, companyId);
      if (!po) throw badRequest('Selected purchase order does not belong to this company');
    }
    db.prepare(
      `UPDATE grns SET grn_number = ?, date = ?, po_id = ?, supplier = ?, total_amount = ?, status = ?, items = ?
       WHERE id = ?`,
    ).run(
      str(req.body?.grn_number, 'grn_number', { max: 60, required: true }),
      isoDate(req.body?.date, 'date'),
      poId,
      str(req.body?.supplier, 'supplier', { max: 200 }),
      money(req.body?.total_amount, 'total_amount'),
      str(req.body?.status, 'status', { max: 40 }) || 'Received',
      parseItems(req.body?.items, 'items'),
      id,
    );
    logEvent(req.actor!, 'UPDATE', 'GRN', id, `Updated GRN ID: ${id}`);
    res.json({ success: true });
  });

  app.delete('/api/grns/:id', requireAuth, denyWrites, (req, res) => {
    const id = int(req.params.id, 'id');
    const existing = db.prepare('SELECT company_id FROM grns WHERE id = ?').get(id) as
      | { company_id: number }
      | undefined;
    if (!existing) throw new HttpError(404, 'GRN not found');
    assertCompanyAccess(req, existing.company_id);
    db.prepare('DELETE FROM grns WHERE id = ?').run(id);
    logEvent(req.actor!, 'DELETE', 'GRN', id, `Deleted GRN ID: ${id}`);
    res.json({ success: true });
  });

  // Document numbering -----------------------------------------------------

  app.get('/api/next-number/po', requireAuth, (req, res) => {
    const companyId = assertCompanyAccess(req, req.query.company_id);
    const type = String(req.query.type ?? 'LPO') === 'IPO' ? 'IPO' : 'LPO';
    const prefix = type === 'IPO' ? 'IPO' : 'LPO';
    const rows = db
      .prepare('SELECT po_number FROM purchase_orders WHERE company_id = ? AND type = ?')
      .all(companyId, type) as { po_number: string }[];
    let maxNum = 0;
    for (const row of rows) {
      const m = row.po_number?.match(/(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!Number.isNaN(n) && n > maxNum) maxNum = n;
      }
    }
    res.json({ nextNumber: `${prefix}-${new Date().getFullYear()}-${String(maxNum + 1).padStart(4, '0')}` });
  });

  app.get('/api/next-number/grn', requireAuth, (req, res) => {
    const companyId = assertCompanyAccess(req, req.query.company_id);
    const rows = db.prepare('SELECT grn_number FROM grns WHERE company_id = ?').all(companyId) as {
      grn_number: string;
    }[];
    let maxNum = 0;
    for (const row of rows) {
      const m = row.grn_number?.match(/(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!Number.isNaN(n) && n > maxNum) maxNum = n;
      }
    }
    res.json({ nextNumber: `GRN-${new Date().getFullYear()}-${String(maxNum + 1).padStart(4, '0')}` });
  });

  // Inter-company transfers — admin only -----------------------------------

  const TRANSFER_TABLES = {
    ledger: 'ledgers',
    voucher: 'transactions',
    asset: 'assets',
  } as const;
  type TransferType = keyof typeof TRANSFER_TABLES;

  /**
   * Moves a row between companies. A voucher cannot simply be re-stamped with
   * a new company_id: it would keep pointing at ledgers that stayed behind in
   * the source company, and `GET /api/transactions/:companyId` joins on those
   * ledgers, so the row would silently vanish from both companies.
   *
   * So a voucher drags its ledgers across with it. If any of those ledgers are
   * also used by vouchers remaining in the source company the move is refused,
   * because splitting one ledger across two companies is not representable.
   */
  const transferOne = (type: TransferType, id: number, targetCompanyId: number, actor: Actor) => {
    const table = TRANSFER_TABLES[type];
    const row = db.prepare(`SELECT company_id FROM ${table} WHERE id = ?`).get(id) as
      | { company_id: number }
      | undefined;
    if (!row) throw new HttpError(404, `${type} not found`);
    if (row.company_id === targetCompanyId) throw badRequest(`${type} is already in the target company`);

    const draggedLedgers: number[] = [];
    if (type === 'voucher') {
      const voucher = db
        .prepare('SELECT debit_ledger_id, credit_ledger_id FROM transactions WHERE id = ?')
        .get(id) as { debit_ledger_id: number; credit_ledger_id: number };
      draggedLedgers.push(voucher.debit_ledger_id, voucher.credit_ledger_id);

      const stranded = db
        .prepare(
          `SELECT l.id, l.name FROM ledgers l
           WHERE l.id IN (?, ?)
             AND l.company_id != ?
             AND EXISTS (
               SELECT 1 FROM transactions t
               WHERE (t.debit_ledger_id = l.id OR t.credit_ledger_id = l.id)
                 AND t.company_id = ?
                 AND t.id != ?
             )
           LIMIT 1`,
        )
        .get(voucher.debit_ledger_id, voucher.credit_ledger_id, targetCompanyId, row.company_id, id) as
        | { id: number; name: string }
        | undefined;

      if (stranded) {
        throw badRequest(
          `Cannot move this voucher: ledger "${stranded.name}" is shared with other vouchers still in the source company. Move those first, or move the ledger itself.`,
        );
      }
    }

    if (type === 'ledger') {
      // The ledger takes every voucher that posts against it.
      const moved = db
        .prepare('SELECT COUNT(*) AS n FROM transactions WHERE debit_ledger_id = ? OR credit_ledger_id = ?')
        .get(id, id) as { n: number };
      db.prepare('UPDATE transactions SET company_id = ? WHERE debit_ledger_id = ? OR credit_ledger_id = ?').run(
        targetCompanyId,
        id,
        id,
      );
      if (moved.n > 0) {
        logEvent(
          actor,
          'TRANSFER',
          'VOUCHER',
          null,
          `Moved ${moved.n} voucher(s) along with ledger ID ${id} to company ID ${targetCompanyId}`,
        );
      }
    }

    if (draggedLedgers.length) {
      db.prepare(`UPDATE ledgers SET company_id = ? WHERE id IN (${draggedLedgers.map(() => '?').join(',')})`).run(
        targetCompanyId,
        ...draggedLedgers,
      );
    }

    db.prepare(`UPDATE ${table} SET company_id = ? WHERE id = ?`).run(targetCompanyId, id);
    logEvent(actor, 'TRANSFER', type.toUpperCase(), id, `Moved ${type} ID ${id} to company ID ${targetCompanyId}`);
  };

  app.post('/api/transfers/bulk', requireAuth, requireRole('admin'), (req, res) => {
    const type = String(req.body?.type ?? '') as TransferType;
    const table = TRANSFER_TABLES[type];
    if (!table) throw badRequest('Invalid type');
    const targetCompanyId = assertCompanyAccess(req, req.body?.target_company_id);
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) throw badRequest('ids must be a non-empty array');

    const run = db.transaction(() => {
      for (const raw of ids) transferOne(type, int(raw, 'id'), targetCompanyId, req.actor!);
    });
    run();
    res.json({ success: true, count: ids.length });
  });

  for (const [type, singular] of [
    ['ledger', 'ledger_id'],
    ['voucher', 'voucher_id'],
    ['asset', 'asset_id'],
  ] as const) {
    app.post(`/api/transfers/${type}`, requireAuth, requireRole('admin'), (req, res) => {
      const targetCompanyId = assertCompanyAccess(req, req.body?.target_company_id);
      const run = db.transaction(() =>
        transferOne(type as TransferType, int(req.body?.[singular], singular), targetCompanyId, req.actor!),
      );
      run();
      res.json({ success: true });
    });
  }

  // --- Frontend ------------------------------------------------------------

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint' }));

  if (IS_PROD) {
    // The server is compiled to dist-server/server.js, so __dirname is
    // /app/dist-server and the Vite output sits next to it in /app/dist.
    // Resolve from process.cwd() instead, which is the app root in both the
    // container and a bare `node dist-server/server.js` run.
    const distDir = process.env.STATIC_DIR
      ? path.resolve(process.env.STATIC_DIR)
      : path.resolve(process.cwd(), 'dist');

    if (!fs.existsSync(path.join(distDir, 'index.html'))) {
      console.error(
        `[static] index.html not found in ${distDir}. The frontend was probably not built into the image.`,
      );
    }

    app.use(
      express.static(distDir, {
        index: false,
        setHeaders(res, filePath) {
          // Vite emits content-hashed asset filenames, so they are immutable.
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    // Imported lazily so the production process never loads Vite at all.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  // Error handler ----------------------------------------------------------
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...err.payload });
    }
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed JSON body' });
    }
    console.error('[error]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  const PORT = Number(process.env.PORT || 3000);

  // Default to 0.0.0.0, not 127.0.0.1.
  //
  // Inside a container, binding loopback means nothing is listening on the
  // container's network interface: docker-proxy and the cloudflared container
  // both connect to the container IP, so every external request is refused
  // while a loopback healthcheck inside the container still passes and reports
  // the service as healthy. That failure is invisible from inside.
  //
  // This is safe because the container's own network namespace is the boundary.
  // Exposure is controlled by what the host publishes — docker-compose binds
  // 127.0.0.1:4030:3000, so port 3000 is not exposed to the internet.
  const HOST = process.env.HOST || '0.0.0.0';
  const server = app.listen(PORT, HOST, () => {
    console.log(`[ledgerflow] listening on http://${HOST}:${PORT} (${IS_PROD ? 'production' : 'development'})`);
  });

  const shutdown = (signal: string) => {
    console.log(`[ledgerflow] ${signal} received, closing`);
    server.close(() => {
      try {
        // Fold the WAL back into the main db file so a bare copy of accounting.db
        // is never missing committed transactions.
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch (e) {
        console.error('[ledgerflow] WAL checkpoint failed', e);
      }
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((e) => {
  console.error('[ledgerflow] failed to start', e);
  process.exit(1);
});
