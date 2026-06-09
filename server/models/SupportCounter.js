const mongoose = require('mongoose');

const SupportCounterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    sequence: { type: Number, default: 1000 }
}, {
    versionKey: false,
    collection: 'supportcounters'
});

module.exports = mongoose.models.SupportCounter || mongoose.model('SupportCounter', SupportCounterSchema);
