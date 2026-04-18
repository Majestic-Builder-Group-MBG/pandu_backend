const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/db');
const { sessionContentViewTokenService } = require('../services/sessionContentViewTokenService');

const storageRoot = path.join(__dirname, '..', 'storage');

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const removeFileSafe = (filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
};

const moduleFolder = (moduleId) => path.join(storageRoot, 'modules', String(moduleId));
const sessionFolder = (moduleId, sessionId) => path.join(moduleFolder(moduleId), 'sessions', String(sessionId));

const generateEnrollKey = () => crypto.randomBytes(6).toString('hex').toUpperCase();

const moveTempFileTo = (tempPath, targetDir) => {
  ensureDir(targetDir);
  const fileName = path.basename(tempPath);
  const finalPath = path.join(targetDir, fileName);
  fs.renameSync(tempPath, finalPath);
  return finalPath;
};

const toRelativeStoragePath = (absPath) => path.relative(path.join(__dirname, '..'), absPath).replace(/\\/g, '/');
const attachModuleBannerUrl = (moduleRow) => ({
  ...moduleRow,
  banner_download_url: moduleRow && moduleRow.banner_image_path
    ? `/api/modules/${moduleRow.id}/banner`
    : null
});

const canManageModule = async (user, moduleId) => {
  if (user.role === 'admin') return true;
  if (user.role !== 'teacher') return false;

  const [rows] = await db.query('SELECT id FROM modules WHERE id = ? AND teacher_id = ?', [moduleId, user.id]);
  return rows.length > 0;
};

const canReadModule = async (user, moduleId) => {
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
};

const getSessionByModule = async (moduleId, sessionId) => {
  const [rows] = await db.query(
    'SELECT id, module_id, open_at FROM module_sessions WHERE id = ? AND module_id = ? LIMIT 1',
    [sessionId, moduleId]
  );

  return rows[0] || null;
};

const isSessionLockedForStudent = (user, sessionRow) => {
  if (!user || user.role !== 'student') {
    return false;
  }

  if (!sessionRow || !sessionRow.open_at) {
    return false;
  }

  return new Date(sessionRow.open_at) > new Date();
};

const getSessionContentFileByIds = async (moduleId, sessionId, contentId) => {
  const [rows] = await db.query(
    `SELECT sc.id, sc.file_path, sc.mime_type, ms.open_at
     FROM session_contents sc
     JOIN module_sessions ms ON ms.id = sc.session_id
     WHERE sc.id = ? AND sc.session_id = ? AND ms.module_id = ? AND sc.content_type = 'file'`,
    [contentId, sessionId, moduleId]
  );

  return rows[0] || null;
};

const isDirectPublicViewAllowed = (mimeType) => {
  const normalizedMimeType = String(mimeType || '').toLowerCase();
  if (!normalizedMimeType) {
    return false;
  }

  if (normalizedMimeType.startsWith('image/')) {
    return false;
  }

  if (normalizedMimeType.startsWith('video/')) {
    return false;
  }

  return true;
};

const getFileKind = (mimeType) => {
  const normalizedMimeType = String(mimeType || '').toLowerCase();

  if (!normalizedMimeType) {
    return null;
  }

  if (normalizedMimeType.startsWith('image/')) {
    return 'image';
  }

  if (normalizedMimeType.startsWith('video/')) {
    return 'video';
  }

  if (normalizedMimeType === 'application/pdf') {
    return 'document';
  }

  return 'other';
};

const buildSessionContentResponse = (contentRow, moduleId, sessionId) => {
  const fileDownloadUrl = contentRow && contentRow.file_path
    ? `/api/modules/${moduleId}/sessions/${sessionId}/contents/${contentRow.id}/file`
    : null;

  const fileKind = contentRow && contentRow.content_type === 'file'
    ? getFileKind(contentRow.mime_type)
    : null;

  const isMedia = fileKind === 'image' || fileKind === 'video';
  const isPublicViewSupported = Boolean(contentRow && contentRow.content_type === 'file' && isDirectPublicViewAllowed(contentRow.mime_type));

  return {
    ...contentRow,
    file_download_url: fileDownloadUrl,
    file_kind: fileKind,
    is_media: isMedia,
    is_public_view_supported: isPublicViewSupported,
    should_use_public_view_url: isPublicViewSupported
  };
};

