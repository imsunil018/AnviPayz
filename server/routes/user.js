const express = require('express');
const {
    getProfile,
    patchProfile,
    requestSecureEmailChange,
    verifySecureEmailChange,
    requestSecureMobileChange,
    verifySecureMobileChange
} = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/profile', getProfile);
router.patch('/update-profile', patchProfile);
router.post('/request-email-change', requestSecureEmailChange);
router.post('/verify-email-change', verifySecureEmailChange);
router.post('/request-mobile-change', requestSecureMobileChange);
router.post('/verify-mobile-change', verifySecureMobileChange);

module.exports = router;
