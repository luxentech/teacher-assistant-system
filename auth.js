const crypto = require('node:crypto');
const { db, initUserSettings } = require('./database');

// Hash password with salt
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

// Generate secure random token
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Register user
function registerUser({ name, phone, password, confirmPassword, subject, center_name }) {
  if (!name || !name.trim()) {
    throw new Error('الاسم مطلوب بالكامل');
  }
  const cleanPhone = String(phone || '').trim();
  if (!cleanPhone || cleanPhone.length < 6) {
    throw new Error('برجاء إدخال رقم هاتف صحيح');
  }
  if (!password || password.length < 4) {
    throw new Error('كلمة السر يجب أن لا تقل عن 4 حروف أو أرقام');
  }
  if (password !== confirmPassword) {
    throw new Error('كلمة السر وتأكيد كلمة السر غير متطابقين');
  }

  // Check if phone already registered
  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(cleanPhone);
  if (existing) {
    throw new Error('رقم الهاتف مسجل بالفعل مسبقاً، يمكنك تسجيل الدخول به مباشرة');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  const stmt = db.prepare(`
    INSERT INTO users (name, phone, password_hash, salt, subject, center_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(name.trim(), cleanPhone, passwordHash, salt, (subject || '').trim(), (center_name || '').trim());
  const userId = Number(result.lastInsertRowid);

  // Initialize settings for new user
  initUserSettings(userId, name.trim(), subject || '', center_name || '');

  // Generate auth token
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  db.prepare('INSERT INTO user_tokens (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);

  const user = db.prepare('SELECT id, name, phone, subject, center_name, created_at FROM users WHERE id = ?').get(userId);
  return { user, token };
}

// Login user
function loginUser({ phone, password }) {
  const cleanPhone = String(phone || '').trim();
  if (!cleanPhone || !password) {
    throw new Error('برجاء كتابة رقم الهاتف وكلمة السر');
  }

  const userRecord = db.prepare('SELECT * FROM users WHERE phone = ?').get(cleanPhone);
  if (!userRecord) {
    throw new Error('رقم الهاتف غير مسجل بالنظام، برجاء إنشاء حساب جديد أولاً');
  }

  const hash = hashPassword(password, userRecord.salt);
  if (hash !== userRecord.password_hash) {
    throw new Error('كلمة السر غير صحيحة، برجاء التأكد والمحاولة مرة أخرى');
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO user_tokens (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userRecord.id, expiresAt);

  const user = {
    id: userRecord.id,
    name: userRecord.name,
    phone: userRecord.phone,
    subject: userRecord.subject,
    center_name: userRecord.center_name,
    created_at: userRecord.created_at
  };

  return { user, token };
}

// Get user from token
function getUserFromToken(token) {
  if (!token) return null;
  const tokenRecord = db.prepare(`
    SELECT ut.user_id, u.id, u.name, u.phone, u.subject, u.center_name, u.created_at
    FROM user_tokens ut
    JOIN users u ON ut.user_id = u.id
    WHERE ut.token = ?
  `).get(token);

  if (!tokenRecord) return null;

  return {
    id: tokenRecord.id,
    name: tokenRecord.name,
    phone: tokenRecord.phone,
    subject: tokenRecord.subject,
    center_name: tokenRecord.center_name,
    created_at: tokenRecord.created_at
  };
}

// Logout
function logoutUser(token) {
  if (token) {
    db.prepare('DELETE FROM user_tokens WHERE token = ?').run(token);
  }
}

// Express Middleware for protecting APIs
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  let token = null;

  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else {
      token = authHeader.trim();
    }
  }

  // Also allow query parameter ?token=... for file downloads (Excel, Backup JSON)
  if (!token && req.query && req.query.token) {
    token = String(req.query.token).trim();
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'غير مصرح: يجب تسجيل الدخول للوصول إلى هذه البيانات' });
  }

  const user = getUserFromToken(token);
  if (!user) {
    return res.status(401).json({ success: false, error: 'جلسة تسجيل الدخول منتهية أو غير صالحة، برجاء إعادة تسجيل الدخول' });
  }

  req.user = user;
  req.userId = user.id;
  req.token = token;
  next();
}

module.exports = {
  registerUser,
  loginUser,
  getUserFromToken,
  logoutUser,
  requireAuth
};
