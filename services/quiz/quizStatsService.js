const db = require('../../config/db');

class QuizStatsService {
  async getQuizQuestionStats(quizId) {
    const [countRows] = await db.query(
      `SELECT
         COUNT(*) AS total_questions,
         SUM(CASE WHEN question_type = 'mcq' THEN 1 ELSE 0 END) AS total_mcq,
         SUM(CASE WHEN question_type = 'essay' THEN 1 ELSE 0 END) AS total_essay
       FROM quiz_questions
       WHERE quiz_id = ?`,
      [quizId]
    );

    const [invalidRows] = await db.query(
      `SELECT COUNT(*) AS invalid_count
       FROM quiz_questions qq
       LEFT JOIN (
         SELECT question_id,
           COUNT(*) AS option_count,
           SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct_count
         FROM quiz_question_options
         GROUP BY question_id
       ) stats ON stats.question_id = qq.id
       WHERE qq.quiz_id = ?
         AND qq.question_type = 'mcq'
         AND (COALESCE(stats.option_count, 0) < 2 OR COALESCE(stats.correct_count, 0) < 1)`,
      [quizId]
    );

    return {
      totalQuestions: Number(countRows[0].total_questions || 0),
      totalMcq: Number(countRows[0].total_mcq || 0),
      totalEssay: Number(countRows[0].total_essay || 0),
      invalidMcqCount: Number(invalidRows[0].invalid_count || 0)
    };
  }

  async getQuizAttemptSummaryForStudent(quizId, studentId) {
    const [aggregateRows] = await db.query(
      `SELECT COUNT(*) AS attempts_used,
         SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count
       FROM quiz_attempts
       WHERE quiz_id = ? AND student_id = ?`,
      [quizId, studentId]
    );

    const [latestRows] = await db.query(
      `SELECT id, attempt_no, status, started_at, expires_at, submitted_at, auto_score, manual_score, final_score, passed
       FROM quiz_attempts
       WHERE quiz_id = ? AND student_id = ?
       ORDER BY attempt_no DESC
       LIMIT 1`,
      [quizId, studentId]
    );

    return {
      attempts_used: Number(aggregateRows[0].attempts_used || 0),
      in_progress_count: Number(aggregateRows[0].in_progress_count || 0),
      latest_attempt: latestRows[0] || null
    };
  }
}

module.exports = {
  quizStatsService: new QuizStatsService()
};
