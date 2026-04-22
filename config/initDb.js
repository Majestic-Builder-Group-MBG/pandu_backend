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
    CREATE TABLE IF NOT EXISTS session_quizzes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      session_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      banner_image_path VARCHAR(500) NULL,
      duration_minutes INT NOT NULL DEFAULT 30,
      max_attempts INT NOT NULL DEFAULT 1,
      passing_score DECIMAL(5,2) NOT NULL DEFAULT 70.00,
      is_published TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_session_quiz (session_id),
      CONSTRAINT fk_session_quizzes_session FOREIGN KEY (session_id) REFERENCES module_sessions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS quiz_questions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      quiz_id INT NOT NULL,
      question_type ENUM('mcq', 'essay') NOT NULL,
      question_text LONGTEXT NOT NULL,
      points DECIMAL(7,2) NOT NULL DEFAULT 1.00,
      media_path VARCHAR(500) NULL,
      media_mime_type VARCHAR(120) NULL,
      sort_order INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_quiz_questions_quiz FOREIGN KEY (quiz_id) REFERENCES session_quizzes(id) ON DELETE CASCADE,
      INDEX idx_quiz_questions_quiz_sort (quiz_id, sort_order, id)
    ) ENGINE=InnoDB;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS quiz_question_options (
      id INT AUTO_INCREMENT PRIMARY KEY,
      question_id INT NOT NULL,
      option_text TEXT NOT NULL,
      is_correct TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_quiz_options_question FOREIGN KEY (question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE,
      INDEX idx_quiz_options_question_sort (question_id, sort_order, id)
    ) ENGINE=InnoDB;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      quiz_id INT NOT NULL,
      student_id INT NOT NULL,
      attempt_no INT NOT NULL,
      status ENUM('in_progress', 'submitted_pending_review', 'graded', 'auto_submitted') NOT NULL DEFAULT 'in_progress',
      started_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      submitted_at DATETIME NULL,
      total_points DECIMAL(9,2) NOT NULL DEFAULT 0.00,
      auto_score DECIMAL(7,2) NOT NULL DEFAULT 0.00,
      manual_score DECIMAL(7,2) NOT NULL DEFAULT 0.00,
      final_score DECIMAL(7,2) NOT NULL DEFAULT 0.00,
      passed TINYINT(1) NULL,
      graded_at DATETIME NULL,
      graded_by_user_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_quiz_attempts_quiz FOREIGN KEY (quiz_id) REFERENCES session_quizzes(id) ON DELETE CASCADE,
      CONSTRAINT fk_quiz_attempts_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_quiz_attempts_grader FOREIGN KEY (graded_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE KEY uniq_quiz_student_attempt_no (quiz_id, student_id, attempt_no),
      INDEX idx_quiz_attempts_quiz_student (quiz_id, student_id),
      INDEX idx_quiz_attempts_quiz_status (quiz_id, status)
    ) ENGINE=InnoDB;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS quiz_attempt_answers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      attempt_id INT NOT NULL,
      question_id INT NOT NULL,
      selected_option_id INT NULL,
      essay_answer LONGTEXT NULL,
      is_correct TINYINT(1) NULL,
      auto_points DECIMAL(9,2) NOT NULL DEFAULT 0.00,
      manual_points DECIMAL(9,2) NULL,
      reviewer_feedback TEXT NULL,
      reviewed_by_user_id INT NULL,
      reviewed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_quiz_answers_attempt FOREIGN KEY (attempt_id) REFERENCES quiz_attempts(id) ON DELETE CASCADE,
      CONSTRAINT fk_quiz_answers_question FOREIGN KEY (question_id) REFERENCES quiz_questions(id) ON DELETE CASCADE,
      CONSTRAINT fk_quiz_answers_option FOREIGN KEY (selected_option_id) REFERENCES quiz_question_options(id) ON DELETE SET NULL,
      CONSTRAINT fk_quiz_answers_reviewer FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE KEY uniq_attempt_question (attempt_id, question_id),
      INDEX idx_quiz_answers_attempt (attempt_id),
      INDEX idx_quiz_answers_question (question_id)
    ) ENGINE=InnoDB;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS session_reminders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      module_id INT NOT NULL,
      session_id INT NOT NULL,
      user_id INT NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      channel ENUM('in_app') NOT NULL DEFAULT 'in_app',
      notify_before_minutes INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_session_reminders_module FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE,
      CONSTRAINT fk_session_reminders_session FOREIGN KEY (session_id) REFERENCES module_sessions(id) ON DELETE CASCADE,
      CONSTRAINT fk_session_reminders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_session_reminder_user (session_id, user_id),
      INDEX idx_session_reminders_user (user_id),
      INDEX idx_session_reminders_session_enabled (session_id, enabled)
    ) ENGINE=InnoDB;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS in_app_notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      type VARCHAR(64) NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      payload_json JSON NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_in_app_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_in_app_notifications_user_created (user_id, created_at)
    ) ENGINE=InnoDB;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      endpoint VARCHAR(1000) NOT NULL,
      endpoint_hash CHAR(64) NOT NULL,
      p256dh VARCHAR(512) NOT NULL,
      auth VARCHAR(512) NOT NULL,
      user_agent VARCHAR(512) NULL,
      platform VARCHAR(120) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      last_success_at DATETIME NULL,
      last_error_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_push_subscriptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY uniq_push_endpoint_hash (endpoint_hash),
      INDEX idx_push_subscriptions_user (user_id),
      INDEX idx_push_subscriptions_active (is_active)
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