const createModule = async (req, res) => {
  const { name, description = null } = req.body;

  if (!name || !String(name).trim()) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(400).json({ success: false, message: 'Nama module wajib diisi' });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    let enrollKey = generateEnrollKey();
    let tries = 0;
    while (tries < 5) {
      const [keyExists] = await connection.query('SELECT id FROM modules WHERE enroll_key = ?', [enrollKey]);
      if (keyExists.length === 0) break;
      enrollKey = generateEnrollKey();
      tries += 1;
    }

    const [moduleResult] = await connection.query(
      'INSERT INTO modules (teacher_id, name, description, enroll_key) VALUES (?, ?, ?, ?)',
      [req.user.id, String(name).trim(), description ? String(description).trim() : null, enrollKey]
    );

    const moduleId = moduleResult.insertId;
    const defaultSessions = ['Sesi 1', 'Sesi 2', 'Sesi 3'];

    for (let i = 0; i < defaultSessions.length; i += 1) {
      await connection.query(
        'INSERT INTO module_sessions (module_id, title, sort_order) VALUES (?, ?, ?)',
        [moduleId, defaultSessions[i], i + 1]
      );
    }

    let bannerPath = null;
    if (req.file) {
      const movedPath = moveTempFileTo(req.file.path, path.join(moduleFolder(moduleId), 'banner'));
      bannerPath = toRelativeStoragePath(movedPath);
      await connection.query('UPDATE modules SET banner_image_path = ? WHERE id = ?', [bannerPath, moduleId]);
    }

    await connection.commit();

    const [rows] = await connection.query(
      `SELECT m.id, m.teacher_id, m.name, m.description, m.banner_image_path, m.enroll_key, m.created_at,
        u.name AS teacher_name
       FROM modules m
       JOIN users u ON u.id = m.teacher_id
       WHERE m.id = ?`,
      [moduleId]
    );

    return res.status(201).json({
      success: true,
      message: 'Module berhasil dibuat dengan 3 sesi default',
      data: attachModuleBannerUrl(rows[0])
    });
  } catch (error) {
    await connection.rollback();
    if (req.file) removeFileSafe(req.file.path);
    return res.status(500).json({
      success: false,
      message: 'Gagal membuat module',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

const getModules = async (req, res) => {
  try {
    let rows = [];

    if (req.user.role === 'admin') {
      [rows] = await db.query(
        `SELECT m.id, m.name, m.description, m.banner_image_path, m.enroll_key, m.teacher_id,
          u.name AS teacher_name, m.created_at, m.updated_at
         FROM modules m
         JOIN users u ON u.id = m.teacher_id
         ORDER BY m.created_at DESC`
      );
    } else if (req.user.role === 'teacher') {
      [rows] = await db.query(
        `SELECT m.id, m.name, m.description, m.banner_image_path, m.enroll_key, m.teacher_id,
          u.name AS teacher_name, m.created_at, m.updated_at
         FROM modules m
         JOIN users u ON u.id = m.teacher_id
         WHERE m.teacher_id = ?
         ORDER BY m.created_at DESC`,
        [req.user.id]
      );
    } else {
      [rows] = await db.query(
        `SELECT m.id, m.name, m.description, m.banner_image_path, m.teacher_id,
          u.name AS teacher_name, me.enrolled_at, m.created_at, m.updated_at
         FROM module_enrollments me
         JOIN modules m ON m.id = me.module_id
         JOIN users u ON u.id = m.teacher_id
         WHERE me.user_id = ?
         ORDER BY me.enrolled_at DESC`,
        [req.user.id]
      );
    }

    const mappedRows = rows.map((row) => attachModuleBannerUrl(row));
    return res.json({ success: true, data: mappedRows });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil daftar module', error: error.message });
  }
};

const getModuleById = async (req, res) => {
  const moduleId = Number(req.params.moduleId);

  try {
    const allowed = await canReadModule(req.user, moduleId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses ke module ini' });
    }

    const [moduleRows] = await db.query(
      `SELECT m.id, m.name, m.description, m.banner_image_path, m.enroll_key, m.teacher_id,
        u.name AS teacher_name, m.created_at, m.updated_at
       FROM modules m
       JOIN users u ON u.id = m.teacher_id
       WHERE m.id = ?`,
      [moduleId]
    );

    if (moduleRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Module tidak ditemukan' });
    }

    const [sessions] = await db.query(
      'SELECT id, title, sort_order, open_at, created_at, updated_at FROM module_sessions WHERE module_id = ? ORDER BY sort_order ASC, id ASC',
      [moduleId]
    );

    const data = { ...attachModuleBannerUrl(moduleRows[0]), sessions };
    if (req.user.role === 'student') {
      delete data.enroll_key;
    }

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil detail module', error: error.message });
  }
};

const updateModule = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const { name, description, enroll_key } = req.body;
  const hasDescription = Object.prototype.hasOwnProperty.call(req.body, 'description');
  const hasEnrollKey = Object.prototype.hasOwnProperty.call(req.body, 'enroll_key');

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses edit module ini' });
    }

    const [moduleRows] = await db.query('SELECT id, banner_image_path FROM modules WHERE id = ?', [moduleId]);
    if (moduleRows.length === 0) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(404).json({ success: false, message: 'Module tidak ditemukan' });
    }

    let nextBannerPath = moduleRows[0].banner_image_path;
    if (req.file) {
      const movedPath = moveTempFileTo(req.file.path, path.join(moduleFolder(moduleId), 'banner'));
      nextBannerPath = toRelativeStoragePath(movedPath);

      if (moduleRows[0].banner_image_path) {
        removeFileSafe(path.join(__dirname, '..', moduleRows[0].banner_image_path));
      }
    }

    const normalizedEnrollKey = hasEnrollKey
      ? String(enroll_key || '').trim().toUpperCase()
      : null;

    if (hasEnrollKey) {
      if (!normalizedEnrollKey) {
        if (req.file) removeFileSafe(req.file.path);
        return res.status(400).json({
          success: false,
          message: 'enroll_key tidak boleh kosong jika ingin diubah'
        });
      }

      if (!/^[A-Z0-9-]+$/.test(normalizedEnrollKey)) {
        if (req.file) removeFileSafe(req.file.path);
        return res.status(400).json({
          success: false,
          message: 'Format enroll_key tidak valid. Gunakan hanya huruf, angka, dan tanda minus (-)'
        });
      }

      if (normalizedEnrollKey.length > 64) {
        if (req.file) removeFileSafe(req.file.path);
        return res.status(400).json({
          success: false,
          message: 'enroll_key maksimal 64 karakter'
        });
      }

      const [existingEnrollKey] = await db.query(
        'SELECT id FROM modules WHERE enroll_key = ? AND id <> ? LIMIT 1',
        [normalizedEnrollKey, moduleId]
      );

      if (existingEnrollKey.length > 0) {
        if (req.file) removeFileSafe(req.file.path);
        return res.status(409).json({
          success: false,
          message: 'Enroll key tidak bisa digunakan, coba gunakan nama lain'
        });
      }
    }

    await db.query(
      `UPDATE modules
       SET name = COALESCE(?, name),
           description = CASE WHEN ? = 1 THEN ? ELSE description END,
           banner_image_path = ?,
           enroll_key = CASE WHEN ? = 1 THEN ? ELSE enroll_key END
       WHERE id = ?`,
      [
        name ? String(name).trim() : null,
        hasDescription ? 1 : 0,
        hasDescription ? (description ? String(description).trim() : null) : null,
        nextBannerPath,
        hasEnrollKey ? 1 : 0,
        hasEnrollKey ? normalizedEnrollKey : null,
        moduleId
      ]
    );

    const [updatedRows] = await db.query('SELECT * FROM modules WHERE id = ?', [moduleId]);

    return res.json({ success: true, message: 'Module berhasil diperbarui', data: attachModuleBannerUrl(updatedRows[0]) });
  } catch (error) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui module', error: error.message });
  }
};

