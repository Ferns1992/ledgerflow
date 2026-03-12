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

  CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    type TEXT,
    po_number TEXT,
    date TEXT,
    supplier TEXT,
    total_amount REAL,
    status TEXT DEFAULT 'Pending',
    items TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS grns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER,
    grn_number TEXT,
    date TEXT,
    po_id INTEGER,
    supplier TEXT,
    total_amount REAL,
    status TEXT DEFAULT 'Received',
    items TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id),
    FOREIGN KEY(po_id) REFERENCES purchase_orders(id)
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
    const { name, address, gstin, currency_symbol, taxes, userId, userName } = req.body;
    try {
      const result = db.prepare('INSERT INTO companies (name, address, gstin, currency_symbol) VALUES (?, ?, ?, ?)').run(name, address, gstin, currency_symbol || '₹');
      const companyId = result.lastInsertRowid as number;
      
      if (taxes && Array.isArray(taxes)) {
        const insertTax = db.prepare('INSERT INTO taxes (company_id, name, rate) VALUES (?, ?, ?)');
        for (const tax of taxes) {
          insertTax.run(companyId, tax.name, tax.rate);
        }
      }
      
      logEvent(userId, userName, 'CREATE', 'COMPANY', companyId, `Created company: ${name}`);
      res.json({ id: companyId });
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

  app.post('/api/ledgers/bulk', (req, res) => {
    const { ledgers, userId, userName } = req.body;
    if (!Array.isArray(ledgers) || ledgers.length === 0) {
      return res.status(400).json({ error: 'Invalid ledgers array' });
    }

    const insert = db.prepare('INSERT INTO ledgers (company_id, name, group_name, opening_balance) VALUES (?, ?, ?, ?)');
    
    const insertMany = db.transaction((ledgs) => {
      let count = 0;
      for (const l of ledgs) {
        insert.run(l.company_id, l.name, l.group_name, l.opening_balance);
        count++;
      }
      return count;
    });

    try {
      const count = insertMany(ledgers);
      logEvent(userId, userName, 'CREATE', 'LEDGER_BULK', null, `Imported ${count} ledgers`);
      res.json({ success: true, count });
    } catch (error) {
      console.error('Bulk insert error:', error);
      res.status(500).json({ error: 'Failed to import ledgers' });
    }
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

  app.post('/api/transactions/bulk', (req, res) => {
    const { transactions, userId, userName } = req.body;
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ error: 'Invalid transactions array' });
    }

    const insert = db.prepare('INSERT INTO transactions (company_id, date, debit_ledger_id, credit_ledger_id, amount, tax_id, tax_amount, narration) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    
    const insertMany = db.transaction((txs) => {
      let count = 0;
      for (const tx of txs) {
        insert.run(tx.company_id, tx.date, tx.debit_ledger_id, tx.credit_ledger_id, tx.amount, tx.tax_id || null, tx.tax_amount || 0, tx.narration);
        count++;
      }
      return count;
    });

    try {
      const count = insertMany(transactions);
      logEvent(userId, userName, 'CREATE', 'TRANSACTION_BULK', null, `Imported ${count} transactions`);
      res.json({ success: true, count });
    } catch (error) {
      console.error('Bulk insert error:', error);
      res.status(500).json({ error: 'Failed to import transactions' });
    }
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

  app.post('/api/assets/bulk', (req, res) => {
    const { assets, userId, userName } = req.body;
    if (!Array.isArray(assets) || assets.length === 0) {
      return res.status(400).json({ error: 'Invalid assets array' });
    }

    const insert = db.prepare('INSERT INTO assets (company_id, name, value, purchase_date, depreciation_rate) VALUES (?, ?, ?, ?, ?)');
    
    const insertMany = db.transaction((asts) => {
      let count = 0;
      for (const a of asts) {
        insert.run(a.company_id, a.name, a.value, a.purchase_date, a.depreciation_rate);
        count++;
      }
      return count;
    });

    try {
      const count = insertMany(assets);
      logEvent(userId, userName, 'CREATE', 'ASSET_BULK', null, `Imported ${count} assets`);
      res.json({ success: true, count });
    } catch (error) {
      console.error('Bulk insert error:', error);
      res.status(500).json({ error: 'Failed to import assets' });
    }
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
    db.prepare('DELETE FROM grns WHERE company_id = ?').run(id);
    db.prepare('DELETE FROM purchase_orders WHERE company_id = ?').run(id);
    db.prepare('DELETE FROM taxes WHERE company_id = ?').run(id);
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

  // --- Purchase Orders (LPO/IPO) ---
  app.get('/api/purchase-orders', (req, res) => {
    const { company_id } = req.query;
    if (!company_id) return res.json([]);
    const pos = db.prepare('SELECT * FROM purchase_orders WHERE company_id = ? ORDER BY date DESC').all(company_id);
    res.json(pos);
  });

  app.post('/api/purchase-orders', (req, res) => {
    const { company_id, type, po_number, date, supplier, total_amount, status, items, userId, userName } = req.body;
    const result = db.prepare('INSERT INTO purchase_orders (company_id, type, po_number, date, supplier, total_amount, status, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(company_id, type, po_number, date, supplier, total_amount, status || 'Pending', JSON.stringify(items));
    logEvent(userId, userName, 'CREATE', 'PURCHASE_ORDER', result.lastInsertRowid as number, `Created ${type}: ${po_number}`);
    res.json({ id: result.lastInsertRowid });
  });

  app.put('/api/purchase-orders/:id', (req, res) => {
    const { type, po_number, date, supplier, total_amount, status, items, userId, userName } = req.body;
    db.prepare('UPDATE purchase_orders SET type = ?, po_number = ?, date = ?, supplier = ?, total_amount = ?, status = ?, items = ? WHERE id = ?').run(type, po_number, date, supplier, total_amount, status, JSON.stringify(items), req.params.id);
    logEvent(userId, userName, 'UPDATE', 'PURCHASE_ORDER', Number(req.params.id), `Updated ${type}: ${po_number}`);
    res.json({ success: true });
  });

  app.delete('/api/purchase-orders/:id', (req, res) => {
    const { userId, userName } = req.query;
    db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(req.params.id);
    logEvent(userId, userName, 'DELETE', 'PURCHASE_ORDER', req.params.id, `Deleted PO ID: ${req.params.id}`);
    res.json({ success: true });
  });

  // --- GRNs ---
  app.get('/api/grns', (req, res) => {
    const { company_id } = req.query;
    if (!company_id) return res.json([]);
    const grns = db.prepare('SELECT * FROM grns WHERE company_id = ? ORDER BY date DESC').all(company_id);
    res.json(grns);
  });

  app.post('/api/grns', (req, res) => {
    const { company_id, grn_number, date, po_id, supplier, total_amount, status, items, userId, userName } = req.body;
    const result = db.prepare('INSERT INTO grns (company_id, grn_number, date, po_id, supplier, total_amount, status, items) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(company_id, grn_number, date, po_id, supplier, total_amount, status || 'Received', JSON.stringify(items));
    logEvent(userId, userName, 'CREATE', 'GRN', result.lastInsertRowid as number, `Created GRN: ${grn_number}`);
    res.json({ id: result.lastInsertRowid });
  });

  app.put('/api/grns/:id', (req, res) => {
    const { grn_number, date, po_id, supplier, total_amount, status, items, userId, userName } = req.body;
    db.prepare('UPDATE grns SET grn_number = ?, date = ?, po_id = ?, supplier = ?, total_amount = ?, status = ?, items = ? WHERE id = ?').run(grn_number, date, po_id, supplier, total_amount, status, JSON.stringify(items), req.params.id);
    logEvent(userId, userName, 'UPDATE', 'GRN', Number(req.params.id), `Updated GRN: ${grn_number}`);
    res.json({ success: true });
  });

  app.delete('/api/grns/:id', (req, res) => {
    const { userId, userName } = req.query;
    db.prepare('DELETE FROM grns WHERE id = ?').run(req.params.id);
    logEvent(userId, userName, 'DELETE', 'GRN', req.params.id, `Deleted GRN ID: ${req.params.id}`);
    res.json({ success: true });
  });

  // --- Auto-numbering ---
  app.get('/api/next-number/po', (req, res) => {
    try {
      const { company_id, type } = req.query;
      if (!company_id) return res.status(400).json({ error: 'company_id is required' });
      
      const prefix = type === 'LPO' ? 'LPO' : 'IPO';
      const allPOs = db.prepare('SELECT po_number FROM purchase_orders WHERE company_id = ? AND type = ?').all(company_id, type) as { po_number: string }[];
      
      let maxNum = 0;
      allPOs.forEach(po => {
        if (po.po_number) {
          const match = po.po_number.match(/(\d+)$/);
          if (match) {
            const num = parseInt(match[1]);
            if (!isNaN(num) && num > maxNum) maxNum = num;
          }
        }
      });
      
      const nextNum = maxNum + 1;
      const year = new Date().getFullYear();
      const nextNumber = `${prefix}-${year}-${nextNum.toString().padStart(4, '0')}`;
      console.log(`Generated next PO number: ${nextNumber} for company: ${company_id}, type: ${type}`);
      res.json({ nextNumber });
    } catch (error) {
      console.error('Error generating next PO number:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/next-number/grn', (req, res) => {
    try {
      const { company_id } = req.query;
      if (!company_id) return res.status(400).json({ error: 'company_id is required' });
      
      const allGRNs = db.prepare('SELECT grn_number FROM grns WHERE company_id = ?').all(company_id) as { grn_number: string }[];
      
      let maxNum = 0;
      allGRNs.forEach(grn => {
        if (grn.grn_number) {
          const match = grn.grn_number.match(/(\d+)$/);
          if (match) {
            const num = parseInt(match[1]);
            if (!isNaN(num) && num > maxNum) maxNum = num;
          }
        }
      });
      
      const nextNum = maxNum + 1;
      const year = new Date().getFullYear();
      const nextNumber = `GRN-${year}-${nextNum.toString().padStart(4, '0')}`;
      console.log(`Generated next GRN number: ${nextNumber} for company: ${company_id}`);
      res.json({ nextNumber });
    } catch (error) {
      console.error('Error generating next GRN number:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // --- Inter-Company Transfers ---
  app.post('/api/transfers/ledger', (req, res) => {
    const { ledger_id, target_company_id, userId, userName } = req.body;
    db.prepare('UPDATE ledgers SET company_id = ? WHERE id = ?').run(target_company_id, ledger_id);
    logEvent(userId, userName, 'TRANSFER', 'LEDGER', ledger_id, `Transferred Ledger ID: ${ledger_id} to Company ID: ${target_company_id}`);
    res.json({ success: true });
  });

  app.post('/api/transfers/voucher', (req, res) => {
    const { voucher_id, target_company_id, userId, userName } = req.body;
    db.prepare('UPDATE transactions SET company_id = ? WHERE id = ?').run(target_company_id, voucher_id);
    logEvent(userId, userName, 'TRANSFER', 'VOUCHER', voucher_id, `Transferred Voucher ID: ${voucher_id} to Company ID: ${target_company_id}`);
    res.json({ success: true });
  });

  app.post('/api/transfers/asset', (req, res) => {
    const { asset_id, target_company_id, userId, userName } = req.body;
    db.prepare('UPDATE assets SET company_id = ? WHERE id = ?').run(target_company_id, asset_id);
    logEvent(userId, userName, 'TRANSFER', 'ASSET', asset_id, `Transferred Asset ID: ${asset_id} to Company ID: ${target_company_id}`);
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
