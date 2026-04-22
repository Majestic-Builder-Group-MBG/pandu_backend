const db = require('../../config/db');
const { quizAccessService } = require('./quizAccessService');
const { quizValueService } = require('./quizValueService');

const createHttpError = (status, message, data = undefined) => {
  const error = new Error(message);
  error.status = status;
  if (data !== undefined) {
    error.data = data;
  }
  return error;
};

class QuizAttemptService {
  async getQuizBySessionId(sessionId) {
    const [rows] = await db.query('SELECT * FROM session_quizzes WHERE session_id = ? LIMIT 1', [sessionId]);
    return rows[0] || null;
  }

  async startAttempt({ moduleId, sessionId, user }) {
    await quizAccessService.assertStudentCanAccessQuiz({ user }, moduleId, sessionId);

    const quiz = await this.getQuizBySessionId(sessionId);
    if (!quiz) {
      throw createHttpError(404, 'Quiz untuk sesi ini belum dibuat');
    }

    if (!quiz.is_published) {
      throw createHttpError(403, 'Quiz belum dipublish oleh pengampu module');
    }

    const [questionRows] = await db.query('SELECT id FROM quiz_questions WHERE quiz_id = ? LIMIT 1', [quiz.id]);
    if (questionRows.length === 0) {
      throw createHttpError(400, 'Quiz belum memiliki pertanyaan');
    }

    const [ongoingRows] = await db.query(
      `SELECT *
       FROM quiz_attempts
       WHERE quiz_id = ? AND student_id = ? AND status = 'in_progress'
       ORDER BY attempt_no DESC
       LIMIT 1`,
      [quiz.id, user.id]
    );

    if (ongoingRows.length > 0) {
      const ongoing = ongoingRows[0];
      const isExpired = new Date(ongoing.expires_at) < new Date();
      if (!isExpired) {
        const remainingSeconds = Math.max(0, Math.floor((new Date(ongoing.expires_at).getTime() - Date.now()) / 1000));
        return {
          statusCode: 200,
          message: 'Attempt aktif ditemukan',
          data: {
            ...ongoing,
            remaining_seconds: remainingSeconds
          }
        };
      }
    }

    const [attemptStatRows] = await db.query(
      'SELECT COALESCE(MAX(attempt_no), 0) AS max_attempt_no, COUNT(*) AS attempts_used FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?',
      [quiz.id, user.id]
    );

    const attemptsUsed = Number(attemptStatRows[0].attempts_used || 0);
    const nextAttemptNo = Number(attemptStatRows[0].max_attempt_no || 0) + 1;

    if (attemptsUsed >= Number(quiz.max_attempts)) {
      throw createHttpError(403, 'Batas attempt quiz sudah habis', {
        attempts_used: attemptsUsed,
        max_attempts: Number(quiz.max_attempts)
      });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + (Number(quiz.duration_minutes) * 60 * 1000));

    const [result] = await db.query(
      `INSERT INTO quiz_attempts
       (quiz_id, student_id, attempt_no, status, started_at, expires_at)
       VALUES (?, ?, ?, 'in_progress', ?, ?)`,
      [quiz.id, user.id, nextAttemptNo, now, expiresAt]
    );

    const [rows] = await db.query('SELECT * FROM quiz_attempts WHERE id = ?', [result.insertId]);
    const attempt = rows[0];
    const remainingSeconds = Math.max(0, Math.floor((new Date(attempt.expires_at).getTime() - Date.now()) / 1000));

    return {
      statusCode: 201,
      message: 'Attempt quiz dimulai',
      data: {
        ...attempt,
        remaining_seconds: remainingSeconds
      }
    };
  }

