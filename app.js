// ==========================================
// STATE MANAGEMENT & GLOBAL VARIABLES
// ==========================================
let authToken = localStorage.getItem('teacher_token') || null;
let currentUser = null;
let currentSession = null;
let currentSessionData = null;
let allGroups = [];
let allStudents = [];
let currentSettings = {};
let html5QrScanner = null;

// ==========================================
// INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  initLiveClock();
  setDefaultSessionDate();
  checkAuthStatus();
});

// ========================================================
// 0. LOCAL STORAGE CLIENT DATABASE ENGINE (بدون سيرفر وبدون باك إند)
// ========================================================
const DB_STORAGE_KEY = 'teacher_os_db_v1';

function getLocalDB() {
  try {
    const raw = localStorage.getItem(DB_STORAGE_KEY);
    if (!raw) {
      const initialDB = {
        users: [
          {
            id: 'admin_master',
            name: 'المدير العام (الأدمن)',
            phone: 'admin',
            password: 'admin',
            subject: 'إدارة المنصة',
            center_name: 'الإدارة العامة',
            role: 'admin',
            status: 'active',
            created_at: new Date().toISOString()
          }
        ],
        groups: [],
        students: [],
        sessions: [],
        attendance: [],
        payments: [],
        expenses: [],
        handouts: [],
        student_handouts: [],
        messages: [],
        settings: {}
      };
      localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(initialDB));
      return initialDB;
    }
    const db = JSON.parse(raw);
    if (!db.users) db.users = [];
    if (!db.users.some(u => u.role === 'admin' || u.phone === 'admin')) {
      db.users.push({
        id: 'admin_master',
        name: 'المدير العام (الأدمن)',
        phone: 'admin',
        password: 'admin',
        subject: 'إدارة المنصة',
        center_name: 'الإدارة العامة',
        role: 'admin',
        status: 'active',
        created_at: new Date().toISOString()
      });
      localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(db));
    }
    if (!db.groups) db.groups = [];
    if (!db.students) db.students = [];
    if (!db.sessions) db.sessions = [];
    if (!db.attendance) db.attendance = [];
    if (!db.payments) db.payments = [];
    if (!db.expenses) db.expenses = [];
    if (!db.handouts) db.handouts = [];
    if (!db.student_handouts) db.student_handouts = [];
    if (!db.messages) db.messages = [];
    if (!db.settings) db.settings = {};
    return db;
  } catch (err) {
    console.error('Database parse error:', err);
    return { users: [], groups: [], students: [], sessions: [], attendance: [], payments: [], expenses: [], handouts: [], student_handouts: [], messages: [], settings: {} };
  }
}

function saveLocalDB(db) {
  try {
    localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(db));
  } catch (err) {
    console.error('Database save error:', err);
    alert('تنبيه: مساحة التخزين في المتصفح ممتلئة!');
  }
}

function generateLocalId() {
  return 'id_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
}

