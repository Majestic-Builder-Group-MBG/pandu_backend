const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const { quizStorageService } = require('../services/quiz/quizStorageService');
const { quizAccessService } = require('../services/quiz/quizAccessService');
const { quizValueService } = require('../services/quiz/quizValueService');
const { quizStatsService } = require('../services/quiz/quizStatsService');
const { quizAttemptService } = require('../services/quiz/quizAttemptService');
const { quizDraftAiService } = require('../services/ai/quizDraftAiService');

const removeFileSafe = (filePath) => quizStorageService.removeFileSafe(filePath);
const moveTempFileTo = (tempPath, targetDir) => quizStorageService.moveTempFileTo(tempPath, targetDir);
const quizFolder = (moduleId, sessionId) => quizStorageService.quizFolder(moduleId, sessionId);
const sessionFolder = (moduleId, sessionId) => quizStorageService.sessionFolder(moduleId, sessionId);
const toRelativeStoragePath = (absPath) => quizStorageService.toRelativeStoragePath(absPath);
const toAbsolutePath = (relativePath) => quizStorageService.toAbsolutePath(relativePath);

const toBoolean = (value) => quizValueService.toBoolean(value);
const toNumber = (value) => quizValueService.toNumber(value);
const parseJsonField = (value, fieldName) => quizValueService.parseJsonField(value, fieldName);
const normalizeQuestionOptions = (rawOptions) => quizValueService.normalizeQuestionOptions(rawOptions);

const canManageModule = async (user, moduleId) => quizAccessService.canManageModule(user, moduleId);
const canReadModule = async (user, moduleId) => quizAccessService.canReadModule(user, moduleId);
const getSessionRow = async (moduleId, sessionId) => quizAccessService.getSessionRow(moduleId, sessionId);
const isSessionLockedForStudent = (user, sessionRow) => quizAccessService.isSessionLockedForStudent(user, sessionRow);

const getQuizBySessionId = async (sessionId) => {
  const [rows] = await db.query('SELECT * FROM session_quizzes WHERE session_id = ? LIMIT 1', [sessionId]);
  return rows[0] || null;
};

const getQuestionById = async (quizId, questionId) => {
  const [rows] = await db.query(
    'SELECT * FROM quiz_questions WHERE id = ? AND quiz_id = ? LIMIT 1',
    [questionId, quizId]
  );
  return rows[0] || null;
};

const getQuizQuestionStats = async (quizId) => quizStatsService.getQuizQuestionStats(quizId);
const getQuizAttemptSummaryForStudent = async (quizId, studentId) => quizStatsService.getQuizAttemptSummaryForStudent(quizId, studentId);
const assertStudentCanAccessQuiz = async (req, moduleId, sessionId) => quizAccessService.assertStudentCanAccessQuiz(req, moduleId, sessionId);

const buildQuestionResponse = (question, moduleId, sessionId, options = []) => ({
  ...question,
  has_media: Boolean(question && question.media_path),
  media_url: question && question.media_path
    ? `/api/modules/${moduleId}/sessions/${sessionId}/quiz/questions/${question.id}/media`
    : null,
  options
});

const parseArrayField = (value, fieldName) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        const error = new Error(`${fieldName} harus berupa array`);
        error.status = 400;
        throw error;
      }
      return parsed;
    } catch (error) {
      if (!error.status) {
        error.status = 400;
        error.message = `${fieldName} harus berupa JSON array valid`;
      }
      throw error;
    }
  }

  const error = new Error(`${fieldName} harus berupa array`);
  error.status = 400;
  throw error;
};

const toIntInRange = (value, fallbackValue, min, max, fieldName) => {
  const resolvedValue = value === undefined || value === null || value === ''
    ? fallbackValue
    : Number(value);

  if (!Number.isInteger(resolvedValue) || resolvedValue < min || resolvedValue > max) {
    const error = new Error(`${fieldName} harus angka bulat antara ${min} sampai ${max}`);
    error.status = 400;
    throw error;
  }

  return resolvedValue;
};

const normalizeDifficulty = (value) => {
  const normalized = String(value || 'medium').trim().toLowerCase();
  if (!['easy', 'medium', 'hard'].includes(normalized)) {
    const error = new Error('difficulty hanya boleh: easy | medium | hard');
    error.status = 400;
    throw error;
  }

  return normalized;
};

const normalizeLocale = (value) => {
  const normalized = String(value || 'id').trim().toLowerCase();
  if (!/^[a-z]{2}(-[a-z]{2})?$/.test(normalized)) {
    const error = new Error('locale tidak valid. Gunakan format seperti id atau en');
    error.status = 400;
    throw error;
  }

  return normalized;
};

