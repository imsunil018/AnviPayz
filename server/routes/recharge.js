const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const {
    checkout,
    lookup,
    plans,
    pay,
    webhook
} = require('../controllers/rechargeController');

const router = express.Router();

router.post('/lookup', protect, lookup);
router.get('/plans', protect, plans);
router.post('/checkout', protect, checkout);
router.post('/pay', protect, pay);
router.all('/webhook', webhook);

module.exports = router;
