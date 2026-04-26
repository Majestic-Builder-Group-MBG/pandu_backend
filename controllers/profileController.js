const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const { profileStorageService } = require('../services/profile/profileStorageService');
const { passwordChangeService } = require('../services/passwordChangeService');
const { tokenSecurityService } = require('../services/tokenSecurityService');

const removeFileSafe = (filePath) => profileStorageService.removeFileSafe(filePath);
const moveTempFileTo = (tempPath, targetDir) => profileStorageService.moveTempFileTo(tempPath, targetDir);
const userProfileFolder = (userId) => profileStorageService.userProfileFolder(userId);
const toRelativeStoragePath = (absPath) => profileStorageService.toRelativeStoragePath(absPath);
const toAbsolutePath = (relativePath) => profileStorageService.toAbsolutePath(relativePath);

const buildPhotoUrl = (hasPhoto) => (hasPhoto ? '/api/profile/me/photo' : null);

const getMyProfile = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, email, role, profile_photo_path, created_at, updated_at
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }

    const user = rows[0];
    return res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        has_profile_photo: Boolean(user.profile_photo_path),
        profile_photo_url: buildPhotoUrl(Boolean(user.profile_photo_path)),
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil profil', error: error.message });
  }
};

const updateMyProfile = async (req, res) => {
  const body = req.body || {};
  const hasName = Object.prototype.hasOwnProperty.call(body, 'name');

  if (!hasName) {
    return res.status(400).json({ success: false, message: 'Minimal kirim field name' });
  }

  const name = String(body.name || '').trim();
  if (!name) {
    return res.status(400).json({ success: false, message: 'name wajib diisi' });
  }

  if (name.length > 120) {
    return res.status(400).json({ success: false, message: 'name maksimal 120 karakter' });
  }

  try {
    await db.query('UPDATE users SET name = ? WHERE id = ?', [name, req.user.id]);

    const [rows] = await db.query(
      `SELECT id, name, email, role, profile_photo_path, created_at, updated_at
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [req.user.id]
    );

    const user = rows[0];
    return res.json({
      success: true,
      message: 'Profil berhasil diperbarui',
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        has_profile_photo: Boolean(user.profile_photo_path),
        profile_photo_url: buildPhotoUrl(Boolean(user.profile_photo_path)),
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal memperbarui profil', error: error.message });
  }
};

const updateProfilePhoto = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'File foto wajib diupload' });
  }

  if (!String(req.file.mimetype || '').startsWith('image/')) {
    removeFileSafe(req.file.path);
    return res.status(400).json({ success: false, message: 'Foto profil hanya mendukung tipe image/*' });
  }

  try {
    const [rows] = await db.query('SELECT id, profile_photo_path FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (rows.length === 0) {
      removeFileSafe(req.file.path);
      return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }

    const movedPath = moveTempFileTo(req.file.path, userProfileFolder(req.user.id));
    const relativePath = toRelativeStoragePath(movedPath);

    await db.query('UPDATE users SET profile_photo_path = ? WHERE id = ?', [relativePath, req.user.id]);

    if (rows[0].profile_photo_path) {
      removeFileSafe(toAbsolutePath(rows[0].profile_photo_path));
    }

    return res.json({
      success: true,
      message: 'Foto profil berhasil diperbarui',
      data: {
        has_profile_photo: true,
        profile_photo_url: buildPhotoUrl(true)
      }
    });
  } catch (error) {
    removeFileSafe(req.file.path);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui foto profil', error: error.message });
  }
};

const downloadMyProfilePhoto = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT profile_photo_path FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }

    if (!rows[0].profile_photo_path) {
      return res.status(404).json({ success: false, message: 'Foto profil belum tersedia' });
    }

    const absolutePath = toAbsolutePath(rows[0].profile_photo_path);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ success: false, message: 'File foto profil tidak ditemukan' });
    }

    res.type(path.extname(absolutePath));
    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil foto profil', error: error.message });
  }
};

const requestPasswordChange = async (req, res) => {
  const newPassword = req.body && req.body.new_password;

  try {
    const [userRows] = await db.query('SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }

    const data = await passwordChangeService.createRequest({
      user: userRows[0],
      newPassword
    });

    return res.status(201).json({
      success: true,
      message: 'Permintaan ganti password berhasil dikirim. Menunggu OTP dari pengampu/admin.',
      data
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal membuat permintaan ganti password'
    });
  }
};

const confirmPasswordChange = async (req, res) => {
  const body = req.body || {};
  const requestId = body.request_id;
  const otp = body.otp;

  try {
    const data = await passwordChangeService.confirmByOtp({
      user: req.user,
      requestId,
      otp
    });

    if (req.token) {
      await tokenSecurityService.revokeToken(req.token, req.user.id);
      await tokenSecurityService.cleanupExpiredRevokedTokens();
    }

    return res.json({
      success: true,
      message: 'Password berhasil diubah. Silakan login ulang.',
      data
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal konfirmasi ganti password'
    });
  }
};

module.exports = {
  getMyProfile,
  updateMyProfile,
  updateProfilePhoto,
  downloadMyProfilePhoto,
  requestPasswordChange,
  confirmPasswordChange
};