// Client-Side Router to simulate backend REST APIs directly in the browser
async function clientStorageRouter(endpoint, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const [pathOnly, queryString] = endpoint.split('?');
  const params = new URLSearchParams(queryString || '');
  let body = {};
  if (options.body) {
    if (typeof options.body === 'string') {
      try { body = JSON.parse(options.body); } catch(e) { body = {}; }
    } else {
      body = options.body;
    }
  }

  const db = getLocalDB();
  const currentUserId = authToken;
  const user = currentUserId ? db.users.find(u => String(u.id) === String(currentUserId)) : null;

  // Small delay for smooth UI feedback
  await new Promise(r => setTimeout(r, 30));

  // --- 1. AUTHENTICATION ---
  if (pathOnly === '/api/auth/register' && method === 'POST') {
    const { name, phone, password, confirmPassword, subject, center_name } = body;
    if (!name || !name.trim()) return { success: false, error: 'الاسم مطلوب بالكامل' };
    const cleanPhone = normalizeClientPhone(phone);
    if (!cleanPhone || cleanPhone.length < 3) return { success: false, error: 'برجاء إدخال رقم هاتف صحيح' };
    const cleanPass = String(password || '').trim();
    if (!cleanPass || cleanPass.length < 3) return { success: false, error: 'كلمة السر يجب ألا تقل عن 3 خانات' };
    if (cleanPass !== String(confirmPassword || '').trim()) return { success: false, error: 'كلمة السر وتأكيدها غير متطابقين' };

    if (db.users.some(u => u.phone === cleanPhone)) {
      return { success: false, error: 'رقم الهاتف مسجل بالفعل مسبقاً، يمكنك تسجيل الدخول به مباشرة' };
    }

    const newUser = {
      id: generateLocalId(),
      name: name.trim(),
      phone: cleanPhone,
      password: cleanPass,
      subject: (subject || '').trim(),
      center_name: (center_name || '').trim(),
      role: 'teacher',
      status: 'active',
      created_at: new Date().toISOString()
    };
    db.users.push(newUser);
    db.settings[newUser.id] = {
      teacher_name: newUser.name,
      subject: newUser.subject || 'العامة',
      center_name: newUser.center_name || 'السنتر التعليمي',
      currency: 'جنيه',
      whatsapp_absent_msg: 'السلام عليكم ورحمة الله وبركاته، ولي أمر الطالب {student_name}، نحيطكم علماً بأن الطالب تغيب اليوم الموافق {date} عن حصة مادة {subject} مع {teacher_name}. برجاء المتابعة والاهتمام حرصاً على مستواه التعليمي.',
      whatsapp_debt_msg: 'السلام عليكم ورحمة الله وبركاته، نود تذكيركم بوجود مستحقات دراسية متأخرة على الطالب {student_name} بمبلغ {amount} {currency}. برجاء التكرم بالسداد في أقرب فرصة.',
      whatsapp_quiz_msg: 'السلام عليكم ورحمة الله وبركاته، ولي أمر الطالب {student_name}، نود إحاطتكم بأن درجة الطالب في اختبار {subject} اليوم هي ({score} من {max_score}). نتمنى له دوام التوفيق والنجاح.'
    };
    saveLocalDB(db);
    return { success: true, data: { user: newUser, token: newUser.id } };
  }

  if (pathOnly === '/api/auth/login' && method === 'POST') {
    const { phone, password } = body;
    const cleanPhone = normalizeClientPhone(phone);
    const cleanPass = String(password || '').trim();
    const foundUser = db.users.find(u => u.phone === cleanPhone);
    if (!foundUser) return { success: false, error: 'رقم الهاتف غير مسجل بالنظام، برجاء التأكد أو إنشاء حساب جديد' };
    if (foundUser.status === 'blocked') return { success: false, error: 'تم إيقاف هذا الحساب من قِبل إدارة المنصة' };
    if (foundUser.password !== cleanPass) return { success: false, error: 'كلمة السر غير صحيحة، برجاء المحاولة مرة أخرى' };
    return { success: true, data: { user: foundUser, token: foundUser.id } };
  }

  if (pathOnly === '/api/auth/me') {
    if (!user) return { success: false, status: 401, error: 'جلسة تسجيل الدخول منتهية' };
    return { success: true, data: user };
  }

  if (pathOnly === '/api/auth/logout' && method === 'POST') {
    return { success: true };
  }

  if (pathOnly === '/api/auth/profile' && method === 'PUT') {
    if (!user) return { success: false, status: 401 };
    const { name, subject, center_name, password } = body;
    if (name) user.name = name.trim();
    if (subject !== undefined) user.subject = subject.trim();
    if (center_name !== undefined) user.center_name = center_name.trim();
    if (password && password.trim().length >= 3) user.password = password.trim();
    saveLocalDB(db);
    return { success: true, data: user, message: 'تم تحديث الملف الشخصي بنجاح' };
  }

  // --- AUTH CHECK FOR PROTECTED ROUTES ---
  if (!user) return { success: false, status: 401, error: 'يرجى تسجيل الدخول' };
  if (user.status === 'blocked') return { success: false, status: 403, error: 'تم إيقاف هذا الحساب' };

  // --- 2. SETTINGS ---
  if (pathOnly === '/api/settings') {
    if (method === 'GET') {
      return { success: true, data: db.settings[user.id] || {} };
    }
    if (method === 'POST') {
      db.settings[user.id] = { ...(db.settings[user.id] || {}), ...body };
      saveLocalDB(db);
      return { success: true, message: 'تم حفظ الإعدادات بنجاح' };
    }
  }

  // --- 3. GROUPS ---
  if (pathOnly === '/api/groups') {
    if (method === 'GET') {
      const groups = db.groups
        .filter(g => String(g.user_id) === String(user.id))
        .map(g => ({
          ...g,
          students_count: db.students.filter(s => String(s.group_id) === String(g.id) && s.status === 'active').length
        }));
      return { success: true, data: groups };
    }
    if (method === 'POST') {
      const { name, grade, days, time, session_price, monthly_price, notes } = body;
      if (!name || !grade) return { success: false, error: 'اسم المجموعة والمرحلة الدراسية مطلوبان' };
      const newGroup = {
        id: generateLocalId(),
        user_id: user.id,
        name: name.trim(),
        grade: grade.trim(),
        days: (days || '').trim(),
        time: (time || '').trim(),
        session_price: Number(session_price) || 0,
        monthly_price: Number(monthly_price) || 0,
        notes: (notes || '').trim(),
        created_at: new Date().toISOString()
      };
      db.groups.push(newGroup);
      saveLocalDB(db);
      return { success: true, data: newGroup, message: 'تم إنشاء المجموعة بنجاح' };
    }
  }

  if (pathOnly.startsWith('/api/groups/') && pathOnly.split('/').length === 4) {
    const groupId = pathOnly.split('/')[3];
    const grpIndex = db.groups.findIndex(g => String(g.id) === String(groupId) && String(g.user_id) === String(user.id));
    if (grpIndex === -1) return { success: false, error: 'المجموعة غير موجودة' };

    if (method === 'PUT') {
      const { name, grade, days, time, session_price, monthly_price, notes } = body;
      db.groups[grpIndex] = {
        ...db.groups[grpIndex],
        name: name ? name.trim() : db.groups[grpIndex].name,
        grade: grade ? grade.trim() : db.groups[grpIndex].grade,
        days: days !== undefined ? days.trim() : db.groups[grpIndex].days,
        time: time !== undefined ? time.trim() : db.groups[grpIndex].time,
        session_price: session_price !== undefined ? Number(session_price) || 0 : db.groups[grpIndex].session_price,
        monthly_price: monthly_price !== undefined ? Number(monthly_price) || 0 : db.groups[grpIndex].monthly_price,
        notes: notes !== undefined ? notes.trim() : db.groups[grpIndex].notes
      };
      saveLocalDB(db);
      return { success: true, data: db.groups[grpIndex], message: 'تم تحديث بيانات المجموعة' };
    }

    if (method === 'DELETE') {
      db.groups.splice(grpIndex, 1);
      db.students.forEach(s => {
        if (String(s.group_id) === String(groupId) && String(s.user_id) === String(user.id)) {
          s.group_id = null;
        }
      });
      saveLocalDB(db);
      return { success: true, message: 'تم حذف المجموعة بنجاح' };
    }
  }

  // --- 4. STUDENTS ---
  if (pathOnly === '/api/students/next-code') {
    const teacherStudents = db.students.filter(s => String(s.user_id) === String(user.id));
    let nextNum = 1001;
    teacherStudents.forEach(s => {
      const parsed = parseInt(s.code, 10);
      if (!isNaN(parsed) && parsed >= nextNum) nextNum = parsed + 1;
    });
    return { success: true, code: String(nextNum) };
  }

  if (pathOnly === '/api/students') {
    if (method === 'GET') {
      const search = (params.get('search') || '').toLowerCase().trim();
      const groupId = params.get('group_id');
      const grade = params.get('grade');
      const status = params.get('status');
      const hasDebt = params.get('has_debt');

      let list = db.students.filter(s => String(s.user_id) === String(user.id));
      if (status) list = list.filter(s => s.status === status);
      if (groupId) list = list.filter(s => String(s.group_id) === String(groupId));
      if (grade) list = list.filter(s => s.grade === grade);
      if (hasDebt === 'true') list = list.filter(s => (Number(s.balance) || 0) > 0);
      if (search) {
        list = list.filter(s => 
          (s.name && s.name.toLowerCase().includes(search)) ||
          (s.code && String(s.code).includes(search)) ||
          (s.phone && s.phone.includes(search)) ||
          (s.father_phone && s.father_phone.includes(search)) ||
          (s.mother_phone && s.mother_phone.includes(search))
        );
      }

      const results = list.map(s => {
        const grp = db.groups.find(g => String(g.id) === String(s.group_id));
        return {
          ...s,
          group_name: grp ? grp.name : null,
          group_days: grp ? grp.days : null,
          group_time: grp ? grp.time : null,
          group_session_price: grp ? grp.session_price : 0
        };
      }).sort((a, b) => a.name.localeCompare(b.name, 'ar'));

      return { success: true, data: results };
    }

    if (method === 'POST') {
      let { code, name, phone, grade, group_id, father_phone, mother_phone, monthly_fee, notes } = body;
      if (!name || !grade) return { success: false, error: 'اسم الطالب والمرحلة الدراسية مطلوبان' };

      let cleanCode = normalizeClientCode(code);
      if (!cleanCode) {
        let maxCode = 1000;
        db.students.filter(s => String(s.user_id) === String(user.id)).forEach(s => {
          const n = parseInt(s.code, 10);
          if (!isNaN(n) && n > maxCode) maxCode = n;
        });
        cleanCode = String(maxCode + 1);
      }

      if (db.students.some(s => String(s.user_id) === String(user.id) && String(s.code) === cleanCode)) {
        return { success: false, error: 'كود الطالب مسجل مسبقاً، برجاء اختيار كود آخر' };
      }

      if (!monthly_fee && group_id) {
        const grp = db.groups.find(g => String(g.id) === String(group_id) && String(g.user_id) === String(user.id));
        if (grp) monthly_fee = grp.session_price;
      }

      const newStudent = {
        id: generateLocalId(),
        user_id: user.id,
        code: cleanCode,
        name: name.trim(),
        phone: normalizeClientPhone(phone),
        grade: grade.trim(),
        group_id: group_id ? String(group_id) : null,
        father_phone: normalizeClientPhone(father_phone),
        mother_phone: normalizeClientPhone(mother_phone),
        monthly_fee: Number(monthly_fee) || 0,
        balance: 0,
        notes: (notes || '').trim(),
        status: 'active',
        created_at: new Date().toISOString()
      };
      db.students.push(newStudent);
      saveLocalDB(db);
      return { success: true, data: newStudent, message: 'تم تسجيل الطالب بنجاح' };
    }
  }

  if (pathOnly.startsWith('/api/students/') && pathOnly.split('/').length === 4) {
    const studentId = pathOnly.split('/')[3];
    const stdIndex = db.students.findIndex(s => String(s.id) === String(studentId) && String(s.user_id) === String(user.id));
    if (stdIndex === -1) return { success: false, error: 'الطالب غير موجود' };

    if (method === 'GET') {
      const student = db.students[stdIndex];
      const grp = db.groups.find(g => String(g.id) === String(student.group_id));

      const history = db.attendance
        .filter(a => String(a.student_id) === String(studentId) && String(a.user_id) === String(user.id))
        .map(a => {
          const sess = db.sessions.find(ss => String(ss.id) === String(a.session_id));
          const sGrp = sess ? db.groups.find(g => String(g.id) === String(sess.group_id)) : null;
          return {
            ...a,
            session_date: sess ? sess.session_date : '',
            session_title: sess ? sess.title : '',
            group_name: sGrp ? sGrp.name : ''
          };
        }).sort((a, b) => b.session_date.localeCompare(a.session_date));

      const payments = db.payments
        .filter(p => String(p.student_id) === String(studentId) && String(p.user_id) === String(user.id))
        .sort((a, b) => b.date.localeCompare(a.date));

      const handouts = db.student_handouts
        .filter(sh => String(sh.student_id) === String(studentId) && String(sh.user_id) === String(user.id))
        .map(sh => {
          const h = db.handouts.find(hd => String(hd.id) === String(sh.handout_id));
          return {
            ...sh,
            handout_title: h ? h.title : '',
            handout_price: h ? h.price : 0
          };
        }).sort((a, b) => b.delivered_at.localeCompare(a.delivered_at));

      return {
        success: true,
        data: {
          ...student,
          group_name: grp ? grp.name : null,
          group_days: grp ? grp.days : null,
          group_time: grp ? grp.time : null,
          history,
          payments,
          handouts
        }
      };
    }

    if (method === 'PUT') {
      let { code, name, phone, grade, group_id, father_phone, mother_phone, monthly_fee, balance, notes, status } = body;
      const cleanCode = normalizeClientCode(code);
      if (db.students.some(s => String(s.user_id) === String(user.id) && String(s.code) === cleanCode && String(s.id) !== String(studentId))) {
        return { success: false, error: 'هذا الكود مستخدم لطالب آخر لديك' };
      }

      db.students[stdIndex] = {
        ...db.students[stdIndex],
        code: cleanCode || db.students[stdIndex].code,
        name: name ? name.trim() : db.students[stdIndex].name,
        phone: phone !== undefined ? normalizeClientPhone(phone) : db.students[stdIndex].phone,
        grade: grade ? grade.trim() : db.students[stdIndex].grade,
        group_id: group_id !== undefined ? (group_id ? String(group_id) : null) : db.students[stdIndex].group_id,
        father_phone: father_phone !== undefined ? normalizeClientPhone(father_phone) : db.students[stdIndex].father_phone,
        mother_phone: mother_phone !== undefined ? normalizeClientPhone(mother_phone) : db.students[stdIndex].mother_phone,
        monthly_fee: monthly_fee !== undefined ? Number(monthly_fee) || 0 : db.students[stdIndex].monthly_fee,
        balance: balance !== undefined ? Number(balance) || 0 : db.students[stdIndex].balance,
        notes: notes !== undefined ? notes.trim() : db.students[stdIndex].notes,
        status: status || db.students[stdIndex].status
      };
      saveLocalDB(db);
      return { success: true, data: db.students[stdIndex], message: 'تم تحديث بيانات الطالب' };
    }

    if (method === 'DELETE') {
      db.students.splice(stdIndex, 1);
      db.attendance = db.attendance.filter(a => String(a.student_id) !== String(studentId));
      db.payments = db.payments.filter(p => String(p.student_id) !== String(studentId));
      db.student_handouts = db.student_handouts.filter(sh => String(sh.student_id) !== String(studentId));
      saveLocalDB(db);
      return { success: true, message: 'تم حذف الطالب وسجلاته بنجاح' };
    }
  }

  // --- 5. SESSIONS & ATTENDANCE ---
  if (pathOnly === '/api/sessions' && method === 'POST') {
    const { group_id, session_date, title, notes } = body;
    if (!group_id || !session_date) return { success: false, error: 'المجموعة وتاريخ الحصة مطلوبان' };

    const grp = db.groups.find(g => String(g.id) === String(group_id) && String(g.user_id) === String(user.id));
    if (!grp) return { success: false, error: 'المجموعة غير موجودة' };

    let session = db.sessions.find(s => String(s.group_id) === String(group_id) && s.session_date === session_date && String(s.user_id) === String(user.id));
    if (!session) {
      session = {
        id: generateLocalId(),
        user_id: user.id,
        group_id: String(group_id),
        session_date,
        title: title || `حصة يوم ${session_date}`,
        notes: (notes || '').trim(),
        status: 'active',
        created_at: new Date().toISOString()
      };
      db.sessions.push(session);

      const groupStudents = db.students.filter(s => String(s.group_id) === String(group_id) && s.status === 'active' && String(s.user_id) === String(user.id));
      groupStudents.forEach(st => {
        const cost = st.monthly_fee > 0 ? st.monthly_fee : (grp.session_price || 0);
        db.attendance.push({
          id: generateLocalId(),
          user_id: user.id,
          session_id: session.id,
          student_id: st.id,
          status: 'absent',
          check_in_time: null,
          paid_amount: 0,
          remaining_amount: cost,
          homework: 'done',
          quiz_score: null,
          max_quiz_score: 10,
          received_handout: 0,
          notes: '',
          created_at: new Date().toISOString()
        });
      });
      saveLocalDB(db);
    }
    return { success: true, data: session };
  }

  if (pathOnly.startsWith('/api/sessions/') && pathOnly.endsWith('/checkin') && method === 'POST') {
    const parts = pathOnly.split('/');
    const sessionId = parts[3];
    const { code, paid_amount, status } = body;
    if (!code) return { success: false, error: 'كود الطالب مطلوب' };

    const cleanCode = normalizeClientCode(code);
    const student = db.students.find(s => String(s.user_id) === String(user.id) && (String(s.code) === cleanCode || String(s.id) === cleanCode));
    if (!student) return { success: false, error: 'كود الطالب غير صحيح أو غير مسجل لديك' };

    const session = db.sessions.find(s => String(s.id) === String(sessionId) && String(s.user_id) === String(user.id));
    if (!session) return { success: false, error: 'الحصة غير موجودة' };
    const grp = db.groups.find(g => String(g.id) === String(session.group_id));

    const fee = student.monthly_fee > 0 ? student.monthly_fee : (grp ? grp.session_price : 0);
    const paid = paid_amount !== undefined ? Number(paid_amount) : fee;
    const remaining = Math.max(0, fee - paid);

    const now = new Date();
    const checkInTime = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });

    let att = db.attendance.find(a => String(a.session_id) === String(sessionId) && String(a.student_id) === String(student.id) && String(a.user_id) === String(user.id));
    if (att) {
      const prevRemaining = att.remaining_amount || 0;
      att.status = status || 'present';
      att.check_in_time = checkInTime;
      att.paid_amount = paid;
      att.remaining_amount = remaining;
      student.balance = (student.balance || 0) - prevRemaining + remaining;
    } else {
      att = {
        id: generateLocalId(),
        user_id: user.id,
        session_id: sessionId,
        student_id: student.id,
        status: status || 'present',
        check_in_time: checkInTime,
        paid_amount: paid,
        remaining_amount: remaining,
        homework: 'done',
        quiz_score: null,
        max_quiz_score: 10,
        received_handout: 0,
        notes: '',
        created_at: new Date().toISOString()
      };
      db.attendance.push(att);
      student.balance = (student.balance || 0) + remaining;
    }

    saveLocalDB(db);
    return {
      success: true,
      message: `تم تسجيل حضور: ${student.name}`,
      data: { student, attendance: att, paid, remaining }
    };
  }

  if (pathOnly.startsWith('/api/sessions/') && pathOnly.split('/').length === 4 && method === 'GET') {
    const sessionId = pathOnly.split('/')[3];
    const session = db.sessions.find(s => String(s.id) === String(sessionId) && String(s.user_id) === String(user.id));
    if (!session) return { success: false, error: 'الحصة غير موجودة' };

    const grp = db.groups.find(g => String(g.id) === String(session.group_id));

    // Ensure any new student in group has an attendance row
    const groupStudents = db.students.filter(s => String(s.group_id) === String(session.group_id) && s.status === 'active' && String(s.user_id) === String(user.id));
    groupStudents.forEach(st => {
      let exists = db.attendance.some(a => String(a.session_id) === String(sessionId) && String(a.student_id) === String(st.id) && String(a.user_id) === String(user.id));
      if (!exists) {
        const cost = st.monthly_fee > 0 ? st.monthly_fee : (grp ? grp.session_price : 0);
        db.attendance.push({
          id: generateLocalId(),
          user_id: user.id,
          session_id: sessionId,
          student_id: st.id,
          status: 'absent',
          check_in_time: null,
          paid_amount: 0,
          remaining_amount: cost,
          homework: 'done',
          quiz_score: null,
          max_quiz_score: 10,
          received_handout: 0,
          notes: '',
          created_at: new Date().toISOString()
        });
      }
    });

    const records = db.attendance
      .filter(a => String(a.session_id) === String(sessionId) && String(a.user_id) === String(user.id))
      .map(a => {
        const st = db.students.find(s => String(s.id) === String(a.student_id));
        return {
          attendance_id: a.id,
          attendance_status: a.status,
          check_in_time: a.check_in_time,
          paid_amount: a.paid_amount,
          remaining_amount: a.remaining_amount,
          homework: a.homework,
          quiz_score: a.quiz_score,
          max_quiz_score: a.max_quiz_score,
          received_handout: a.received_handout,
          attendance_notes: a.notes,
          student_id: st ? st.id : null,
          student_code: st ? st.code : '',
          student_name: st ? st.name : 'طالب محذوف',
          student_phone: st ? st.phone : '',
          father_phone: st ? st.father_phone : '',
          mother_phone: st ? st.mother_phone : '',
          student_balance: st ? st.balance : 0,
          monthly_fee: st ? st.monthly_fee : 0
        };
      }).sort((a, b) => {
        const order = { present: 1, late: 2, excused: 3, absent: 4 };
        const oA = order[a.attendance_status] || 5;
        const oB = order[b.attendance_status] || 5;
        if (oA !== oB) return oA - oB;
        return a.student_name.localeCompare(b.student_name, 'ar');
      });

    const totalStudents = records.length;
    const presentCount = records.filter(r => r.attendance_status === 'present').length;
    const lateCount = records.filter(r => r.attendance_status === 'late').length;
    const excusedCount = records.filter(r => r.attendance_status === 'excused').length;
    const absentCount = records.filter(r => r.attendance_status === 'absent').length;
    const totalPaid = records.reduce((sum, r) => sum + (Number(r.paid_amount) || 0), 0);
    const totalRemaining = records.reduce((sum, r) => sum + (Number(r.remaining_amount) || 0), 0);
    const absentees = records.filter(r => r.attendance_status === 'absent');

    return {
      success: true,
      data: {
        session: { ...session, group_name: grp ? grp.name : '', session_price: grp ? grp.session_price : 0 },
        records,
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
    };
  }

  if (pathOnly.startsWith('/api/attendance/') && method === 'PUT') {
    const attId = pathOnly.split('/')[3];
    const attIndex = db.attendance.findIndex(a => String(a.id) === String(attId) && String(a.user_id) === String(user.id));
    if (attIndex === -1) return { success: false, error: 'سجل الحضور غير موجود' };

    const att = db.attendance[attIndex];
    const student = db.students.find(s => String(s.id) === String(att.student_id));

    if (body.status !== undefined) att.status = body.status;
    if (body.check_in_time !== undefined) att.check_in_time = body.check_in_time;
    if (body.homework !== undefined) att.homework = body.homework;
    if (body.quiz_score !== undefined) att.quiz_score = body.quiz_score !== null && body.quiz_score !== '' ? Number(body.quiz_score) : null;
    if (body.max_quiz_score !== undefined) att.max_quiz_score = Number(body.max_quiz_score) || 10;
    if (body.received_handout !== undefined) att.received_handout = Number(body.received_handout) || 0;
    if (body.notes !== undefined) att.notes = body.notes;

    if (body.paid_amount !== undefined || body.remaining_amount !== undefined) {
      const prevRemaining = att.remaining_amount || 0;
      if (body.paid_amount !== undefined) att.paid_amount = Number(body.paid_amount) || 0;
      if (body.remaining_amount !== undefined) att.remaining_amount = Number(body.remaining_amount) || 0;
      if (student) {
        student.balance = (student.balance || 0) - prevRemaining + att.remaining_amount;
      }
    }

    saveLocalDB(db);
    return { success: true, message: 'تم تحديث الحضور بنجاح' };
  }

  // --- 6. PAYMENTS ---
  if (pathOnly === '/api/payments') {
    if (method === 'GET') {
      const payments = db.payments
        .filter(p => String(p.user_id) === String(user.id))
        .map(p => {
          const st = db.students.find(s => String(s.id) === String(p.student_id));
          return { ...p, student_name: st ? st.name : 'طالب محذوف', student_code: st ? st.code : '' };
        }).sort((a, b) => b.date.localeCompare(a.date));
      return { success: true, data: payments };
    }

    if (method === 'POST') {
      const { student_id, amount, date, type, notes } = body;
      if (!student_id || !amount) return { success: false, error: 'الطالب والمبلغ مطلوبان' };
      const student = db.students.find(s => String(s.id) === String(student_id) && String(s.user_id) === String(user.id));
      if (!student) return { success: false, error: 'الطالب غير موجود' };

      const numAmount = Number(amount) || 0;
      const payment = {
        id: generateLocalId(),
        user_id: user.id,
        student_id: String(student_id),
        amount: numAmount,
        date: date || new Date().toISOString().split('T')[0],
        type: type || 'تسوية مستحقات',
        notes: (notes || '').trim(),
        created_at: new Date().toISOString()
      };
      db.payments.push(payment);
      student.balance = Math.max(0, (student.balance || 0) - numAmount);
      saveLocalDB(db);
      return { success: true, data: payment, message: 'تم تسجيل الدفعة بنجاح' };
    }
  }

  if (pathOnly.startsWith('/api/payments/') && method === 'DELETE') {
    const paymentId = pathOnly.split('/')[3];
    const pIndex = db.payments.findIndex(p => String(p.id) === String(paymentId) && String(p.user_id) === String(user.id));
    if (pIndex !== -1) {
      const payment = db.payments[pIndex];
      const student = db.students.find(s => String(s.id) === String(payment.student_id));
      if (student) student.balance = (student.balance || 0) + (payment.amount || 0);
      db.payments.splice(pIndex, 1);
      saveLocalDB(db);
    }
    return { success: true, message: 'تم حذف الدفعة' };
  }

  // --- 7. EXPENSES ---
  if (pathOnly === '/api/expenses') {
    if (method === 'GET') {
      const expenses = db.expenses
        .filter(e => String(e.user_id) === String(user.id))
        .sort((a, b) => b.date.localeCompare(a.date));
      return { success: true, data: expenses };
    }
    if (method === 'POST') {
      const { title, amount, category, date, notes } = body;
      if (!title || !amount) return { success: false, error: 'اسم المصروف والمبلغ مطلوبان' };
      const expense = {
        id: generateLocalId(),
        user_id: user.id,
        title: title.trim(),
        amount: Number(amount) || 0,
        category: category || 'عام',
        date: date || new Date().toISOString().split('T')[0],
        notes: (notes || '').trim(),
        created_at: new Date().toISOString()
      };
      db.expenses.push(expense);
      saveLocalDB(db);
      return { success: true, data: expense, message: 'تم تسجيل المصروف بنجاح' };
    }
  }

  if (pathOnly.startsWith('/api/expenses/') && method === 'DELETE') {
    const expenseId = pathOnly.split('/')[3];
    db.expenses = db.expenses.filter(e => !(String(e.id) === String(expenseId) && String(e.user_id) === String(user.id)));
    saveLocalDB(db);
    return { success: true, message: 'تم حذف المصروف بنجاح' };
  }

  // --- 8. HANDOUTS (الملازم والمذكرات) ---
  if (pathOnly === '/api/handouts') {
    if (method === 'GET') {
      const handouts = db.handouts
        .filter(h => String(h.user_id) === String(user.id))
        .map(h => ({
          ...h,
          delivered_count: db.student_handouts.filter(sh => String(sh.handout_id) === String(h.id)).length
        }));
      return { success: true, data: handouts };
    }
    if (method === 'POST') {
      const { title, grade, price, description, total_copies } = body;
      if (!title || !grade) return { success: false, error: 'عنوان المذكرة والمرحلة مطلوبان' };
      const handout = {
        id: generateLocalId(),
        user_id: user.id,
        title: title.trim(),
        grade: grade.trim(),
        price: Number(price) || 0,
        description: (description || '').trim(),
        total_copies: Number(total_copies) || 0,
        created_at: new Date().toISOString()
      };
      db.handouts.push(handout);
      saveLocalDB(db);
      return { success: true, data: handout, message: 'تمت إضافة المذكرة بنجاح' };
    }
  }

  if (pathOnly.startsWith('/api/handouts/') && method === 'DELETE') {
    const handoutId = pathOnly.split('/')[3];
    db.handouts = db.handouts.filter(h => !(String(h.id) === String(handoutId) && String(h.user_id) === String(user.id)));
    db.student_handouts = db.student_handouts.filter(sh => !(String(sh.handout_id) === String(handoutId) && String(sh.user_id) === String(user.id)));
    saveLocalDB(db);
    return { success: true, message: 'تم حذف المذكرة بنجاح' };
  }

  if (pathOnly === '/api/handouts/deliver' && method === 'POST') {
    const { handout_id, student_id, paid_amount } = body;
    const handout = db.handouts.find(h => String(h.id) === String(handout_id) && String(h.user_id) === String(user.id));
    const student = db.students.find(s => String(s.id) === String(student_id) && String(s.user_id) === String(user.id));
    if (!handout || !student) return { success: false, error: 'المذكرة أو الطالب غير موجود' };

    const price = handout.price || 0;
    const paid = paid_amount !== undefined ? Number(paid_amount) || 0 : price;
    const remaining = Math.max(0, price - paid);

    db.student_handouts.push({
      id: generateLocalId(),
      user_id: user.id,
      handout_id: String(handout_id),
      student_id: String(student_id),
      paid_amount: paid,
      remaining_amount: remaining,
      delivered_at: new Date().toISOString()
    });

    if (remaining > 0) {
      student.balance = (student.balance || 0) + remaining;
    }
    saveLocalDB(db);
    return { success: true, message: 'تم تسليم المذكرة للطالب بنجاح' };
  }

  // --- 9. DASHBOARD REPORTS ---
  if (pathOnly === '/api/reports/dashboard') {
    const teacherStudents = db.students.filter(s => String(s.user_id) === String(user.id) && s.status === 'active');
    const teacherGroups = db.groups.filter(g => String(g.user_id) === String(user.id));
    const teacherAttendance = db.attendance.filter(a => String(a.user_id) === String(user.id));
    const teacherPayments = db.payments.filter(p => String(p.user_id) === String(user.id));
    const teacherExpenses = db.expenses.filter(e => String(e.user_id) === String(user.id));
    const teacherHandouts = db.student_handouts.filter(sh => String(sh.user_id) === String(user.id));

    const totalStudents = teacherStudents.length;
    const totalGroups = teacherGroups.length;
    const attendanceIncome = teacherAttendance.reduce((sum, a) => sum + (Number(a.paid_amount) || 0), 0);
    const handoutsIncome = teacherHandouts.reduce((sum, sh) => sum + (Number(sh.paid_amount) || 0), 0);
    const directPaymentsIncome = teacherPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const totalIncome = attendanceIncome + handoutsIncome + directPaymentsIncome;
    const totalExpenses = teacherExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const netProfit = totalIncome - totalExpenses;
    const totalDebts = teacherStudents.reduce((sum, s) => sum + (Number(s.balance) || 0), 0);

    const totalRecords = teacherAttendance.length;
    const presentRecords = teacherAttendance.filter(a => a.status === 'present' || a.status === 'late').length;
    const attendanceRate = totalRecords > 0 ? Math.round((presentRecords / totalRecords) * 100) : 0;

    return {
      success: true,
      data: {
        totalStudents,
        totalGroups,
        totalIncome,
        totalExpenses,
        netProfit,
        totalDebts,
        attendanceRate
      }
    };
  }

  // --- 10. ADMIN DASHBOARD & CONTROLS ---
  if (pathOnly === '/api/admin/overview') {
    if (user.role !== 'admin') return { success: false, status: 403, error: 'غير مصرح' };
    const teachers = db.users.filter(u => u.role !== 'admin');
    const totalTeachers = teachers.length;
    const activeTeachers = teachers.filter(u => u.status === 'active' || !u.status).length;
    const blockedTeachers = teachers.filter(u => u.status === 'blocked').length;
    const totalStudents = db.students.length;
    const totalSessions = db.sessions.length;

    const totalAttendancePaid = db.attendance.reduce((sum, a) => sum + (Number(a.paid_amount) || 0), 0);
    const totalHandoutsPaid = db.student_handouts.reduce((sum, sh) => sum + (Number(sh.paid_amount) || 0), 0);
    const totalPaymentsPaid = db.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const totalPlatformVolume = totalAttendancePaid + totalHandoutsPaid + totalPaymentsPaid;
    const commissionRate = 10;
    const platformProfit = Math.round(totalPlatformVolume * (commissionRate / 100));

    return {
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
    };
  }

  if (pathOnly === '/api/admin/teachers') {
    if (user.role !== 'admin') return { success: false, status: 403, error: 'غير مصرح' };
    const teachers = db.users.filter(u => u.role !== 'admin').map(t => {
      const sCount = db.students.filter(s => String(s.user_id) === String(t.id)).length;
      const gCount = db.groups.filter(g => String(g.user_id) === String(t.id)).length;
      const collected = db.attendance.filter(a => String(a.user_id) === String(t.id)).reduce((s, a) => s + (Number(a.paid_amount) || 0), 0);
      return {
        id: t.id,
        name: t.name,
        phone: t.phone,
        subject: t.subject,
        center_name: t.center_name,
        role: t.role,
        status: t.status || 'active',
        created_at: t.created_at,
        students_count: sCount,
        groups_count: gCount,
        total_collected: collected
      };
    });
    return { success: true, data: teachers };
  }

  if (pathOnly.startsWith('/api/admin/teachers/') && pathOnly.endsWith('/toggle-status') && method === 'PUT') {
    if (user.role !== 'admin') return { success: false, status: 403, error: 'غير مصرح' };
    const teacherId = pathOnly.split('/')[4];
    const t = db.users.find(u => String(u.id) === String(teacherId));
    if (!t) return { success: false, error: 'المعلم غير موجود' };
    t.status = t.status === 'blocked' ? 'active' : 'blocked';
    saveLocalDB(db);
    return { success: true, new_status: t.status, message: `تم ${t.status === 'blocked' ? 'إيقاف' : 'تفعيل'} الحساب بنجاح` };
  }

  if (pathOnly.startsWith('/api/admin/teachers/') && pathOnly.split('/').length === 5 && method === 'DELETE') {
    if (user.role !== 'admin') return { success: false, status: 403, error: 'غير مصرح' };
    const teacherId = pathOnly.split('/')[4];
    db.users = db.users.filter(u => String(u.id) !== String(teacherId));
    db.groups = db.groups.filter(g => String(g.user_id) !== String(teacherId));
    db.students = db.students.filter(s => String(s.user_id) !== String(teacherId));
    db.sessions = db.sessions.filter(s => String(s.user_id) !== String(teacherId));
    db.attendance = db.attendance.filter(a => String(a.user_id) !== String(teacherId));
    db.payments = db.payments.filter(p => String(p.user_id) !== String(teacherId));
    db.expenses = db.expenses.filter(e => String(e.user_id) !== String(teacherId));
    db.handouts = db.handouts.filter(h => String(h.user_id) !== String(teacherId));
    db.student_handouts = db.student_handouts.filter(sh => String(sh.user_id) !== String(teacherId));
    saveLocalDB(db);
    return { success: true, message: 'تم حذف حساب المدرس وكافة بياناته نهائياً' };
  }

  // --- 11. CHAT MESSAGING (شات الإدارة والمدرسين) ---
  if (pathOnly === '/api/chat/conversations') {
    if (user.role !== 'admin') return { success: false, status: 403 };
    const teachers = db.users.filter(u => u.role !== 'admin').map(t => {
      const msgs = db.messages.filter(m => (String(m.sender_id) === String(t.id) && String(m.receiver_id) === String(user.id)) || (String(m.sender_id) === String(user.id) && String(m.receiver_id) === String(t.id)));
      const lastMsg = msgs[msgs.length - 1];
      const unreadCount = db.messages.filter(m => String(m.sender_id) === String(t.id) && String(m.receiver_id) === String(user.id) && !m.is_read).length;
      return {
        id: t.id,
        name: t.name,
        phone: t.phone,
        subject: t.subject,
        status: t.status,
        last_message: lastMsg ? lastMsg.message : '',
        last_message_date: lastMsg ? lastMsg.created_at : '',
        unread_count: unreadCount
      };
    }).sort((a, b) => b.unread_count - a.unread_count);
    return { success: true, data: teachers };
  }

  if (pathOnly === '/api/chat/messages') {
    if (method === 'GET') {
      let otherUserId = params.get('teacher_id');
      if (user.role !== 'admin') {
        const admin = db.users.find(u => u.role === 'admin');
        otherUserId = admin ? admin.id : null;
      }
      if (!otherUserId) return { success: true, data: [] };

      // Mark received messages as read
      db.messages.forEach(m => {
        if (String(m.receiver_id) === String(user.id) && String(m.sender_id) === String(otherUserId)) {
          m.is_read = true;
        }
      });
      saveLocalDB(db);

      const conversation = db.messages.filter(m => 
        (String(m.sender_id) === String(user.id) && String(m.receiver_id) === String(otherUserId)) ||
        (String(m.sender_id) === String(otherUserId) && String(m.receiver_id) === String(user.id))
      ).map(m => {
        const sender = db.users.find(u => String(u.id) === String(m.sender_id));
        return {
          ...m,
          sender_name: sender ? sender.name : 'مستخدم',
          sender_role: sender ? sender.role : 'teacher'
        };
      });
      return { success: true, data: conversation };
    }

    if (method === 'POST') {
      const { message, receiver_id } = body;
      if (!message || !message.trim()) return { success: false, error: 'نص الرسالة مطلوب' };

      let targetReceiverId = receiver_id;
      if (user.role !== 'admin') {
        const admin = db.users.find(u => u.role === 'admin');
        if (!admin) return { success: false, error: 'حساب الإدارة غير متاح حالياً' };
        targetReceiverId = admin.id;
      } else {
        if (!targetReceiverId) return { success: false, error: 'برجاء اختيار المدرس المستلم' };
      }

      const newMsg = {
        id: generateLocalId(),
        sender_id: user.id,
        receiver_id: String(targetReceiverId),
        message: message.trim(),
        is_read: false,
        created_at: new Date().toISOString()
      };
      db.messages.push(newMsg);
      saveLocalDB(db);

      return {
        success: true,
        data: {
          ...newMsg,
          sender_name: user.name,
          sender_role: user.role
        }
      };
    }
  }

  if (pathOnly === '/api/chat/unread-count') {
    const count = db.messages.filter(m => String(m.receiver_id) === String(user.id) && !m.is_read).length;
    return { success: true, unread_count: count };
  }

  return { success: true };
}