const downloadModuleBanner = async (req, res) => {
  const moduleId = Number(req.params.moduleId);

  try {
    const allowed = await canReadModule(req.user, moduleId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses banner module ini' });
    }

    const [rows] = await db.query('SELECT id, banner_image_path FROM modules WHERE id = ?', [moduleId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Module tidak ditemukan' });
    }

    if (!rows[0].banner_image_path) {
      return res.status(404).json({ success: false, message: 'Banner module belum tersedia' });
    }

    const absolutePath = path.join(__dirname, '..', rows[0].banner_image_path);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ success: false, message: 'File banner tidak ditemukan di storage' });
    }

    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil banner module', error: error.message });
  }
};

const deleteModule = async (req, res) => {
  const moduleId = Number(req.params.moduleId);

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses hapus module ini' });
    }

    const [rows] = await db.query('SELECT id FROM modules WHERE id = ?', [moduleId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Module tidak ditemukan' });
    }

    await db.query('DELETE FROM modules WHERE id = ?', [moduleId]);
    fs.rmSync(moduleFolder(moduleId), { recursive: true, force: true });

    return res.json({ success: true, message: 'Module berhasil dihapus' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal menghapus module', error: error.message });
  }
};

const regenerateEnrollKey = async (req, res) => {
  const moduleId = Number(req.params.moduleId);

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses untuk generate key' });
    }

    const newKey = generateEnrollKey();
    await db.query('UPDATE modules SET enroll_key = ? WHERE id = ?', [newKey, moduleId]);

    return res.json({ success: true, message: 'Enroll key berhasil diperbarui', data: { enroll_key: newKey } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal regenerate enroll key', error: error.message });
  }
};

const getModuleSessions = async (req, res) => {
  const moduleId = Number(req.params.moduleId);

  try {
    const allowed = await canReadModule(req.user, moduleId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses ke sesi module ini' });
    }

    const [sessions] = await db.query(
      'SELECT id, module_id, title, sort_order, open_at, created_at, updated_at FROM module_sessions WHERE module_id = ? ORDER BY sort_order ASC, id ASC',
      [moduleId]
    );

    return res.json({ success: true, data: sessions });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil sesi module', error: error.message });
  }
};

const createSession = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const { title } = req.body || {};

  if (!title || !String(title).trim()) {
    return res.status(400).json({ success: false, message: 'Nama sesi wajib diisi' });
  }

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses menambah sesi' });
    }

    const [maxSortRows] = await db.query('SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM module_sessions WHERE module_id = ?', [moduleId]);
    const nextSortOrder = Number(maxSortRows[0].max_sort) + 1;

    const [result] = await db.query(
      'INSERT INTO module_sessions (module_id, title, sort_order) VALUES (?, ?, ?)',
      [moduleId, String(title).trim(), nextSortOrder]
    );

    const [rows] = await db.query('SELECT * FROM module_sessions WHERE id = ?', [result.insertId]);
    return res.status(201).json({ success: true, message: 'Sesi berhasil ditambahkan', data: rows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal menambah sesi', error: error.message });
  }
};

