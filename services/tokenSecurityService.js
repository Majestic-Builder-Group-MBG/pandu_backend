const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

class TokenSecurityService {
  hashToken(rawToken) {
    return crypto.createHash('sha256').update(String(rawToken || '')).digest('hex');
  }

  getTokenExpiryDate(rawToken) {
    const decoded = jwt.decode(rawToken);
    if (!decoded || !decoded.exp) {
      throw createHttpError(400, 'Token tidak memiliki informasi masa berlaku');
    }

    return new Date(Number(decoded.exp) * 1000);
  }

  async isTokenRevoked(rawToken) {
    const tokenHash = this.hashToken(rawToken);

    const [rows] = await db.query(
      'SELECT id FROM revoked_auth_tokens WHERE token_hash = ? LIMIT 1',
      [tokenHash]
    );

    return rows.length > 0;
  }

  async assertTokenNotRevoked(rawToken) {
    const revoked = await this.isTokenRevoked(rawToken);
    if (revoked) {
      throw createHttpError(401, 'Unauthorized: token sudah logout atau dicabut');
    }
  }

  async revokeToken(rawToken, userId = null) {
    const expiresAt = this.getTokenExpiryDate(rawToken);

    await db.query(
      `INSERT INTO revoked_auth_tokens (token_hash, revoked_by_user_id, expires_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE revoked_by_user_id = VALUES(revoked_by_user_id), expires_at = VALUES(expires_at)`,
      [this.hashToken(rawToken), userId, expiresAt]
    );
  }

  async cleanupExpiredRevokedTokens() {
    const [result] = await db.query('DELETE FROM revoked_auth_tokens WHERE expires_at < NOW()');
    return result.affectedRows || 0;
  }
}

module.exports = {
  tokenSecurityService: new TokenSecurityService(),
  createHttpError
};