// ==========================================
// 1. API HELPER WITH LOCAL STORAGE ROUTER
// ==========================================
async function apiFetch(endpoint, options = {}) {
  try {
    const res = await clientStorageRouter(endpoint, options);
    if (res && res.status === 401) {
      handleUnauthorized();
      throw new Error(res.error || 'جلسة تسجيل الدخول منتهية');
    }
    return res;
  } catch (err) {
    throw err;
  }
}

function handleUnauthorized() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('teacher_token');
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('appScreen').classList.add('hidden');
  showToast('يرجى تسجيل الدخول للوصول إلى النظام', 'info');
}

// ==========================================
// 2. AUTHENTICATION (تسجيل الدخول والتسجيل)
// ==========================================
async function checkAuthStatus() {
  if (!authToken) {
    showAuthScreen();
    return;
  }

  try {
    const res = await apiFetch('/api/auth/me');
    if (res.success && res.data) {
      currentUser = res.data;
      showAppScreen();
    } else {
      showAuthScreen();
    }
  } catch (err) {
    showAuthScreen();
  }
}

function showAuthScreen() {
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('appScreen').classList.add('hidden');
  const adminScreen = document.getElementById('adminScreen');
  if (adminScreen) adminScreen.classList.add('hidden');
}

let adminPollingInterval = null;
let teacherPollingInterval = null;

function showAppScreen() {
  document.getElementById('authScreen').classList.add('hidden');

  if (currentUser && currentUser.role === 'admin') {
    document.getElementById('appScreen').classList.add('hidden');
    const adminScreen = document.getElementById('adminScreen');
    if (adminScreen) adminScreen.classList.remove('hidden');

    loadAdminDashboard();
    loadAdminTeachers();
    loadAdminConversations();
    if (!adminPollingInterval) {
      adminPollingInterval = setInterval(checkAdminChatBadge, 6000);
    }
  } else {
    const adminScreen = document.getElementById('adminScreen');
    if (adminScreen) adminScreen.classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');

    updateHeaderProfile();
    loadSettings();
    loadGroups();
    loadStudentsList();
    if (!teacherPollingInterval) {
      teacherPollingInterval = setInterval(checkTeacherChatBadge, 6000);
    }
  }
}

function switchAuthMode(mode) {
  const regForm = document.getElementById('registerForm');
  const loginForm = document.getElementById('loginForm');
  const tabReg = document.getElementById('authTabRegister');
  const tabLogin = document.getElementById('authTabLogin');
  const alertEl = document.getElementById('authAlert');
  alertEl.classList.add('hidden');

  if (mode === 'register') {
    regForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    tabReg.classList.add('bg-white', 'text-slate-800', 'shadow-sm');
    tabReg.classList.remove('text-slate-500');
    tabLogin.classList.remove('bg-white', 'text-slate-800', 'shadow-sm');
    tabLogin.classList.add('text-slate-500');
  } else {
    loginForm.classList.remove('hidden');
    regForm.classList.add('hidden');
    tabLogin.classList.add('bg-white', 'text-slate-800', 'shadow-sm');
    tabLogin.classList.remove('text-slate-500');
    tabReg.classList.remove('bg-white', 'text-slate-800', 'shadow-sm');
    tabReg.classList.add('text-slate-500');
  }
}

function togglePasswordVisibility(fieldId) {
  const el = document.getElementById(fieldId);
  if (el) {
    el.type = el.type === 'password' ? 'text' : 'password';
  }
}