const applyGeneratedDraftToQuiz = async ({ moduleId, sessionId, generatedData }) => {
  const draft = generatedData && generatedData.draft ? generatedData.draft : null;
  if (!draft) {
    const error = new Error('Draft AI tidak tersedia untuk diterapkan');
    error.status = 500;
    throw error;
  }

  const quizTitle = String(draft.quiz_title || '').trim();
  if (!quizTitle) {
    const error = new Error('Judul quiz hasil AI kosong');
    error.status = 502;
    throw error;
  }

  const quizDescription = draft.quiz_description ? String(draft.quiz_description).trim() : null;
  const combinedQuestions = [
    ...(Array.isArray(draft.mcq) ? draft.mcq : []),
    ...(Array.isArray(draft.essay) ? draft.essay : [])
  ].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

  if (combinedQuestions.length === 0) {
    const error = new Error('Draft AI tidak memiliki pertanyaan');
    error.status = 502;
    throw error;
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [quizRows] = await connection.query(
      'SELECT * FROM session_quizzes WHERE session_id = ? LIMIT 1 FOR UPDATE',
      [sessionId]
    );

    let quizId;
    if (quizRows.length === 0) {
      const [insertResult] = await connection.query(
        `INSERT INTO session_quizzes
         (session_id, title, description, banner_image_path, duration_minutes, max_attempts, passing_score, is_published)
         VALUES (?, ?, ?, NULL, 30, 1, 70, 0)`,
        [sessionId, quizTitle, quizDescription]
      );
      quizId = insertResult.insertId;
    } else {
      quizId = quizRows[0].id;
      await connection.query(
        `UPDATE session_quizzes
         SET title = ?, description = ?, is_published = 0
         WHERE id = ?`,
        [quizTitle, quizDescription, quizId]
      );
    }

    await connection.query('DELETE FROM quiz_questions WHERE quiz_id = ?', [quizId]);

    for (const question of combinedQuestions) {
      const questionType = String(question.question_type || '').trim().toLowerCase();
      const questionText = String(question.question_text || '').trim();
      const points = Number(question.points);
      const sortOrder = Number(question.sort_order || 0) || 1;

      const [questionResult] = await connection.query(
        `INSERT INTO quiz_questions
         (quiz_id, question_type, question_text, points, media_path, media_mime_type, sort_order)
         VALUES (?, ?, ?, ?, NULL, NULL, ?)`,
        [quizId, questionType, questionText, points, sortOrder]
      );

      if (questionType === 'mcq') {
        const options = Array.isArray(question.options) ? question.options : [];
        for (let i = 0; i < options.length; i += 1) {
          const option = options[i];
          await connection.query(
            `INSERT INTO quiz_question_options (question_id, option_text, is_correct, sort_order)
             VALUES (?, ?, ?, ?)`,
            [
              questionResult.insertId,
              String(option.option_text || '').trim(),
              option.is_correct ? 1 : 0,
              Number(option.sort_order || i + 1)
            ]
          );
        }
      }
    }

    await connection.commit();

    const [latestQuizRows] = await db.query('SELECT * FROM session_quizzes WHERE id = ?', [quizId]);
    const [questionRows] = await db.query(
      `SELECT id, quiz_id, question_type, question_text, points, sort_order
       FROM quiz_questions
       WHERE quiz_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [quizId]
    );

    const questionIds = questionRows.map((item) => item.id);
    let optionRows = [];
    if (questionIds.length > 0) {
      const placeholders = questionIds.map(() => '?').join(',');
      const [rows] = await db.query(
        `SELECT id, question_id, option_text, is_correct, sort_order
         FROM quiz_question_options
         WHERE question_id IN (${placeholders})
         ORDER BY sort_order ASC, id ASC`,
        questionIds
      );
      optionRows = rows;
    }

    const optionMap = new Map();
    for (const option of optionRows) {
      const current = optionMap.get(option.question_id) || [];
      current.push(option);
      optionMap.set(option.question_id, current);
    }

    return {
      applied: true,
      mode: 'replace',
      quiz: {
        ...latestQuizRows[0],
        has_banner: Boolean(latestQuizRows[0].banner_image_path),
        banner_download_url: latestQuizRows[0].banner_image_path
          ? `/api/modules/${moduleId}/sessions/${sessionId}/quiz/banner`
          : null,
        questions: questionRows.map((question) => buildQuestionResponse(
          question,
          moduleId,
          sessionId,
          optionMap.get(question.id) || []
        ))
      }
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const generateQuizDraft = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const body = req.body || {};

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses generate draft quiz sesi ini' });
    }

    const sessionRow = await getSessionRow(moduleId, sessionId);
    if (!sessionRow) {
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan pada module ini' });
    }

    const sourceMode = String(body.source_mode || 'session_contents').trim().toLowerCase();
    if (sourceMode !== 'session_contents') {
      return res.status(400).json({
        success: false,
        message: 'source_mode saat ini hanya mendukung session_contents'
      });
    }

    const parsedContentIds = parseArrayField(body.content_ids, 'content_ids');
    const contentIds = parsedContentIds
      ? parsedContentIds.map((item) => Number(item))
      : null;

    if (contentIds && contentIds.some((item) => !Number.isInteger(item) || item <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'content_ids harus berisi angka id konten yang valid'
      });
    }

    const uniqueContentIds = contentIds ? [...new Set(contentIds)] : null;

    const mcqCount = toIntInRange(body.mcq_count, 5, 1, 20, 'mcq_count');
    const essayCount = toIntInRange(body.essay_count, 3, 0, 20, 'essay_count');
    const difficulty = normalizeDifficulty(body.difficulty);
    const locale = normalizeLocale(body.locale);
    const manualContext = body.manual_context ? String(body.manual_context).trim() : '';
    const applyToQuiz = Object.prototype.hasOwnProperty.call(body, 'apply_to_quiz')
      ? toBoolean(body.apply_to_quiz)
      : true;

    const data = await quizDraftAiService.generateDraft({
      moduleId,
      sessionId,
      contentIds: uniqueContentIds,
      manualContext,
      mcqCount,
      essayCount,
      difficulty,
      locale
    });

    if (applyToQuiz) {
      const appliedQuiz = await applyGeneratedDraftToQuiz({ moduleId, sessionId, generatedData: data });
      data.applied_quiz = appliedQuiz;
    }

    return res.json({
      success: true,
      message: applyToQuiz
        ? 'Draft soal quiz berhasil digenerate dan menggantikan quiz sesi saat ini'
        : 'Draft soal quiz berhasil digenerate',
      data
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal generate draft quiz'
    });
  }
};

const createQuiz = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const body = req.body || {};
  const title = body.title ? String(body.title).trim() : '';

  if (!title) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(400).json({ success: false, message: 'title quiz wajib diisi' });
  }

  const durationMinutes = toNumber(body.duration_minutes);
  const maxAttempts = toNumber(body.max_attempts);
  const passingScore = toNumber(body.passing_score);

  if (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 480)) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(400).json({ success: false, message: 'duration_minutes harus angka bulat antara 1 sampai 480' });
  }

  if (maxAttempts !== null && (!Number.isInteger(maxAttempts) || maxAttempts <= 0 || maxAttempts > 50)) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(400).json({ success: false, message: 'max_attempts harus angka bulat antara 1 sampai 50' });
  }

  if (passingScore !== null && (passingScore < 0 || passingScore > 100)) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(400).json({ success: false, message: 'passing_score harus antara 0 sampai 100' });
  }

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses membuat quiz pada sesi ini' });
    }

    const sessionRow = await getSessionRow(moduleId, sessionId);
    if (!sessionRow) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan pada module ini' });
    }

    const existingQuiz = await getQuizBySessionId(sessionId);
    if (existingQuiz) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(409).json({ success: false, message: 'Quiz untuk sesi ini sudah ada' });
    }

    let bannerPath = null;
    if (req.file) {
      const movedPath = moveTempFileTo(req.file.path, path.join(quizFolder(moduleId, sessionId), 'banner'));
      bannerPath = toRelativeStoragePath(movedPath);
    }

    const [result] = await db.query(
      `INSERT INTO session_quizzes
       (session_id, title, description, banner_image_path, duration_minutes, max_attempts, passing_score, is_published)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        sessionId,
        title,
        body.description ? String(body.description).trim() : null,
        bannerPath,
        durationMinutes === null ? 30 : durationMinutes,
        maxAttempts === null ? 1 : maxAttempts,
        passingScore === null ? 70 : passingScore
      ]
    );

    const [rows] = await db.query('SELECT * FROM session_quizzes WHERE id = ?', [result.insertId]);
    const data = {
      ...rows[0],
      has_banner: Boolean(rows[0].banner_image_path),
      banner_download_url: rows[0].banner_image_path
        ? `/api/modules/${moduleId}/sessions/${sessionId}/quiz/banner`
        : null
    };

    return res.status(201).json({ success: true, message: 'Quiz sesi berhasil dibuat', data });
  } catch (error) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(500).json({ success: false, message: 'Gagal membuat quiz sesi', error: error.message });
  }
};

