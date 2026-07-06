const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const {
    getCpxIframe,
    getSurveys,
    handleCpxPostback,
    launchSurvey,
    submitSurveyReward
} = require('../controllers/surveyController');

const router = express.Router();

router.get('/surveys/cpx/iframe', protect, getCpxIframe);
router.get('/surveys', protect, getSurveys);
router.post('/surveys/:surveyId/launch', protect, launchSurvey);
router.post('/surveys/submit', protect, submitSurveyReward);
router.post('/cpx/postback', handleCpxPostback);

module.exports = router;