const updateSession = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const body = req.body || {};
  const { title, sort_order } = body;
  const hasSortOrder = Object.prototype.hasOwnProperty.call(body, 'sort_order');
  const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title');

  if (!hasTitle && !hasSortOrder) {
    return res.status(400).json({
      success: false,
      message: 'Minimal kirim salah satu field: title atau sort_order'
    });
  }

  if (hasSortOrder) {
    const normalizedSortOrder = Number(sort_order);
    if (!Number.isInteger(normalizedSortOrder) || normalizedSortOrder <= 0) {
      return res.status(400).json({
        success: false,
        message: 'sort_order harus berupa angka bulat lebih dari 0'
      });
    }
  }

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses update sesi' });
    }

    const [sessionRows] = await db.query('SELECT id FROM module_sessions WHERE id = ? AND module_id = ?', [sessionId, moduleId]);
    if (sessionRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan pada module ini' });
    }

    await db.query(
      `UPDATE module_sessions
       SET title = COALESCE(?, title),
           sort_order = CASE WHEN ? = 1 THEN ? ELSE sort_order END
       WHERE id = ?`,
      [
        title ? String(title).trim() : null,
        hasSortOrder ? 1 : 0,
        hasSortOrder ? Number(sort_order) : null,
        sessionId
      ]
    );

    const [updatedRows] = await db.query('SELECT * FROM module_sessions WHERE id = ?', [sessionId]);
    return res.json({ success: true, message: 'Sesi berhasil diperbarui', data: updatedRows[0] });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal update sesi', error: error.message });
  }
};

