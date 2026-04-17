const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { registrationCodeService } = require('../services/registrationCodeService');
const { tokenSecurityService } = require('../services/tokenSecurityService');

const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';

const normalizeAuthBody = (rawBody) => {
  if (typeof rawBody === 'string') {
    const trimmed = rawBody.trim();
    if (!trimmed) {
      return {};
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        const error = new Error('Body text/plain harus berupa JSON object yang valid');
        error.status = 400;
        throw error;
      }
      return parsed;
    } catch (error) {
      if (!error.status) {
        error.status = 400;
        error.message = 'Body text/plain harus berupa JSON valid';
      }
      throw error;
    }
  }

  return rawBody || {};
};

// ================== REGISTER ==================
const register = async (req, res) => {
  let connection;
  let transactionOpen = false;

  try {
    const normalizedBody = normalizeAuthBody(req.body);
    const { name, email, password, role, registration_code } = normalizedBody;

    if (!name || !email || !password || !registration_code) {
      return res.status(400).json({
        success: false,
        message: 'Nama, email, password, dan registration_code wajib diisi'
      });
    }

    if (String(password).length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password minimal 8 karakter'
      });
    }

    const requestedRole = role ? String(role).trim().toLowerCase() : null;
    if (requestedRole && !['teacher', 'student'].includes(requestedRole)) {
      return res.status(400).json({
        success: false,
        message: 'role pada registrasi hanya boleh teacher atau student'
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionOpen = true;

    const [existingUser] = await connection.query(
      'SELECT id FROM users WHERE email = ?',
      [String(email).trim()]
    );

    if (existingUser.length > 0) {
      await connection.rollback();
      transactionOpen = false;
      return res.status(409).json({
        success: false,
        message: 'Email sudah terdaftar'
      });
    }

    const codeRow = await registrationCodeService.getLockedValidCode(connection, registration_code);
    const finalRole = codeRow.target_role;

    if (requestedRole && requestedRole !== finalRole) {
      throw Object.assign(new Error('Role tidak sesuai dengan target role pada registration_code'), { status: 400 });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const [result] = await connection.query(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [String(name).trim(), String(email).trim(), hashedPassword, finalRole]
    );

    await registrationCodeService.recordCodeUsage(
      connection,
      codeRow,
      result.insertId,
      req.ip || req.socket.remoteAddress || null
    );

    await connection.commit();
    transactionOpen = false;

    const token = jwt.sign(
      {
        id: result.insertId,
        email: String(email).trim(),
        role: finalRole
      },
      process.env.JWT_SECRET,
      { expiresIn: jwtExpiresIn }
    );

    res.status(201).json({
      success: true,
      message: 'Registrasi berhasil',
      data: {
        user: {
          id: result.insertId,
          name: String(name).trim(),
          email: String(email).trim(),
          role: finalRole
        },
        token: token,
        token_type: 'Bearer'
      }
    });

  } catch (error) {
    if (connection && transactionOpen) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Rollback Error:', rollbackError.message);
      }
    }
    console.error('Register Error:', error.message);
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Terjadi kesalahan pada server'
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// ================== LOGIN (tetap disertakan) ==================
const login = async (req, res) => {
  try {
    const normalizedBody = normalizeAuthBody(req.body);
    const { email, password } = normalizedBody;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email dan password wajib diisi'
      });
    }

    const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Email atau password salah'
      });
    }

    const user = users[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Email atau password salah'
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: jwtExpiresIn }
    );

    res.json({
      success: true,
      message: 'Login berhasil',
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        },
        token: token,
        token_type: 'Bearer'
      }
    });

  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server'
    });
  }
};

const logout = async (req, res) => {
  try {
    if (!req.token || !req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: token tidak ditemukan'
      });
    }

    await tokenSecurityService.revokeToken(req.token, req.user.id);
    await tokenSecurityService.cleanupExpiredRevokedTokens();

    return res.json({
      success: true,
      message: 'Logout berhasil'
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal logout'
    });
  }
};

module.exports = { register, login, logout };
