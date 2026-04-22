const express = require('express');
const auth = require('../middleware/authMiddleware');
const { getUpcomingSessions } = require('../controllers/dashboardController');

const router = express.Router();

router.get('/upcoming-sessions', auth, getUpcomingSessions);

module.exports = router;