const getSessionSchedule = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);

  try {
    const allowed = await canReadModule(req.user, moduleId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses melihat jadwal sesi' });
    }

    const sessionRow = await getSessionByModule(moduleId, sessionId);
    if (!sessionRow) {
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan pada module ini' });
    }

    return res.json({
      success: true,
      data: {
        module_id: moduleId,
        session_id: sessionId,
        open_at: sessionRow.open_at
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil jadwal sesi', error: error.message });
  }
};

const updateSessionSchedule = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const body = req.body || {};
  const hasOpenAt = Object.prototype.hasOwnProperty.call(body, 'open_at');

  if (!hasOpenAt) {
    return res.status(400).json({
      success: false,
      message: 'Field open_at wajib dikirim. Gunakan null untuk menghapus jadwal'
    });
  }

  let normalizedOpenAt = null;
  if (body.open_at !== null) {
    const parsedDate = new Date(body.open_at);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Format open_at tidak valid. Gunakan format tanggal ISO-8601'
      });
    }
    normalizedOpenAt = parsedDate;
  }

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses mengatur jadwal sesi' });
    }

    const sessionRow = await getSessionByModule(moduleId, sessionId);
    if (!sessionRow) {
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan pada module ini' });
    }

    await db.query('UPDATE module_sessions SET open_at = ? WHERE id = ?', [normalizedOpenAt, sessionId]);

    const [updatedRows] = await db.query(
      'SELECT id, module_id, title, sort_order, open_at, created_at, updated_at FROM module_sessions WHERE id = ?',
      [sessionId]
    );

    return res.json({
      success: true,
      message: normalizedOpenAt ? 'Jadwal sesi berhasil diperbarui' : 'Jadwal sesi berhasil dikosongkan',
      data: updatedRows[0]
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengatur jadwal sesi', error: error.message });
  }
};

const createSessionContentViewUrl = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const contentId = Number(req.params.contentId);

  try {
    const allowed = await canReadModule(req.user, moduleId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses membuat URL view berkas' });
    }

    const contentFile = await getSessionContentFileByIds(moduleId, sessionId, contentId);
    if (!contentFile || !contentFile.file_path) {
      return res.status(404).json({ success: false, message: 'Berkas konten tidak ditemukan' });
    }

    if (!isDirectPublicViewAllowed(contentFile.mime_type)) {
      return res.status(400).json({
        success: false,
        message: 'Public view URL hanya tersedia untuk berkas non-image dan non-video'
      });
    }

    if (isSessionLockedForStudent(req.user, contentFile)) {
      return res.status(403).json({ success: false, message: 'Sesi ini belum dibuka sesuai jadwal' });
    }

    const token = sessionContentViewTokenService.sign({
      purpose: 'session-content-file-view',
      module_id: moduleId,
      session_id: sessionId,
      content_id: contentId,
      requester_id: req.user.id,
      requester_role: req.user.role
    });

    const publicUrl = `${req.protocol}://${req.get('host')}/public/session-contents/view?token=${encodeURIComponent(token)}`;

    return res.json({
      success: true,
      message: 'URL view berkas berhasil dibuat',
      data: {
        public_url: publicUrl,
        expires_in_seconds: sessionContentViewTokenService.getTtlSeconds()
      }
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal membuat URL view berkas'
    });
  }
};