const updateQuiz = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const body = req.body || {};

  const hasTitle = Object.prototype.hasOwnProperty.call(body, 'title');
  const hasDescription = Object.prototype.hasOwnProperty.call(body, 'description');
  const hasDuration = Object.prototype.hasOwnProperty.call(body, 'duration_minutes');
  const hasMaxAttempts = Object.prototype.hasOwnProperty.call(body, 'max_attempts');
  const hasPassingScore = Object.prototype.hasOwnProperty.call(body, 'passing_score');
  const removeBanner = toBoolean(body.remove_banner);

  if (!hasTitle && !hasDescription && !hasDuration && !hasMaxAttempts && !hasPassingScore && !req.file && !removeBanner) {
    return res.status(400).json({ success: false, message: 'Tidak ada perubahan yang dikirim untuk quiz' });
  }

  const durationMinutes = hasDuration ? toNumber(body.duration_minutes) : null;
  const maxAttempts = hasMaxAttempts ? toNumber(body.max_attempts) : null;
  const passingScore = hasPassingScore ? toNumber(body.passing_score) : null;

  if (hasDuration && (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 480)) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(400).json({ success: false, message: 'duration_minutes harus angka bulat antara 1 sampai 480' });
  }

  if (hasMaxAttempts && (!Number.isInteger(maxAttempts) || maxAttempts <= 0 || maxAttempts > 50)) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(400).json({ success: false, message: 'max_attempts harus angka bulat antara 1 sampai 50' });
  }

  if (hasPassingScore && (passingScore < 0 || passingScore > 100)) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(400).json({ success: false, message: 'passing_score harus antara 0 sampai 100' });
  }

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses mengubah quiz sesi ini' });
    }

    const sessionRow = await getSessionRow(moduleId, sessionId);
    if (!sessionRow) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan pada module ini' });
    }

    const quiz = await getQuizBySessionId(sessionId);
    if (!quiz) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(404).json({ success: false, message: 'Quiz untuk sesi ini belum dibuat' });
    }

    let nextBannerPath = quiz.banner_image_path;
    if (req.file) {
      const movedPath = moveTempFileTo(req.file.path, path.join(quizFolder(moduleId, sessionId), 'banner'));
      nextBannerPath = toRelativeStoragePath(movedPath);
      if (quiz.banner_image_path) {
        removeFileSafe(toAbsolutePath(quiz.banner_image_path));
      }
    }

    if (removeBanner) {
      if (nextBannerPath) {
        removeFileSafe(toAbsolutePath(nextBannerPath));
      }
      nextBannerPath = null;
    }

    await db.query(
      `UPDATE session_quizzes
       SET title = CASE WHEN ? = 1 THEN ? ELSE title END,
           description = CASE WHEN ? = 1 THEN ? ELSE description END,
           duration_minutes = CASE WHEN ? = 1 THEN ? ELSE duration_minutes END,
           max_attempts = CASE WHEN ? = 1 THEN ? ELSE max_attempts END,
           passing_score = CASE WHEN ? = 1 THEN ? ELSE passing_score END,
           banner_image_path = ?
       WHERE id = ?`,
      [
        hasTitle ? 1 : 0,
        hasTitle ? (body.title ? String(body.title).trim() : null) : null,
        hasDescription ? 1 : 0,
        hasDescription ? (body.description ? String(body.description).trim() : null) : null,
        hasDuration ? 1 : 0,
        hasDuration ? durationMinutes : null,
        hasMaxAttempts ? 1 : 0,
        hasMaxAttempts ? maxAttempts : null,
        hasPassingScore ? 1 : 0,
        hasPassingScore ? passingScore : null,
        nextBannerPath,
        quiz.id
      ]
    );

    const [rows] = await db.query('SELECT * FROM session_quizzes WHERE id = ?', [quiz.id]);
    const data = {
      ...rows[0],
      has_banner: Boolean(rows[0].banner_image_path),
      banner_download_url: rows[0].banner_image_path
        ? `/api/modules/${moduleId}/sessions/${sessionId}/quiz/banner`
        : null
    };

    return res.json({ success: true, message: 'Quiz sesi berhasil diperbarui', data });
  } catch (error) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(500).json({ success: false, message: 'Gagal memperbarui quiz sesi', error: error.message });
  }
};