function normalizeClientPhone(str) {
  if (!str) return '';
  let s = String(str).trim();
  if (s.toLowerCase() === 'admin') return 'admin';
  s = s.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  s = s.replace(/[\s\-\(\)\.]/g, '');
  if (s.startsWith('+20')) {
    s = '0' + s.slice(3);
  } else if (s.startsWith('0020')) {
    s = '0' + s.slice(4);
  } else if (s.startsWith('20') && s.length === 12 && ['10', '11', '12', '15'].includes(s.slice(2, 4))) {
    s = '0' + s.slice(2);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  s = s.replace(/\D/g, '');
  return s;
}

function normalizeClientCode(str) {
  if (!str) return '';
  let s = String(str).trim();
  s = s.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  s = s.replace(/[\s\r\n\t]/g, '');
  return s;
}

// Handle Register Submit
async function handleRegister(event) {
  event.preventDefault();
  const alertEl = document.getElementById('authAlert');
  const submitBtn = document.getElementById('regSubmitBtn');

  const name = document.getElementById('regName').value.trim();
  const phone = normalizeClientPhone(document.getElementById('regPhone').value);
  const subject = document.getElementById('regSubject').value.trim();
  const center_name = document.getElementById('regCenter').value.trim();
  const password = document.getElementById('regPassword').value.trim();
  const confirmPassword = document.getElementById('regConfirmPassword').value.trim();

  if (password !== confirmPassword) {
    showAuthError('كلمة السر وتأكيد كلمة السر غير متطابقين!');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري إنشاء الحساب...';

  try {
    const json = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, phone, password, confirmPassword, subject, center_name })
    });

    if (json.success && json.data) {
      authToken = json.data.token;
      currentUser = json.data.user;
      localStorage.setItem('teacher_token', authToken);
      showToast('تم إنشاء الحساب بنجاح! مرحباً بك.', 'success');
      showAppScreen();
    } else {
      showAuthError(json.error || 'حدث خطأ أثناء إنشاء الحساب');
    }
  } catch (err) {
    showAuthError(err.message || 'تعذر الاتصال بالخادم');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> <span>إنشاء الحساب وبدء الاستخدام</span>';
  }
}

// Handle Login Submit
async function handleLogin(event) {
  event.preventDefault();
  const submitBtn = document.getElementById('loginSubmitBtn');
  const phone = normalizeClientPhone(document.getElementById('loginPhone').value);
  const password = document.getElementById('loginPassword').value.trim();

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التحقق...';

  try {
    const json = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password })
    });

    if (json.success && json.data) {
      authToken = json.data.token;
      currentUser = json.data.user;
      localStorage.setItem('teacher_token', authToken);
      showToast('تم تسجيل الدخول بنجاح!', 'success');
      showAppScreen();
    } else {
      showAuthError(json.error || 'رقم الهاتف أو كلمة السر غير صحيحة');
    }
  } catch (err) {
    showAuthError(err.message || 'تعذر الاتصال بالخادم');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> <span>تسجيل الدخول للنظام</span>';
  }
}

