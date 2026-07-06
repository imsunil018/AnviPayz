const mongoose = require('mongoose');

const SurveyHistorySchema = new mongoose.Schema({
    surveyId: { type: String, required: true, trim: true, index: true },
    provider: { type: String, required: true, trim: true, lowercase: true, index: true },
    providerLabel: { type: String, default: '', trim: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rewardPoints: { type: Number, default: 0, min: 0 },
    status: {
        type: String,
        default: 'started',
        trim: true,
        lowercase: true,
        enum: ['started', 'completed', 'failed', 'duplicate', 'expired']
    },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    transactionId: { type: String, default: undefined, trim: true, index: true },
    sessionId: { type: String, default: undefined, trim: true, index: true },
    duplicateKey: { type: String, default: undefined, trim: true, index: true, unique: true, sparse: true },
    claimKey: { type: String, default: '', trim: true, index: true },
    launchUrl: { type: String, default: '', trim: true },
    providerPayload: { type: mongoose.Schema.Types.Mixed, default: {} },
    rewardPayload: { type: mongoose.Schema.Types.Mixed, default: {} }
}, {
    timestamps: true
});

SurveyHistorySchema.index({ provider: 1, surveyId: 1, userId: 1, status: 1 });
SurveyHistorySchema.index({ sessionId: 1 }, { unique: true, sparse: true });
SurveyHistorySchema.index({ transactionId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.SurveyHistory || mongoose.model('SurveyHistory', SurveyHistorySchema);