const publishQuiz = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const body = req.body || {};
  const hasPublishFlag = Object.prototype.hasOwnProperty.call(body, 'is_published');

  if (!hasPublishFlag) {
    return res.status(400).json({ success: false, message: 'Field is_published wajib dikirim' });
  }

  const isPublished = toBoolean(body.is_published);

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses publish quiz sesi ini' });
    }

    const sessionRow = await getSessionRow(moduleId, sessionId);
    if (!sessionRow) {
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan pada module ini' });
    }

    const quiz = await getQuizBySessionId(sessionId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: 'Quiz untuk sesi ini belum dibuat' });
    }

    if (isPublished) {
      const stats = await getQuizQuestionStats(quiz.id);
      if (stats.totalQuestions === 0) {
        return res.status(400).json({ success: false, message: 'Quiz tidak bisa dipublish tanpa pertanyaan' });
      }

      if (stats.invalidMcqCount > 0) {
        return res.status(400).json({
          success: false,
          message: 'Quiz tidak bisa dipublish. Pastikan semua soal MCQ memiliki minimal 2 opsi dan minimal 1 jawaban benar'
        });
      }
    }

    await db.query('UPDATE session_quizzes SET is_published = ? WHERE id = ?', [isPublished ? 1 : 0, quiz.id]);

    const [rows] = await db.query('SELECT * FROM session_quizzes WHERE id = ?', [quiz.id]);
    return res.json({
      success: true,
      message: isPublished ? 'Quiz berhasil dipublish' : 'Quiz berhasil di-unpublish',
      data: rows[0]
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengubah status publish quiz', error: error.message });
  }
};