  async submitAttempt({ moduleId, sessionId, user, attemptId, answers }) {
    await quizAccessService.assertStudentCanAccessQuiz({ user }, moduleId, sessionId);

    const quiz = await this.getQuizBySessionId(sessionId);
    if (!quiz) {
      throw createHttpError(404, 'Quiz untuk sesi ini belum dibuat');
    }

    if (!quiz.is_published) {
      throw createHttpError(403, 'Quiz belum dipublish oleh pengampu module');
    }

    const [attemptRows] = await db.query(
      `SELECT *
       FROM quiz_attempts
       WHERE id = ? AND quiz_id = ? AND student_id = ?
       LIMIT 1`,
      [attemptId, quiz.id, user.id]
    );

    if (attemptRows.length === 0) {
      throw createHttpError(404, 'Attempt quiz tidak ditemukan');
    }

    const attempt = attemptRows[0];
    if (attempt.status !== 'in_progress') {
      throw createHttpError(409, 'Attempt quiz ini sudah disubmit sebelumnya');
    }

    const [questionRows] = await db.query(
      'SELECT id, question_type, points FROM quiz_questions WHERE quiz_id = ? ORDER BY sort_order ASC, id ASC',
      [quiz.id]
    );

    if (questionRows.length === 0) {
      throw createHttpError(400, 'Quiz belum memiliki pertanyaan');
    }

    const questionIds = questionRows.map((question) => question.id);
    const placeholders = questionIds.map(() => '?').join(',');
    const [optionRows] = await db.query(
      `SELECT id, question_id, is_correct
       FROM quiz_question_options
       WHERE question_id IN (${placeholders})`,
      questionIds
    );

    const optionMapByQuestion = new Map();
    for (const optionRow of optionRows) {
      const map = optionMapByQuestion.get(optionRow.question_id) || new Map();
      map.set(optionRow.id, optionRow);
      optionMapByQuestion.set(optionRow.question_id, map);
    }

    const answerMap = new Map();
    const validQuestionIdSet = new Set(questionIds);
    for (const answer of answers) {
      const questionId = Number(answer && answer.question_id);
      if (!Number.isInteger(questionId) || questionId <= 0) {
        throw createHttpError(400, 'question_id pada answers harus angka valid');
      }

      if (!validQuestionIdSet.has(questionId)) {
        throw createHttpError(400, `question_id ${questionId} tidak terdaftar pada quiz ini`);
      }

      answerMap.set(questionId, answer || {});
    }

    const isTimedOut = new Date(attempt.expires_at) < new Date();
    const submittedAt = new Date();

    let totalPoints = 0;
    let autoEarned = 0;
    let hasEssay = false;
    const answerRowsToInsert = [];

    for (const question of questionRows) {
      totalPoints += Number(question.points);
      const providedAnswer = answerMap.get(question.id) || {};

      if (question.question_type === 'mcq') {
        const selectedOptionId = Number(providedAnswer.selected_option_id);
        let isCorrect = false;
        let autoPoints = 0;

        if (Number.isInteger(selectedOptionId) && selectedOptionId > 0) {
          const optionMap = optionMapByQuestion.get(question.id) || new Map();
          const optionRow = optionMap.get(selectedOptionId);

          if (optionRow) {
            isCorrect = Number(optionRow.is_correct) === 1;
            if (isCorrect) {
              autoPoints = Number(question.points);
            }
          }
        }

        autoEarned += autoPoints;
        answerRowsToInsert.push({
          question_id: question.id,
          selected_option_id: Number.isInteger(selectedOptionId) && selectedOptionId > 0 ? selectedOptionId : null,
          essay_answer: null,
          is_correct: isCorrect ? 1 : 0,
          auto_points: autoPoints,
          manual_points: null
        });
      } else {
        hasEssay = true;
        const essayAnswer = providedAnswer.essay_answer ? String(providedAnswer.essay_answer).trim() : null;
        answerRowsToInsert.push({
          question_id: question.id,
          selected_option_id: null,
          essay_answer: essayAnswer,
          is_correct: null,
          auto_points: 0,
          manual_points: null
        });
      }
    }

    const autoScore = totalPoints > 0 ? (autoEarned / totalPoints) * 100 : 0;
    const finalScore = autoScore;

    let nextStatus = 'graded';
    let passed = finalScore >= Number(quiz.passing_score) ? 1 : 0;
    let gradedAt = submittedAt;

    if (hasEssay) {
      nextStatus = isTimedOut ? 'auto_submitted' : 'submitted_pending_review';
      passed = null;
      gradedAt = null;
    } else if (isTimedOut) {
      nextStatus = 'auto_submitted';
    }

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      await connection.query('DELETE FROM quiz_attempt_answers WHERE attempt_id = ?', [attempt.id]);

      for (const row of answerRowsToInsert) {
        await connection.query(
          `INSERT INTO quiz_attempt_answers
           (attempt_id, question_id, selected_option_id, essay_answer, is_correct, auto_points, manual_points)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            attempt.id,
            row.question_id,
            row.selected_option_id,
            row.essay_answer,
            row.is_correct,
            row.auto_points,
            row.manual_points
          ]
        );
      }

      await connection.query(
        `UPDATE quiz_attempts
         SET status = ?,
             submitted_at = ?,
             total_points = ?,
             auto_score = ?,
             manual_score = 0,
             final_score = ?,
             passed = ?,
             graded_at = ?,
             graded_by_user_id = ?
         WHERE id = ?`,
        [nextStatus, submittedAt, totalPoints, autoScore, finalScore, passed, gradedAt, null, attempt.id]
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const [updatedRows] = await db.query('SELECT * FROM quiz_attempts WHERE id = ?', [attempt.id]);
    return {
      statusCode: 200,
      message: hasEssay
        ? 'Jawaban quiz berhasil disubmit. Menunggu penilaian essai oleh pengampu.'
        : 'Jawaban quiz berhasil disubmit dan langsung dinilai sistem',
      data: updatedRows[0]
    };
  }

  async listAttempts({ moduleId, sessionId, user, statusFilter }) {
    const validStatuses = new Set(['in_progress', 'submitted_pending_review', 'graded', 'auto_submitted']);
    if (statusFilter && !validStatuses.has(statusFilter)) {
      throw createHttpError(400, 'Query status tidak valid');
    }

    const manageable = await quizAccessService.canManageModule(user, moduleId);
    if (!manageable) {
      throw createHttpError(403, 'Tidak memiliki akses melihat attempt quiz');
    }

    const sessionRow = await quizAccessService.getSessionRow(moduleId, sessionId);
    if (!sessionRow) {
      throw createHttpError(404, 'Sesi tidak ditemukan pada module ini');
    }

    const quiz = await this.getQuizBySessionId(sessionId);
    if (!quiz) {
      throw createHttpError(404, 'Quiz untuk sesi ini belum dibuat');
    }

    let whereSql = 'WHERE qa.quiz_id = ?';
    const params = [quiz.id];

    if (statusFilter) {
      whereSql += ' AND qa.status = ?';
      params.push(statusFilter);
    }

    const [rows] = await db.query(
      `SELECT qa.id, qa.quiz_id, qa.student_id, qa.attempt_no, qa.status, qa.started_at, qa.expires_at,
         qa.submitted_at, qa.auto_score, qa.manual_score, qa.final_score, qa.passed, qa.graded_at,
         s.name AS student_name, s.email AS student_email
       FROM quiz_attempts qa
       JOIN users s ON s.id = qa.student_id
       ${whereSql}
       ORDER BY qa.attempt_no DESC, qa.id DESC`,
      params
    );

    return rows;
  }

  async getAttemptDetail({ moduleId, sessionId, attemptId, user }) {
    if (!Number.isInteger(attemptId) || attemptId <= 0) {
      throw createHttpError(400, 'attemptId tidak valid');
    }

    const manageable = await quizAccessService.canManageModule(user, moduleId);
    if (!manageable) {
      throw createHttpError(403, 'Tidak memiliki akses melihat detail attempt quiz');
    }

    const sessionRow = await quizAccessService.getSessionRow(moduleId, sessionId);
    if (!sessionRow) {
      throw createHttpError(404, 'Sesi tidak ditemukan pada module ini');
    }

    const quiz = await this.getQuizBySessionId(sessionId);
    if (!quiz) {
      throw createHttpError(404, 'Quiz untuk sesi ini belum dibuat');
    }

    const [attemptRows] = await db.query(
      `SELECT qa.*, s.name AS student_name, s.email AS student_email
       FROM quiz_attempts qa
       JOIN users s ON s.id = qa.student_id
       WHERE qa.id = ? AND qa.quiz_id = ?
       LIMIT 1`,
      [attemptId, quiz.id]
    );

    if (attemptRows.length === 0) {
      throw createHttpError(404, 'Attempt quiz tidak ditemukan');
    }

    const [answerRows] = await db.query(
      `SELECT a.id AS answer_id, a.attempt_id, a.question_id, a.selected_option_id, a.essay_answer,
         a.is_correct, a.auto_points, a.manual_points, a.reviewer_feedback, a.reviewed_at,
         q.question_type, q.question_text, q.points AS question_points,
         opt.option_text AS selected_option_text
       FROM quiz_attempt_answers a
       JOIN quiz_questions q ON q.id = a.question_id
       LEFT JOIN quiz_question_options opt ON opt.id = a.selected_option_id
       WHERE a.attempt_id = ?
       ORDER BY q.sort_order ASC, q.id ASC`,
      [attemptId]
    );

    return { ...attemptRows[0], answers: answerRows };
  }

  async reviewEssay({ moduleId, sessionId, attemptId, user, reviews }) {
    if (!Number.isInteger(attemptId) || attemptId <= 0) {
      throw createHttpError(400, 'attemptId tidak valid');
    }

    if (!Array.isArray(reviews) || reviews.length === 0) {
      throw createHttpError(400, 'reviews wajib berupa array dan tidak boleh kosong');
    }

    const manageable = await quizAccessService.canManageModule(user, moduleId);
    if (!manageable) {
      throw createHttpError(403, 'Tidak memiliki akses menilai jawaban essai quiz');
    }

    const sessionRow = await quizAccessService.getSessionRow(moduleId, sessionId);
    if (!sessionRow) {
      throw createHttpError(404, 'Sesi tidak ditemukan pada module ini');
    }

    const quiz = await this.getQuizBySessionId(sessionId);
    if (!quiz) {
      throw createHttpError(404, 'Quiz untuk sesi ini belum dibuat');
    }

    const [attemptRows] = await db.query('SELECT * FROM quiz_attempts WHERE id = ? AND quiz_id = ? LIMIT 1', [attemptId, quiz.id]);
    if (attemptRows.length === 0) {
      throw createHttpError(404, 'Attempt quiz tidak ditemukan');
    }

    const attempt = attemptRows[0];
    if (!['submitted_pending_review', 'auto_submitted'].includes(attempt.status)) {
      throw createHttpError(409, 'Attempt quiz ini tidak dalam status yang bisa dinilai essai');
    }

    const [essayAnswerRows] = await db.query(
      `SELECT a.id AS answer_id, a.question_id, q.points AS question_points
       FROM quiz_attempt_answers a
       JOIN quiz_questions q ON q.id = a.question_id
       WHERE a.attempt_id = ? AND q.question_type = 'essay'`,
      [attemptId]
    );

    if (essayAnswerRows.length === 0) {
      throw createHttpError(400, 'Attempt ini tidak memiliki jawaban essai untuk dinilai');
    }

    const essayByQuestionId = new Map();
    for (const essay of essayAnswerRows) {
      essayByQuestionId.set(essay.question_id, essay);
    }

    const normalizedReviews = [];
    for (const review of reviews) {
      const questionId = Number(review && review.question_id);
      const manualPoints = quizValueService.toNumber(review && review.manual_points);
      const feedback = review && Object.prototype.hasOwnProperty.call(review, 'reviewer_feedback')
        ? (review.reviewer_feedback ? String(review.reviewer_feedback).trim() : null)
        : null;

      if (!Number.isInteger(questionId) || questionId <= 0) {
        throw createHttpError(400, 'question_id pada reviews harus angka valid');
      }

      if (manualPoints === null || manualPoints < 0) {
        throw createHttpError(400, 'manual_points pada reviews harus angka >= 0');
      }

      const essayAnswer = essayByQuestionId.get(questionId);
      if (!essayAnswer) {
        throw createHttpError(400, `question_id ${questionId} bukan pertanyaan essai pada attempt ini`);
      }

      if (manualPoints > Number(essayAnswer.question_points)) {
        throw createHttpError(
          400,
          `manual_points untuk question_id ${questionId} tidak boleh lebih dari bobot soal (${essayAnswer.question_points})`
        );
      }

      normalizedReviews.push({
        answer_id: essayAnswer.answer_id,
        question_id: questionId,
        manual_points: manualPoints,
        reviewer_feedback: feedback
      });
    }

    const reviewedQuestionIds = new Set(normalizedReviews.map((item) => item.question_id));
    const missingReview = essayAnswerRows.find((essayAnswer) => !reviewedQuestionIds.has(essayAnswer.question_id));
    if (missingReview) {
      throw createHttpError(400, 'Semua pertanyaan essai harus dinilai pada satu proses review');
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      for (const review of normalizedReviews) {
        await connection.query(
          `UPDATE quiz_attempt_answers
           SET manual_points = ?, reviewer_feedback = ?, reviewed_by_user_id = ?, reviewed_at = ?
           WHERE id = ?`,
          [review.manual_points, review.reviewer_feedback, user.id, new Date(), review.answer_id]
        );
      }

      const [scoreRows] = await connection.query(
        `SELECT
           COALESCE(SUM(q.points), 0) AS total_points,
           COALESCE(SUM(a.auto_points), 0) AS auto_earned,
           COALESCE(SUM(CASE WHEN q.question_type = 'essay' THEN COALESCE(a.manual_points, 0) ELSE 0 END), 0) AS manual_earned,
           SUM(CASE WHEN q.question_type = 'essay' AND a.manual_points IS NULL THEN 1 ELSE 0 END) AS pending_essay_reviews
         FROM quiz_attempt_answers a
         JOIN quiz_questions q ON q.id = a.question_id
         WHERE a.attempt_id = ?`,
        [attemptId]
      );

      const score = scoreRows[0];
      const totalPoints = Number(score.total_points || 0);
      const autoEarned = Number(score.auto_earned || 0);
      const manualEarned = Number(score.manual_earned || 0);
      const pendingEssayReviews = Number(score.pending_essay_reviews || 0);

      const autoScore = totalPoints > 0 ? (autoEarned / totalPoints) * 100 : 0;
      const manualScore = totalPoints > 0 ? (manualEarned / totalPoints) * 100 : 0;
      const finalScore = autoScore + manualScore;

      const isFinalized = pendingEssayReviews === 0;
      const nextStatus = isFinalized ? 'graded' : attempt.status;
      const passed = isFinalized ? (finalScore >= Number(quiz.passing_score) ? 1 : 0) : null;

      await connection.query(
        `UPDATE quiz_attempts
         SET status = ?,
             auto_score = ?,
             manual_score = ?,
             final_score = ?,
             passed = ?,
             graded_at = ?,
             graded_by_user_id = ?
         WHERE id = ?`,
        [nextStatus, autoScore, manualScore, finalScore, passed, isFinalized ? new Date() : null, isFinalized ? user.id : null, attemptId]
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const [updatedRows] = await db.query('SELECT * FROM quiz_attempts WHERE id = ?', [attemptId]);
    return updatedRows[0];
  }
}

module.exports = {
  quizAttemptService: new QuizAttemptService(),
  createHttpError
};
