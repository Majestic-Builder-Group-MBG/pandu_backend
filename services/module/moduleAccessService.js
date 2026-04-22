const db = require('../../config/db');

class ModuleAccessService {
  async canManageModule(user, moduleId) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.role !== 'teacher') return false;

    const [rows] = await db.query('SELECT id FROM modules WHERE id = ? AND teacher_id = ?', [moduleId, user.id]);
    return rows.length > 0;
  }

  async canReadModule(user, moduleId) {
    if (!user) return false;
    if (user.role === 'admin') return true;

    if (user.role === 'teacher') {
      const [rows] = await db.query('SELECT id FROM modules WHERE id = ? AND teacher_id = ?', [moduleId, user.id]);
      return rows.length > 0;
    }

    const [rows] = await db.query(
      'SELECT id FROM module_enrollments WHERE module_id = ? AND user_id = ?',
      [moduleId, user.id]
    );
    return rows.length > 0;
  }

  async getSessionByModule(moduleId, sessionId) {
    const [rows] = await db.query(
      'SELECT id, module_id, open_at FROM module_sessions WHERE id = ? AND module_id = ? LIMIT 1',
      [sessionId, moduleId]
    );

    return rows[0] || null;
  }

  isSessionLockedForStudent(user, sessionRow) {
    if (!user || user.role !== 'student') {
      return false;
    }

    if (!sessionRow || !sessionRow.open_at) {
      return false;
    }

    return new Date(sessionRow.open_at) > new Date();
  }
}

module.exports = {
  moduleAccessService: new ModuleAccessService()
};