const getQuiz = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);

  try {
    const readable = await canReadModule(req.user, moduleId);
    if (!readable) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses ke quiz sesi ini' });
    }

    const sessionRow = await getSessionRow(moduleId, sessionId);
    if (!sessionRow) {
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan pada module ini' });
    }

    if (isSessionLockedForStudent(req.user, sessionRow)) {
      return res.status(403).json({ success: false, message: 'Sesi ini belum dibuka sesuai jadwal' });
    }

    const quiz = await getQuizBySessionId(sessionId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: 'Quiz untuk sesi ini belum dibuat' });
    }

    const isStudent = req.user.role === 'student';
    if (isStudent && !quiz.is_published) {
      return res.status(403).json({ success: false, message: 'Quiz belum dipublish oleh pengampu module' });
    }

    const [questions] = await db.query(
      `SELECT q.id, q.quiz_id, q.question_type, q.question_text, q.points, q.media_path, q.media_mime_type, q.sort_order, q.created_at, q.updated_at
       FROM quiz_questions q
       WHERE q.quiz_id = ?
       ORDER BY q.sort_order ASC, q.id ASC`,
      [quiz.id]
    );

    const questionIds = questions.map((question) => question.id);
    let options = [];
    if (questionIds.length > 0) {
      const placeholders = questionIds.map(() => '?').join(',');
      const [optionRows] = await db.query(
        `SELECT id, question_id, option_text, is_correct, sort_order
         FROM quiz_question_options
         WHERE question_id IN (${placeholders})
         ORDER BY sort_order ASC, id ASC`,
        questionIds
      );
      options = optionRows;
    }

    const optionMap = new Map();
    for (const option of options) {
      const list = optionMap.get(option.question_id) || [];
      list.push(isStudent
        ? {
          id: option.id,
          question_id: option.question_id,
          option_text: option.option_text,
          sort_order: option.sort_order
        }
        : option);
      optionMap.set(option.question_id, list);
    }

    const questionData = questions.map((question) => buildQuestionResponse(
      question,
      moduleId,
      sessionId,
      optionMap.get(question.id) || []
    ));

    const data = {
      ...quiz,
      has_banner: Boolean(quiz.banner_image_path),
      banner_download_url: quiz.banner_image_path
        ? `/api/modules/${moduleId}/sessions/${sessionId}/quiz/banner`
        : null,
      questions: questionData
    };

    if (isStudent) {
      const summary = await getQuizAttemptSummaryForStudent(quiz.id, req.user.id);
      data.my_attempt_summary = summary;
    }

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil data quiz sesi', error: error.message });
  }
};

const downloadQuizBanner = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);

  try {
    const readable = await canReadModule(req.user, moduleId);
    if (!readable) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses banner quiz' });
    }

    const sessionRow = await getSessionRow(moduleId, sessionId);
    if (!sessionRow) {
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan pada module ini' });
    }

    if (isSessionLockedForStudent(req.user, sessionRow)) {
      return res.status(403).json({ success: false, message: 'Sesi ini belum dibuka sesuai jadwal' });
    }

    const quiz = await getQuizBySessionId(sessionId);
    if (!quiz || !quiz.banner_image_path) {
      return res.status(404).json({ success: false, message: 'Banner quiz belum tersedia' });
    }

    if (req.user.role === 'student' && !quiz.is_published) {
      return res.status(403).json({ success: false, message: 'Quiz belum dipublish oleh pengampu module' });
    }

    const absolutePath = toAbsolutePath(quiz.banner_image_path);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ success: false, message: 'File banner quiz tidak ditemukan di storage' });
    }

    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil banner quiz', error: error.message });
  }
};

