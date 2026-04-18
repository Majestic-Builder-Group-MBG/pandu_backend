const db = require('./db');

const initializeDatabase = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(190) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role ENUM('admin', 'teacher', 'student') NOT NULL DEFAULT 'student',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS modules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      teacher_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT NULL,
      banner_image_path VARCHAR(500) NULL,
      enroll_key VARCHAR(64) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_modules_teacher FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS module_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      module_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      sort_order INT NOT NULL DEFAULT 1,
      open_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_sessions_module FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  try {
    await db.query('ALTER TABLE module_sessions ADD COLUMN open_at DATETIME NULL');
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') {
      throw error;
    }
  }

  try {
    await db.query('ALTER TABLE module_sessions DROP COLUMN description');
  } catch (error) {
    if (error.code !== 'ER_CANT_DROP_FIELD_OR_KEY') {
      throw error;
    }
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS module_enrollments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      module_id INT NOT NULL,
      user_id INT NOT NULL,
      enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_module_user (module_id, user_id),
      CONSTRAINT fk_enrollments_module FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE,
      CONSTRAINT fk_enrollments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS session_contents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      session_id INT NOT NULL,
      content_type ENUM('file', 'url', 'text') NOT NULL,
      title VARCHAR(255) NULL,
      file_path VARCHAR(500) NULL,
      mime_type VARCHAR(120) NULL,
      url TEXT NULL,
      text_content LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_contents_session FOREIGN KEY (session_id) REFERENCES module_sessions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS registration_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(6) NOT NULL UNIQUE,
      target_role ENUM('teacher', 'student') NOT NULL DEFAULT 'student',
      created_by_user_id INT NOT NULL,
      max_uses INT NOT NULL DEFAULT 1,
      used_count INT NOT NULL DEFAULT 0,
      expires_at DATETIME NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_registration_codes_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_registration_codes_creator (created_by_user_id),
      INDEX idx_registration_codes_active (is_active, expires_at)
    ) ENGINE=InnoDB;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS registration_code_usages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      registration_code_id INT NOT NULL,
      used_by_user_id INT NOT NULL,
      used_ip VARCHAR(64) NULL,
      used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_registration_code_usages_code FOREIGN KEY (registration_code_id) REFERENCES registration_codes(id) ON DELETE CASCADE,
      CONSTRAINT fk_registration_code_usages_user FOREIGN KEY (used_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_code_user_usage (registration_code_id, used_by_user_id),
      INDEX idx_registration_code_usages_code (registration_code_id),
      INDEX idx_registration_code_usages_user (used_by_user_id)
    ) ENGINE=InnoDB;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS revoked_auth_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      token_hash CHAR(64) NOT NULL UNIQUE,
      revoked_by_user_id INT NULL,
      expires_at DATETIME NOT NULL,
      revoked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_revoked_auth_tokens_user FOREIGN KEY (revoked_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_revoked_auth_tokens_expires_at (expires_at)
    ) ENGINE=InnoDB;
  `);

};

module.exports = initializeDatabase;
