const mongoose = require('mongoose');

const SupportTicketSchema = new mongoose.Schema({
    kind: {
        type: String,
        enum: ['ticket', 'counter'],
        default: 'ticket',
        index: true
    },
    ticketId: {
        type: String,
        trim: true,
        uppercase: true
    },
    sequence: {
        type: Number,
        default: null
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    name: {
        type: String,
        trim: true
    },
    email: {
        type: String,
        trim: true,
        lowercase: true
    },
    issueType: {
        type: String,
        trim: true
    },
    message: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['open', 'in_progress', 'closed'],
        default: 'open'
    },
    notificationStatus: {
        type: String,
        enum: ['sent', 'failed'],
        default: 'sent'
    },
    notificationError: {
        type: String,
        default: ''
    }
}, {
    timestamps: true,
    versionKey: false,
    collection: 'supporttickets'
});

SupportTicketSchema.index(
    { ticketId: 1 },
    {
        unique: true,
        partialFilterExpression: {
            kind: 'ticket',
            ticketId: { $type: 'string' }
        }
    }
);

SupportTicketSchema.index(
    { sequence: 1 },
    {
        unique: true,
        partialFilterExpression: {
            kind: 'ticket',
            sequence: { $type: 'number' }
        }
    }
);

module.exports = mongoose.models.SupportTicket || mongoose.model('SupportTicket', SupportTicketSchema);
