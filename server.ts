import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || 'accounting.db';
const db = new Database(dbPath);

// Initialize Database Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'viewer',
    full_name TEXT
  );

  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    address TEXT,
    gstin TEXT,
    currency_symbol TEXT DEFAULT '₹',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS taxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    name TEXT,
    rate REAL,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS ledgers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    name TEXT,
    group_name TEXT,
    opening_balance REAL DEFAULT 0,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    date TEXT,
    debit_ledger_id INTEGER,
    credit_ledger_id INTEGER,
    amount REAL,
    tax_id INTEGER,
    tax_amount REAL DEFAULT 0,
    narration TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id),
    FOREIGN KEY(debit_ledger_id) REFERENCES ledgers(id),
    FOREIGN KEY(credit_ledger_id) REFERENCES ledgers(id),
    FOREIGN KEY(tax_id) REFERENCES taxes(id)
  );

  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    name TEXT,
    value REAL,
    purchase_date TEXT,
    depreciation_rate REAL,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    user_name TEXT,
    action TEXT,
    entity_type TEXT,
    entity_id INTEGER,
    details TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Insert default admin if no users exist
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
if (userCount.count === 0) {
  db.prepare('INSERT INTO users (username, password, role, full_name) VALUES (?, ?, ?, ?)').run('admin', 'admin', 'admin', 'System Administrator');
}