const addQuizQuestion = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const body = req.body || {};
  const questionType = body.question_type ? String(body.question_type).trim().toLowerCase() : '';
  const questionText = body.question_text ? String(body.question_text).trim() : '';
  const points = toNumber(body.points);

  if (!['mcq', 'essay'].includes(questionType)) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(400).json({ success: false, message: 'question_type wajib: mcq | essay' });
  }

  if (!questionText) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(400).json({ success: false, message: 'question_text wajib diisi' });
  }

  if (points === null || points <= 0 || points > 1000) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(400).json({ success: false, message: 'points harus angka lebih dari 0 dan maksimal 1000' });
  }

  let parsedOptions = null;
  try {
    if (questionType === 'mcq') {
      parsedOptions = normalizeQuestionOptions(parseJsonField(body.options, 'options'));
    }
  } catch (error) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(error.status || 400).json({ success: false, message: error.message });
  }

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses menambah pertanyaan quiz' });
    }

    const sessionRow = await getSessionRow(moduleId, sessionId);
    if (!sessionRow) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan pada module ini' });
    }

    const quiz = await getQuizBySessionId(sessionId);
    if (!quiz) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(404).json({ success: false, message: 'Quiz untuk sesi ini belum dibuat' });
    }

    const requestedSortOrder = toNumber(body.sort_order);
    if (requestedSortOrder !== null && (!Number.isInteger(requestedSortOrder) || requestedSortOrder <= 0)) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(400).json({ success: false, message: 'sort_order harus angka bulat lebih dari 0' });
    }

    let sortOrder = requestedSortOrder;
    if (sortOrder === null) {
      const [rows] = await db.query('SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM quiz_questions WHERE quiz_id = ?', [quiz.id]);
      sortOrder = Number(rows[0].max_sort || 0) + 1;
    }

    const [result] = await db.query(
      `INSERT INTO quiz_questions
       (quiz_id, question_type, question_text, points, media_path, media_mime_type, sort_order)
       VALUES (?, ?, ?, ?, NULL, NULL, ?)`,
      [quiz.id, questionType, questionText, points, sortOrder]
    );

    const questionId = result.insertId;
    let mediaPath = null;
    let mediaMimeType = null;

    if (req.file) {
      const movedPath = moveTempFileTo(req.file.path, path.join(quizFolder(moduleId, sessionId), 'questions', String(questionId)));
      mediaPath = toRelativeStoragePath(movedPath);
      mediaMimeType = req.file.mimetype;
      await db.query('UPDATE quiz_questions SET media_path = ?, media_mime_type = ? WHERE id = ?', [mediaPath, mediaMimeType, questionId]);
    }

    if (questionType === 'mcq') {
      for (const option of parsedOptions) {
        await db.query(
          'INSERT INTO quiz_question_options (question_id, option_text, is_correct, sort_order) VALUES (?, ?, ?, ?)',
          [questionId, option.option_text, option.is_correct ? 1 : 0, option.sort_order]
        );
      }
    }

    const question = await getQuestionById(quiz.id, questionId);
    const [optionRows] = await db.query(
      'SELECT id, question_id, option_text, is_correct, sort_order FROM quiz_question_options WHERE question_id = ? ORDER BY sort_order ASC, id ASC',
      [questionId]
    );

    return res.status(201).json({
      success: true,
      message: 'Pertanyaan quiz berhasil ditambahkan',
      data: buildQuestionResponse(question, moduleId, sessionId, optionRows)
    });
  } catch (error) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(500).json({ success: false, message: 'Gagal menambah pertanyaan quiz', error: error.message });
  }
};

