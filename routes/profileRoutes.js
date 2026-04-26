const express = require('express');
const auth = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');
const {
  getMyProfile,
  updateMyProfile,
  updateProfilePhoto,
  downloadMyProfilePhoto,
  requestPasswordChange,
  confirmPasswordChange
} = require('../controllers/profileController');

const router = express.Router();

router.get('/me', auth, getMyProfile);
router.patch('/me', auth, upload.none(), updateMyProfile);
router.get('/me/photo', auth, downloadMyProfilePhoto);
router.patch('/me/photo', auth, upload.single('photo'), updateProfilePhoto);

router.post('/password-change/request', auth, upload.none(), requestPasswordChange);
router.post('/password-change/confirm', auth, upload.none(), confirmPasswordChange);

module.exports = router;
