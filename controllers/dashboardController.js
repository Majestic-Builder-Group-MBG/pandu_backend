const db = require('../config/db');
const { buildListResponse } = require('../utils/listResponse');

const getUpcomingSessions = async (req, res) => {
  try {
    const role = req.user.role;
    let rows = [];

    if (role === 'admin') {
      [rows] = await db.query(
        `SELECT ms.id AS session_id, ms.module_id, ms.title AS session_title, ms.open_at,
           m.name AS module_name, m.teacher_id, u.name AS teacher_name,
           sq.id AS quiz_id, sq.is_published AS quiz_is_published
         FROM module_sessions ms
         JOIN modules m ON m.id = ms.module_id
         JOIN users u ON u.id = m.teacher_id
         LEFT JOIN session_quizzes sq ON sq.session_id = ms.id
         WHERE ms.open_at IS NOT NULL AND ms.open_at >= NOW()
         ORDER BY ms.open_at ASC, ms.id ASC`
      );
    } else if (role === 'teacher') {
      [rows] = await db.query(
        `SELECT ms.id AS session_id, ms.module_id, ms.title AS session_title, ms.open_at,
           m.name AS module_name, m.teacher_id, u.name AS teacher_name,
           sq.id AS quiz_id, sq.is_published AS quiz_is_published
         FROM module_sessions ms
         JOIN modules m ON m.id = ms.module_id
         JOIN users u ON u.id = m.teacher_id
         LEFT JOIN session_quizzes sq ON sq.session_id = ms.id
         WHERE m.teacher_id = ?
           AND ms.open_at IS NOT NULL
           AND ms.open_at >= NOW()
         ORDER BY ms.open_at ASC, ms.id ASC`,
        [req.user.id]
      );
    } else {
      [rows] = await db.query(
        `SELECT ms.id AS session_id, ms.module_id, ms.title AS session_title, ms.open_at,
           m.name AS module_name, m.teacher_id, u.name AS teacher_name,
           sq.id AS quiz_id, sq.is_published AS quiz_is_published
         FROM module_enrollments me
         JOIN modules m ON m.id = me.module_id
         JOIN users u ON u.id = m.teacher_id
         JOIN module_sessions ms ON ms.module_id = m.id
         LEFT JOIN session_quizzes sq ON sq.session_id = ms.id
         WHERE me.user_id = ?
           AND ms.open_at IS NOT NULL
           AND ms.open_at >= NOW()
         ORDER BY ms.open_at ASC, ms.id ASC`,
        [req.user.id]
      );
    }

    const mapped = rows.map((row) => {
      const isTeacherOwner = role === 'teacher' && Number(row.teacher_id) === Number(req.user.id);
      const canManage = role === 'admin' || isTeacherOwner;

      return {
        session_id: row.session_id,
        module_id: row.module_id,
        module_name: row.module_name,
        teacher_name: row.teacher_name,
        title: row.session_title,
        open_at: row.open_at,
        quiz: {
          exists: Boolean(row.quiz_id),
          is_published: row.quiz_id ? Boolean(row.quiz_is_published) : false
        },
        capabilities: {
          can_view: true,
          can_edit: canManage,
          can_delete: canManage,
          can_manage_schedule: canManage,
          can_manage_quiz: canManage
        }
      };
    });

    const list = buildListResponse(mapped, req.query);
    return res.json({ success: true, data: list.data, meta: list.meta });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil upcoming sessions dashboard',
      error: error.message
    });
  }
};

module.exports = {
  getUpcomingSessions
};
