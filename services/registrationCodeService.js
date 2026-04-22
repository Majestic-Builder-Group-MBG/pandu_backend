const db = require('../config/db');

const ROLE_ADMIN = 'admin';
const ROLE_TEACHER = 'teacher';
const ROLE_STUDENT = 'student';

const REGISTRATION_TARGET_ROLES = new Set([ROLE_TEACHER, ROLE_STUDENT]);

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

class RegistrationCodeService {
  normalizeTargetRole(targetRole) {
    const normalized = String(targetRole || ROLE_STUDENT).trim().toLowerCase();
    if (!REGISTRATION_TARGET_ROLES.has(normalized)) {
      throw createHttpError(400, 'target_role hanya boleh student atau teacher');
    }
    return normalized;
  }

  assertCreatorCanCreateRole(requester, targetRole) {
    if (!requester || !requester.role) {
      throw createHttpError(401, 'Unauthorized: user tidak ditemukan');
    }

    if (requester.role === ROLE_ADMIN) {
      return;
    }

    if (requester.role === ROLE_TEACHER && targetRole === ROLE_STUDENT) {
      return;
    }

    throw createHttpError(403, 'Role anda tidak dapat membuat kode untuk role tersebut');
  }

  parseNumberInRange(value, fallbackValue, min, max, fieldName) {
    const resolvedValue = value === undefined ? fallbackValue : value;
    const numberValue = Number(resolvedValue);

    if (!Number.isInteger(numberValue) || numberValue < min || numberValue > max) {
      throw createHttpError(400, `${fieldName} harus angka antara ${min} sampai ${max}`);
    }

    return numberValue;
  }

  generateNumericCode(length) {
    const min = 10 ** (length - 1);
    const max = (10 ** length) - 1;
    const randomNumber = Math.floor(Math.random() * (max - min + 1)) + min;
    return String(randomNumber);
  }

  async generateUniqueCode(length, connection = db) {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const code = this.generateNumericCode(length);
      const [rows] = await connection.query('SELECT id FROM registration_codes WHERE code = ?', [code]);
      if (rows.length === 0) {
        return code;
      }
    }