// Helper to log events
const logEvent = (userId: any, userName: any, action: string, entityType: string, entityId: any, details: string) => {
  try {
    const uId = (userId && userId !== 'undefined') ? Number(userId) : null;
    const uName = (userName && userName !== 'undefined') ? userName : 'System';
    const eId = (entityId && entityId !== 'undefined') ? Number(entityId) : null;
    db.prepare('INSERT INTO event_logs (user_id, user_name, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)').run(uId, uName, action, entityType, eId, details);
  } catch (e) {
    console.error('Logging failed', e);
  }
};

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Routes
  app.get('/api/logs', (req, res) => {
    const logs = db.prepare(`
      SELECT l.*, u.full_name as user_name 
      FROM event_logs l
      LEFT JOIN users u ON l.user_id = u.id
      ORDER BY l.timestamp DESC
      LIMIT 100
    `).all();
    res.json(logs);
  });

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT id, username, role, full_name FROM users WHERE username = ? AND password = ?').get(username, password);
    if (user) {
      res.json(user);
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  app.get('/api/companies', (req, res) => {
    const companies = db.prepare('SELECT * FROM companies').all();
    res.json(companies);
  });

  app.post('/api/companies', (req, res) => {
    const { name, address, gstin, currency_symbol, userId, userName } = req.body;
    try {
      const result = db.prepare('INSERT INTO companies (name, address, gstin, currency_symbol) VALUES (?, ?, ?, ?)').run(name, address, gstin, currency_symbol || '₹');
      logEvent(userId, userName, 'CREATE', 'COMPANY', result.lastInsertRowid as number, `Created company: ${name}`);
      res.json({ id: result.lastInsertRowid });
    } catch (e) {
      res.status(400).json({ error: 'Company already exists' });
    }
  });

  app.put('/api/companies/:id', (req, res) => {
    const { name, address, gstin, currency_symbol, userId, userName } = req.body;
    db.prepare('UPDATE companies SET name = ?, address = ?, gstin = ?, currency_symbol = ? WHERE id = ?').run(name, address, gstin, currency_symbol, req.params.id);
    logEvent(userId, userName, 'UPDATE', 'COMPANY', Number(req.params.id), `Updated company: ${name}`);
    res.json({ success: true });
  });

  app.get('/api/ledgers/:companyId', (req, res) => {
    const ledgers = db.prepare('SELECT * FROM ledgers WHERE company_id = ?').all(req.params.companyId);
    res.json(ledgers);
  });

  app.post('/api/ledgers', (req, res) => {
    const { company_id, name, group_name, opening_balance, userId, userName } = req.body;
    const result = db.prepare('INSERT INTO ledgers (company_id, name, group_name, opening_balance) VALUES (?, ?, ?, ?)').run(company_id, name, group_name, opening_balance);
    logEvent(userId, userName, 'CREATE', 'LEDGER', result.lastInsertRowid as number, `Created ledger: ${name}`);
    res.json({ id: result.lastInsertRowid });
  });

  app.put('/api/ledgers/:id', (req, res) => {
    const { name, group_name, opening_balance, userId, userName } = req.body;
    db.prepare('UPDATE ledgers SET name = ?, group_name = ?, opening_balance = ? WHERE id = ?').run(name, group_name, opening_balance, req.params.id);
    logEvent(userId, userName, 'UPDATE', 'LEDGER', Number(req.params.id), `Updated ledger: ${name}`);
    res.json({ success: true });
  });

  app.get('/api/taxes/:companyId', (req, res) => {
    const taxes = db.prepare('SELECT * FROM taxes WHERE company_id = ?').all(req.params.companyId);
    res.json(taxes);
  });

  app.post('/api/taxes', (req, res) => {
    const { company_id, name, rate, userId, userName } = req.body;
    const result = db.prepare('INSERT INTO taxes (company_id, name, rate) VALUES (?, ?, ?)').run(company_id, name, rate);
    logEvent(userId, userName, 'CREATE', 'TAX', result.lastInsertRowid as number, `Created tax: ${name}`);
    res.json({ id: result.lastInsertRowid });
  });

  app.put('/api/taxes/:id', (req, res) => {
    const { name, rate, userId, userName } = req.body;
    db.prepare('UPDATE taxes SET name = ?, rate = ? WHERE id = ?').run(name, rate, req.params.id);
    logEvent(userId, userName, 'UPDATE', 'TAX', Number(req.params.id), `Updated tax: ${name}`);
    res.json({ success: true });
  });

  app.delete('/api/taxes/:id', (req, res) => {
    const { userId, userName } = req.query;
    db.prepare('DELETE FROM taxes WHERE id = ?').run(req.params.id);
    logEvent(userId, userName, 'DELETE', 'TAX', Number(req.params.id), `Deleted tax ID: ${req.params.id}`);
    res.json({ success: true });
  });

  app.get('/api/transactions/:companyId', (req, res) => {
    const transactions = db.prepare(`
      SELECT t.*, dl.name as debit_ledger_name, cl.name as credit_ledger_name 
      FROM transactions t
      JOIN ledgers dl ON t.debit_ledger_id = dl.id
      JOIN ledgers cl ON t.credit_ledger_id = cl.id
      WHERE t.company_id = ?
      ORDER BY t.date DESC
    `).all(req.params.companyId);
    res.json(transactions);
  });

  app.post('/api/transactions', (req, res) => {
    const { company_id, date, debit_ledger_id, credit_ledger_id, amount, tax_id, tax_amount, narration, userId, userName } = req.body;
    const result = db.prepare('INSERT INTO transactions (company_id, date, debit_ledger_id, credit_ledger_id, amount, tax_id, tax_amount, narration) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(company_id, date, debit_ledger_id, credit_ledger_id, amount, tax_id, tax_amount, narration);
    logEvent(userId, userName, 'CREATE', 'TRANSACTION', result.lastInsertRowid as number, `Created transaction: ${amount} Dr ${debit_ledger_id} Cr ${credit_ledger_id}`);
    res.json({ id: result.lastInsertRowid });
  });

  app.put('/api/transactions/:id', (req, res) => {
    const { date, debit_ledger_id, credit_ledger_id, amount, tax_id, tax_amount, narration, userId, userName } = req.body;
    db.prepare('UPDATE transactions SET date = ?, debit_ledger_id = ?, credit_ledger_id = ?, amount = ?, tax_id = ?, tax_amount = ?, narration = ? WHERE id = ?').run(date, debit_ledger_id, credit_ledger_id, amount, tax_id, tax_amount, narration, req.params.id);
    logEvent(userId, userName, 'UPDATE', 'TRANSACTION', Number(req.params.id), `Updated transaction: ${amount}`);
    res.json({ success: true });
  });

  app.get('/api/assets/:companyId', (req, res) => {
    const assets = db.prepare('SELECT * FROM assets WHERE company_id = ?').all(req.params.companyId);
    res.json(assets);
  });

  app.post('/api/assets', (req, res) => {
    const { company_id, name, value, purchase_date, depreciation_rate, userId, userName } = req.body;
    const result = db.prepare('INSERT INTO assets (company_id, name, value, purchase_date, depreciation_rate) VALUES (?, ?, ?, ?, ?)').run(company_id, name, value, purchase_date, depreciation_rate);
    logEvent(userId, userName, 'CREATE', 'ASSET', result.lastInsertRowid as number, `Created asset: ${name}`);
    res.json({ id: result.lastInsertRowid });
  });

  app.put('/api/assets/:id', (req, res) => {
    const { name, value, purchase_date, depreciation_rate, userId, userName } = req.body;
    db.prepare('UPDATE assets SET name = ?, value = ?, purchase_date = ?, depreciation_rate = ? WHERE id = ?').run(name, value, purchase_date, depreciation_rate, req.params.id);
    logEvent(userId, userName, 'UPDATE', 'ASSET', Number(req.params.id), `Updated asset: ${name}`);
    res.json({ success: true });
  });

  app.get('/api/users', (req, res) => {
    const users = db.prepare('SELECT id, username, role, full_name FROM users').all();
    res.json(users);
  });

  app.post('/api/users', (req, res) => {
    const { username, password, role, full_name, userId, userName } = req.body;
    try {
      const result = db.prepare('INSERT INTO users (username, password, role, full_name) VALUES (?, ?, ?, ?)').run(username, password, role, full_name);
      logEvent(userId, userName, 'CREATE', 'USER', result.lastInsertRowid as number, `Created user: ${username}`);
      res.json({ id: result.lastInsertRowid });
    } catch (e) {
      res.status(400).json({ error: 'Username already exists' });
    }
  });

  app.put('/api/users/:id', (req, res) => {
    const { username, password, role, full_name, userId, userName } = req.body;
    if (password) {
      db.prepare('UPDATE users SET username = ?, password = ?, role = ?, full_name = ? WHERE id = ?').run(username, password, role, full_name, req.params.id);
    } else {
      db.prepare('UPDATE users SET username = ?, role = ?, full_name = ? WHERE id = ?').run(username, role, full_name, req.params.id);
    }
    logEvent(userId, userName, 'UPDATE', 'USER', Number(req.params.id), `Updated user: ${username}`);
    res.json({ success: true });
  });

  app.delete('/api/users/:id', (req, res) => {
    const { userId, userName } = req.query;
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    logEvent(userId, userName, 'DELETE', 'USER', req.params.id, `Deleted user ID: ${req.params.id}`);
    res.json({ success: true });
  });

  app.delete('/api/companies/:id', (req, res) => {
    const id = req.params.id;
    const { userId, userName } = req.query;
    db.prepare('DELETE FROM transactions WHERE company_id = ?').run(id);
    db.prepare('DELETE FROM ledgers WHERE company_id = ?').run(id);
    db.prepare('DELETE FROM assets WHERE company_id = ?').run(id);
    db.prepare('DELETE FROM companies WHERE id = ?').run(id);
    logEvent(userId, userName, 'DELETE', 'COMPANY', id, `Deleted company ID: ${id}`);
    res.json({ success: true });
  });

  app.delete('/api/ledgers/:id', (req, res) => {
    const { userId, userName } = req.query;
    db.prepare('DELETE FROM transactions WHERE debit_ledger_id = ? OR credit_ledger_id = ?').run(req.params.id, req.params.id);
    db.prepare('DELETE FROM ledgers WHERE id = ?').run(req.params.id);
    logEvent(userId, userName, 'DELETE', 'LEDGER', req.params.id, `Deleted ledger ID: ${req.params.id}`);
    res.json({ success: true });
  });

  app.delete('/api/transactions/:id', (req, res) => {
    const { userId, userName } = req.query;
    db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
    logEvent(userId, userName, 'DELETE', 'TRANSACTION', req.params.id, `Deleted transaction ID: ${req.params.id}`);
    res.json({ success: true });
  });

  app.delete('/api/assets/:id', (req, res) => {
    const { userId, userName } = req.query;
    db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
    logEvent(userId, userName, 'DELETE', 'ASSET', req.params.id, `Deleted asset ID: ${req.params.id}`);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
