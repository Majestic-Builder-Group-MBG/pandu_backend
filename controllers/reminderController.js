const db = require('../config/db');
const { buildListResponse } = require('../utils/listResponse');

const toBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const getSessionReminder = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);

  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Endpoint reminder sesi hanya untuk student' });
    }

    const [sessionRows] = await db.query(
      `SELECT ms.id, ms.module_id
       FROM module_sessions ms
       JOIN module_enrollments me ON me.module_id = ms.module_id AND me.user_id = ?
       WHERE ms.id = ? AND ms.module_id = ?
       LIMIT 1`,
      [req.user.id, sessionId, moduleId]
    );

    if (sessionRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan atau tidak dapat diakses' });
    }

    const [rows] = await db.query(
      `SELECT id, module_id, session_id, user_id, enabled, channel, notify_before_minutes, created_at, updated_at
       FROM session_reminders
       WHERE module_id = ? AND session_id = ? AND user_id = ?
       LIMIT 1`,
      [moduleId, sessionId, req.user.id]
    );

    if (rows.length === 0) {
      return res.json({
        success: true,
        data: {
          module_id: moduleId,
          session_id: sessionId,
          user_id: req.user.id,
          enabled: false,
          channel: 'in_app',
          notify_before_minutes: null,
          capabilities: {
            can_view: true,
            can_edit: true,
            can_delete: false
          }
        }
      });
    }

    return res.json({
      success: true,
      data: {
        ...rows[0],
        capabilities: {
          can_view: true,
          can_edit: true,
          can_delete: true
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil reminder sesi', error: error.message });
  }
};

const upsertSessionReminder = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const body = req.body || {};

  const hasEnabled = Object.prototype.hasOwnProperty.call(body, 'enabled');
  const hasChannel = Object.prototype.hasOwnProperty.call(body, 'channel');
  const hasNotifyBefore = Object.prototype.hasOwnProperty.call(body, 'notify_before_minutes');

  if (!hasEnabled && !hasChannel && !hasNotifyBefore) {
    return res.status(400).json({
      success: false,
      message: 'Minimal kirim salah satu field: enabled, channel, notify_before_minutes'
    });
  }

  const enabled = hasEnabled ? toBoolean(body.enabled) : true;
  const channel = hasChannel ? String(body.channel || '').trim().toLowerCase() : 'in_app';

  if (!['in_app'].includes(channel)) {
    return res.status(400).json({ success: false, message: 'channel reminder saat ini hanya mendukung in_app' });
  }

  let notifyBeforeMinutes = null;
  if (hasNotifyBefore) {
    if (body.notify_before_minutes === null || body.notify_before_minutes === '') {
      notifyBeforeMinutes = null;
    } else {
      const parsed = Number(body.notify_before_minutes);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10080) {
        return res.status(400).json({ success: false, message: 'notify_before_minutes harus angka bulat antara 0 sampai 10080' });
      }
      notifyBeforeMinutes = parsed;
    }
  }

  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Endpoint reminder sesi hanya untuk student' });
    }

    const [sessionRows] = await db.query(
      `SELECT ms.id, ms.module_id
       FROM module_sessions ms
       JOIN module_enrollments me ON me.module_id = ms.module_id AND me.user_id = ?
       WHERE ms.id = ? AND ms.module_id = ?
       LIMIT 1`,
      [req.user.id, sessionId, moduleId]
    );

    if (sessionRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan atau tidak dapat diakses' });
    }

    const [existingRows] = await db.query(
      `SELECT id, enabled, channel, notify_before_minutes
       FROM session_reminders
       WHERE module_id = ? AND session_id = ? AND user_id = ?
       LIMIT 1`,
      [moduleId, sessionId, req.user.id]
    );

    if (existingRows.length > 0) {
      const existing = existingRows[0];
      const nextEnabled = hasEnabled ? enabled : Boolean(existing.enabled);
      const nextChannel = hasChannel ? channel : existing.channel;
      const nextNotifyBefore = hasNotifyBefore ? notifyBeforeMinutes : existing.notify_before_minutes;

      await db.query(
        `UPDATE session_reminders
         SET enabled = ?, channel = ?, notify_before_minutes = ?
         WHERE id = ?`,
        [nextEnabled ? 1 : 0, nextChannel, nextNotifyBefore, existing.id]
      );
    } else {
      await db.query(
        `INSERT INTO session_reminders
         (module_id, session_id, user_id, enabled, channel, notify_before_minutes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [moduleId, sessionId, req.user.id, enabled ? 1 : 0, channel, hasNotifyBefore ? notifyBeforeMinutes : null]
      );
    }

    const [rows] = await db.query(
      `SELECT id, module_id, session_id, user_id, enabled, channel, notify_before_minutes, created_at, updated_at
       FROM session_reminders
       WHERE module_id = ? AND session_id = ? AND user_id = ?
       LIMIT 1`,
      [moduleId, sessionId, req.user.id]
    );

    return res.json({
      success: true,
      message: 'Reminder sesi berhasil disimpan',
      data: {
        ...rows[0],
        capabilities: {
          can_view: true,
          can_edit: true,
          can_delete: true
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal menyimpan reminder sesi', error: error.message });
  }
};

const deleteSessionReminder = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);

  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Endpoint reminder sesi hanya untuk student' });
    }

    const [rows] = await db.query(
      `SELECT id
       FROM session_reminders
       WHERE module_id = ? AND session_id = ? AND user_id = ?
       LIMIT 1`,
      [moduleId, sessionId, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Reminder sesi tidak ditemukan' });
    }

    await db.query('DELETE FROM session_reminders WHERE id = ?', [rows[0].id]);
    return res.json({ success: true, message: 'Reminder sesi berhasil dihapus' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal menghapus reminder sesi', error: error.message });
  }
};

const listMyReminders = async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Endpoint reminders/me hanya untuk student' });
    }

    const [rows] = await db.query(
      `SELECT sr.id, sr.module_id, sr.session_id, sr.user_id, sr.enabled, sr.channel, sr.notify_before_minutes,
         sr.created_at, sr.updated_at,
         ms.title AS session_title, ms.open_at,
         m.name AS module_name,
         sq.id AS quiz_id, sq.is_published AS quiz_is_published
       FROM session_reminders sr
       JOIN module_sessions ms ON ms.id = sr.session_id
       JOIN modules m ON m.id = sr.module_id
       LEFT JOIN session_quizzes sq ON sq.session_id = sr.session_id
       WHERE sr.user_id = ?
       ORDER BY ms.open_at ASC, sr.updated_at DESC`,
      [req.user.id]
    );

    const mapped = rows.map((row) => ({
      ...row,
      quiz: {
        exists: Boolean(row.quiz_id),
        is_published: row.quiz_id ? Boolean(row.quiz_is_published) : false
      },
      capabilities: {
        can_view: true,
        can_edit: true,
        can_delete: true
      }
    }));

    const list = buildListResponse(mapped, req.query);
    return res.json({ success: true, data: list.data, meta: list.meta });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil daftar reminder user', error: error.message });
  }
};

module.exports = {
  getSessionReminder,
  upsertSessionReminder,
  deleteSessionReminder,
  listMyReminders
};