function showAuthError(msg) {
  const alertEl = document.getElementById('authAlert');
  if (alertEl) {
    alertEl.className = 'mb-4 p-3 rounded-xl text-xs font-bold flex items-center gap-2 bg-rose-50 text-rose-700 border border-rose-200';
    alertEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${msg}</span>`;
    alertEl.classList.remove('hidden');
    alertEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  showToast(msg, 'error');
}

function confirmLogout() {
  if (confirm('هل أنت متأكد من رغبتك في تسجيل الخروج؟')) {
    apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    authToken = null;
    currentUser = null;
    localStorage.removeItem('teacher_token');
    showAuthScreen();
    showToast('تم تسجيل الخروج بنجاح', 'info');
  }
}

function updateHeaderProfile() {
  if (!currentUser) return;
  const nameEl = document.getElementById('headerTeacherName');
  const subEl = document.getElementById('headerSubject');
  if (nameEl) nameEl.innerText = currentUser.name || 'الأستاذ';
  if (subEl) subEl.innerText = `${currentUser.subject ? 'مادة: ' + currentUser.subject : ''} ${currentUser.center_name ? '| ' + currentUser.center_name : ''}`.trim() || 'نظام إدارة الطلاب والحصص';
}

// ==========================================
// 3. UI UTILITIES & TABS
// ==========================================
function initLiveClock() {
  const update = () => {
    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

    const dateEl = document.getElementById('liveDate');
    const clockEl = document.getElementById('liveClock');
    if (dateEl) dateEl.innerText = dateStr;
    if (clockEl) clockEl.innerText = timeStr;
  };
  update();
  setInterval(update, 1000);
}

function setDefaultSessionDate() {
  const dateInput = document.getElementById('attendanceSessionDate');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;
  }
}

function switchTab(tabId) {
  const tabs = ['attendance', 'students', 'groups', 'idcards', 'handouts', 'finance', 'leaderboard', 'settings', 'chat'];
  tabs.forEach(t => {
    const sec = document.getElementById(`tab-${t}`);
    const btn = document.getElementById(`tabBtn-${t}`);
    if (sec) {
      if (t === tabId) {
        sec.classList.remove('hidden');
      } else {
        sec.classList.add('hidden');
      }
    }
    if (btn) {
      if (t === tabId) {
        btn.classList.remove('border-transparent', 'text-slate-400');
        btn.classList.add('border-brand-500', 'text-brand-400');
      } else {
        btn.classList.remove('border-brand-500', 'text-brand-400');
        btn.classList.add('border-transparent', 'text-slate-400');
      }
    }
  });

  if (tabId === 'students') loadStudentsList();
  if (tabId === 'groups') renderGroupsGrid();
  if (tabId === 'idcards') renderIdCardsPreview();
  if (tabId === 'handouts') loadHandouts();
  if (tabId === 'finance') loadFinanceDashboard();
  if (tabId === 'leaderboard') loadLeaderboard();
  if (tabId === 'chat') {
    loadTeacherMessages();
  }
  if (tabId === 'attendance') {
    setTimeout(() => {
      const input = document.getElementById('quickBarcodeInput');
      if (input) input.focus();
    }, 100);
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  const typeStyles = {
    success: 'bg-emerald-600 text-white shadow-emerald-600/30',
    error: 'bg-rose-600 text-white shadow-rose-600/30',
    warning: 'bg-amber-500 text-white shadow-amber-500/30',
    info: 'bg-slate-900 text-white shadow-slate-900/30'
  };
  const typeIcons = {
    success: 'fa-circle-check',
    error: 'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info: 'fa-circle-info'
  };

  toast.className = `toast-enter flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl font-bold text-xs pointer-events-auto ${typeStyles[type] || typeStyles.info}`;
  toast.innerHTML = `<i class="fa-solid ${typeIcons[type] || 'fa-circle-info'} text-base"></i> <span class="flex-1">${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('toast-enter');
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// ==========================================
// 4. GROUPS MANAGEMENT
// ==========================================
async function loadGroups() {
  try {
    const res = await apiFetch('/api/groups');
    if (res.success) {
      allGroups = res.data || [];
      populateGroupSelects();
      renderGroupsGrid();
    }
  } catch (err) {
    console.error('Error loading groups:', err);
  }
}

function populateGroupSelects() {
  const attSelect = document.getElementById('attendanceGroupSelect');
  const stdFilter = document.getElementById('studentGroupFilter');
  const stdFormGroup = document.getElementById('studentFormGroup');
  const idCardSelect = document.getElementById('idCardGroupSelect');

  const optionsHtml = allGroups.length === 0
    ? '<option value="">لا توجد مجموعات مسجلة بعد</option>'
    : '<option value="">-- اضغط لاختيار المجموعة --</option>' + allGroups.map(g => `
        <option value="${g.id}">${g.name} - ${g.grade} (${g.days} ${g.time})</option>
      `).join('');

  if (attSelect) {
    attSelect.innerHTML = optionsHtml;
    // Auto select first group if available
    if (allGroups.length > 0 && !attSelect.value) {
      attSelect.value = allGroups[0].id;
      loadSessionForSelectedGroup();
    }
  }

  if (stdFilter) {
    stdFilter.innerHTML = '<option value="">جميع المجموعات</option>' + allGroups.map(g => `
      <option value="${g.id}">${g.name} (${g.grade})</option>
    `).join('');
  }

  if (stdFormGroup) {
    stdFormGroup.innerHTML = '<option value="">بدون مجموعة حالياً</option>' + allGroups.map(g => `
      <option value="${g.id}">${g.name} (${g.grade})</option>
    `).join('');
  }

  if (idCardSelect) {
    idCardSelect.innerHTML = '<option value="all">جميع الطلاب في كل المجموعات</option>' + allGroups.map(g => `
      <option value="${g.id}">${g.name} (${g.grade})</option>
    `).join('');
  }
}

function renderGroupsGrid() {
  const container = document.getElementById('groupsGrid');
  if (!container) return;

  if (allGroups.length === 0) {
    container.innerHTML = `
      <div class="col-span-full bg-white p-10 rounded-3xl border border-slate-200 text-center">
        <div class="w-16 h-16 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto text-2xl mb-3">
          <i class="fa-solid fa-layer-group"></i>
        </div>
        <h4 class="text-base font-bold text-slate-800">لا توجد أي مجموعات دراسية بعد</h4>
        <p class="text-xs text-slate-500 mt-1 mb-4">ابدأ بإضافة أول مجموعة دراسية ومواعيدها لتسجيل حضور الطلاب</p>
        <button onclick="openAddGroupModal()" class="bg-brand-600 hover:bg-brand-500 text-white px-5 py-2.5 rounded-xl font-bold text-xs shadow-md transition">
          <i class="fa-solid fa-plus ml-1"></i> إضافة أول مجموعة
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = allGroups.map(g => `
    <div class="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm hover:shadow-md transition space-y-4">
      <div class="flex items-start justify-between">
        <div>
          <span class="text-[10px] font-extrabold bg-brand-50 text-brand-700 px-2.5 py-1 rounded-full">${g.grade}</span>
          <h3 class="text-base font-extrabold text-slate-800 mt-1.5">${g.name}</h3>
        </div>
        <div class="flex items-center gap-1">
          <button onclick="openEditGroupModal(${g.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-500 flex items-center justify-center transition" title="تعديل"><i class="fa-solid fa-pen text-xs"></i></button>
          <button onclick="deleteGroup(${g.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-500 flex items-center justify-center transition" title="حذف"><i class="fa-solid fa-trash text-xs"></i></button>
        </div>
      </div>

      <div class="space-y-1.5 text-xs text-slate-600 bg-slate-50 p-3 rounded-2xl">
        <div class="flex items-center gap-2">
          <i class="fa-regular fa-calendar text-brand-600 w-4"></i>
          <span>${g.days || 'غير محدد'}</span>
        </div>
        <div class="flex items-center gap-2">
          <i class="fa-regular fa-clock text-brand-600 w-4"></i>
          <span>${g.time || 'غير محدد'}</span>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 text-center pt-1 border-t border-slate-100">
        <div>
          <p class="text-[10px] text-slate-400 font-bold">سعر الحصة</p>
          <p class="text-xs font-black text-slate-800">${g.session_price || 0} ج.م</p>
        </div>
        <div>
          <p class="text-[10px] text-slate-400 font-bold">عدد الطلاب</p>
          <p class="text-xs font-black text-brand-600">${g.students_count || 0} طالب</p>
        </div>
      </div>

      <button onclick="selectGroupForAttendance(${g.id})" class="w-full bg-slate-100 hover:bg-brand-600 hover:text-white text-slate-700 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5">
        <i class="fa-solid fa-clipboard-user"></i>
        <span>فتح كشف الحضور</span>
      </button>
    </div>
  `).join('');
}

function selectGroupForAttendance(groupId) {
  const sel = document.getElementById('attendanceGroupSelect');
  if (sel) {
    sel.value = groupId;
    switchTab('attendance');
    loadSessionForSelectedGroup();
  }
}

function openAddGroupModal() {
  document.getElementById('groupFormId').value = '';
  document.getElementById('groupModalTitle').innerText = 'إضافة مجموعة جديدة';
  document.getElementById('groupForm').reset();
  document.getElementById('groupModal').classList.remove('hidden');
}

function openEditGroupModal(groupId) {
  const grp = allGroups.find(g => g.id === groupId);
  if (!grp) return;

  document.getElementById('groupFormId').value = grp.id;
  document.getElementById('groupModalTitle').innerText = 'تعديل المجموعة';
  document.getElementById('groupFormName').value = grp.name;
  document.getElementById('groupFormGrade').value = grp.grade;
  document.getElementById('groupFormDays').value = grp.days || '';
  document.getElementById('groupFormTime').value = grp.time || '';
  document.getElementById('groupFormSessionPrice').value = grp.session_price || 0;
  document.getElementById('groupFormMonthlyPrice').value = grp.monthly_price || 0;
  document.getElementById('groupFormNotes').value = grp.notes || '';

  document.getElementById('groupModal').classList.remove('hidden');
}

function closeGroupModal() {
  document.getElementById('groupModal').classList.add('hidden');
}

async function saveGroupForm(event) {
  event.preventDefault();
  const id = document.getElementById('groupFormId').value;
  const payload = {
    name: document.getElementById('groupFormName').value.trim(),
    grade: document.getElementById('groupFormGrade').value,
    days: document.getElementById('groupFormDays').value.trim(),
    time: document.getElementById('groupFormTime').value.trim(),
    session_price: document.getElementById('groupFormSessionPrice').value,
    monthly_price: document.getElementById('groupFormMonthlyPrice').value,
    notes: document.getElementById('groupFormNotes').value.trim()
  };

  try {
    const res = await apiFetch(id ? `/api/groups/${id}` : '/api/groups', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });

    if (res.success) {
      showToast(res.message || 'تم حفظ المجموعة بنجاح', 'success');
      closeGroupModal();
      await loadGroups();
    } else {
      showToast(res.error || 'فشل حفظ المجموعة', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteGroup(groupId) {
  if (!confirm('هل أنت متأكد من حذف هذه المجموعة؟ لن يتم حذف الطلاب ولكن سيتم فك ارتباطهم بالمجموعة.')) return;

  try {
    const res = await apiFetch(`/api/groups/${groupId}`, { method: 'DELETE' });
    if (res.success) {
      showToast(res.message, 'success');
      await loadGroups();
    } else {
      showToast(res.error, 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
// 5. ATTENDANCE & LIVE SESSIONS
// ==========================================
async function loadSessionForSelectedGroup() {
  const groupSelect = document.getElementById('attendanceGroupSelect');
  const dateInput = document.getElementById('attendanceSessionDate');

  const groupId = groupSelect ? groupSelect.value : null;
  const sessionDate = dateInput ? dateInput.value : null;

  if (!groupId || !sessionDate) {
    resetAttendanceView();
    return;
  }

  try {
    // 1. Get or create session
    const sessionRes = await apiFetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ group_id: groupId, session_date: sessionDate })
    });

    if (sessionRes.success && sessionRes.data) {
      currentSession = sessionRes.data;
      // 2. Fetch full session details & records
      const fullRes = await apiFetch(`/api/sessions/${currentSession.id}`);
      if (fullRes.success && fullRes.data) {
        currentSessionData = fullRes.data;
        renderAttendanceRoster();
        renderAttendanceStats();
      }
    }
  } catch (err) {
    console.error('Error loading session:', err);
    showToast('حدث خطأ في تحميل بيانات الحصة', 'error');
  }
}

function resetAttendanceView() {
  currentSession = null;
  currentSessionData = null;
  document.getElementById('statTotalStudents').innerText = '0';
  document.getElementById('statPresentStudents').innerText = '0';
  document.getElementById('statAbsentStudents').innerText = '0';
  document.getElementById('statAttendanceRate').innerText = '0%';
  document.getElementById('statSessionIncome').innerText = '0 ج.م';
  document.getElementById('statSessionRemaining').innerText = '0 ج.م';
  document.getElementById('sessionRosterCountBadge').innerText = '0 طالب';
  document.getElementById('attendanceTableBody').innerHTML = `
    <tr>
      <td colspan="10" class="text-center py-12 text-slate-400">
        <i class="fa-solid fa-users-slash text-3xl mb-2 block"></i>
        <span>برجاء اختيار مجموعة لعرض كشف الحضور</span>
      </td>
    </tr>
  `;
}

function renderAttendanceStats() {
  if (!currentSessionData || !currentSessionData.stats) return;
  const s = currentSessionData.stats;

  document.getElementById('statTotalStudents').innerText = s.totalStudents;
  document.getElementById('statPresentStudents').innerText = s.presentCount + s.lateCount;
  document.getElementById('statAbsentStudents').innerText = s.absentCount;
  document.getElementById('statAttendanceRate').innerText = `${s.attendanceRate}%`;
  document.getElementById('statSessionIncome').innerText = `${s.totalPaid} ج.م`;
  document.getElementById('statSessionRemaining').innerText = `${s.totalRemaining} ج.م`;
  document.getElementById('sessionRosterCountBadge').innerText = `${s.totalStudents} طالب`;
}

function renderAttendanceRoster() {
  const tbody = document.getElementById('attendanceTableBody');
  if (!tbody || !currentSessionData) return;

  const records = currentSessionData.records || [];
  if (records.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="text-center py-12 text-slate-400">
          <i class="fa-solid fa-user-plus text-3xl mb-2 block"></i>
          <span>لا يوجد طلاب مسجلون في هذه المجموعة بعد. قم بإضافة طلاب للمجموعة أولاً.</span>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = records.map(r => {
    const isPresent = r.attendance_status === 'present';
    const isAbsent = r.attendance_status === 'absent';
    const isLate = r.attendance_status === 'late';
    const isExcused = r.attendance_status === 'excused';

    const statusBadge = isPresent
      ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800">حاضر</span>'
      : isAbsent
      ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800">غائب</span>'
      : isLate
      ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800">متأخر</span>'
      : '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-800">معتذر</span>';

    const rowBg = isPresent ? 'bg-emerald-50/20' : (isAbsent ? 'bg-white' : 'bg-slate-50/50');
    const studentPhone = r.student_phone || r.father_phone || '';
    const whatsappLink = buildWhatsappLink(r.father_phone || r.student_phone, r.student_name, isAbsent ? 'absent' : 'quiz', r.quiz_score);

    return `
      <tr class="${rowBg} hover:bg-slate-50 transition border-b border-slate-100" id="att-row-${r.attendance_id}">
        <!-- Code -->
        <td class="px-4 py-3 font-mono font-bold text-slate-700">${r.student_code}</td>
        
        <!-- Name & Debt pill -->
        <td class="px-4 py-3">
          <div class="font-extrabold text-slate-800 cursor-pointer hover:text-brand-600 transition" onclick="openStudentProfile(${r.student_id})">
            ${r.student_name}
          </div>
          ${r.student_balance > 0 ? `<span class="inline-block text-[10px] font-black text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.2 rounded mt-0.5">عليه دين: ${r.student_balance} ج.م</span>` : ''}
        </td>

        <!-- Status selector -->
        <td class="px-4 py-3 text-center">
          <select onchange="updateAttendanceRecord(${r.attendance_id}, 'status', this.value)" class="text-xs font-bold rounded-xl px-2 py-1 border border-slate-200 bg-white focus:ring-2 focus:ring-brand-500 focus:outline-none">
            <option value="present" ${isPresent ? 'selected' : ''}>حاضر</option>
            <option value="absent" ${isAbsent ? 'selected' : ''}>غائب</option>
            <option value="late" ${isLate ? 'selected' : ''}>متأخر</option>
            <option value="excused" ${isExcused ? 'selected' : ''}>معتذر</option>
          </select>
        </td>

        <!-- Check-in Time -->
        <td class="px-4 py-3 text-center text-xs text-slate-500 font-mono">${r.check_in_time || '--'}</td>

        <!-- Paid Amount -->
        <td class="px-4 py-3 text-center">
          <input type="number" value="${r.paid_amount || 0}" onchange="updateAttendanceRecord(${r.attendance_id}, 'paid_amount', this.value)" class="w-16 text-center text-xs font-bold border border-slate-200 rounded-lg py-1 bg-white focus:ring-2 focus:ring-brand-500">
        </td>

        <!-- Remaining Amount -->
        <td class="px-4 py-3 text-center">
          <input type="number" value="${r.remaining_amount || 0}" onchange="updateAttendanceRecord(${r.attendance_id}, 'remaining_amount', this.value)" class="w-16 text-center text-xs font-bold border border-slate-200 rounded-lg py-1 bg-white focus:ring-2 focus:ring-brand-500 text-rose-600">
        </td>

        <!-- Homework -->
        <td class="px-4 py-3 text-center">
          <select onchange="updateAttendanceRecord(${r.attendance_id}, 'homework', this.value)" class="text-xs font-bold rounded-lg px-1.5 py-1 border border-slate-200 bg-white">
            <option value="done" ${r.homework === 'done' ? 'selected' : ''}>كامل</option>
            <option value="partial" ${r.homework === 'partial' ? 'selected' : ''}>ناقص</option>
            <option value="none" ${r.homework === 'none' ? 'selected' : ''}>لم يقم</option>
          </select>
        </td>

        <!-- Quiz score -->
        <td class="px-4 py-3 text-center">
          <div class="inline-flex items-center gap-1">
            <input type="number" step="0.5" value="${r.quiz_score !== null ? r.quiz_score : ''}" placeholder="--" onchange="updateAttendanceRecord(${r.attendance_id}, 'quiz_score', this.value)" class="w-14 text-center text-xs font-bold border border-slate-200 rounded-lg py-1 bg-white focus:ring-2 focus:ring-brand-500">
            <span class="text-[10px] text-slate-400">/${r.max_quiz_score || 20}</span>
          </div>
        </td>

        <!-- WhatsApp Direct -->
        <td class="px-4 py-3 text-center">
          ${studentPhone ? `
            <a href="${whatsappLink}" target="_blank" class="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white inline-flex items-center justify-center transition" title="إرسال رسالة واتساب">
              <i class="fa-brands fa-whatsapp text-sm"></i>
            </a>
          ` : `<span class="text-[10px] text-slate-300">لا يوجد رقم</span>`}
        </td>

        <!-- Actions -->
        <td class="px-4 py-3 text-center">
          <button onclick="openStudentProfile(${r.student_id})" class="text-xs text-indigo-600 hover:text-indigo-800 font-bold px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 transition">
            الملف
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Fast Barcode Check-In
async function handleQuickCheckIn(event) {
  event.preventDefault();
  if (!currentSession) {
    showToast('برجاء اختيار المجموعة وتاريخ الحصة أولاً', 'warning');
    return;
  }

  const codeInput = document.getElementById('quickBarcodeInput');
  const paidInput = document.getElementById('quickPaidAmount');
  const code = codeInput ? normalizeClientCode(codeInput.value) : '';
  const paid = paidInput && paidInput.value ? paidInput.value : undefined;

  if (!code) return;

  try {
    const res = await apiFetch(`/api/sessions/${currentSession.id}/checkin`, {
      method: 'POST',
      body: JSON.stringify({ code, paid_amount: paid, status: 'present' })
    });

    if (res.success && res.data) {
      playAudioTone(true);
      showCheckInFeedback(res.message, true, res.data);
      codeInput.value = '';
      codeInput.focus();
      // Reload session
      await loadSessionForSelectedGroup();
    } else {
      playAudioTone(false);
      showCheckInFeedback(res.error || 'كود الطالب غير صحيح', false);
    }
  } catch (err) {
    playAudioTone(false);
    showCheckInFeedback(err.message, false);
  }
}

function showCheckInFeedback(msg, success, data = null) {
  const box = document.getElementById('checkInFeedback');
  if (!box) return;

  box.className = `mt-4 p-3.5 rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-between transition ${success ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'}`;

  let extra = '';
  if (data && data.student) {
    extra = `<span class="text-xs">المدفوع: ${data.paid} ج.م | المتبقي: ${data.remaining} ج.م</span>`;
  }

  box.innerHTML = `
    <div class="flex items-center gap-2">
      <i class="fa-solid ${success ? 'fa-circle-check text-emerald-400' : 'fa-circle-xmark text-rose-400'} text-base"></i>
      <span>${msg}</span>
    </div>
    ${extra}
  `;
  box.classList.remove('hidden');

  setTimeout(() => {
    box.classList.add('hidden');
  }, 4000);
}

// Inline Table Record Update
async function updateAttendanceRecord(attendanceId, field, value) {
  try {
    const payload = {};
    payload[field] = value;

    const res = await apiFetch(`/api/attendance/${attendanceId}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });

    if (res.success) {
      showToast('تم التحديث بنجاح', 'success');
      // Reload stats & data smoothly
      await loadSessionForSelectedGroup();
    } else {
      showToast(res.error || 'فشل التحديث', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function filterRosterTable() {
  const query = (document.getElementById('rosterSearchInput').value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('rosterStatusFilter').value;
  const tbody = document.getElementById('attendanceTableBody');
  const rows = tbody.getElementsByTagName('tr');

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const text = row.innerText.toLowerCase();
    const matchesQuery = query === '' || text.includes(query);

    let matchesStatus = true;
    if (statusFilter === 'present') {
      matchesStatus = text.includes('حاضر');
    } else if (statusFilter === 'absent') {
      matchesStatus = text.includes('غائب');
    }

    if (matchesQuery && matchesStatus) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  }
}

function triggerNewSessionModal() {
  // Sets session date to today and focuses barcode input
  setDefaultSessionDate();
  loadSessionForSelectedGroup();
  setTimeout(() => {
    const input = document.getElementById('quickBarcodeInput');
    if (input) input.focus();
  }, 150);
}

// ==========================================
// 6. WHATSAPP & ABSENTEES BROADCAST
// ==========================================
function buildWhatsappLink(phone, studentName, templateType = 'absent', score = null) {
  if (!phone) return '#';
  let cleanPhone = String(phone).replace(/\D/g, '');
  if (cleanPhone.startsWith('01')) {
    cleanPhone = '20' + cleanPhone.substring(1);
  } else if (!cleanPhone.startsWith('20')) {
    cleanPhone = '2' + cleanPhone;
  }

  const teacherName = (currentUser && currentUser.name) || (currentSettings.teacher_name || 'الأستاذ');
  const subject = (currentUser && currentUser.subject) || (currentSettings.subject || 'المادة');
  const dateStr = currentSession ? currentSession.session_date : new Date().toISOString().split('T')[0];

  let msg = '';
  if (templateType === 'absent') {
    msg = (currentSettings.whatsapp_absent_msg || 'السلام عليكم ورحمة الله وبركاته، ولي أمر الطالب {student_name}، نحيطكم علماً بأن الطالب تغيب اليوم الموافق {date} عن حصة مادة {subject} مع {teacher_name}. برجاء المتابعة والاهتمام.')
      .replace('{student_name}', studentName)
      .replace('{date}', dateStr)
      .replace('{subject}', subject)
      .replace('{teacher_name}', teacherName);
  } else if (templateType === 'debt') {
    msg = (currentSettings.whatsapp_debt_msg || 'السلام عليكم ورحمة الله وبركاته، نود تذكيركم بوجود مستحقات دراسية متأخرة على الطالب {student_name} بمبلغ {amount} {currency}. برجاء التكرم بالسداد في أقرب فرصة.')
      .replace('{student_name}', studentName)
      .replace('{amount}', score || 0)
      .replace('{currency}', currentSettings.currency || 'جنيه');
  } else if (templateType === 'quiz') {
    msg = (currentSettings.whatsapp_quiz_msg || 'السلام عليكم، درجة الطالب {student_name} في اختبار {subject} اليوم هي ({score}). نتمنى له دوام التوفيق والنجاح.')
      .replace('{student_name}', studentName)
      .replace('{subject}', subject)
      .replace('{score}', score || 0)
      .replace('{max_score}', 20);
  }

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
}

function openAbsenteesBroadcastModal() {
  if (!currentSessionData || !currentSessionData.absentees) {
    showToast('لا توجد حصة محددة حالياً', 'warning');
    return;
  }

  const absentees = currentSessionData.absentees;
  const container = document.getElementById('absenteesListContainer');
  const subtitle = document.getElementById('absenteesModalSubtitle');

  subtitle.innerText = `إجمالي الغائبين في هذه الحصة: ${absentees.length} طالب`;

  if (absentees.length === 0) {
    container.innerHTML = `
      <div class="py-10 text-center text-slate-400">
        <i class="fa-solid fa-user-check text-3xl mb-2 text-emerald-500 block"></i>
        <span class="font-bold">رائع! لا يوجد أي غياب في هذه الحصة، نسبة الحضور 100%</span>
      </div>
    `;
  } else {
    container.innerHTML = absentees.map(a => {
      const parentPhone = a.father_phone || a.student_phone || a.mother_phone;
      const link = buildWhatsappLink(parentPhone, a.student_name, 'absent');
      return `
        <div class="py-3 flex items-center justify-between">
          <div>
            <h4 class="text-xs sm:text-sm font-extrabold text-slate-800">${a.student_name}</h4>
            <p class="text-[11px] text-slate-500">كود: ${a.student_code} | ولي الأمر: ${parentPhone || 'غير مسجل'}</p>
          </div>
          <div>
            ${parentPhone ? `
              <a href="${link}" target="_blank" class="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition">
                <i class="fa-brands fa-whatsapp text-sm"></i>
                <span>إرسال واتساب</span>
              </a>
            ` : `<span class="text-[11px] text-slate-400">لا يوجد رقم</span>`}
          </div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('absenteesModal').classList.remove('hidden');
}

function closeAbsenteesModal() {
  document.getElementById('absenteesModal').classList.add('hidden');
}

// ==========================================
// 7. STUDENTS MANAGEMENT
// ==========================================
async function loadStudentsList() {
  const search = document.getElementById('studentSearchInput') ? document.getElementById('studentSearchInput').value.trim() : '';
  const groupId = document.getElementById('studentGroupFilter') ? document.getElementById('studentGroupFilter').value : '';
  const hasDebt = document.getElementById('studentDebtFilter') ? document.getElementById('studentDebtFilter').value : '';

  let url = '/api/students?';
  if (search) url += `search=${encodeURIComponent(search)}&`;
  if (groupId) url += `group_id=${groupId}&`;
  if (hasDebt) url += `has_debt=${hasDebt}&`;

  try {
    const res = await apiFetch(url);
    if (res.success) {
      allStudents = res.data || [];
      renderStudentsTable();
      renderStudentsBadge();
    }
  } catch (err) {
    console.error('Error loading students:', err);
  }
}

function renderStudentsBadge() {
  const badge = document.getElementById('studentsTotalBadge');
  if (badge) badge.innerText = `${allStudents.length} طالب`;
}

function renderStudentsTable() {
  const tbody = document.getElementById('studentsTableBody');
  if (!tbody) return;

  if (allStudents.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-12 text-slate-400">
          <i class="fa-solid fa-users text-3xl mb-2 block"></i>
          <span>لا يوجد طلاب مطابقين للبحث. يمكنك إضافة طالب جديد بالضغط على "إضافة طالب".</span>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = allStudents.map(s => {
    const debtClass = s.balance > 0 ? 'text-rose-600 font-black' : 'text-slate-400 font-bold';
    return `
      <tr class="hover:bg-slate-50 transition border-b border-slate-100">
        <td class="px-4 py-3 font-mono font-bold text-slate-700">${s.code}</td>
        <td class="px-4 py-3">
          <div class="font-extrabold text-slate-800 cursor-pointer hover:text-brand-600 transition" onclick="openStudentProfile(${s.id})">
            ${s.name}
          </div>
        </td>
        <td class="px-4 py-3 text-xs text-slate-600">${s.grade}</td>
        <td class="px-4 py-3 text-xs font-bold text-slate-700">${s.group_name || '<span class="text-slate-400">بدون مجموعة</span>'}</td>
        <td class="px-4 py-3 text-xs font-mono text-slate-600" dir="ltr">${s.phone || '--'}</td>
        <td class="px-4 py-3 text-xs font-mono text-slate-600" dir="ltr">${s.father_phone || s.mother_phone || '--'}</td>
        <td class="px-4 py-3 text-center ${debtClass}">
          ${s.balance > 0 ? `${s.balance} ج.م` : '0'}
        </td>
        <td class="px-4 py-3 text-center">
          <div class="inline-flex items-center gap-1.5">
            ${s.balance > 0 ? `
              <button onclick="openPaymentModal(${s.id})" class="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-700 transition" title="سداد دفعة">
                <i class="fa-solid fa-hand-holding-dollar ml-1"></i> سداد
              </button>
            ` : ''}
            <button onclick="openStudentProfile(${s.id})" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-500 inline-flex items-center justify-center transition" title="الملف الشامل">
              <i class="fa-solid fa-file-invoice text-xs"></i>
            </button>
            <button onclick="openEditStudentModal(${s.id})" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-600 text-slate-500 inline-flex items-center justify-center transition" title="تعديل">
              <i class="fa-solid fa-pen text-xs"></i>
            </button>
            <button onclick="deleteStudent(${s.id})" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-500 inline-flex items-center justify-center transition" title="حذف">
              <i class="fa-solid fa-trash text-xs"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function openAddStudentModal() {
  document.getElementById('studentFormId').value = '';
  document.getElementById('studentModalTitle').innerText = 'تسجيل طالب جديد';
  document.getElementById('studentForm').reset();
  document.getElementById('studentBalanceFieldWrapper').classList.add('hidden');

  // Auto-generate next student code
  try {
    const res = await apiFetch('/api/students/next-code');
    if (res.success && res.code) {
      document.getElementById('studentFormCode').value = res.code;
    }
  } catch (e) {}

  document.getElementById('studentModal').classList.remove('hidden');
}

function openEditStudentModal(studentId) {
  const std = allStudents.find(s => s.id === studentId);
  if (!std) return;

  document.getElementById('studentFormId').value = std.id;
  document.getElementById('studentModalTitle').innerText = 'تعديل بيانات الطالب';
  document.getElementById('studentFormCode').value = std.code;
  document.getElementById('studentFormName').value = std.name;
  document.getElementById('studentFormGrade').value = std.grade;
  document.getElementById('studentFormGroup').value = std.group_id || '';
  document.getElementById('studentFormPhone').value = std.phone || '';
  document.getElementById('studentFormFatherPhone').value = std.father_phone || '';
  document.getElementById('studentFormMotherPhone').value = std.mother_phone || '';
  document.getElementById('studentFormFee').value = std.monthly_fee || 0;

  const balanceWrapper = document.getElementById('studentBalanceFieldWrapper');
  balanceWrapper.classList.remove('hidden');
  document.getElementById('studentFormBalance').value = std.balance || 0;
  document.getElementById('studentFormNotes').value = std.notes || '';

  document.getElementById('studentModal').classList.remove('hidden');
}

function closeStudentModal() {
  document.getElementById('studentModal').classList.add('hidden');
}

async function saveStudentForm(event) {
  event.preventDefault();
  const id = document.getElementById('studentFormId').value;
  const payload = {
    code: normalizeClientCode(document.getElementById('studentFormCode').value),
    name: document.getElementById('studentFormName').value.trim(),
    grade: document.getElementById('studentFormGrade').value,
    group_id: document.getElementById('studentFormGroup').value || null,
    phone: normalizeClientPhone(document.getElementById('studentFormPhone').value),
    father_phone: normalizeClientPhone(document.getElementById('studentFormFatherPhone').value),
    mother_phone: normalizeClientPhone(document.getElementById('studentFormMotherPhone').value),
    monthly_fee: document.getElementById('studentFormFee').value,
    balance: document.getElementById('studentFormBalance') ? document.getElementById('studentFormBalance').value : 0,
    notes: document.getElementById('studentFormNotes').value.trim()
  };

  try {
    const res = await apiFetch(id ? `/api/students/${id}` : '/api/students', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });

    if (res.success) {
      showToast(res.message || 'تم حفظ بيانات الطالب بنجاح', 'success');
      closeStudentModal();
      await loadStudentsList();
    } else {
      showToast(res.error || 'فشل حفظ الطالب', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteStudent(studentId) {
  if (!confirm('هل أنت متأكد من حذف هذا الطالب نهائياً من سجلاتك؟')) return;

  try {
    const res = await apiFetch(`/api/students/${studentId}`, { method: 'DELETE' });
    if (res.success) {
      showToast(res.message, 'success');
      await loadStudentsList();
    } else {
      showToast(res.error, 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
// 8. STUDENT PROFILE & HISTORY MODAL
// ==========================================
async function openStudentProfile(studentId) {
  try {
    const res = await apiFetch(`/api/students/${studentId}`);
    if (!res.success || !res.data) {
      showToast('تعذر جلب ملف الطالب', 'error');
      return;
    }

    const s = res.data;
    document.getElementById('profileStudentName').innerText = s.name;
    document.getElementById('profileStudentMeta').innerText = `كود: ${s.code} | المرحلة: ${s.grade} | المجموعة: ${s.group_name || 'بدون مجموعة'}`;

    const history = s.history || [];
    const payments = s.payments || [];
    const presentCount = history.filter(h => h.status === 'present' || h.status === 'late').length;

    document.getElementById('profileSessionsCount').innerText = history.length;
    document.getElementById('profilePresentCount').innerText = presentCount;
    document.getElementById('profileBalance').innerText = `${s.balance || 0} ج.م`;

    // History Table
    const histTbody = document.getElementById('profileHistoryTableBody');
    if (history.length === 0) {
      histTbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-slate-400">لا يوجد سجل حضور مسجل بعد</td></tr>';
    } else {
      histTbody.innerHTML = history.map(h => `
        <tr class="border-b border-slate-100">
          <td class="p-2.5 font-mono">${h.session_date}</td>
          <td class="p-2.5">${h.group_name}</td>
          <td class="p-2.5 text-center font-bold ${h.status === 'present' ? 'text-emerald-600' : 'text-rose-600'}">${h.status === 'present' ? 'حاضر' : 'غائب'}</td>
          <td class="p-2.5 text-center">${h.paid_amount || 0} ج.م</td>
          <td class="p-2.5 text-center text-rose-600 font-bold">${h.remaining_amount || 0} ج.م</td>
          <td class="p-2.5 text-center font-bold">${h.quiz_score !== null ? h.quiz_score : '--'}</td>
        </tr>
      `).join('');
    }

    // Payments Table
    const payTbody = document.getElementById('profilePaymentsTableBody');
    if (payments.length === 0) {
      payTbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-slate-400">لا يوجد سجل دفعات منفصلة مسجلة</td></tr>';
    } else {
      payTbody.innerHTML = payments.map(p => `
        <tr class="border-b border-slate-100">
          <td class="p-2.5 font-mono">${p.date}</td>
          <td class="p-2.5 font-black text-emerald-600">${p.amount} ج.م</td>
          <td class="p-2.5">${p.payment_type || 'سداد دين'}</td>
          <td class="p-2.5 text-slate-500">${p.notes || '--'}</td>
        </tr>
      `).join('');
    }

    document.getElementById('studentProfileModal').classList.remove('hidden');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function closeStudentProfileModal() {
  document.getElementById('studentProfileModal').classList.add('hidden');
}

// ==========================================
// 9. QUICK PAYMENT & DEBT SETTLER
// ==========================================
function openPaymentModal(studentId) {
  const std = allStudents.find(s => s.id === studentId);
  if (!std) return;

  document.getElementById('paymentStudentId').value = std.id;
  document.getElementById('paymentStudentName').innerText = std.name;
  document.getElementById('paymentCurrentBalance').innerText = `${std.balance || 0} ج.م`;
  document.getElementById('paymentAmount').value = std.balance > 0 ? std.balance : '';
  document.getElementById('paymentNotes').value = '';

  document.getElementById('paymentModal').classList.remove('hidden');
}

function closePaymentModal() {
  document.getElementById('paymentModal').classList.add('hidden');
}

async function submitPaymentForm(event) {
  event.preventDefault();
  const studentId = document.getElementById('paymentStudentId').value;
  const amount = document.getElementById('paymentAmount').value;
  const paymentType = document.getElementById('paymentType').value;
  const notes = document.getElementById('paymentNotes').value.trim();

  try {
    const res = await apiFetch('/api/payments', {
      method: 'POST',
      body: JSON.stringify({ student_id: studentId, amount, payment_type: paymentType, notes })
    });

    if (res.success) {
      showToast(res.message, 'success');
      closePaymentModal();
      await loadStudentsList();
      if (currentSession) await loadSessionForSelectedGroup();
    } else {
      showToast(res.error || 'فشل تسجيل السداد', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
// 10. ID CARDS & BARCODES GENERATION
// ==========================================
function renderIdCardsPreview() {
  const container = document.getElementById('idCardsContainer');
  const groupFilter = document.getElementById('idCardGroupSelect') ? document.getElementById('idCardGroupSelect').value : 'all';
  if (!container) return;

  let filtered = allStudents;
  if (groupFilter !== 'all') {
    filtered = allStudents.filter(s => String(s.group_id) === String(groupFilter));
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full bg-white p-10 rounded-3xl border border-slate-200 text-center">
        <i class="fa-solid fa-id-card text-3xl mb-2 text-slate-300 block"></i>
        <span class="text-xs text-slate-500 font-bold">لا توجد كروت لعرضها في هذه المجموعة.</span>
      </div>
    `;
    return;
  }

  const teacherName = (currentUser && currentUser.name) || (currentSettings.teacher_name || 'الأستاذ');
  const subject = (currentUser && currentUser.subject) || (currentSettings.subject || 'المادة');
  const centerName = (currentUser && currentUser.center_name) || (currentSettings.center_name || 'السنتر');

  container.innerHTML = filtered.map(s => `
    <div class="id-card-print bg-white rounded-3xl p-5 border-2 border-slate-200 shadow-md flex flex-col justify-between relative overflow-hidden">
      <!-- Card Top Ribbon -->
      <div class="flex items-center justify-between border-b pb-3 border-slate-100">
        <div>
          <h4 class="text-xs font-black text-slate-800">${teacherName}</h4>
          <p class="text-[10px] text-brand-600 font-bold">مادة ${subject} | ${centerName}</p>
        </div>
        <div class="w-8 h-8 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center text-sm font-bold">
          <i class="fa-solid fa-graduation-cap"></i>
        </div>
      </div>

      <!-- Student Details -->
      <div class="my-3 space-y-1">
        <h3 class="text-sm font-black text-slate-900">${s.name}</h3>
        <p class="text-[11px] text-slate-500 font-bold">${s.grade}</p>
        <p class="text-[10px] text-slate-400">${s.group_name || 'بدون مجموعة'}</p>
      </div>

      <!-- Barcode & QR Code Area -->
      <div class="pt-2 border-t border-slate-100 flex flex-col items-center justify-center">
        <svg id="barcode-${s.id}" class="max-w-full"></svg>
        <div class="flex items-center justify-between w-full mt-2 text-[10px] text-slate-500 font-mono font-bold">
          <span>الكود: ${s.code}</span>
          <span>هاتف: ${s.phone || s.father_phone || '--'}</span>
        </div>
      </div>
    </div>
  `).join('');

  // Render Barcodes after DOM inserts
  setTimeout(() => {
    filtered.forEach(s => {
      try {
        JsBarcode(`#barcode-${s.id}`, String(s.code), {
          format: "CODE128",
          lineColor: "#0f172a",
          width: 1.8,
          height: 38,
          displayValue: false
        });
      } catch (e) {}
    });
  }, 100);
}

// ==========================================
// 11. HANDOUTS & EXPENSES
// ==========================================
async function loadHandouts() {
  try {
    const res = await apiFetch('/api/handouts');
    if (res.success) {
      renderHandoutsTable(res.data || []);
    }
  } catch (err) {
    console.error('Error loading handouts:', err);
  }
}

function renderHandoutsTable(handouts) {
  const tbody = document.getElementById('handoutsTableBody');
  if (!tbody) return;

  if (handouts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-10 text-slate-400">
          <i class="fa-solid fa-book-open text-2xl mb-1 block"></i>
          <span>لا توجد مذكرات مسجلة بعد. اضغط "إضافة مذكرة جديدة" للبدء.</span>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = handouts.map(h => `
    <tr class="hover:bg-slate-50 border-b border-slate-100">
      <td class="px-4 py-3 font-extrabold text-slate-800">${h.title}</td>
      <td class="px-4 py-3 text-xs text-slate-600">${h.grade}</td>
      <td class="px-4 py-3 text-xs font-black text-brand-600">${h.price} ج.م</td>
      <td class="px-4 py-3 text-center text-xs font-bold text-slate-700">${h.distributed_count || 0}</td>
      <td class="px-4 py-3 text-center text-xs font-bold text-emerald-600">${h.total_collected || 0} ج.م</td>
      <td class="px-4 py-3 text-center">
        <button onclick="deleteHandout(${h.id})" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-500 inline-flex items-center justify-center transition">
          <i class="fa-solid fa-trash text-xs"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

function openAddHandoutModal() {
  document.getElementById('handoutForm').reset();
  document.getElementById('handoutModal').classList.remove('hidden');
}

function closeHandoutModal() {
  document.getElementById('handoutModal').classList.add('hidden');
}

async function saveHandoutForm(event) {
  event.preventDefault();
  const payload = {
    title: document.getElementById('handoutTitle').value.trim(),
    grade: document.getElementById('handoutGrade').value,
    price: document.getElementById('handoutPrice').value
  };

  try {
    const res = await apiFetch('/api/handouts', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (res.success) {
      showToast('تمت إضافة المذكرة بنجاح', 'success');
      closeHandoutModal();
      loadHandouts();
    } else {
      showToast(res.error, 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteHandout(id) {
  if (!confirm('هل أنت متأكد من حذف هذه المذكرة؟')) return;
  try {
    const res = await apiFetch(`/api/handouts/${id}`, { method: 'DELETE' });
    if (res.success) {
      showToast(res.message, 'success');
      loadHandouts();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Expenses
function openAddExpenseModal() {
  document.getElementById('expenseForm').reset();
  document.getElementById('expenseModal').classList.remove('hidden');
}

function closeExpenseModal() {
  document.getElementById('expenseModal').classList.add('hidden');
}

async function saveExpenseForm(event) {
  event.preventDefault();
  const payload = {
    title: document.getElementById('expenseTitle').value.trim(),
    amount: document.getElementById('expenseAmount').value,
    category: document.getElementById('expenseCategory').value
  };

  try {
    const res = await apiFetch('/api/expenses', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (res.success) {
      showToast('تم تسجيل المصروف بنجاح', 'success');
      closeExpenseModal();
      loadFinanceDashboard();
    } else {
      showToast(res.error, 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteExpense(id) {
  if (!confirm('هل أنت متأكد من حذف هذا المصروف؟')) return;
  try {
    const res = await apiFetch(`/api/expenses/${id}`, { method: 'DELETE' });
    if (res.success) {
      showToast(res.message, 'success');
      loadFinanceDashboard();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================
// 12. FINANCE & LEADERBOARD DASHBOARDS
// ==========================================
async function loadFinanceDashboard() {
  try {
    const [reportRes, expRes] = await Promise.all([
      apiFetch('/api/reports/dashboard'),
      apiFetch('/api/expenses')
    ]);

    if (reportRes.success && reportRes.data) {
      const d = reportRes.data;
      document.getElementById('financeTotalIncome').innerText = `${d.totalIncome} ج.م`;
      document.getElementById('financeTotalExpenses').innerText = `${d.totalExpenses} ج.م`;
      document.getElementById('financeNetProfit').innerText = `${d.netProfit} ج.م`;
      document.getElementById('financeTotalDebts').innerText = `${d.totalDebts} ج.م`;
      document.getElementById('financeDebtorsCount').innerText = `${d.studentsWithDebt} طالب عليهم متبقي`;
    }

    if (expRes.success) {
      renderExpensesTable(expRes.data || []);
    }
  } catch (err) {
    console.error('Error loading finance:', err);
  }
}

function renderExpensesTable(expenses) {
  const tbody = document.getElementById('expensesTableBody');
  if (!tbody) return;

  if (expenses.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-slate-400">لا توجد مصروفات مسجلة</td></tr>';
    return;
  }

  tbody.innerHTML = expenses.map(e => `
    <tr class="border-b border-slate-100 hover:bg-slate-50">
      <td class="px-4 py-3 font-bold text-slate-800">${e.title}</td>
      <td class="px-4 py-3 font-black text-rose-600">${e.amount} ج.م</td>
      <td class="px-4 py-3 text-xs text-slate-600">${e.category || 'عام'}</td>
      <td class="px-4 py-3 text-xs font-mono text-slate-500">${e.date}</td>
      <td class="px-4 py-3 text-center">
        <button onclick="deleteExpense(${e.id})" class="text-slate-400 hover:text-rose-600 text-xs transition">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

async function loadLeaderboard() {
  const grade = document.getElementById('leaderboardGradeFilter') ? document.getElementById('leaderboardGradeFilter').value : '';
  const url = grade ? `/api/reports/top-students?grade=${encodeURIComponent(grade)}` : '/api/reports/top-students';

  try {
    const res = await apiFetch(url);
    const container = document.getElementById('leaderboardContainer');
    if (!container) return;

    if (!res.success || !res.data || res.data.length === 0) {
      container.innerHTML = `
        <div class="col-span-full bg-white p-10 rounded-3xl border border-slate-200 text-center">
          <i class="fa-solid fa-award text-3xl mb-2 text-amber-400 block"></i>
          <span class="text-xs text-slate-500 font-bold">لا توجد درجات اختبارات مسجلة بعد. عند تسجيل درجات الاختبارات في الحصص سيتم تصنيف الأوائل هنا تلقائياً.</span>
        </div>
      `;
      return;
    }

    container.innerHTML = res.data.map((st, idx) => {
      const medals = ['🥇', '🥈', '🥉'];
      const medal = medals[idx] || `#${idx + 1}`;
      return `
        <div class="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="text-2xl">${medal}</span>
            <div>
              <h4 class="text-sm font-black text-slate-800">${st.name}</h4>
              <p class="text-[11px] text-slate-500">${st.grade} | ${st.group_name || ''}</p>
            </div>
          </div>
          <div class="text-left">
            <span class="text-xs text-slate-400 block font-bold">متوسط الدرجات</span>
            <span class="text-lg font-black text-amber-600">${st.avg_score}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error leaderboard:', err);
  }
}

// ==========================================
// 13. SETTINGS & DATA BACKUP
// ==========================================
async function loadSettings() {
  try {
    const res = await apiFetch('/api/settings');
    if (res.success && res.data) {
      currentSettings = res.data;
      if (document.getElementById('settingTeacherName')) document.getElementById('settingTeacherName').value = currentSettings.teacher_name || '';
      if (document.getElementById('settingSubject')) document.getElementById('settingSubject').value = currentSettings.subject || '';
      if (document.getElementById('settingCenterName')) document.getElementById('settingCenterName').value = currentSettings.center_name || '';
      if (document.getElementById('settingCurrency')) document.getElementById('settingCurrency').value = currentSettings.currency || 'جنيه';
      if (document.getElementById('settingWhatsappAbsent')) document.getElementById('settingWhatsappAbsent').value = currentSettings.whatsapp_absent_msg || '';
      if (document.getElementById('settingWhatsappDebt')) document.getElementById('settingWhatsappDebt').value = currentSettings.whatsapp_debt_msg || '';
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const payload = {
    teacher_name: document.getElementById('settingTeacherName').value.trim(),
    subject: document.getElementById('settingSubject').value.trim(),
    center_name: document.getElementById('settingCenterName').value.trim(),
    currency: document.getElementById('settingCurrency').value.trim(),
    whatsapp_absent_msg: document.getElementById('settingWhatsappAbsent').value.trim(),
    whatsapp_debt_msg: document.getElementById('settingWhatsappDebt').value.trim()
  };

  try {
    // 1. Update user profile
    await apiFetch('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({ name: payload.teacher_name, subject: payload.subject, center_name: payload.center_name })
    });

    // 2. Update settings
    const res = await apiFetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (res.success) {
      if (currentUser) {
        currentUser.name = payload.teacher_name;
        currentUser.subject = payload.subject;
        currentUser.center_name = payload.center_name;
      }
      updateHeaderProfile();
      showToast('تم حفظ الإعدادات بنجاح', 'success');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function downloadDataBackup() {
  try {
    const db = getLocalDB();
    const jsonStr = JSON.stringify(db, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `teacher_os_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('تم حفظ وتحميل النسخة الاحتياطية بنجاح!', 'success');
  } catch (err) {
    showToast('تعذر تحميل النسخة الاحتياطية: ' + err.message, 'error');
  }
}

function restoreDataBackup(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed.users && Array.isArray(parsed.users)) {
        saveLocalDB(parsed);
        showToast('تم استعادة النسخة الاحتياطية بنجاح! جاري التحديث...', 'success');
        setTimeout(() => location.reload(), 900);
      } else {
        showToast('ملف النسخة الاحتياطية غير صالح', 'error');
      }
    } catch (err) {
      showToast('تعذر استعادة الملف: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

// ==========================================
// 14. EXCEL IMPORT & EXPORT (Client-Side SheetJS)
// ==========================================
function openImportExcelModal() {
  document.getElementById('importExcelModal').classList.remove('hidden');
}

function closeImportExcelModal() {
  document.getElementById('importExcelModal').classList.add('hidden');
}

async function submitImportExcel(event) {
  event.preventDefault();
  const fileInput = document.getElementById('excelFileInput');
  if (!fileInput || !fileInput.files[0]) {
    showToast('برجاء اختيار ملف إكسيل أولاً', 'warning');
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      if (typeof XLSX === 'undefined') {
        showToast('مكتبة الإكسيل غير محملة، تأكد من الاتصال بالإنترنت', 'error');
        return;
      }
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(worksheet);

      if (!rows || rows.length === 0) {
        showToast('الملف فارغ أو لا يحتوي على صفوف صالحة', 'warning');
        return;
      }

      const db = getLocalDB();
      let lastCode = 1000;
      db.students.filter(s => String(s.user_id) === String(currentUser.id)).forEach(s => {
        const c = parseInt(s.code, 10);
        if (!isNaN(c) && c > lastCode) lastCode = c;
      });

      let insertedCount = 0;
      rows.forEach(r => {
        const name = r['اسم الطالب'] || r['الاسم'] || r['Name'] || r['name'];
        if (!name) return;

        let code = r['كود الطالب'] || r['الكود'] || r['Code'] || r['code'];
        if (!code) {
          lastCode++;
          code = String(lastCode);
        } else {
          code = normalizeClientCode(code);
        }

        if (db.students.some(s => String(s.user_id) === String(currentUser.id) && String(s.code) === String(code))) {
          lastCode++;
          code = String(lastCode);
        }

        const phone = normalizeClientPhone(r['هاتف الطالب'] || r['رقم الطالب'] || r['Phone'] || '');
        const grade = String(r['المرحلة الدراسية'] || r['السنة'] || r['Grade'] || 'الصف الأول الثانوي').trim();
        const father = normalizeClientPhone(r['هاتف الأب'] || r['رقم الأب'] || r['Father'] || '');
        const mother = normalizeClientPhone(r['هاتف الأم'] || r['رقم الأم'] || r['Mother'] || '');
        const fee = Number(r['قيمة الحصة'] || r['الاشتراك'] || r['Fee'] || 0);
        const notes = String(r['ملاحظات'] || r['Notes'] || '').trim();

        db.students.push({
          id: generateLocalId(),
          user_id: currentUser.id,
          code,
          name: String(name).trim(),
          phone,
          grade,
          group_id: null,
          father_phone: father,
          mother_phone: mother,
          monthly_fee: fee,
          balance: 0,
          notes,
          status: 'active',
          created_at: new Date().toISOString()
        });
        insertedCount++;
      });

      saveLocalDB(db);
      showToast(`تم استيراد ${insertedCount} طالب بنجاح!`, 'success');
      closeImportExcelModal();
      loadStudentsList();
    } catch (err) {
      showToast('خطأ أثناء قراءة ملف الإكسيل: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function exportStudentsExcel() {
  if (!allStudents || allStudents.length === 0) {
    showToast('لا يوجد طلاب لتصديرهم حالياً', 'warning');
    return;
  }
  if (typeof XLSX === 'undefined') {
    showToast('مكتبة الإكسيل غير محملة', 'error');
    return;
  }

  const rows = allStudents.map(s => ({
    'كود الطالب': s.code,
    'اسم الطالب': s.name,
    'المرحلة الدراسية': s.grade,
    'المجموعة': s.group_name || '',
    'هاتف الطالب': s.phone || '',
    'هاتف ولي الأمر (الأب)': s.father_phone || '',
    'هاتف الأم': s.mother_phone || '',
    'المستحقات المتبقية (جنيه)': s.balance || 0,
    'قيمة الحصة': s.monthly_fee || 0,
    'الحالة': s.status === 'active' ? 'نشط' : 'متوقف',
    'ملاحظات': s.notes || ''
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'قائمة الطلاب');
  XLSX.writeFile(wb, `قائمة_الطلاب_${new Date().toISOString().split('T')[0]}.xlsx`);
  showToast('تم تصدير ملف الإكسيل بنجاح!', 'success');
}

function exportCurrentSessionExcel() {
  if (!currentSession || !currentSessionData || !currentSessionData.records || currentSessionData.records.length === 0) {
    showToast('برجاء اختيار الحصة أولاً وبدء تسجيل الحضور', 'warning');
    return;
  }
  if (typeof XLSX === 'undefined') {
    showToast('مكتبة الإكسيل غير محملة', 'error');
    return;
  }

  const rows = currentSessionData.records.map(r => ({
    'كود الطالب': r.student_code,
    'اسم الطالب': r.student_name,
    'حالة الحضور': r.attendance_status === 'present' ? 'حاضر' : (r.attendance_status === 'late' ? 'متأخر' : (r.attendance_status === 'excused' ? 'معتذر' : 'غائب')),
    'وقت الحضور': r.check_in_time || '-',
    'المبلغ المدفوع': r.paid_amount || 0,
    'المتبقي': r.remaining_amount || 0,
    'الواجب': r.homework || '-',
    'درجة الكويز': r.quiz_score !== null ? `${r.quiz_score}/${r.max_quiz_score || 10}` : '-',
    'استلم مذكرة': r.received_handout ? 'نعم' : 'لا',
    'هاتف الطالب': r.student_phone || '',
    'هاتف الأب': r.father_phone || '',
    'ملاحظات': r.attendance_notes || ''
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'حضور الحصة');
  XLSX.writeFile(wb, `حضور_${currentSession.group_name || 'حصة'}_${currentSession.session_date}.xlsx`);
  showToast('تم تصدير كشف الحضور إكسيل بنجاح!', 'success');
}

function printCurrentSessionSheet() {
  window.print();
}

// ==========================================
// 15. CAMERA QR CODE SCANNER (الكاميرا الخلفية للموبايل)
// ==========================================
let availableCameras = [];
let currentCameraIndex = 0;
let currentFacingMode = 'environment'; // دائماً البدء بالكاميرا الخلفية افتراضياً

function toggleCameraScannerModal() {
  const modal = document.getElementById('cameraScannerModal');
  if (modal.classList.contains('hidden')) {
    modal.classList.remove('hidden');
    startCameraScanner();
  } else {
    stopCameraScanner();
    modal.classList.add('hidden');
  }
}

async function startCameraScanner(preferredCameraId = null) {
  if (html5QrScanner) {
    try { await html5QrScanner.stop(); } catch (e) {}
  }
  html5QrScanner = new Html5Qrcode("qr-reader");

  try {
    // 1. Get available cameras
    if (availableCameras.length === 0) {
      availableCameras = await Html5Qrcode.getCameras().catch(() => []);
    }

    const selectEl = document.getElementById('cameraDeviceSelect');
    let targetCameraConfig = null;

    if (availableCameras.length > 0) {
      if (selectEl) {
        selectEl.innerHTML = availableCameras.map((cam, idx) => {
          const isBack = cam.label.toLowerCase().includes('back') || cam.label.toLowerCase().includes('rear') || cam.label.toLowerCase().includes('environment') || idx === availableCameras.length - 1;
          const label = isBack ? `📸 كاميرا خلفية (${idx + 1})` : `🤳 كاميرا أمامية (${idx + 1})`;
          return `<option value="${cam.id}">${label}</option>`;
        }).join('');
      }

      if (preferredCameraId) {
        targetCameraConfig = preferredCameraId;
        if (selectEl) selectEl.value = preferredCameraId;
      } else {
        // Find best back camera (rear camera)
        let backCam = availableCameras.find(c => {
          const l = c.label.toLowerCase();
          return l.includes('back') || l.includes('rear') || l.includes('environment');
        });

        // On mobile devices, the last camera is usually the primary rear camera
        if (!backCam && availableCameras.length > 1) {
          backCam = availableCameras[availableCameras.length - 1];
        }

        const selectedCam = backCam || availableCameras[0];
        targetCameraConfig = selectedCam.id;
        if (selectEl) selectEl.value = selectedCam.id;
      }
    } else {
      // Fallback to strict environment facingMode for mobile
      targetCameraConfig = { facingMode: { exact: "environment" } };
    }

    const qrConfig = {
      fps: 15,
      qrbox: { width: 240, height: 240 },
      aspectRatio: 1.0
    };

    // Update active badge indicator
    updateCameraBadge();

    // Start scanner with fallback if exact environment fails on some webcams
    try {
      await html5QrScanner.start(
        targetCameraConfig,
        qrConfig,
        onQrCodeSuccess,
        () => {}
      );
    } catch (startErr) {
      // Fallback without exact constraint if camera ID or exact constraint was refused
      await html5QrScanner.start(
        { facingMode: "environment" },
        qrConfig,
        onQrCodeSuccess,
        () => {}
      );
    }

  } catch (err) {
    console.error('Camera init error:', err);
    showToast('تعذر فتح الكاميرا الخلفية: ' + (err.message || err), 'error');
  }
}

function onQrCodeSuccess(decodedText) {
  playAudioTone(true);
  toggleCameraScannerModal();
  const codeInput = document.getElementById('quickBarcodeInput');
  if (codeInput) {
    codeInput.value = normalizeClientCode(decodedText);
    handleQuickCheckIn(new Event('submit'));
  }
}

// Flip between rear and front camera
async function switchCameraFlip() {
  if (availableCameras.length > 1) {
    currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
    const nextCam = availableCameras[currentCameraIndex];
    await startCameraScanner(nextCam.id);
  } else {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    if (html5QrScanner) {
      try { await html5QrScanner.stop(); } catch (e) {}
    }
    updateCameraBadge();
    html5QrScanner.start(
      { facingMode: currentFacingMode },
      { fps: 15, qrbox: { width: 240, height: 240 } },
      onQrCodeSuccess,
      () => {}
    );
  }
}

async function switchCameraDevice(deviceId) {
  if (deviceId) {
    await startCameraScanner(deviceId);
  }
}

function updateCameraBadge() {
  const badge = document.getElementById('cameraActiveTypeBadge');
  if (!badge) return;

  const selectEl = document.getElementById('cameraDeviceSelect');
  const selectedText = selectEl && selectEl.options[selectEl.selectedIndex] ? selectEl.options[selectEl.selectedIndex].text : '';

  if (selectedText.includes('أمامية') || currentFacingMode === 'user') {
    badge.className = 'text-[10px] text-amber-700 font-bold bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full';
    badge.innerText = '🤳 الكاميرا الأمامية';
  } else {
    badge.className = 'text-[10px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full';
    badge.innerText = '📸 الكاميرا الخلفية (الأساسية)';
  }
}

function stopCameraScanner() {
  if (html5QrScanner) {
    try {
      html5QrScanner.stop();
      html5QrScanner.clear();
    } catch (e) {}
    html5QrScanner = null;
  }
}


// ==========================================
// 16. ADMIN DASHBOARD & CHAT CENTER LOGIC
// ==========================================
let allAdminTeachers = [];
let selectedChatTeacherId = null;

function switchAdminSection(secId) {
  ['overview', 'teachers', 'chat'].forEach(s => {
    const sec = document.getElementById(`adminSec-${s}`);
    const btn = document.getElementById(`adminSecBtn-${s}`);
    if (sec) {
      if (s === secId) sec.classList.remove('hidden');
      else sec.classList.add('hidden');
    }
    if (btn) {
      if (s === secId) {
        btn.classList.add('bg-white/10', 'text-white');
        btn.classList.remove('text-slate-300');
      } else {
        btn.classList.remove('bg-white/10', 'text-white');
        btn.classList.add('text-slate-300');
      }
    }
  });

  if (secId === 'overview') loadAdminDashboard();
  if (secId === 'teachers') loadAdminTeachers();
  if (secId === 'chat') loadAdminConversations();
}

async function loadAdminDashboard() {
  try {
    const res = await apiFetch('/api/admin/overview');
    if (res.success && res.data) {
      const d = res.data;
      if (document.getElementById('adminStatTeachers')) document.getElementById('adminStatTeachers').innerText = d.totalTeachers;
      if (document.getElementById('adminStatActiveTeachers')) document.getElementById('adminStatActiveTeachers').innerText = d.activeTeachers;
      if (document.getElementById('adminStatBlockedTeachers')) document.getElementById('adminStatBlockedTeachers').innerText = d.blockedTeachers;
      if (document.getElementById('adminStatStudents')) document.getElementById('adminStatStudents').innerText = d.totalStudents;
      if (document.getElementById('adminStatTotalVolume')) document.getElementById('adminStatTotalVolume').innerText = `${d.totalPlatformVolume} ج.م`;
      if (document.getElementById('adminStatProfit')) document.getElementById('adminStatProfit').innerText = `${d.platformProfit} ج.م`;
    }
  } catch (err) {
    console.error('Error loading admin overview:', err);
  }
}

async function loadAdminTeachers() {
  try {
    const res = await apiFetch('/api/admin/teachers');
    if (res.success) {
      allAdminTeachers = res.data || [];
      renderAdminTeachersTable(allAdminTeachers);
    }
  } catch (err) {
    console.error('Error loading teachers:', err);
  }
}

function renderAdminTeachersTable(teachers) {
  const tbody = document.getElementById('adminTeachersTableBody');
  if (!tbody) return;

  if (teachers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-10 text-slate-400">لا يوجد مدرسين مسجلين بعد في الموقع</td></tr>';
    return;
  }

  tbody.innerHTML = teachers.map(t => {
    const isBlocked = t.status === 'blocked';
    const statusBadge = isBlocked
      ? '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-black bg-rose-100 text-rose-800">موقوف</span>'
      : '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-800">نشط</span>';

    return `
      <tr class="hover:bg-slate-50 transition border-b border-slate-100 ${isBlocked ? 'bg-rose-50/20' : ''}">
        <td class="px-4 py-3.5">
          <div class="font-extrabold text-slate-800">${t.name}</div>
          <span class="text-[10px] text-slate-400">انضم: ${t.created_at ? t.created_at.split(' ')[0] : '--'}</span>
        </td>
        <td class="px-4 py-3.5 font-mono text-xs font-bold text-slate-700" dir="ltr">${t.phone}</td>
        <td class="px-4 py-3.5 text-xs text-slate-600">${t.subject || 'عام'} ${t.center_name ? ' | ' + t.center_name : ''}</td>
        <td class="px-4 py-3.5 text-center font-bold text-xs text-slate-700">${t.groups_count || 0}</td>
        <td class="px-4 py-3.5 text-center font-bold text-xs text-brand-600">${t.students_count || 0}</td>
        <td class="px-4 py-3.5 text-center font-black text-xs text-indigo-700">${t.total_collected || 0} ج.م</td>
        <td class="px-4 py-3.5 text-center">${statusBadge}</td>
        <td class="px-4 py-3.5 text-center">
          <div class="inline-flex items-center gap-1.5">
            <button onclick="toggleTeacherStatus(${t.id})" class="px-3 py-1.5 rounded-xl text-xs font-bold transition ${isBlocked ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'}">
              <i class="fa-solid ${isBlocked ? 'fa-play' : 'fa-ban'} ml-1"></i>
              <span>${isBlocked ? 'تفعيل الحساب' : 'إيقاف الحساب'}</span>
            </button>
            <button onclick="openChatWithTeacher(${t.id}, '${t.name}', '${t.subject || ''}')" class="px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition flex items-center gap-1">
              <i class="fa-solid fa-comments"></i>
              <span>شات</span>
            </button>
            <button onclick="deleteTeacher(${t.id})" class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-rose-100 hover:text-rose-700 text-slate-400 flex items-center justify-center transition" title="حذف الحساب نهائياً">
              <i class="fa-solid fa-trash text-xs"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterAdminTeachers() {
  const query = (document.getElementById('adminTeacherSearchInput').value || '').toLowerCase().trim();
  const filtered = allAdminTeachers.filter(t => {
    return t.name.toLowerCase().includes(query) || (t.phone && t.phone.includes(query)) || (t.subject && t.subject.toLowerCase().includes(query));
  });
  renderAdminTeachersTable(filtered);
}

async function toggleTeacherStatus(teacherId) {
  try {
    const res = await apiFetch(`/api/admin/teachers/${teacherId}/toggle-status`, { method: 'PUT' });
    if (res.success) {
      showToast(res.message, 'success');
      await loadAdminTeachers();
      await loadAdminDashboard();
    } else {
      showToast(res.error || 'فشل تعديل حالة الحساب', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteTeacher(teacherId) {
  if (!confirm('تحذير: هل أنت متأكد من حذف حساب هذا المدرس نهائياً مع كافة طلابه ومجموعاته؟ لا يمكن التراجع عن هذا الإجراء.')) return;
  try {
    const res = await apiFetch(`/api/admin/teachers/${teacherId}`, { method: 'DELETE' });
    if (res.success) {
      showToast(res.message, 'success');
      await loadAdminTeachers();
      await loadAdminDashboard();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Admin Chat Center
async function loadAdminConversations() {
  try {
    const res = await apiFetch('/api/chat/conversations');
    const container = document.getElementById('adminConversationsList');
    if (!container) return;

    if (!res.success || !res.data || res.data.length === 0) {
      container.innerHTML = '<div class="p-6 text-center text-slate-400 text-xs">لا يوجد مدرسين لبدء المحادثة</div>';
      return;
    }

    container.innerHTML = res.data.map(t => {
      const isSelected = selectedChatTeacherId === t.id;
      return `
        <div onclick="openChatWithTeacher(${t.id}, '${t.name}', '${t.subject || ''}')" class="p-3.5 cursor-pointer hover:bg-slate-100 transition ${isSelected ? 'bg-indigo-50/80 border-r-4 border-indigo-600' : ''}">
          <div class="flex items-center justify-between">
            <h5 class="text-xs font-black text-slate-800 truncate">${t.name}</h5>
            ${t.unread_count > 0 ? `<span class="px-1.5 py-0.2 bg-rose-500 text-white rounded-full text-[10px] font-bold">${t.unread_count}</span>` : ''}
          </div>
          <p class="text-[11px] text-slate-500 truncate mt-0.5">${t.last_message || 'اضغط لبدء الشات...'}</p>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading conversations:', err);
  }
}

async function openChatWithTeacher(teacherId, teacherName, teacherSubject) {
  selectedChatTeacherId = teacherId;
  switchAdminSection('chat');

  document.getElementById('adminChatTeacherName').innerText = teacherName;
  document.getElementById('adminChatTeacherSub').innerText = `مادة: ${teacherSubject || 'عام'} | شات مباشر`;
  document.getElementById('adminMessageInput').disabled = false;
  document.getElementById('adminMessageSendBtn').disabled = false;
  document.getElementById('adminMessageInput').focus();

  await loadAdminChatMessages(teacherId);
  loadAdminConversations();
}

async function loadAdminChatMessages(teacherId) {
  if (!teacherId) return;
  try {
    const res = await apiFetch(`/api/chat/messages?teacher_id=${teacherId}`);
    const container = document.getElementById('adminChatMessagesList');
    if (!container) return;

    if (!res.success || !res.data || res.data.length === 0) {
      container.innerHTML = '<div class="h-full flex items-center justify-center text-slate-400 text-xs">لا توجد رسائل سابقة مع هذا المدرس. اكتب رسالتك بالأسفل للتواصل معه.</div>';
      return;
    }

    container.innerHTML = res.data.map(m => {
      const isAdmin = m.sender_role === 'admin';
      return `
        <div class="flex ${isAdmin ? 'justify-start' : 'justify-end'}">
          <div class="max-w-md rounded-2xl px-4 py-2.5 shadow-sm text-xs ${isAdmin ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none'}">
            <p class="text-[10px] ${isAdmin ? 'text-indigo-200' : 'text-slate-400'} font-bold mb-0.5">${m.sender_name}</p>
            <p class="font-medium leading-relaxed">${m.message}</p>
            <span class="text-[9px] block text-left mt-1 ${isAdmin ? 'text-indigo-300' : 'text-slate-400'} font-mono">${m.created_at ? m.created_at.split(' ')[1] : ''}</span>
          </div>
        </div>
      `;
    }).join('');

    container.scrollTop = container.scrollHeight;
  } catch (err) {
    console.error('Error loading chat messages:', err);
  }
}

async function sendAdminMessage(event) {
  event.preventDefault();
  if (!selectedChatTeacherId) return;

  const input = document.getElementById('adminMessageInput');
  const message = input.value.trim();
  if (!message) return;

  try {
    const res = await apiFetch('/api/chat/messages', {
      method: 'POST',
      body: JSON.stringify({ message, receiver_id: selectedChatTeacherId })
    });

    if (res.success) {
      input.value = '';
      await loadAdminChatMessages(selectedChatTeacherId);
      loadAdminConversations();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function refreshAdminCurrentChat() {
  if (selectedChatTeacherId) {
    loadAdminChatMessages(selectedChatTeacherId);
    loadAdminConversations();
    showToast('تم تحديث المحادثة', 'info');
  }
}

async function checkAdminChatBadge() {
  try {
    const res = await apiFetch('/api/chat/unread-count');
    const badge = document.getElementById('adminChatTotalBadge');
    if (badge && res.success) {
      if (res.unread_count > 0) {
        badge.innerText = res.unread_count;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
    if (selectedChatTeacherId && !document.getElementById('adminSec-chat').classList.contains('hidden')) {
      loadAdminChatMessages(selectedChatTeacherId);
    }
  } catch (e) {}
}

// Teacher Side Chat Logic
async function loadTeacherMessages() {
  try {
    const res = await apiFetch('/api/chat/messages');
    const container = document.getElementById('teacherChatMessagesList');
    if (!container) return;

    if (!res.success || !res.data || res.data.length === 0) {
      container.innerHTML = '<div class="h-full flex items-center justify-center text-slate-400 text-xs">لا توجد رسائل سابقة. يمكنك إرسال أي استفسار أو طلب للإدارة وسيتم الرد عليك فوراً.</div>';
      return;
    }

    container.innerHTML = res.data.map(m => {
      const isTeacher = m.sender_role !== 'admin';
      return `
        <div class="flex ${isTeacher ? 'justify-start' : 'justify-end'}">
          <div class="max-w-md rounded-2xl px-4 py-2.5 shadow-sm text-xs ${isTeacher ? 'bg-brand-600 text-white rounded-br-none' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none'}">
            <p class="text-[10px] ${isTeacher ? 'text-emerald-200' : 'text-indigo-600'} font-bold mb-0.5">${m.sender_name}</p>
            <p class="font-medium leading-relaxed">${m.message}</p>
            <span class="text-[9px] block text-left mt-1 ${isTeacher ? 'text-emerald-200' : 'text-slate-400'} font-mono">${m.created_at ? m.created_at.split(' ')[1] : ''}</span>
          </div>
        </div>
      `;
    }).join('');

    container.scrollTop = container.scrollHeight;
  } catch (err) {
    console.error('Error loading teacher messages:', err);
  }
}

async function sendTeacherMessage(event) {
  event.preventDefault();
  const input = document.getElementById('teacherMessageInput');
  const message = input.value.trim();
  if (!message) return;

  try {
    const res = await apiFetch('/api/chat/messages', {
      method: 'POST',
      body: JSON.stringify({ message })
    });

    if (res.success) {
      input.value = '';
      await loadTeacherMessages();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function checkTeacherChatBadge() {
  try {
    const res = await apiFetch('/api/chat/unread-count');
    const badge = document.getElementById('teacherChatBadge');
    if (badge && res.success) {
      if (res.unread_count > 0) {
        badge.innerText = res.unread_count;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
    const chatTab = document.getElementById('tab-chat');
    if (chatTab && !chatTab.classList.contains('hidden')) {
      loadTeacherMessages();
    }
  } catch (e) {}
}
