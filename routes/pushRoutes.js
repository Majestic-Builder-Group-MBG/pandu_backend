const express = require('express');
const auth = require('../middleware/authMiddleware');
const upload = require('../middleware/uploadMiddleware');
const {
  savePushSubscription,
  deletePushSubscription,
  listMyPushSubscriptions
} = require('../controllers/pushSubscriptionController');

const router = express.Router();

router.post('/subscriptions', auth, upload.none(), savePushSubscription);
router.delete('/subscriptions', auth, upload.none(), deletePushSubscription);
router.get('/subscriptions/me', auth, upload.none(), listMyPushSubscriptions);

module.exports = router;