const updateQuizQuestion = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const questionId = Number(req.params.questionId);
  const body = req.body || {};

  const hasQuestionType = Object.prototype.hasOwnProperty.call(body, 'question_type');
  const hasQuestionText = Object.prototype.hasOwnProperty.call(body, 'question_text');
  const hasPoints = Object.prototype.hasOwnProperty.call(body, 'points');
  const hasSortOrder = Object.prototype.hasOwnProperty.call(body, 'sort_order');
  const hasOptions = Object.prototype.hasOwnProperty.call(body, 'options');
  const removeMedia = toBoolean(body.remove_media);

  if (!hasQuestionType && !hasQuestionText && !hasPoints && !hasSortOrder && !hasOptions && !req.file && !removeMedia) {
    return res.status(400).json({ success: false, message: 'Tidak ada perubahan yang dikirim untuk pertanyaan quiz' });
  }

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses mengubah pertanyaan quiz' });
    }

    const sessionRow = await getSessionRow(moduleId, sessionId);
    if (!sessionRow) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan pada module ini' });
    }

    const quiz = await getQuizBySessionId(sessionId);
    if (!quiz) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(404).json({ success: false, message: 'Quiz untuk sesi ini belum dibuat' });
    }

    const existingQuestion = await getQuestionById(quiz.id, questionId);
    if (!existingQuestion) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(404).json({ success: false, message: 'Pertanyaan quiz tidak ditemukan' });
    }

    const nextQuestionType = hasQuestionType
      ? String(body.question_type || '').trim().toLowerCase()
      : existingQuestion.question_type;

    if (!['mcq', 'essay'].includes(nextQuestionType)) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(400).json({ success: false, message: 'question_type wajib: mcq | essay' });
    }

    const nextQuestionText = hasQuestionText
      ? (body.question_text ? String(body.question_text).trim() : '')
      : existingQuestion.question_text;

    if (!nextQuestionText) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(400).json({ success: false, message: 'question_text wajib diisi' });
    }

    const nextPoints = hasPoints ? toNumber(body.points) : Number(existingQuestion.points);
    if (nextPoints === null || nextPoints <= 0 || nextPoints > 1000) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(400).json({ success: false, message: 'points harus angka lebih dari 0 dan maksimal 1000' });
    }

    const nextSortOrder = hasSortOrder ? toNumber(body.sort_order) : Number(existingQuestion.sort_order);
    if (!Number.isInteger(nextSortOrder) || nextSortOrder <= 0) {
      if (req.file) removeFileSafe(req.file.path);
      return res.status(400).json({ success: false, message: 'sort_order harus angka bulat lebih dari 0' });
    }

    let parsedOptions = null;
    if (nextQuestionType === 'mcq') {
      if (hasOptions) {
        parsedOptions = normalizeQuestionOptions(parseJsonField(body.options, 'options'));
      }
    }

    let nextMediaPath = existingQuestion.media_path;
    let nextMediaMimeType = existingQuestion.media_mime_type;

    if (req.file) {
      const movedPath = moveTempFileTo(req.file.path, path.join(quizFolder(moduleId, sessionId), 'questions', String(questionId)));
      const movedRelativePath = toRelativeStoragePath(movedPath);

      if (existingQuestion.media_path) {
        removeFileSafe(toAbsolutePath(existingQuestion.media_path));
      }

      nextMediaPath = movedRelativePath;
      nextMediaMimeType = req.file.mimetype;
    }

    if (removeMedia) {
      if (nextMediaPath) {
        removeFileSafe(toAbsolutePath(nextMediaPath));
      }
      nextMediaPath = null;
      nextMediaMimeType = null;
    }

    await db.query(
      `UPDATE quiz_questions
       SET question_type = ?,
           question_text = ?,
           points = ?,
           sort_order = ?,
           media_path = ?,
           media_mime_type = ?
       WHERE id = ?`,
      [nextQuestionType, nextQuestionText, nextPoints, nextSortOrder, nextMediaPath, nextMediaMimeType, questionId]
    );

    if (nextQuestionType === 'essay') {
      await db.query('DELETE FROM quiz_question_options WHERE question_id = ?', [questionId]);
    }

    if (nextQuestionType === 'mcq' && parsedOptions) {
      await db.query('DELETE FROM quiz_question_options WHERE question_id = ?', [questionId]);
      for (const option of parsedOptions) {
        await db.query(
          'INSERT INTO quiz_question_options (question_id, option_text, is_correct, sort_order) VALUES (?, ?, ?, ?)',
          [questionId, option.option_text, option.is_correct ? 1 : 0, option.sort_order]
        );
      }
    }

    if (nextQuestionType === 'mcq' && !parsedOptions) {
      const [optionRows] = await db.query('SELECT id FROM quiz_question_options WHERE question_id = ?', [questionId]);
      if (optionRows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Pertanyaan MCQ wajib memiliki options. Kirim field options untuk mengisi opsi jawaban'
        });
      }
    }

    const question = await getQuestionById(quiz.id, questionId);
    const [optionRows] = await db.query(
      'SELECT id, question_id, option_text, is_correct, sort_order FROM quiz_question_options WHERE question_id = ? ORDER BY sort_order ASC, id ASC',
      [questionId]
    );

    return res.json({
      success: true,
      message: 'Pertanyaan quiz berhasil diperbarui',
      data: buildQuestionResponse(question, moduleId, sessionId, optionRows)
    });
  } catch (error) {
    if (req.file) removeFileSafe(req.file.path);
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Gagal memperbarui pertanyaan quiz' });
  }
};

const deleteQuizQuestion = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const questionId = Number(req.params.questionId);

  try {
    const manageable = await canManageModule(req.user, moduleId);
    if (!manageable) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses menghapus pertanyaan quiz' });
    }

    const sessionRow = await getSessionRow(moduleId, sessionId);
    if (!sessionRow) {
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan pada module ini' });
    }

    const quiz = await getQuizBySessionId(sessionId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: 'Quiz untuk sesi ini belum dibuat' });
    }

    const question = await getQuestionById(quiz.id, questionId);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Pertanyaan quiz tidak ditemukan' });
    }

    await db.query('DELETE FROM quiz_questions WHERE id = ?', [questionId]);

    if (question.media_path) {
      removeFileSafe(toAbsolutePath(question.media_path));
    }

    return res.json({ success: true, message: 'Pertanyaan quiz berhasil dihapus' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal menghapus pertanyaan quiz', error: error.message });
  }
};

const downloadQuestionMedia = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const questionId = Number(req.params.questionId);

  try {
    const readable = await canReadModule(req.user, moduleId);
    if (!readable) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses media pertanyaan quiz' });
    }

    const sessionRow = await getSessionRow(moduleId, sessionId);
    if (!sessionRow) {
      return res.status(404).json({ success: false, message: 'Sesi tidak ditemukan pada module ini' });
    }

    if (isSessionLockedForStudent(req.user, sessionRow)) {
      return res.status(403).json({ success: false, message: 'Sesi ini belum dibuka sesuai jadwal' });
    }

    const quiz = await getQuizBySessionId(sessionId);
    if (!quiz) {
      return res.status(404).json({ success: false, message: 'Quiz untuk sesi ini belum dibuat' });
    }

    if (req.user.role === 'student' && !quiz.is_published) {
      return res.status(403).json({ success: false, message: 'Quiz belum dipublish oleh pengampu module' });
    }

    const question = await getQuestionById(quiz.id, questionId);
    if (!question || !question.media_path) {
      return res.status(404).json({ success: false, message: 'Media pertanyaan quiz tidak ditemukan' });
    }

    const absolutePath = toAbsolutePath(question.media_path);
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ success: false, message: 'File media tidak ditemukan di storage' });
    }

    if (question.media_mime_type) {
      res.type(question.media_mime_type);
    }

    return res.sendFile(absolutePath);
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil media pertanyaan quiz', error: error.message });
  }
};

