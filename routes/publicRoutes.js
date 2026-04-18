const express = require('express');
const { viewSessionContentFileByToken } = require('../controllers/moduleController');

const router = express.Router();

router.get('/session-contents/view', viewSessionContentFileByToken);

module.exports = router;
