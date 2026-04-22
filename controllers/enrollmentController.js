const db = require('../config/db');
const { buildListResponse } = require('../utils/listResponse');

const enrollByKey = async (req, res) => {
  const { enroll_key } = req.body || {};

  if (req.user.role !== 'student') {
    return res.status(403).json({ success: false, message: 'Hanya student yang dapat melakukan enroll module' });
  }

  if (!enroll_key || !String(enroll_key).trim()) {
    return res.status(400).json({ success: false, message: 'enroll_key wajib diisi' });
  }

  try {
    const [moduleRows] = await db.query(
      'SELECT id, name, teacher_id, enroll_key FROM modules WHERE enroll_key = ?',
      [String(enroll_key).trim().toUpperCase()]
    );

    if (moduleRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Enroll key tidak ditemukan' });
    }

    const targetModule = moduleRows[0];

    const [existingRows] = await db.query(
      'SELECT id FROM module_enrollments WHERE module_id = ? AND user_id = ?',
      [targetModule.id, req.user.id]
    );

    if (existingRows.length > 0) {
      return res.status(409).json({ success: false, message: 'User sudah enroll pada module ini' });
    }

    await db.query('INSERT INTO module_enrollments (module_id, user_id) VALUES (?, ?)', [targetModule.id, req.user.id]);

    return res.status(201).json({
      success: true,
      message: 'Enroll berhasil',
      data: {
        module_id: targetModule.id,
        module_name: targetModule.name
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal enroll module', error: error.message });
  }
};

const myEnrollments = async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ success: false, message: 'Endpoint ini hanya untuk student' });
  }

  try {
    const [rows] = await db.query(
      `SELECT m.id, m.name, m.description, m.banner_image_path, me.enrolled_at,
        u.name AS teacher_name
       FROM module_enrollments me
       JOIN modules m ON m.id = me.module_id
       JOIN users u ON u.id = m.teacher_id
       WHERE me.user_id = ?
       ORDER BY me.enrolled_at DESC`,
      [req.user.id]
    );

    const mapped = rows.map((row) => ({
      ...row,
      capabilities: {
        can_view: true,
        can_unenroll: false
      }
    }));

    const list = buildListResponse(mapped, req.query);
    return res.json({ success: true, data: list.data, meta: list.meta });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil enrollment', error: error.message });
  }
};

module.exports = {
  enrollByKey,
  myEnrollments
};
