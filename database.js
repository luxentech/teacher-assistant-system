const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const os = require('node:os');

// On Vercel (serverless environment), the root folder is read-only, so write to os.tmpdir()
const dbDir = process.env.VERCEL ? os.tmpdir() : __dirname;
const dbPath = path.join(dbDir, 'teacher_system.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode and foreign keys for high performance and relational integrity
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- Users Table (المدرسين والمستخدمين)
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    subject TEXT DEFAULT '',
    center_name TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Auth Tokens Table (جلسات تسجيل الدخول)
  CREATE TABLE IF NOT EXISTS user_tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Groups Table (المجموعات والمواعيد لكل مدرس)
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    grade TEXT NOT NULL,
    days TEXT NOT NULL,
    time TEXT NOT NULL,
    session_price REAL DEFAULT 0,
    monthly_price REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Students Table (بيانات الطلاب لكل مدرس)
  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    grade TEXT NOT NULL,
    group_id INTEGER,
    father_phone TEXT,
    mother_phone TEXT,
    monthly_fee REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    notes TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE SET NULL,
    UNIQUE(user_id, code)
  );

  -- Sessions Table (الحصص)
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    session_date TEXT NOT NULL,
    title TEXT,
    notes TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(group_id) REFERENCES groups(id) ON DELETE CASCADE
  );

  -- Attendance Table (سجل الحضور والغياب والفلوس للحصة)
  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    status TEXT DEFAULT 'absent', -- 'present', 'absent', 'late', 'excused'
    check_in_time TEXT,
    paid_amount REAL DEFAULT 0,
    remaining_amount REAL DEFAULT 0,
    homework TEXT DEFAULT 'done', -- 'done', 'partial', 'none'
    quiz_score REAL DEFAULT NULL,
    max_quiz_score REAL DEFAULT 20,
    received_handout INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, student_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
  );

  -- Handouts Table (المذكرات والملازم)
  CREATE TABLE IF NOT EXISTS handouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    grade TEXT NOT NULL,
    price REAL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Student Handouts Table (توزيع المذكرات والتحصيل)
  CREATE TABLE IF NOT EXISTS student_handouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    handout_id INTEGER NOT NULL,
    paid_amount REAL DEFAULT 0,
    remaining_amount REAL DEFAULT 0,
    delivered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY(handout_id) REFERENCES handouts(id) ON DELETE CASCADE
  );

  -- Payments & Transactions Table (سجل الدفعات وسداد الديون)
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_type TEXT DEFAULT 'سداد دين', -- 'سداد دين', 'حصة', 'مذكرة', 'اشتراك شهري'
    notes TEXT,
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
  );

  -- Expenses Table (المصروفات)
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT DEFAULT 'عام',
    date TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Settings Table (إعدادات النظام والرسائل الخاصة بكل مدرس)
  CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY(user_id, key),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Indexes for speed & search
  CREATE INDEX IF NOT EXISTS idx_students_user ON students(user_id);
  CREATE INDEX IF NOT EXISTS idx_students_group ON students(group_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, session_date);
  CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
  CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
`);

// Helper to seed default settings for a newly created user
function initUserSettings(userId, teacherName, subject = '', centerName = '') {
  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)');
  const defaultSettings = [
    ['teacher_name', teacherName || 'المدرس'],
    ['subject', subject || 'العامة'],
    ['center_name', centerName || 'السنتر التعليمي'],
    ['currency', 'جنيه'],
    ['whatsapp_absent_msg', 'السلام عليكم ورحمة الله وبركاته، ولي أمر الطالب {student_name}، نحيطكم علماً بأن الطالب تغيب اليوم الموافق {date} عن حصة مادة {subject} مع {teacher_name}. برجاء المتابعة والاهتمام حرصاً على مستواه التعليمي.'],
    ['whatsapp_debt_msg', 'السلام عليكم ورحمة الله وبركاته، نود تذكيركم بوجود مستحقات دراسية متأخرة على الطالب {student_name} بمبلغ {amount} {currency}. برجاء التكرم بالسداد في أقرب فرصة.'],
    ['whatsapp_quiz_msg', 'السلام عليكم ورحمة الله وبركاته، ولي أمر الطالب {student_name}، نود إحاطتكم بأن درجة الطالب في اختبار {subject} اليوم هي ({score} من {max_score}). نتمنى له دوام التوفيق والنجاح.']
  ];

  for (const [k, v] of defaultSettings) {
    insertSetting.run(userId, k, v);
  }
}

module.exports = {
  db,
  initUserSettings
};