    throw createHttpError(500, 'Gagal generate kode unik, silakan coba lagi');
  }

  async createCode(requester, payload = {}) {
    const targetRole = this.normalizeTargetRole(payload.target_role);
    this.assertCreatorCanCreateRole(requester, targetRole);

    const codeLength = this.parseNumberInRange(payload.code_length, 6, 4, 6, 'code_length');
    const maxUses = this.parseNumberInRange(payload.max_uses, 10, 1, 1000, 'max_uses');
    const expiresInHours = this.parseNumberInRange(payload.expires_in_hours, 24, 1, 720, 'expires_in_hours');

    const code = await this.generateUniqueCode(codeLength);
    const expiresAt = new Date(Date.now() + (expiresInHours * 60 * 60 * 1000));

    const [insertResult] = await db.query(
      `INSERT INTO registration_codes
       (code, target_role, created_by_user_id, max_uses, used_count, expires_at, is_active)
       VALUES (?, ?, ?, ?, 0, ?, 1)`,
      [code, targetRole, requester.id, maxUses, expiresAt]
    );

    const [rows] = await db.query(
      `SELECT rc.id, rc.code, rc.target_role, rc.max_uses, rc.used_count, rc.expires_at, rc.is_active, rc.created_at,
        u.id AS creator_id, u.name AS creator_name, u.email AS creator_email, u.role AS creator_role
       FROM registration_codes rc
       JOIN users u ON u.id = rc.created_by_user_id
       WHERE rc.id = ?`,
      [insertResult.insertId]
    );

    return rows[0];
  }

  buildListWhereClause(requester) {
    if (requester.role === ROLE_ADMIN) {
      return { whereSql: '', params: [] };
    }

    return {
      whereSql: 'WHERE rc.created_by_user_id = ?',
      params: [requester.id]
    };
  }

  async listCodes(requester) {
    const { whereSql, params } = this.buildListWhereClause(requester);

    const [rows] = await db.query(
      `SELECT rc.id, rc.code, rc.target_role, rc.max_uses, rc.used_count, rc.expires_at, rc.is_active, rc.created_at, rc.updated_at,
       creator.id AS creator_id, creator.name AS creator_name, creator.email AS creator_email,
       COUNT(rcu.id) AS usage_count,
       MAX(rcu.used_at) AS last_used_at
       FROM registration_codes rc
       JOIN users creator ON creator.id = rc.created_by_user_id
       LEFT JOIN registration_code_usages rcu ON rcu.registration_code_id = rc.id
       ${whereSql}
       GROUP BY rc.id, creator.id, creator.name, creator.email
       ORDER BY rc.created_at DESC`,
      params
    );

    return rows;
  }

  async assertCodeAccess(requester, codeId) {
    const normalizedCodeId = Number(codeId);
    if (!Number.isInteger(normalizedCodeId) || normalizedCodeId <= 0) {
      throw createHttpError(400, 'codeId tidak valid');
    }

    let rows = [];
    if (requester.role === ROLE_ADMIN) {
      [rows] = await db.query('SELECT id FROM registration_codes WHERE id = ?', [normalizedCodeId]);
    } else {
      [rows] = await db.query(
        'SELECT id FROM registration_codes WHERE id = ? AND created_by_user_id = ?',
        [normalizedCodeId, requester.id]
      );
    }

    if (rows.length === 0) {
      throw createHttpError(404, 'Kode registrasi tidak ditemukan atau tidak bisa diakses');
    }

    return normalizedCodeId;
  }

  async revokeCode(requester, codeId) {
    const normalizedCodeId = await this.assertCodeAccess(requester, codeId);

    await db.query(
      'UPDATE registration_codes SET is_active = 0 WHERE id = ?',
      [normalizedCodeId]
    );

    const [rows] = await db.query(
      `SELECT id, code, target_role, max_uses, used_count, expires_at, is_active, created_at, updated_at
       FROM registration_codes
       WHERE id = ?`,
      [normalizedCodeId]
    );

    return rows[0];
  }

  async listCodeUsages(requester, codeId) {
    const normalizedCodeId = await this.assertCodeAccess(requester, codeId);

    const [rows] = await db.query(
      `SELECT rcu.id, rcu.registration_code_id, rcu.used_ip, rcu.used_at,
        u.id AS used_by_user_id, u.name AS used_by_name, u.email AS used_by_email, u.role AS used_by_role
       FROM registration_code_usages rcu
       JOIN users u ON u.id = rcu.used_by_user_id
       WHERE rcu.registration_code_id = ?
       ORDER BY rcu.used_at DESC`,
      [normalizedCodeId]
    );

    return rows;
  }

  async getSummary(requester) {
    const { whereSql, params } = this.buildListWhereClause(requester);

    const [rows] = await db.query(
      `SELECT
         COUNT(*) AS total_codes,
         SUM(CASE WHEN rc.is_active = 1 AND rc.expires_at >= NOW() AND rc.used_count < rc.max_uses THEN 1 ELSE 0 END) AS active_codes,
         SUM(CASE WHEN rc.expires_at < NOW() THEN 1 ELSE 0 END) AS expired_codes,
         SUM(CASE WHEN rc.used_count >= rc.max_uses THEN 1 ELSE 0 END) AS used_up_codes,
         SUM(CASE WHEN rc.used_count > 0 THEN 1 ELSE 0 END) AS used_codes,
         SUM(GREATEST(rc.max_uses - rc.used_count, 0)) AS remaining_uses_total
       FROM registration_codes rc
       ${whereSql}`,
      params
    );

    const summary = rows[0] || {};
    return {
      total_codes: Number(summary.total_codes || 0),
      active_codes: Number(summary.active_codes || 0),
      expired_codes: Number(summary.expired_codes || 0),
      used_codes: Number(summary.used_codes || 0),
      used_up_codes: Number(summary.used_up_codes || 0),
      remaining_uses_total: Number(summary.remaining_uses_total || 0)
    };
  }

  buildManageScope(requester) {
    if (requester.role === ROLE_ADMIN) {
      return {
        whereSql: '',
        params: []
      };
    }

    return {
      whereSql: 'AND created_by_user_id = ?',
      params: [requester.id]
    };
  }

  async archiveExpiredCodes(requester) {
    const { whereSql, params } = this.buildManageScope(requester);

    const [result] = await db.query(
      `UPDATE registration_codes
       SET is_active = 0
       WHERE expires_at < NOW() AND is_active = 1 ${whereSql}`,
      params
    );

    return {
      affected: result.affectedRows || 0
    };
  }

  async deleteExpiredCodes(requester) {
    const { whereSql, params } = this.buildManageScope(requester);

    const [result] = await db.query(
      `DELETE FROM registration_codes
       WHERE expires_at < NOW() ${whereSql}`,
      params
    );

    return {
      affected: result.affectedRows || 0
    };
  }

  async getLockedValidCode(connection, rawCode) {
    const normalizedCode = String(rawCode || '').trim();
    if (!normalizedCode) {
      throw createHttpError(400, 'registration_code wajib diisi');
    }

    if (!/^\d{4,6}$/.test(normalizedCode)) {
      throw createHttpError(400, 'registration_code harus berupa angka 4 sampai 6 digit');
    }

    const [rows] = await connection.query(
      `SELECT id, code, target_role, max_uses, used_count, expires_at, is_active
       FROM registration_codes
       WHERE code = ?
       LIMIT 1
       FOR UPDATE`,
      [normalizedCode]
    );

    if (rows.length === 0) {
      throw createHttpError(400, 'Kode registrasi tidak ditemukan');
    }

    const row = rows[0];
    const now = new Date();

    if (!row.is_active) {
      throw createHttpError(400, 'Kode registrasi sudah tidak aktif');
    }

    if (row.expires_at && new Date(row.expires_at) < now) {
      throw createHttpError(400, 'Kode registrasi sudah kadaluarsa');
    }

    if (Number(row.used_count) >= Number(row.max_uses)) {
      throw createHttpError(400, 'Kode registrasi sudah mencapai batas penggunaan');
    }

    return row;
  }

  async recordCodeUsage(connection, codeRow, usedByUserId, usedIp) {
    await connection.query(
      `INSERT INTO registration_code_usages (registration_code_id, used_by_user_id, used_ip)
       VALUES (?, ?, ?)`,
      [codeRow.id, usedByUserId, usedIp ? String(usedIp).slice(0, 64) : null]
    );

    const nextUsedCount = Number(codeRow.used_count) + 1;
    const isStillActive = nextUsedCount < Number(codeRow.max_uses) ? 1 : 0;

    await connection.query(
      'UPDATE registration_codes SET used_count = ?, is_active = ? WHERE id = ?',
      [nextUsedCount, isStillActive, codeRow.id]
    );
  }
}

module.exports = {
  registrationCodeService: new RegistrationCodeService(),
  createHttpError
};
