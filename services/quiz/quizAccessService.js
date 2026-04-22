const db = require('../../config/db');

class QuizAccessService {
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

  async getSessionRow(moduleId, sessionId) {
    const [rows] = await db.query(
      'SELECT id, module_id, open_at FROM module_sessions WHERE id = ? AND module_id = ? LIMIT 1',
      [sessionId, moduleId]
    );
    return rows[0] || null;
  }

  isSessionLockedForStudent(user, sessionRow) {
    if (!user || user.role !== 'student') return false;
    if (!sessionRow || !sessionRow.open_at) return false;
    return new Date(sessionRow.open_at) > new Date();
  }

  async assertStudentCanAccessQuiz(req, moduleId, sessionId) {
    if (req.user.role !== 'student') {
      const error = new Error('Endpoint ini hanya untuk student');
      error.status = 403;
      throw error;
    }

    const readable = await this.canReadModule(req.user, moduleId);
    if (!readable) {
      const error = new Error('Tidak memiliki akses ke module ini');
      error.status = 403;
      throw error;
    }

    const sessionRow = await this.getSessionRow(moduleId, sessionId);
    if (!sessionRow) {
      const error = new Error('Sesi tidak ditemukan pada module ini');
      error.status = 404;
      throw error;
    }

    if (this.isSessionLockedForStudent(req.user, sessionRow)) {
      const error = new Error('Sesi ini belum dibuka sesuai jadwal');
      error.status = 403;
      throw error;
    }

    return sessionRow;
  }
}

module.exports = {
  quizAccessService: new QuizAccessService()
};
