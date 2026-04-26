const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/db');

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

class PasswordChangeService {
  constructor() {
    this.defaultOtpTtlMinutes = 5;
    this.defaultMaxAttempts = 3;
  }

  hashOtp(rawOtp) {
    return crypto.createHash('sha256').update(String(rawOtp || '')).digest('hex');
  }

  generateOtp() {
    const numeric = Math.floor(Math.random() * 1000);
    return String(numeric).padStart(3, '0');
  }

  getOtpTtlMinutes() {
    const parsed = Number(process.env.PASSWORD_CHANGE_OTP_TTL_MINUTES || this.defaultOtpTtlMinutes);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 60) {
      return this.defaultOtpTtlMinutes;
    }
    return Math.floor(parsed);
  }

  getMaxAttempts() {
    const parsed = Number(process.env.PASSWORD_CHANGE_OTP_MAX_ATTEMPTS || this.defaultMaxAttempts);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 10) {
      return this.defaultMaxAttempts;
    }
    return Math.floor(parsed);
  }

  async getRequestById(requestId) {
    const normalizedRequestId = Number(requestId);
    if (!Number.isInteger(normalizedRequestId) || normalizedRequestId <= 0) {
      throw createHttpError(400, 'request_id tidak valid');
    }

    const [rows] = await db.query(
      `SELECT pcr.*, u.name AS requester_name, u.email AS requester_email, u.role AS requester_role
       FROM password_change_requests pcr
       JOIN users u ON u.id = pcr.user_id
       WHERE pcr.id = ?
       LIMIT 1`,
      [normalizedRequestId]
    );

    if (rows.length === 0) {
      throw createHttpError(404, 'Permintaan ganti password tidak ditemukan');
    }

    return rows[0];
  }

  async assertApproverScope(approver, targetUserId) {
    if (!approver || !approver.role) {
      throw createHttpError(401, 'Unauthorized: user approver tidak ditemukan');
    }

    if (approver.role === 'admin') {
      return;
    }

    if (approver.role !== 'teacher') {
      throw createHttpError(403, 'Role tidak memiliki akses untuk memproses request ganti password');
    }

    const [rows] = await db.query(
      `SELECT rcu.id
       FROM registration_code_usages rcu
       JOIN registration_codes rc ON rc.id = rcu.registration_code_id
       WHERE rcu.used_by_user_id = ?
         AND rc.created_by_user_id = ?
         AND rc.target_role = 'student'
       LIMIT 1`,
      [targetUserId, approver.id]
    );

    if (rows.length === 0) {
      throw createHttpError(403, 'Anda hanya dapat memproses student yang didaftarkan melalui kode registrasi Anda');
    }
  }

  async notifyApprovers(requestId, requester) {
    const [adminRows] = await db.query(
      `SELECT id
       FROM users
       WHERE role = 'admin'`
    );

    const [teacherRows] = await db.query(
      `SELECT DISTINCT rc.created_by_user_id AS user_id
       FROM registration_code_usages rcu
       JOIN registration_codes rc ON rc.id = rcu.registration_code_id
       WHERE rcu.used_by_user_id = ?
         AND rc.target_role = 'student'`,
      [requester.id]
    );

    const approverIds = new Set();
    for (const row of adminRows) {
      approverIds.add(Number(row.id));
    }
    for (const row of teacherRows) {
      approverIds.add(Number(row.user_id));
    }

    const payload = JSON.stringify({
      request_id: requestId,
      requester_user_id: requester.id
    });

    const title = 'Permintaan Ganti Password';
    const message = `${requester.name} (${requester.email}) meminta perubahan password.`;

    for (const approverId of approverIds) {
      await db.query(
        `INSERT INTO in_app_notifications (user_id, type, title, message, payload_json)
         VALUES (?, 'password_change_request', ?, ?, ?)`,
        [approverId, title, message, payload]
      );
    }
  }

  async createRequest({ user, newPassword }) {
    const normalizedPassword = String(newPassword || '');
    if (normalizedPassword.length < 8) {
      throw createHttpError(400, 'Password baru minimal 8 karakter');
    }

    const passwordHash = await bcrypt.hash(normalizedPassword, 10);

    await db.query(
      `UPDATE password_change_requests
       SET status = 'expired'
       WHERE user_id = ?
         AND status IN ('pending', 'otp_issued')`,
      [user.id]
    );

    const [result] = await db.query(
      `INSERT INTO password_change_requests
       (user_id, status, new_password_hash, max_attempts)
       VALUES (?, 'pending', ?, ?)`,
      [user.id, passwordHash, this.getMaxAttempts()]
    );

    await this.notifyApprovers(result.insertId, user);

    return {
      request_id: result.insertId,
      status: 'pending'
    };
  }

  async listInbox(approver) {
    if (approver.role === 'admin') {
      const [rows] = await db.query(
        `SELECT pcr.id, pcr.user_id, pcr.status, pcr.otp_expires_at, pcr.otp_attempt_count, pcr.max_attempts,
           pcr.issued_at, pcr.created_at, pcr.updated_at,
           u.name AS requester_name, u.email AS requester_email, u.role AS requester_role,
           issuer.name AS issued_by_name
         FROM password_change_requests pcr
         JOIN users u ON u.id = pcr.user_id
         LEFT JOIN users issuer ON issuer.id = pcr.issued_by_user_id
         WHERE pcr.status IN ('pending', 'otp_issued')
         ORDER BY pcr.created_at DESC`
      );
      return rows;
    }

    const [rows] = await db.query(
      `SELECT pcr.id, pcr.user_id, pcr.status, pcr.otp_expires_at, pcr.otp_attempt_count, pcr.max_attempts,
         pcr.issued_at, pcr.created_at, pcr.updated_at,
         u.name AS requester_name, u.email AS requester_email, u.role AS requester_role,
         issuer.name AS issued_by_name
       FROM password_change_requests pcr
       JOIN users u ON u.id = pcr.user_id
       LEFT JOIN users issuer ON issuer.id = pcr.issued_by_user_id
       WHERE pcr.status IN ('pending', 'otp_issued')
         AND EXISTS (
           SELECT 1
           FROM registration_code_usages rcu
           JOIN registration_codes rc ON rc.id = rcu.registration_code_id
           WHERE rcu.used_by_user_id = pcr.user_id
             AND rc.target_role = 'student'
             AND rc.created_by_user_id = ?
         )
       ORDER BY pcr.created_at DESC`,
      [approver.id]
    );

    return rows;
  }

  async issueOtp({ approver, requestId }) {
    const request = await this.getRequestById(requestId);
    await this.assertApproverScope(approver, request.user_id);

    if (!['pending', 'otp_issued'].includes(request.status)) {
      throw createHttpError(409, 'Request tidak berada pada status yang bisa dibuatkan OTP');
    }

    const otp = this.generateOtp();
    const otpExpiresAt = new Date(Date.now() + (this.getOtpTtlMinutes() * 60 * 1000));
    const maxAttempts = this.getMaxAttempts();

    await db.query(
      `UPDATE password_change_requests
       SET status = 'otp_issued',
           otp_hash = ?,
           otp_expires_at = ?,
           otp_attempt_count = 0,
           max_attempts = ?,
           issued_by_user_id = ?,
           issued_at = NOW(),
           rejected_by_user_id = NULL,
           rejected_at = NULL,
           reject_reason = NULL
       WHERE id = ?`,
      [this.hashOtp(otp), otpExpiresAt, maxAttempts, approver.id, request.id]
    );

    return {
      request_id: request.id,
      status: 'otp_issued',
      otp,
      otp_expires_at: otpExpiresAt,
      max_attempts: maxAttempts
    };
  }

  async rejectRequest({ approver, requestId, reason }) {
    const request = await this.getRequestById(requestId);
    await this.assertApproverScope(approver, request.user_id);

    if (!['pending', 'otp_issued'].includes(request.status)) {
      throw createHttpError(409, 'Request tidak berada pada status yang bisa ditolak');
    }

    const normalizedReason = reason ? String(reason).trim().slice(0, 500) : null;

    await db.query(
      `UPDATE password_change_requests
       SET status = 'rejected',
           rejected_by_user_id = ?,
           rejected_at = NOW(),
           reject_reason = ?,
           otp_hash = NULL,
           otp_expires_at = NULL
       WHERE id = ?`,
      [approver.id, normalizedReason, request.id]
    );

    return {
      request_id: request.id,
      status: 'rejected',
      reject_reason: normalizedReason
    };
  }

  async confirmByOtp({ user, requestId, otp }) {
    const request = await this.getRequestById(requestId);

    if (Number(request.user_id) !== Number(user.id)) {
      throw createHttpError(403, 'Request ini bukan milik user yang sedang login');
    }

    if (request.status !== 'otp_issued') {
      throw createHttpError(409, 'OTP belum diterbitkan atau request tidak aktif');
    }

    if (!request.otp_hash || !request.otp_expires_at) {
      throw createHttpError(409, 'OTP belum tersedia untuk request ini');
    }

    if (new Date(request.otp_expires_at) < new Date()) {
      await db.query(
        `UPDATE password_change_requests
         SET status = 'expired', otp_hash = NULL
         WHERE id = ?`,
        [request.id]
      );
      throw createHttpError(410, 'OTP sudah kedaluwarsa');
    }

    const currentAttempt = Number(request.otp_attempt_count || 0);
    const maxAttempts = Number(request.max_attempts || this.getMaxAttempts());

    if (currentAttempt >= maxAttempts) {
      await db.query(
        `UPDATE password_change_requests
         SET status = 'expired', otp_hash = NULL
         WHERE id = ?`,
        [request.id]
      );
      throw createHttpError(429, 'Batas percobaan OTP sudah habis');
    }

    const normalizedOtp = String(otp || '').trim();
    if (!/^\d{3}$/.test(normalizedOtp)) {
      throw createHttpError(400, 'OTP harus 3 digit angka');
    }

    const validOtp = this.hashOtp(normalizedOtp) === request.otp_hash;
    if (!validOtp) {
      const nextAttempt = currentAttempt + 1;
      const shouldExpire = nextAttempt >= maxAttempts;

      await db.query(
        `UPDATE password_change_requests
         SET otp_attempt_count = ?,
             status = CASE WHEN ? = 1 THEN 'expired' ELSE status END,
             otp_hash = CASE WHEN ? = 1 THEN NULL ELSE otp_hash END
         WHERE id = ?`,
        [nextAttempt, shouldExpire ? 1 : 0, shouldExpire ? 1 : 0, request.id]
      );

      throw createHttpError(400, shouldExpire ? 'OTP salah, request otomatis kadaluwarsa' : 'OTP tidak valid');
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        'UPDATE users SET password = ? WHERE id = ?',
        [request.new_password_hash, user.id]
      );

      await connection.query(
        `UPDATE password_change_requests
         SET status = 'completed',
             completed_at = NOW(),
             approved_at = NOW(),
             approved_by_user_id = COALESCE(issued_by_user_id, approved_by_user_id),
             otp_hash = NULL,
             otp_expires_at = NULL
         WHERE id = ?`,
        [request.id]
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return {
      request_id: request.id,
      status: 'completed'
    };
  }
}

module.exports = {
  passwordChangeService: new PasswordChangeService(),
  createHttpError
};
