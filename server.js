const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const xlsx = require('xlsx');
const { db } = require('./database');
const { registerUser, loginUser, getUserFromToken, logoutUser, requireAuth, requireAdmin, normalizePhone, normalizeCode } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Uploads directory (use /tmp on Vercel)
const uploadsDir = process.env.VERCEL ? path.join(require('node:os').tmpdir(), 'uploads') : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const upload = multer({ dest: uploadsDir });

// ==========================================
// 1. AUTHENTICATION APIs
// ==========================================
app.post('/api/auth/register', (req, res) => {
  try {
    const { name, phone, password, confirmPassword, subject, center_name } = req.body;
    const result = registerUser({ name, phone, password, confirmPassword, subject, center_name });
    res.json({
      success: true,
      message: 'تم إنشاء الحساب بنجاح! مرحباً بك في النظام',
      data: result
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { phone, password } = req.body;
    const result = loginUser({ phone, password });
    res.json({
      success: true,
      message: 'تم تسجيل الدخول بنجاح',
      data: result
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, data: req.user });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  let token = null;
  if (authHeader) {
    token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
  }
  if (token) {
    logoutUser(token);
  }
  res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
});

// Update User Profile
app.put('/api/auth/profile', requireAuth, (req, res) => {
  try {
    const { name, subject, center_name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'الاسم مطلوب' });
    }
    db.prepare('UPDATE users SET name = ?, subject = ?, center_name = ? WHERE id = ?')
      .run(name.trim(), (subject || '').trim(), (center_name || '').trim(), req.userId);

    // Also update settings teacher_name, subject, center_name
    db.prepare('INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)')
      .run(req.userId, 'teacher_name', name.trim());
    db.prepare('INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)')
      .run(req.userId, 'subject', (subject || '').trim());
    db.prepare('INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)')
      .run(req.userId, 'center_name', (center_name || '').trim());

    const updatedUser = db.prepare('SELECT id, name, phone, subject, center_name, created_at FROM users WHERE id = ?').get(req.userId);
    res.json({ success: true, message: 'تم تحديث البيانات الشخصية بنجاح', data: updatedUser });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 2. SETTINGS APIs
// ==========================================
app.get('/api/settings', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings WHERE user_id = ?').all(req.userId);
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', requireAuth, (req, res) => {
  try {
    const updateStmt = db.prepare('INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)');
    for (const [key, value] of Object.entries(req.body)) {
      updateStmt.run(req.userId, key, String(value));
    }
    res.json({ success: true, message: 'تم حفظ الإعدادات بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// ADMIN DASHBOARD & CONTROL PANEL APIs
// ==========================================
app.get('/api/admin/overview', requireAdmin, (req, res) => {
  try {
    const totalTeachers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role != 'admin'").get().count;
    const activeTeachers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role != 'admin' AND (status = 'active' OR status IS NULL)").get().count;
    const blockedTeachers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role != 'admin' AND status = 'blocked'").get().count;
    const totalStudents = db.prepare("SELECT COUNT(*) as count FROM students").get().count;
    const totalSessions = db.prepare("SELECT COUNT(*) as count FROM sessions").get().count;
    
    const attendanceIncome = db.prepare("SELECT SUM(paid_amount) as total FROM attendance").get().total || 0;
    const handoutsIncome = db.prepare("SELECT SUM(paid_amount) as total FROM student_handouts").get().total || 0;
    const paymentsIncome = db.prepare("SELECT SUM(amount) as total FROM payments").get().total || 0;
    const totalPlatformVolume = attendanceIncome + handoutsIncome + paymentsIncome;
    
    // Commission rate: 10% platform profit
    const commissionRate = 10;
    const platformProfit = Math.round(totalPlatformVolume * (commissionRate / 100));

    res.json({
      success: true,
      data: {
        totalTeachers,
        activeTeachers,
        blockedTeachers,
        totalStudents,
        totalSessions,
        totalPlatformVolume,
        commissionRate,
        platformProfit
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/teachers', requireAdmin, (req, res) => {
  try {
    const teachers = db.prepare(`
      SELECT u.id, u.name, u.phone, u.subject, u.center_name, u.role, u.status, u.created_at,
        (SELECT COUNT(*) FROM students WHERE user_id = u.id) as students_count,
        (SELECT COUNT(*) FROM groups WHERE user_id = u.id) as groups_count,
        (SELECT IFNULL(SUM(paid_amount), 0) FROM attendance WHERE user_id = u.id) as total_collected
      FROM users u
      WHERE u.role != 'admin'
      ORDER BY u.created_at DESC
    `).all();
    res.json({ success: true, data: teachers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/teachers/:id/toggle-status', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const teacher = db.prepare("SELECT * FROM users WHERE id = ? AND role != 'admin'").get(id);
    if (!teacher) {
      return res.status(404).json({ success: false, error: 'المدرس غير موجود' });
    }
    const newStatus = teacher.status === 'blocked' ? 'active' : 'blocked';
    db.prepare("UPDATE users SET status = ? WHERE id = ?").run(newStatus, id);

    // If blocked, immediately delete all active login tokens for this teacher
    if (newStatus === 'blocked') {
      db.prepare("DELETE FROM user_tokens WHERE user_id = ?").run(id);
    }

    res.json({
      success: true,
      message: newStatus === 'blocked' ? `تم إيقاف حساب المدرس (${teacher.name}) بنجاح` : `تم تفعيل حساب المدرس (${teacher.name}) بنجاح`,
      status: newStatus
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/teachers/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare("DELETE FROM users WHERE id = ? AND role != 'admin'").run(id);
    res.json({ success: true, message: 'تم حذف حساب المدرس بالكامل بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// CHAT APIs (الشات المباشر بين الأدمن والمدرس)
// ==========================================
app.get('/api/chat/messages', requireAuth, (req, res) => {
  try {
    let otherUserId;
    if (req.user.role === 'admin') {
      otherUserId = req.query.teacher_id;
      if (!otherUserId) {
        return res.status(400).json({ success: false, error: 'برجاء تحديد المدرس' });
      }
    } else {
      const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
      if (!admin) {
        return res.status(404).json({ success: false, error: 'حساب الإدارة غير متوفر حالياً' });
      }
      otherUserId = admin.id;
    }

    const messages = db.prepare(`
      SELECT m.*, u.name as sender_name, u.role as sender_role
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE (m.sender_id = ? AND m.receiver_id = ?)
         OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.created_at ASC
    `).all(req.userId, otherUserId, otherUserId, req.userId);

    // Mark as read
    db.prepare("UPDATE messages SET is_read = 1 WHERE receiver_id = ? AND sender_id = ? AND is_read = 0")
      .run(req.userId, otherUserId);

    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/chat/messages', requireAuth, (req, res) => {
  try {
    const { message, receiver_id } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'نص الرسالة مطلوب' });
    }

    let targetReceiverId = receiver_id;
    if (req.user.role !== 'admin') {
      const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
      if (!admin) return res.status(404).json({ success: false, error: 'حساب الإدارة غير موجود' });
      targetReceiverId = admin.id;
    } else {
      if (!targetReceiverId) {
        return res.status(400).json({ success: false, error: 'برجاء اختيار المدرس المستلم' });
      }
    }

    const stmt = db.prepare("INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)");
    const result = stmt.run(req.userId, targetReceiverId, message.trim());
    const inserted = db.prepare(`
      SELECT m.*, u.name as sender_name, u.role as sender_role
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `).get(result.lastInsertRowid);

    res.json({ success: true, data: inserted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/chat/conversations', requireAdmin, (req, res) => {
  try {
    const teachers = db.prepare(`
      SELECT u.id, u.name, u.phone, u.subject, u.status,
        (SELECT message FROM messages WHERE (sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id) ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE (sender_id = u.id AND receiver_id = ?) OR (sender_id = ? AND receiver_id = u.id) ORDER BY created_at DESC LIMIT 1) as last_message_date,
        (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread_count
      FROM users u
      WHERE u.role != 'admin'
      ORDER BY unread_count DESC, last_message_date DESC, u.name ASC
    `).all(req.userId, req.userId, req.userId, req.userId);

    res.json({ success: true, data: teachers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/chat/unread-count', requireAuth, (req, res) => {
  try {
    const count = db.prepare("SELECT COUNT(*) as c FROM messages WHERE receiver_id = ? AND is_read = 0").get(req.userId).c || 0;
    res.json({ success: true, unread_count: count });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 3. GROUPS APIs (المجموعات والمواعيد)
// ==========================================
app.get('/api/groups', requireAuth, (req, res) => {
  try {
    const groups = db.prepare(`
      SELECT g.*, 
        COUNT(s.id) as students_count
      FROM groups g
      LEFT JOIN students s ON s.group_id = g.id AND s.status = 'active'
      WHERE g.user_id = ?
      GROUP BY g.id
      ORDER BY g.grade, g.name
    `).all(req.userId);
    res.json({ success: true, data: groups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/groups', requireAuth, (req, res) => {
  try {
    const { name, grade, days, time, session_price, monthly_price, notes } = req.body;
    if (!name || !grade) {
      return res.status(400).json({ success: false, error: 'اسم المجموعة والمرحلة مطلوبان' });
    }
    const stmt = db.prepare(`
      INSERT INTO groups (user_id, name, grade, days, time, session_price, monthly_price, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(req.userId, name.trim(), grade.trim(), days || '', time || '', Number(session_price) || 0, Number(monthly_price) || 0, notes || '');
    res.json({ success: true, data: { id: result.lastInsertRowid }, message: 'تم إضافة المجموعة بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/groups/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { name, grade, days, time, session_price, monthly_price, notes } = req.body;
    const stmt = db.prepare(`
      UPDATE groups 
      SET name = ?, grade = ?, days = ?, time = ?, session_price = ?, monthly_price = ?, notes = ?
      WHERE id = ? AND user_id = ?
    `);
    const info = stmt.run(name.trim(), grade.trim(), days || '', time || '', Number(session_price) || 0, Number(monthly_price) || 0, notes || '', id, req.userId);
    if (info.changes === 0) {
      return res.status(404).json({ success: false, error: 'المجموعة غير موجودة أو غير مصرح بتعديلها' });
    }
    res.json({ success: true, message: 'تم تعديل المجموعة بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/groups/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const info = db.prepare('DELETE FROM groups WHERE id = ? AND user_id = ?').run(id, req.userId);
    if (info.changes === 0) {
      return res.status(404).json({ success: false, error: 'المجموعة غير موجودة' });
    }
    res.json({ success: true, message: 'تم حذف المجموعة بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 4. STUDENTS APIs (إدارة الطلاب)
// ==========================================
app.get('/api/students/next-code', requireAuth, (req, res) => {
  try {
    const row = db.prepare(`
      SELECT code FROM students 
      WHERE user_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(req.userId);
    let nextCode = '1001';
    if (row && !isNaN(parseInt(row.code, 10))) {
      nextCode = String(parseInt(row.code, 10) + 1);
    }
    res.json({ success: true, code: nextCode });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/students', requireAuth, (req, res) => {
  try {
    const { search, group_id, grade, status, has_debt } = req.query;
    let query = `
      SELECT s.*, g.name as group_name, g.days as group_days, g.time as group_time, g.session_price as group_session_price
      FROM students s
      LEFT JOIN groups g ON s.group_id = g.id
      WHERE s.user_id = ?
    `;
    const params = [req.userId];

    if (status) {
      query += ` AND s.status = ?`;
      params.push(status);
    }
    if (group_id) {
      query += ` AND s.group_id = ?`;
      params.push(group_id);
    }
    if (grade) {
      query += ` AND s.grade = ?`;
      params.push(grade);
    }
    if (has_debt === 'true') {
      query += ` AND s.balance > 0`;
    }
    if (search) {
      query += ` AND (s.name LIKE ? OR s.code LIKE ? OR s.phone LIKE ? OR s.father_phone LIKE ? OR s.mother_phone LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
    }

    query += ` ORDER BY s.name ASC`;
    const students = db.prepare(query).all(...params);
    res.json({ success: true, data: students });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/students/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const student = db.prepare(`
      SELECT s.*, g.name as group_name, g.days as group_days, g.time as group_time
      FROM students s
      LEFT JOIN groups g ON s.group_id = g.id
      WHERE s.id = ? AND s.user_id = ?
    `).get(id, req.userId);

    if (!student) {
      return res.status(404).json({ success: false, error: 'الطالب غير موجود' });
    }

    // Get attendance history
    const history = db.prepare(`
      SELECT a.*, s.session_date, s.title as session_title, g.name as group_name
      FROM attendance a
      JOIN sessions s ON a.session_id = s.id
      JOIN groups g ON s.group_id = g.id
      WHERE a.student_id = ? AND a.user_id = ?
      ORDER BY s.session_date DESC
    `).all(id, req.userId);

    // Get payments history
    const payments = db.prepare(`
      SELECT * FROM payments 
      WHERE student_id = ? AND user_id = ?
      ORDER BY date DESC, id DESC
    `).all(id, req.userId);

    // Get handouts delivered to this student
    const handouts = db.prepare(`
      SELECT sh.*, h.title as handout_title, h.price as handout_price
      FROM student_handouts sh
      JOIN handouts h ON sh.handout_id = h.id
      WHERE sh.student_id = ? AND sh.user_id = ?
      ORDER BY sh.delivered_at DESC
    `).all(id, req.userId);

    res.json({ success: true, data: { ...student, history, payments, handouts } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/students', requireAuth, (req, res) => {
  try {
    let { code, name, phone, grade, group_id, father_phone, mother_phone, monthly_fee, notes } = req.body;
    if (!name || !grade) {
      return res.status(400).json({ success: false, error: 'اسم الطالب والمرحلة الدراسية مطلوبان' });
    }

    code = normalizeCode(code);
    if (!code) {
      const last = db.prepare('SELECT code FROM students WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.userId);
      code = last && !isNaN(parseInt(last.code, 10)) ? String(parseInt(last.code, 10) + 1) : '1001';
    }

    // Check code uniqueness for this teacher
    const existing = db.prepare('SELECT id FROM students WHERE user_id = ? AND code = ?').get(req.userId, code);
    if (existing) {
      return res.status(400).json({ success: false, error: 'كود الطالب مسجل مسبقاً، برجاء اختيار كود آخر' });
    }

    if (!monthly_fee && group_id) {
      const grp = db.prepare('SELECT session_price FROM groups WHERE id = ? AND user_id = ?').get(group_id, req.userId);
      if (grp) monthly_fee = grp.session_price;
    }

    const cleanPhone = normalizePhone(phone);
    const cleanFatherPhone = normalizePhone(father_phone);
    const cleanMotherPhone = normalizePhone(mother_phone);

    const stmt = db.prepare(`
      INSERT INTO students (user_id, code, name, phone, grade, group_id, father_phone, mother_phone, monthly_fee, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      req.userId,
      code,
      name.trim(),
      cleanPhone,
      grade.trim(),
      group_id ? Number(group_id) : null,
      cleanFatherPhone,
      cleanMotherPhone,
      Number(monthly_fee) || 0,
      notes || ''
    );

    res.json({ success: true, data: { id: result.lastInsertRowid, code }, message: 'تم تسجيل الطالب بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/students/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    let { code, name, phone, grade, group_id, father_phone, mother_phone, monthly_fee, balance, notes, status } = req.body;

    code = normalizeCode(code);
    const existing = db.prepare('SELECT id FROM students WHERE user_id = ? AND code = ? AND id != ?').get(req.userId, code, id);
    if (existing) {
      return res.status(400).json({ success: false, error: 'هذا الكود مستخدم لطالب آخر لديك' });
    }

    const cleanPhone = normalizePhone(phone);
    const cleanFatherPhone = normalizePhone(father_phone);
    const cleanMotherPhone = normalizePhone(mother_phone);

    const stmt = db.prepare(`
      UPDATE students 
      SET code = ?, name = ?, phone = ?, grade = ?, group_id = ?, father_phone = ?, mother_phone = ?,
          monthly_fee = ?, balance = ?, notes = ?, status = ?
      WHERE id = ? AND user_id = ?
    `);
    const info = stmt.run(
      code,
      name.trim(),
      cleanPhone,
      grade.trim(),
      group_id ? Number(group_id) : null,
      cleanFatherPhone,
      cleanMotherPhone,
      Number(monthly_fee) || 0,
      Number(balance) || 0,
      notes || '',
      status || 'active',
      id,
      req.userId
    );

    if (info.changes === 0) {
      return res.status(404).json({ success: false, error: 'الطالب غير موجود' });
    }

    res.json({ success: true, message: 'تم تحديث بيانات الطالب بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/students/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const info = db.prepare('DELETE FROM students WHERE id = ? AND user_id = ?').run(id, req.userId);
    if (info.changes === 0) {
      return res.status(404).json({ success: false, error: 'الطالب غير موجود' });
    }
    res.json({ success: true, message: 'تم حذف الطالب بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 5. SESSIONS & ATTENDANCE APIs
// ==========================================
app.post('/api/sessions', requireAuth, (req, res) => {
  try {
    const { group_id, session_date, title, notes } = req.body;
    if (!group_id || !session_date) {
      return res.status(400).json({ success: false, error: 'المجموعة والتاريخ مطلوبان' });
    }

    // Verify group belongs to user
    const grp = db.prepare('SELECT * FROM groups WHERE id = ? AND user_id = ?').get(group_id, req.userId);
    if (!grp) {
      return res.status(404).json({ success: false, error: 'المجموعة غير موجودة' });
    }

    // Check if session already exists for this group on this date
    let session = db.prepare(`
      SELECT * FROM sessions 
      WHERE group_id = ? AND session_date = ? AND user_id = ?
    `).get(group_id, session_date, req.userId);

    if (!session) {
      const insertSession = db.prepare(`
        INSERT INTO sessions (user_id, group_id, session_date, title, notes, status)
        VALUES (?, ?, ?, ?, ?, 'active')
      `);
      const result = insertSession.run(req.userId, group_id, session_date, title || `حصة يوم ${session_date}`, notes || '');
      const sessionId = result.lastInsertRowid;
      session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);

      // Pre-populate attendance table with all active students in this group as 'absent'
      const groupStudents = db.prepare(`
        SELECT id, monthly_fee FROM students 
        WHERE group_id = ? AND status = 'active' AND user_id = ?
      `).all(group_id, req.userId);

      const defaultPrice = grp.session_price || 0;

      const insertAtt = db.prepare(`
        INSERT OR IGNORE INTO attendance (user_id, session_id, student_id, status, paid_amount, remaining_amount)
        VALUES (?, ?, ?, 'absent', 0, ?)
      `);

      for (const st of groupStudents) {
        const cost = st.monthly_fee > 0 ? st.monthly_fee : defaultPrice;
        insertAtt.run(req.userId, sessionId, st.id, cost);
      }
    }

    res.json({ success: true, data: session });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/sessions/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const session = db.prepare(`
      SELECT s.*, g.name as group_name, g.grade as group_grade, g.days as group_days, g.time as group_time, g.session_price
      FROM sessions s
      JOIN groups g ON s.group_id = g.id
      WHERE s.id = ? AND s.user_id = ?
    `).get(id, req.userId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'الحصة غير موجودة' });
    }

    // Ensure any newly added student to group also gets an attendance row
    const groupStudents = db.prepare(`
      SELECT id, monthly_fee FROM students 
      WHERE group_id = ? AND status = 'active' AND user_id = ?
    `).all(session.group_id, req.userId);

    const insertAtt = db.prepare(`
      INSERT OR IGNORE INTO attendance (user_id, session_id, student_id, status, paid_amount, remaining_amount)
      VALUES (?, ?, ?, 'absent', 0, ?)
    `);
    for (const st of groupStudents) {
      const cost = st.monthly_fee > 0 ? st.monthly_fee : session.session_price;
      insertAtt.run(req.userId, id, st.id, cost);
    }

    const attendanceRecords = db.prepare(`
      SELECT 
        a.id as attendance_id,
        a.status as attendance_status,
        a.check_in_time,
        a.paid_amount,
        a.remaining_amount,
        a.homework,
        a.quiz_score,
        a.max_quiz_score,
        a.received_handout,
        a.notes as attendance_notes,
        s.id as student_id,
        s.code as student_code,
        s.name as student_name,
        s.phone as student_phone,
        s.father_phone,
        s.mother_phone,
        s.balance as student_balance,
        s.monthly_fee
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      WHERE a.session_id = ? AND a.user_id = ?
      ORDER BY 
        CASE a.status 
          WHEN 'present' THEN 1 
          WHEN 'late' THEN 2 
          WHEN 'excused' THEN 3 
          WHEN 'absent' THEN 4 
          ELSE 5 
        END,
        a.check_in_time DESC,
        s.name ASC
    `).all(id, req.userId);

    const totalStudents = attendanceRecords.length;
    const presentCount = attendanceRecords.filter(r => r.attendance_status === 'present').length;
    const lateCount = attendanceRecords.filter(r => r.attendance_status === 'late').length;
    const excusedCount = attendanceRecords.filter(r => r.attendance_status === 'excused').length;
    const absentCount = attendanceRecords.filter(r => r.attendance_status === 'absent').length;
    const totalPaid = attendanceRecords.reduce((sum, r) => sum + (Number(r.paid_amount) || 0), 0);
    const totalRemaining = attendanceRecords.reduce((sum, r) => sum + (Number(r.remaining_amount) || 0), 0);
    const absentees = attendanceRecords.filter(r => r.attendance_status === 'absent');

    res.json({
      success: true,
      data: {
        session,
        records: attendanceRecords,
        stats: {
          totalStudents,
          presentCount,
          lateCount,
          excusedCount,
          absentCount,
          attendanceRate: totalStudents > 0 ? Math.round(((presentCount + lateCount) / totalStudents) * 100) : 0,
          totalPaid,
          totalRemaining
        },
        absentees
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fast Check-In (Barcode / Code)
app.post('/api/sessions/:id/checkin', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    let { code, paid_amount, status } = req.body;

    if (!code) {
      return res.status(400).json({ success: false, error: 'كود الطالب مطلوب' });
    }

    const cleanCode = normalizeCode(code);
    const student = db.prepare('SELECT * FROM students WHERE (code = ? OR id = ?) AND user_id = ?').get(cleanCode, cleanCode, req.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'كود الطالب غير صحيح أو غير مسجل لديك' });
    }

    const session = db.prepare(`
      SELECT s.*, g.session_price 
      FROM sessions s 
      JOIN groups g ON s.group_id = g.id 
      WHERE s.id = ? AND s.user_id = ?
    `).get(id, req.userId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'الحصة غير موجودة' });
    }

    const fee = student.monthly_fee > 0 ? student.monthly_fee : session.session_price;
    const paid = paid_amount !== undefined ? Number(paid_amount) : fee;
    const remaining = Math.max(0, fee - paid);

    const now = new Date();
    const checkInTime = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });

    let att = db.prepare('SELECT * FROM attendance WHERE session_id = ? AND student_id = ? AND user_id = ?').get(id, student.id, req.userId);

    if (att) {
      const prevRemaining = att.remaining_amount || 0;

      db.prepare(`
        UPDATE attendance 
        SET status = ?, check_in_time = ?, paid_amount = ?, remaining_amount = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `).run(status || 'present', checkInTime, paid, remaining, att.id, req.userId);

      const diff = remaining - prevRemaining;
      if (diff !== 0) {
        db.prepare('UPDATE students SET balance = balance + ? WHERE id = ? AND user_id = ?').run(diff, student.id, req.userId);
      }
    } else {
      db.prepare(`
        INSERT INTO attendance (user_id, session_id, student_id, status, check_in_time, paid_amount, remaining_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(req.userId, id, student.id, status || 'present', checkInTime, paid, remaining);

      if (remaining > 0) {
        db.prepare('UPDATE students SET balance = balance + ? WHERE id = ? AND user_id = ?').run(remaining, student.id, req.userId);
      }
    }

    const updatedStudent = db.prepare('SELECT * FROM students WHERE id = ? AND user_id = ?').get(student.id, req.userId);

    res.json({
      success: true,
      message: `تم تحضير الطالب: ${student.name} بنجاح`,
      data: {
        student: updatedStudent,
        paid,
        remaining,
        checkInTime,
        hasDebt: updatedStudent.balance > 0,
        debtAmount: updatedStudent.balance
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/attendance/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { status, paid_amount, remaining_amount, homework, quiz_score, received_handout, notes } = req.body;

    const oldRecord = db.prepare('SELECT * FROM attendance WHERE id = ? AND user_id = ?').get(id, req.userId);
    if (!oldRecord) {
      return res.status(404).json({ success: false, error: 'سجل الحضور غير موجود' });
    }

    const newPaid = paid_amount !== undefined ? Number(paid_amount) : oldRecord.paid_amount;
    const newRemaining = remaining_amount !== undefined ? Number(remaining_amount) : oldRecord.remaining_amount;

    db.prepare(`
      UPDATE attendance
      SET status = ?,
          paid_amount = ?,
          remaining_amount = ?,
          homework = ?,
          quiz_score = ?,
          received_handout = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(
      status || oldRecord.status,
      newPaid,
      newRemaining,
      homework !== undefined ? homework : oldRecord.homework,
      quiz_score !== undefined ? (quiz_score === '' ? null : Number(quiz_score)) : oldRecord.quiz_score,
      received_handout !== undefined ? Number(received_handout) : oldRecord.received_handout,
      notes !== undefined ? notes : oldRecord.notes,
      id,
      req.userId
    );

    const diff = newRemaining - oldRecord.remaining_amount;
    if (diff !== 0) {
      db.prepare('UPDATE students SET balance = balance + ? WHERE id = ? AND user_id = ?').run(diff, oldRecord.student_id, req.userId);
    }

    res.json({ success: true, message: 'تم التحديث بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 6. PAYMENTS & DEBT SETTLEMENT APIs (سداد الديون والدفعات)
// ==========================================
app.post('/api/payments', requireAuth, (req, res) => {
  try {
    const { student_id, amount, payment_type, notes, date } = req.body;
    const payAmount = Number(amount);
    if (!student_id || !payAmount || payAmount <= 0) {
      return res.status(400).json({ success: false, error: 'الطالب والمبلغ مطلوبان وقيمتهما أكبر من صفر' });
    }

    const student = db.prepare('SELECT * FROM students WHERE id = ? AND user_id = ?').get(student_id, req.userId);
    if (!student) {
      return res.status(404).json({ success: false, error: 'الطالب غير موجود' });
    }

    const payDate = date || new Date().toISOString().split('T')[0];
    const stmt = db.prepare(`
      INSERT INTO payments (user_id, student_id, amount, payment_type, notes, date)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(req.userId, student_id, payAmount, payment_type || 'سداد دين', notes || '', payDate);

    // Reduce student balance
    const newBalance = Math.max(0, student.balance - payAmount);
    db.prepare('UPDATE students SET balance = ? WHERE id = ? AND user_id = ?').run(newBalance, student_id, req.userId);

    res.json({
      success: true,
      message: `تم تسجيل سداد مبلغ ${payAmount} ج.م للطالب ${student.name} بنجاح`,
      data: {
        paidAmount: payAmount,
        previousBalance: student.balance,
        remainingBalance: newBalance
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 7. HANDOUTS & BOOKS APIs
// ==========================================
app.get('/api/handouts', requireAuth, (req, res) => {
  try {
    const handouts = db.prepare(`
      SELECT h.*, 
        COUNT(sh.id) as distributed_count,
        SUM(sh.paid_amount) as total_collected
      FROM handouts h
      LEFT JOIN student_handouts sh ON h.id = sh.handout_id
      WHERE h.user_id = ?
      GROUP BY h.id
      ORDER BY h.id DESC
    `).all(req.userId);
    res.json({ success: true, data: handouts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/handouts', requireAuth, (req, res) => {
  try {
    const { title, grade, price, notes } = req.body;
    if (!title || !grade) {
      return res.status(400).json({ success: false, error: 'عنوان المذكرة والمرحلة مطلوبان' });
    }
    const stmt = db.prepare('INSERT INTO handouts (user_id, title, grade, price, notes) VALUES (?, ?, ?, ?, ?)');
    const result = stmt.run(req.userId, title.trim(), grade.trim(), Number(price) || 0, notes || '');
    res.json({ success: true, data: { id: result.lastInsertRowid }, message: 'تم إضافة المذكرة بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/handouts/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const info = db.prepare('DELETE FROM handouts WHERE id = ? AND user_id = ?').run(id, req.userId);
    if (info.changes === 0) {
      return res.status(404).json({ success: false, error: 'المذكرة غير موجودة' });
    }
    res.json({ success: true, message: 'تم حذف المذكرة بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/handouts/distribute', requireAuth, (req, res) => {
  try {
    const { student_id, handout_id, paid_amount, remaining_amount, notes } = req.body;
    const stmt = db.prepare(`
      INSERT INTO student_handouts (user_id, student_id, handout_id, paid_amount, remaining_amount, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(req.userId, student_id, handout_id, Number(paid_amount) || 0, Number(remaining_amount) || 0, notes || '');

    if (Number(remaining_amount) > 0) {
      db.prepare('UPDATE students SET balance = balance + ? WHERE id = ? AND user_id = ?').run(Number(remaining_amount), student_id, req.userId);
    }

    res.json({ success: true, message: 'تم تسجيل تسليم المذكرة' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 8. EXPENSES APIs
// ==========================================
app.get('/api/expenses', requireAuth, (req, res) => {
  try {
    const expenses = db.prepare('SELECT * FROM expenses WHERE user_id = ? ORDER BY date DESC, id DESC').all(req.userId);
    res.json({ success: true, data: expenses });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/expenses', requireAuth, (req, res) => {
  try {
    const { title, amount, category, date, notes } = req.body;
    if (!title || !amount) {
      return res.status(400).json({ success: false, error: 'بيان المصروف والمبلغ مطلوبان' });
    }
    const stmt = db.prepare('INSERT INTO expenses (user_id, title, amount, category, date, notes) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(req.userId, title.trim(), Number(amount) || 0, category || 'عام', date || new Date().toISOString().split('T')[0], notes || '');
    res.json({ success: true, message: 'تم تسجيل المصروف بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/expenses/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const info = db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').run(id, req.userId);
    if (info.changes === 0) {
      return res.status(404).json({ success: false, error: 'المصروف غير موجود' });
    }
    res.json({ success: true, message: 'تم حذف المصروف بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 9. FINANCIAL & GENERAL REPORTS
// ==========================================
app.get('/api/reports/dashboard', requireAuth, (req, res) => {
  try {
    const totalStudents = db.prepare("SELECT COUNT(*) as count FROM students WHERE status = 'active' AND user_id = ?").get(req.userId).count;
    const totalGroups = db.prepare("SELECT COUNT(*) as count FROM groups WHERE user_id = ?").get(req.userId).count;
    
    // Total income from attendance
    const attendanceIncome = db.prepare("SELECT SUM(paid_amount) as total FROM attendance WHERE user_id = ?").get(req.userId).total || 0;
    
    // Total income from handouts
    const handoutsIncome = db.prepare("SELECT SUM(paid_amount) as total FROM student_handouts WHERE user_id = ?").get(req.userId).total || 0;
    
    // Total income from separate debt payments
    const paymentsIncome = db.prepare("SELECT SUM(amount) as total FROM payments WHERE user_id = ?").get(req.userId).total || 0;

    // Total expenses
    const totalExpenses = db.prepare("SELECT SUM(amount) as total FROM expenses WHERE user_id = ?").get(req.userId).total || 0;
    
    // Total debts owed by students
    const totalDebts = db.prepare("SELECT SUM(balance) as total FROM students WHERE balance > 0 AND user_id = ?").get(req.userId).total || 0;
    
    // Total students with debt
    const studentsWithDebt = db.prepare("SELECT COUNT(*) as count FROM students WHERE balance > 0 AND user_id = ?").get(req.userId).count;

    const totalIncome = attendanceIncome + handoutsIncome + paymentsIncome;

    // Recent sessions
    const recentSessions = db.prepare(`
      SELECT s.*, g.name as group_name, g.grade as group_grade,
        (SELECT COUNT(*) FROM attendance WHERE session_id = s.id AND status = 'present') as present_count,
        (SELECT COUNT(*) FROM attendance WHERE session_id = s.id AND status = 'absent') as absent_count,
        (SELECT SUM(paid_amount) FROM attendance WHERE session_id = s.id) as income
      FROM sessions s
      JOIN groups g ON s.group_id = g.id
      WHERE s.user_id = ?
      ORDER BY s.session_date DESC, s.id DESC
      LIMIT 5
    `).all(req.userId);

    res.json({
      success: true,
      data: {
        totalStudents,
        totalGroups,
        totalIncome,
        attendanceIncome,
        handoutsIncome,
        paymentsIncome,
        totalExpenses,
        netProfit: totalIncome - totalExpenses,
        totalDebts,
        studentsWithDebt,
        recentSessions
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Top students in quizzes (لوحة الشرف)
app.get('/api/reports/top-students', requireAuth, (req, res) => {
  try {
    const { grade } = req.query;
    let query = `
      SELECT s.id, s.name, s.code, s.grade, g.name as group_name,
        ROUND(AVG(a.quiz_score), 1) as avg_score,
        COUNT(a.quiz_score) as quizzes_count
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      LEFT JOIN groups g ON s.group_id = g.id
      WHERE a.quiz_score IS NOT NULL AND a.user_id = ?
    `;
    const params = [req.userId];
    if (grade) {
      query += ` AND s.grade = ?`;
      params.push(grade);
    }
    query += `
      GROUP BY s.id
      HAVING quizzes_count >= 1
      ORDER BY avg_score DESC
      LIMIT 10
    `;
    const top = db.prepare(query).all(...params);
    res.json({ success: true, data: top });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Absentees for today or specific session (قائمة الغائبين مع رسائل واتساب جاهزة)
app.get('/api/reports/absentees', requireAuth, (req, res) => {
  try {
    const { session_id, date } = req.query;
    let query = `
      SELECT a.*, s.name as student_name, s.code as student_code, s.phone as student_phone,
             s.father_phone, s.mother_phone, s.grade as student_grade,
             g.name as group_name, ses.session_date
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      JOIN sessions ses ON a.session_id = ses.id
      JOIN groups g ON ses.group_id = g.id
      WHERE a.user_id = ? AND a.status = 'absent'
    `;
    const params = [req.userId];

    if (session_id) {
      query += ` AND a.session_id = ?`;
      params.push(session_id);
    } else if (date) {
      query += ` AND ses.session_date = ?`;
      params.push(date);
    } else {
      const today = new Date().toISOString().split('T')[0];
      query += ` AND ses.session_date = ?`;
      params.push(today);
    }

    query += ` ORDER BY s.name ASC`;
    const absentees = db.prepare(query).all(...params);
    res.json({ success: true, data: absentees });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 10. EXCEL IMPORT & EXPORT
// ==========================================
app.get('/api/export/students-excel', requireAuth, (req, res) => {
  try {
    const students = db.prepare(`
      SELECT 
        s.code as "كود الطالب",
        s.name as "اسم الطالب",
        s.phone as "هاتف الطالب",
        s.grade as "المرحلة الدراسية",
        g.name as "المجموعة",
        s.father_phone as "هاتف الأب",
        s.mother_phone as "هاتف الأم",
        s.monthly_fee as "قيمة الحصة/الاشتراك",
        s.balance as "المديونية المتبقية",
        s.notes as "ملاحظات"
      FROM students s
      LEFT JOIN groups g ON s.group_id = g.id
      WHERE s.user_id = ?
      ORDER BY s.grade, s.name
    `).all(req.userId);

    const ws = xlsx.utils.json_to_sheet(students);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "الطلاب");

    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="students_list.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/export/session-excel/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const session = db.prepare(`
      SELECT s.*, g.name as group_name, g.grade as group_grade 
      FROM sessions s 
      JOIN groups g ON s.group_id = g.id 
      WHERE s.id = ? AND s.user_id = ?
    `).get(id, req.userId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'الحصة غير موجودة' });
    }

    const records = db.prepare(`
      SELECT 
        s.code as "كود الطالب",
        s.name as "اسم الطالب",
        CASE a.status 
          WHEN 'present' THEN 'حاضر'
          WHEN 'absent' THEN 'غائب'
          WHEN 'late' THEN 'متأخر'
          WHEN 'excused' THEN 'معتذر'
          ELSE a.status 
        END as "حالة الحضور",
        a.check_in_time as "وقت الدخول",
        a.paid_amount as "المدفوع",
        a.remaining_amount as "المتبقي",
        a.homework as "الواجب",
        a.quiz_score as "درجة الاختبار",
        s.phone as "هاتف الطالب",
        s.father_phone as "هاتف الأب",
        s.mother_phone as "هاتف الأم"
      FROM attendance a
      JOIN students s ON a.student_id = s.id
      WHERE a.session_id = ? AND a.user_id = ?
      ORDER BY s.name
    `).all(id, req.userId);

    const ws = xlsx.utils.json_to_sheet(records);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "كشف الحضور");

    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `attendance_${session.session_date}_${session.group_name}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Import Students from Excel
app.post('/api/import/students-excel', requireAuth, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'برجاء رفع ملف إكسيل' });
    }

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    let inserted = 0;
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO students (user_id, code, name, phone, grade, father_phone, mother_phone, monthly_fee, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Get last code
    let lastCodeNum = 1000;
    const lastRow = db.prepare('SELECT code FROM students WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(req.userId);
    if (lastRow && !isNaN(parseInt(lastRow.code, 10))) {
      lastCodeNum = parseInt(lastRow.code, 10);
    }

    for (const r of rows) {
      const name = r['اسم الطالب'] || r['الاسم'] || r['Name'] || r['name'];
      if (!name) continue;

      let code = r['كود الطالب'] || r['الكود'] || r['Code'] || r['code'];
      if (!code) {
        lastCodeNum++;
        code = String(lastCodeNum);
      }

      const phone = String(r['هاتف الطالب'] || r['رقم الطالب'] || r['Phone'] || '');
      const grade = String(r['المرحلة الدراسية'] || r['السنة'] || r['Grade'] || 'الصف الأول الثانوي');
      const father = String(r['هاتف الأب'] || r['رقم الأب'] || r['Father'] || '');
      const mother = String(r['هاتف الأم'] || r['رقم الأم'] || r['Mother'] || '');
      const fee = Number(r['قيمة الحصة'] || r['الاشتراك'] || r['Fee'] || 0);
      const notes = String(r['ملاحظات'] || r['Notes'] || '');

      const info = insertStmt.run(req.userId, String(code).trim(), String(name).trim(), phone, grade, father, mother, fee, notes);
      if (info.changes > 0) inserted++;
    }

    // Clean up uploaded temp file
    try { fs.unlinkSync(req.file.path); } catch (e) {}

    res.json({ success: true, message: `تم استيراد ${inserted} طالب بنجاح!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 11. DATA BACKUP & RESTORE (نسخ احتياطي واستعادة)
// ==========================================
app.get('/api/backup', requireAuth, (req, res) => {
  try {
    const groups = db.prepare('SELECT * FROM groups WHERE user_id = ?').all(req.userId);
    const students = db.prepare('SELECT * FROM students WHERE user_id = ?').all(req.userId);
    const sessions = db.prepare('SELECT * FROM sessions WHERE user_id = ?').all(req.userId);
    const attendance = db.prepare('SELECT * FROM attendance WHERE user_id = ?').all(req.userId);
    const handouts = db.prepare('SELECT * FROM handouts WHERE user_id = ?').all(req.userId);
    const studentHandouts = db.prepare('SELECT * FROM student_handouts WHERE user_id = ?').all(req.userId);
    const payments = db.prepare('SELECT * FROM payments WHERE user_id = ?').all(req.userId);
    const expenses = db.prepare('SELECT * FROM expenses WHERE user_id = ?').all(req.userId);
    const settings = db.prepare('SELECT * FROM settings WHERE user_id = ?').all(req.userId);

    const backupData = {
      version: '2.0',
      exported_at: new Date().toISOString(),
      user: req.user,
      groups,
      students,
      sessions,
      attendance,
      handouts,
      student_handouts: studentHandouts,
      payments,
      expenses,
      settings
    };

    const filename = `teacher_backup_${req.user.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(backupData, null, 2));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback to SPA index.html for all non-api routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server on all network interfaces (0.0.0.0) so it works as a website on mobile and PC
const os = require('node:os');
function getLocalIpAddresses() {
  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

module.exports = app;

// Only start standalone server if run directly (node server.js)
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    const localIps = getLocalIpAddresses();
    console.log(`=======================================================`);
    console.log(`🚀 نظام المساعد الذكي للمدرسين (موقع ويب كامل) يعمل الآن بنجاح!`);
    console.log(`💻 افتح من الكمبيوتر:   http://localhost:${PORT}`);
    if (localIps.length > 0) {
      localIps.forEach(ip => {
        console.log(`📱 افتح من الموبايل:    http://${ip}:${PORT}`);
      });
      console.log(`(تأكد أن الموبايل متصل بنفس شبكة الواي فاي للكمبيوتر)`);
    }
    console.log(`=======================================================`);
  });
}