const viewSessionContentFileByToken = async (req, res) => {
  try {
    const tokenPayload = sessionContentViewTokenService.verify(req.query.token);

    if (!tokenPayload || tokenPayload.purpose !== 'session-content-file-view') {
      return res.status(401).json({ success: false, message: 'Token view tidak valid' });
    }

    const moduleId = Number(tokenPayload.module_id);
    const sessionId = Number(tokenPayload.session_id);
    const contentId = Number(tokenPayload.content_id);
    const requesterRole = tokenPayload.requester_role;

    if (!Number.isInteger(moduleId) || !Number.isInteger(sessionId) || !Number.isInteger(contentId)) {
      return res.status(401).json({ success: false, message: 'Token view tidak valid' });
    }

    const contentFile = await getSessionContentFileByIds(moduleId, sessionId, contentId);
    if (!contentFile || !contentFile.file_path) {
      return res.status(404).json({ success: false, message: 'Berkas konten tidak ditemukan' });
    }

    if (!isDirectPublicViewAllowed(contentFile.mime_type)) {
      return res.status(400).json({
        success: false,
        message: 'Public view URL hanya tersedia untuk berkas non-image dan non-video'
      });
    }

    if (isSessionLockedForStudent({ role: requesterRole }, contentFile)) {
      return res.status(403).json({ success: false, message: 'Sesi ini belum dibuka sesuai jadwal' });
    }

    const absolutePath = path.join(__dirname, '..', contentFile.file_path);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ success: false, message: 'File tidak ditemukan di storage' });
    }

    if (contentFile.mime_type) {
      res.type(contentFile.mime_type);
    }

    const fileName = path.basename(absolutePath);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal membuka berkas view'
    });
  }
};

