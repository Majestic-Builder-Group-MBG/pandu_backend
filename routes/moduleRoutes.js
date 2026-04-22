const express = require('express');
const auth = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');
const upload = require('../middleware/uploadMiddleware');
const {
  createModule,
  getModules,
  getModuleById,
  downloadModuleBanner,
  updateModule,
  deleteModule,
  regenerateEnrollKey,
  getModuleSessions,
  createSession,
  updateSession,
  deleteSession,
  getSessionSchedule,
  updateSessionSchedule,
  createSessionContentViewUrl,
  addSessionContent,
  updateSessionContent,
  getSessionContents,
  deleteSessionContent,
  downloadSessionContentFile
} = require('../controllers/moduleController');
const {
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
  reviewEssayAttempt
} = require('../controllers/quizController');
const {
  getSessionReminder,
  upsertSessionReminder,
  deleteSessionReminder
} = require('../controllers/reminderController');

const router = express.Router();

router.get('/', auth, getModules);
router.post('/', auth, authorize('teacher', 'admin'), upload.single('banner'), createModule);
router.get('/:moduleId', auth, getModuleById);
router.get('/:moduleId/banner', auth, downloadModuleBanner);
router.put('/:moduleId', auth, authorize('teacher', 'admin'), upload.single('banner'), updateModule);
router.delete('/:moduleId', auth, authorize('teacher', 'admin'), deleteModule);
router.patch('/:moduleId/regenerate-enroll-key', auth, authorize('teacher', 'admin'), regenerateEnrollKey);

router.get('/:moduleId/sessions', auth, getModuleSessions);
router.post('/:moduleId/sessions', auth, authorize('teacher', 'admin'), upload.none(), createSession);
router.put('/:moduleId/sessions/:sessionId', auth, authorize('teacher', 'admin'), upload.none(), updateSession);
router.delete('/:moduleId/sessions/:sessionId', auth, authorize('teacher', 'admin'), deleteSession);
router.get('/:moduleId/sessions/:sessionId/schedule', auth, getSessionSchedule);
router.patch('/:moduleId/sessions/:sessionId/schedule', auth, authorize('teacher', 'admin'), upload.none(), updateSessionSchedule);
router.get('/:moduleId/sessions/:sessionId/reminder', auth, upload.none(), getSessionReminder);
router.put('/:moduleId/sessions/:sessionId/reminder', auth, upload.none(), upsertSessionReminder);
router.delete('/:moduleId/sessions/:sessionId/reminder', auth, upload.none(), deleteSessionReminder);

router.get('/:moduleId/sessions/:sessionId/contents', auth, getSessionContents);
router.get('/:moduleId/sessions/:sessionId/contents/:contentId/file', auth, downloadSessionContentFile);
router.post('/:moduleId/sessions/:sessionId/contents/:contentId/view-url', auth, createSessionContentViewUrl);
router.post('/:moduleId/sessions/:sessionId/contents', auth, authorize('teacher', 'admin'), upload.single('file'), addSessionContent);
router.put('/:moduleId/sessions/:sessionId/contents/:contentId', auth, authorize('teacher', 'admin'), upload.single('file'), updateSessionContent);
router.delete('/:moduleId/sessions/:sessionId/contents/:contentId', auth, authorize('teacher', 'admin'), deleteSessionContent);

router.get('/:moduleId/sessions/:sessionId/quiz', auth, getQuiz);
router.post('/:moduleId/sessions/:sessionId/quiz', auth, authorize('teacher', 'admin'), upload.single('banner'), createQuiz);
router.put('/:moduleId/sessions/:sessionId/quiz', auth, authorize('teacher', 'admin'), upload.single('banner'), updateQuiz);
router.patch('/:moduleId/sessions/:sessionId/quiz/publish', auth, authorize('teacher', 'admin'), upload.none(), publishQuiz);
router.get('/:moduleId/sessions/:sessionId/quiz/banner', auth, downloadQuizBanner);

router.post('/:moduleId/sessions/:sessionId/quiz/questions', auth, authorize('teacher', 'admin'), upload.single('media'), addQuizQuestion);
router.put('/:moduleId/sessions/:sessionId/quiz/questions/:questionId', auth, authorize('teacher', 'admin'), upload.single('media'), updateQuizQuestion);
router.delete('/:moduleId/sessions/:sessionId/quiz/questions/:questionId', auth, authorize('teacher', 'admin'), deleteQuizQuestion);
router.get('/:moduleId/sessions/:sessionId/quiz/questions/:questionId/media', auth, downloadQuestionMedia);

router.post('/:moduleId/sessions/:sessionId/quiz/start', auth, upload.none(), startQuizAttempt);
router.post('/:moduleId/sessions/:sessionId/quiz/submit', auth, upload.none(), submitQuizAttempt);

router.get('/:moduleId/sessions/:sessionId/quiz/attempts', auth, authorize('teacher', 'admin'), listQuizAttempts);
router.get('/:moduleId/sessions/:sessionId/quiz/attempts/:attemptId', auth, authorize('teacher', 'admin'), getQuizAttemptDetail);
router.patch('/:moduleId/sessions/:sessionId/quiz/attempts/:attemptId/review', auth, authorize('teacher', 'admin'), upload.none(), reviewEssayAttempt);

module.exports = router;
