const express = require('express');
const auth = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');
const { listMyReminders } = require('../controllers/reminderController');

const router = express.Router();

router.get('/me', auth, upload.none(), listMyReminders);

module.exports = router;
