import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
    number: {
        type: Number,
        required: true,
        min: 1,
        unique: true,
        index: true
    },
    type: {
        type: String,
        required: true,
        enum: ['Simple', 'Doble', 'Matrimonial', 'Suite']
    },
    status: {
        type: String,
        enum: ['available', 'occupied', 'cleaning', 'maintenance'],
        default: 'available'
    },
    price: {
        type: Number,
        required: true,
        min: 0
    }
}, { timestamps: true });

// Redundante pero explícito:
roomSchema.index({ number: 1 }, { unique: true });

export const Room = mongoose.model('Room', roomSchema);
