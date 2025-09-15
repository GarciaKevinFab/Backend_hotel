import express from 'express';
import { getAllRooms, getRoom, createRoom, updateRoom, deleteRoom } from '../controllers/room.Controller.js';

const router = express.Router();

router.get('/', getAllRooms);
router.get('/:id', getRoom);
router.post('/', createRoom);
router.put('/:id', updateRoom);
router.delete('/:id', deleteRoom);

export default router;
