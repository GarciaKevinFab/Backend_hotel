import { Room } from '../models/room.model.js';

export async function getAllRooms(req, res) {
    try {
        const now = new Date();

        const rooms = await Room.aggregate([
            {
                $lookup: {
                    from: 'reservations',
                    let: { roomId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$room', '$$roomId'] },
                                        // Usa tus estados reales
                                        { $in: ['$status', ['reserved', 'checked_in', 'checked-in']] },
                                        { $lte: ['$checkInDate', now] },
                                        { $gt: ['$checkOutDate', now] } // checkout exclusivo
                                    ]
                                }
                            }
                        }
                    ],
                    as: 'activeRes'
                }
            },
            {
                $addFields: {
                    status: {
                        $cond: [{ $gt: [{ $size: '$activeRes' }, 0] }, 'occupied', '$status']
                    }
                }
            },
            { $project: { activeRes: 0 } }
        ]);

        return res.status(200).json(rooms);
    } catch (error) {
        console.error('getAllRooms error:', error);
        return res.status(500).json({ error: error.message });
    }
}

export async function getRoom(req, res) {
    try {
        const room = await Room.findById(req.params.id);
        res.status(200).json(room);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function createRoom(req, res) {
    try {
        const newRoom = new Room(req.body);
        await newRoom.save();
        res.status(201).json(newRoom);
    } catch (error) {
        if (error?.code === 11000 && error?.keyPattern?.number) {
            return res.status(409).json({ message: 'Ya existe una habitación con ese número.' });
        }
        res.status(400).json({ error: error.message });
    }
}

export async function updateRoom(req, res) {
    try {
        const updatedRoom = await Room.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true, context: 'query' }
        );
        res.status(200).json(updatedRoom);
    } catch (error) {
        if (error?.code === 11000 && error?.keyPattern?.number) {
            return res.status(409).json({ message: 'Ya existe una habitación con ese número.' });
        }
        res.status(400).json({ error: error.message });
    }
}

export async function deleteRoom(req, res) {
    try {
        await Room.findByIdAndDelete(req.params.id);
        res.status(204).json();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
