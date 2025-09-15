import express from 'express';
import {
    getAllReservations,
    getReservation,
    createReservation,
    updateReservation,
    deleteReservation,
    extendReservation,
    getGuestsByCountry,
    getGuestsGeoPoints
} from '../controllers/booking.Controller.js';

const router = express.Router();

router.get('/', getAllReservations);
router.get('/:id', getReservation);
router.post('/', createReservation);
router.put('/:id', updateReservation);
router.delete('/:id', deleteReservation);

// Extender estadía
router.patch('/:id/extend', extendReservation);

// Reportes
router.get('/report/guests-by-country', getGuestsByCountry);
router.get('/report/guests-geo', getGuestsGeoPoints);

export default router;
