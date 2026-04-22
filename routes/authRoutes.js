const express = require('express');
const router = express.Router();

const auth = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');
const { authRateLimiter, codeIssueRateLimiter } = require('../middleware/rateLimitMiddleware');
const { register, login, logout } = require('../controllers/authController');
const {
  createRegistrationCode,
  listRegistrationCodes,
  getRegistrationCodeSummary,
  revokeRegistrationCode,
  getRegistrationCodeUsages,
  archiveExpiredRegistrationCodes,
  deleteExpiredRegistrationCodes
} = require('../controllers/registrationCodeController');

router.post('/register', express.text({ type: 'text/plain' }), authRateLimiter, register);
router.post('/login', express.text({ type: 'text/plain' }), authRateLimiter, login);
router.post('/logout', auth, logout);

router.post('/register-codes', auth, authorize('admin', 'teacher'), codeIssueRateLimiter, createRegistrationCode);
router.get('/register-codes', auth, authorize('admin', 'teacher'), listRegistrationCodes);
router.get('/register-codes/summary', auth, authorize('admin', 'teacher'), getRegistrationCodeSummary);
router.get('/register-codes/:codeId/usages', auth, authorize('admin', 'teacher'), getRegistrationCodeUsages);
router.patch('/register-codes/:codeId/revoke', auth, authorize('admin', 'teacher'), revokeRegistrationCode);
router.patch('/register-codes/expired/archive', auth, authorize('admin', 'teacher'), archiveExpiredRegistrationCodes);
router.delete('/register-codes/expired', auth, authorize('admin', 'teacher'), deleteExpiredRegistrationCodes);

module.exports = router;
