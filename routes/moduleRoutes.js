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
  addSessionContent,
  getSessionContents,
  deleteSessionContent,
  downloadSessionContentFile
} = require('../controllers/moduleController');

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

router.get('/:moduleId/sessions/:sessionId/contents', auth, getSessionContents);
router.get('/:moduleId/sessions/:sessionId/contents/:contentId/file', auth, downloadSessionContentFile);
router.post('/:moduleId/sessions/:sessionId/contents', auth, authorize('teacher', 'admin'), upload.single('file'), addSessionContent);
router.delete('/:moduleId/sessions/:sessionId/contents/:contentId', auth, authorize('teacher', 'admin'), deleteSessionContent);

module.exports = router;