const addSessionContent = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const { content_type, title = null, url = null, text_content = null } = req.body;

  if (!content_type || !['file', 'url', 'text'].includes(content_type)) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(400).json({ success: false, message: 'content_type wajib: file | url | text' });
  }

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses menambah konten sesi' });
    }

    const [sessionRows] = await db.query('SELECT id FROM module_sessions WHERE id = ? AND module_id = ?', [sessionId, moduleId]);
    if (sessionRows.length === 0) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan pada module ini' });
    }

    let filePath = null;
    let mimeType = null;

    if (content_type === 'file') {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'File wajib diupload untuk content_type=file' });
      }
      const movedPath = moveTempFileTo(req.file.path, sessionFolder(moduleId, sessionId));
      filePath = toRelativeStoragePath(movedPath);
      mimeType = req.file.mimetype;
    } else if (req.file) {
      removeFileSafe(req.file.path);
    }

    if (content_type === 'url' && (!url || !String(url).trim())) {
      return res.status(400).json({ success: false, message: 'URL wajib diisi untuk content_type=url' });
    }

    const normalizedTextContent = text_content ? String(text_content).trim() : null;

    if (content_type === 'text' && !normalizedTextContent) {
      return res.status(400).json({ success: false, message: 'text_content wajib diisi untuk content_type=text' });
    }

    const [result] = await db.query(
      `INSERT INTO session_contents (session_id, content_type, title, file_path, mime_type, url, text_content)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        content_type,
        title ? String(title).trim() : null,
        filePath,
        mimeType,
        content_type === 'url' ? String(url).trim() : null,
        normalizedTextContent
      ]
    );

    const [rows] = await db.query('SELECT * FROM session_contents WHERE id = ?', [result.insertId]);
    const data = buildSessionContentResponse(rows[0], moduleId, sessionId);
    return res.status(201).json({ success: true, message: 'Konten sesi berhasil ditambahkan', data });
  } catch (error) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(500).json({ success: false, message: 'Gagal menambah konten sesi', error: error.message });
  }
};

const updateSessionContent = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const contentId = Number(req.params.contentId);
  const body = req.body || {};
  const hasContentType = Object.prototype.hasOwnProperty.call(body, 'content_type');
  const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title');
  const hasUrl = Object.prototype.hasOwnProperty.call(body, 'url');
  const hasTextContent = Object.prototype.hasOwnProperty.call(body, 'text_content');

  if (!hasContentType && !hasTitle && !hasUrl && !hasTextContent && !req.file) {
    return res.status(400).json({
      success: false,
      message: 'Minimal kirim salah satu field: content_type, title, url, text_content, atau file'
    });
  }

  let movedNewFileRelativePath = null;

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses update konten sesi' });
    }

    const [rows] = await db.query(
      `SELECT sc.id, sc.session_id, sc.content_type, sc.title, sc.file_path, sc.mime_type, sc.url, sc.text_content
       FROM session_contents sc
       JOIN module_sessions ms ON ms.id = sc.session_id
       WHERE sc.id = ? AND sc.session_id = ? AND ms.module_id = ?`,
      [contentId, sessionId, moduleId]
    );

    if (rows.length === 0) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(404).json({ success: false, message: 'Konten sesi tidak ditemukan' });
    }

    const existingContent = rows[0];
    const nextContentType = hasContentType
      ? String(body.content_type || '').trim().toLowerCase()
      : existingContent.content_type;

    if (!['file', 'url', 'text'].includes(nextContentType)) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(400).json({ success: false, message: 'content_type wajib: file | url | text' });
    }

    const nextTitle = hasTitle
      ? (body.title ? String(body.title).trim() : null)
      : existingContent.title;

    const normalizedUrlInput = hasUrl
      ? (body.url ? String(body.url).trim() : null)
      : existingContent.url;

    const normalizedTextContent = hasTextContent
      ? (body.text_content ? String(body.text_content).trim() : null)
      : existingContent.text_content;

    let nextFilePath = existingContent.file_path;
    let nextMimeType = existingContent.mime_type;
    let shouldDeleteOldFile = false;

    if (nextContentType === 'file') {
      if (req.file) {
        const movedPath = moveTempFileTo(req.file.path, sessionFolder(moduleId, sessionId));
        movedNewFileRelativePath = toRelativeStoragePath(movedPath);
        nextFilePath = movedNewFileRelativePath;
        nextMimeType = req.file.mimetype;

        if (existingContent.file_path && existingContent.file_path !== nextFilePath) {
          shouldDeleteOldFile = true;
        }
      } else if (!existingContent.file_path) {
        return res.status(400).json({ success: false, message: 'File wajib diupload untuk content_type=file' });
      }
    } else {
      if (req.file) {
        removeFileSafe(req.file.path);
        return res.status(400).json({ success: false, message: 'file hanya boleh dikirim untuk content_type=file' });
      }

      if (existingContent.file_path) {
        shouldDeleteOldFile = true;
      }

      nextFilePath = null;
      nextMimeType = null;
    }

    if (nextContentType === 'url' && !normalizedUrlInput) {
      if (movedNewFileRelativePath) {
        removeFileSafe(path.join(__dirname, '..', movedNewFileRelativePath));
      }
      return res.status(400).json({ success: false, message: 'URL wajib diisi untuk content_type=url' });
    }

    if (nextContentType === 'text' && !normalizedTextContent) {
      if (movedNewFileRelativePath) {
        removeFileSafe(path.join(__dirname, '..', movedNewFileRelativePath));
      }
      return res.status(400).json({ success: false, message: 'text_content wajib diisi untuk content_type=text' });
    }

    const nextUrl = nextContentType === 'url' ? normalizedUrlInput : null;

    await db.query(
      `UPDATE session_contents
       SET content_type = ?,
           title = ?,
           file_path = ?,
           mime_type = ?,
           url = ?,
           text_content = ?
       WHERE id = ?`,
      [
        nextContentType,
        nextTitle,
        nextFilePath,
        nextMimeType,
        nextUrl,
        normalizedTextContent,
        contentId
      ]
    );

    if (shouldDeleteOldFile && existingContent.file_path) {
      removeFileSafe(path.join(__dirname, '..', existingContent.file_path));
    }

    const [updatedRows] = await db.query(
      'SELECT id, session_id, content_type, title, file_path, mime_type, url, text_content, created_at FROM session_contents WHERE id = ?',
      [contentId]
    );

    const updated = updatedRows[0];
    const data = buildSessionContentResponse(updated, moduleId, sessionId);

    return res.json({ success: true, message: 'Konten sesi berhasil diperbarui', data });
  } catch (error) {
    if (req.file) {
      removeFileSafe(req.file.path);
    }

    if (movedNewFileRelativePath) {
      removeFileSafe(path.join(__dirname, '..', movedNewFileRelativePath));
    }

    return res.status(500).json({ success: false, message: 'Gagal memperbarui konten sesi', error: error.message });
  }
};

const getSessionContents = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);

  try {
    const allowed = await canReadModule(req.user, moduleId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses membaca konten sesi' });
    }

    const sessionRow = await getSessionByModule(moduleId, sessionId);
    if (!sessionRow) {
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan pada module ini' });
    }

    if (isSessionLockedForStudent(req.user, sessionRow)) {
      return res.status(403).json({ success: false, message: 'Sesi ini belum dibuka sesuai jadwal' });
    }

    const [rows] = await db.query(
      'SELECT id, session_id, content_type, title, file_path, mime_type, url, text_content, created_at FROM session_contents WHERE session_id = ? ORDER BY created_at ASC',
      [sessionId]
    );

    const data = rows.map((item) => buildSessionContentResponse(item, moduleId, sessionId));

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil konten sesi', error: error.message });
  }
};

const downloadSessionContentFile = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const contentId = Number(req.params.contentId);

  try {
    const allowed = await canReadModule(req.user, moduleId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses file ini' });
    }

    const contentFile = await getSessionContentFileByIds(moduleId, sessionId, contentId);

    if (!contentFile || !contentFile.file_path) {
      return res.status(404).json({ success: false, message: 'File konten tidak ditemukan' });
    }

    if (isSessionLockedForStudent(req.user, contentFile)) {
      return res.status(403).json({ success: false, message: 'Sesi ini belum dibuka sesuai jadwal' });
    }

    const absolutePath = path.join(__dirname, '..', contentFile.file_path);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ success: false, message: 'File tidak ditemukan di storage' });
    }

    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil file', error: error.message });
  }
};

const deleteSessionContent = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const contentId = Number(req.params.contentId);

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses menghapus konten sesi' });
    }

    const [rows] = await db.query(
      `SELECT sc.id, sc.file_path
       FROM session_contents sc
       JOIN module_sessions ms ON ms.id = sc.session_id
       WHERE sc.id = ? AND sc.session_id = ? AND ms.module_id = ?`,
      [contentId, sessionId, moduleId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Konten sesi tidak ditemukan' });
    }

    await db.query('DELETE FROM session_contents WHERE id = ?', [contentId]);

    if (rows[0].file_path) {
      removeFileSafe(path.join(__dirname, '..', rows[0].file_path));
    }

    return res.json({ success: true, message: 'Konten sesi berhasil dihapus' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal menghapus konten sesi', error: error.message });
  }
};

module.exports = {
  createModule,
  getModules,
  getModuleById,
  downloadModuleBanner,
  updateModule,
  deleteModule,
  regenerateEnrollKey,
  getModuleSessions,
  createSession,
  updateSession,
  getSessionSchedule,
  updateSessionSchedule,
  createSessionContentViewUrl,
  viewSessionContentFileByToken,
  addSessionContent,
  updateSessionContent,
  getSessionContents,
  deleteSessionContent,
  downloadSessionContentFile,
  canReadModule
};
