const express = require('express');
const auth = require('../middleware/authMiddleware');
const authorize = require('../middleware/roleMiddleware');
const upload = require('../middleware/uploadMiddleware');
const {
  listPasswordChangeRequestInbox,
  issuePasswordChangeOtp,
  rejectPasswordChangeRequest
} = require('../controllers/passwordChangeRequestController');

const router = express.Router();

router.get('/inbox', auth, authorize('admin', 'teacher'), listPasswordChangeRequestInbox);
router.patch('/:requestId/issue-otp', auth, authorize('admin', 'teacher'), upload.none(), issuePasswordChangeOtp);
router.patch('/:requestId/reject', auth, authorize('admin', 'teacher'), upload.none(), rejectPasswordChangeRequest);

module.exports = router;
