const express = require('express');
const auth = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');
const { enrollByKey, myEnrollments } = require('../controllers/enrollmentController');

const router = express.Router();

router.post('/enroll', auth, upload.none(), enrollByKey);
router.get('/me', auth, myEnrollments);

module.exports = router;