const startQuizAttempt = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);

  try {
    const result = await quizAttemptService.startAttempt({ moduleId, sessionId, user: req.user });
    return res.status(result.statusCode).json({ success: true, message: result.message, data: result.data });
  } catch (error) {
    const response = { success: false, message: error.status ? error.message : 'Gagal memulai attempt quiz' };
    if (error.data !== undefined) {
      response.data = error.data;
    }
    return res.status(error.status || 500).json(response);
  }
};

const submitQuizAttempt = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const body = req.body || {};

  const attemptId = Number(body.attempt_id);
  if (!Number.isInteger(attemptId) || attemptId <= 0) {
    return res.status(400).json({ success: false, message: 'attempt_id tidak valid' });
  }

  let answers;
  try {
    answers = parseJsonField(body.answers, 'answers');
  } catch (error) {
    return res.status(error.status || 400).json({ success: false, message: error.message });
  }

  if (!Array.isArray(answers)) {
    return res.status(400).json({ success: false, message: 'answers wajib berupa array' });
  }

  try {
    const result = await quizAttemptService.submitAttempt({
      moduleId,
      sessionId,
      user: req.user,
      attemptId,
      answers
    });

    return res.status(result.statusCode).json({ success: true, message: result.message, data: result.data });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Gagal submit attempt quiz' });
  }
};

const listQuizAttempts = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const statusFilter = req.query.status ? String(req.query.status).trim().toLowerCase() : null;

  try {
    const rows = await quizAttemptService.listAttempts({ moduleId, sessionId, user: req.user, statusFilter });
    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Gagal mengambil daftar attempt quiz' });
  }
};

const getQuizAttemptDetail = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const attemptId = Number(req.params.attemptId);

  try {
    const data = await quizAttemptService.getAttemptDetail({ moduleId, sessionId, attemptId, user: req.user });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Gagal mengambil detail attempt quiz' });
  }
};

const reviewEssayAttempt = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const attemptId = Number(req.params.attemptId);

  let reviews;
  try {
    reviews = parseJsonField(req.body && req.body.reviews, 'reviews');
  } catch (error) {
    return res.status(error.status || 400).json({ success: false, message: error.message });
  }

  try {
    const data = await quizAttemptService.reviewEssay({ moduleId, sessionId, attemptId, user: req.user, reviews });
    return res.json({
      success: true,
      message: 'Penilaian essai berhasil disimpan',
      data
    });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Gagal melakukan review essai' });
  }
};

const getQuizLeaderboard = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const mode = req.query && req.query.mode ? String(req.query.mode).trim().toLowerCase() : 'latest';

  try {
    const data = await quizAttemptService.getLeaderboard({ moduleId, sessionId, user: req.user, mode });
    return res.json({ success: true, data });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal mengambil leaderboard quiz'
    });
  }
};

const updateQuizLeaderboardVisibility = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const visibility = req.body && req.body.leaderboard_visibility;

  try {
    const data = await quizAttemptService.updateLeaderboardVisibility({
      moduleId,
      sessionId,
      user: req.user,
      visibility
    });

    return res.json({
      success: true,
      message: 'Visibility leaderboard quiz berhasil diperbarui',
      data
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal mengubah visibility leaderboard quiz'
    });
  }
};

const deleteQuizAttempt = async (req, res) => {
  const moduleId = Number(req.params.moduleId);
  const sessionId = Number(req.params.sessionId);
  const attemptId = Number(req.params.attemptId);

  try {
    const data = await quizAttemptService.deleteAttempt({
      moduleId,
      sessionId,
      attemptId,
      user: req.user
    });

    return res.json({
      success: true,
      message: 'Attempt quiz berhasil dihapus',
      data
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal menghapus attempt quiz'
    });
  }
};

module.exports = {
  createQuiz,
  updateQuiz,
  publishQuiz,
  getQuiz,
  downloadQuizBanner,
  addQuizQuestion,
  updateQuizQuestion,
  deleteQuizQuestion,
  downloadQuestionMedia,
  startQuizAttempt,
  submitQuizAttempt,
  listQuizAttempts,
  getQuizAttemptDetail,
  reviewEssayAttempt,
  generateQuizDraft,
  getQuizLeaderboard,
  updateQuizLeaderboardVisibility,
  deleteQuizAttempt
};
