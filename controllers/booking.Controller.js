import cron from 'node-cron';
import { DateTime, Settings } from 'luxon';
import { Reservation } from '../models/booking.model.js';
import { Room } from '../models/room.model.js';

/* ===================== Config TZ y reglas globales ===================== */
const ZONE = 'America/Lima';
Settings.defaultZone = ZONE;

const CHECK_IN_HOUR = 6;    // 06:00 Lima
const CHECK_OUT_HOUR = 12;  // 12:00 Lima

/* ===================== Helpers genéricos ===================== */

const isValidDNI = (v = '') => /^\d{8}$/.test(v);
const isValidRUC = (v = '') => /^\d{11}$/.test(v);
const isValidCEE = (v = '') => /^[A-Za-z0-9\-]{8,}$/.test(v);
const isPeruPhone9 = (v = '') => /^9\d{8}$/.test(v);

/** Normaliza "YYYY-MM-DD" a 06:00 Lima */
const toCheckIn = (isoDateStr) =>
    DateTime.fromISO(isoDateStr, { zone: ZONE })
        .set({ hour: CHECK_IN_HOUR, minute: 0, second: 0, millisecond: 0 })
        .toJSDate();

/** Normaliza "YYYY-MM-DD" a 12:00 Lima */
const toCheckOut = (isoDateStr) =>
    DateTime.fromISO(isoDateStr, { zone: ZONE })
        .set({ hour: CHECK_OUT_HOUR, minute: 0, second: 0, millisecond: 0 })
        .toJSDate();

/** Si la ventana completa ya pasó respecto a ahora Lima, empuja ambos días +1 */
const rollIfPast = (startDateJS, endDateJS) => {
    const nowL = DateTime.now().setZone(ZONE);
    const endL = DateTime.fromJSDate(endDateJS, { zone: ZONE });
    if (endL <= nowL) {
        const s = DateTime.fromJSDate(startDateJS, { zone: ZONE }).plus({ days: 1 }).toJSDate();
        const e = DateTime.fromJSDate(endDateJS, { zone: ZONE }).plus({ days: 1 }).toJSDate();
        return [s, e];
    }
    return [startDateJS, endDateJS];
};

/** Noches = diferencia en días (D2.startOf('day') - D1.startOf('day')) */
const nightsBetweenDays = (startJS, endJS) => {
    const s = DateTime.fromJSDate(startJS, { zone: ZONE }).startOf('day');
    const e = DateTime.fromJSDate(endJS, { zone: ZONE }).startOf('day');
    return Math.max(0, Math.floor(e.diff(s, 'days').days));
};

/** Sanitizado de datos de huésped */
const sanitizeGuest = (g, fallbackNationality = 'Peru') => {
    const out = { ...g };
    out.docType = String(out.docType || '').toUpperCase();
    out.docNumber = String(out.docNumber || '').trim();
    if (out.nombres) out.nombres = String(out.nombres).trim();
    if (out.apellidoPaterno) out.apellidoPaterno = String(out.apellidoPaterno).trim();
    if (out.apellidoMaterno) out.apellidoMaterno = String(out.apellidoMaterno).trim();
    if (out.razonSocial) out.razonSocial = String(out.razonSocial).trim();
    if (out.direccion) out.direccion = String(out.direccion).trim();
    out.nationality = out.nationality || fallbackNationality || 'Peru';
    return out;
};

/** Validación de documento por huésped */
const validateGuestDoc = (g) => {
    if (!g.docType || !g.docNumber) return "Cada huésped requiere docType y docNumber";
    if (g.docType === 'DNI' && !isValidDNI(g.docNumber)) return "DNI inválido (8 dígitos)";
    if (g.docType === 'RUC' && !isValidRUC(g.docNumber)) return "RUC inválido (11 dígitos)";
    if (g.docType === 'CEE' && !isValidCEE(g.docNumber)) return "CEE inválido";
    if (g.docType === 'RUC') {
        if (!g.razonSocial?.trim()) return "Para RUC, razón social es obligatoria";
        if (!g.direccion?.trim()) return "Para RUC, dirección es obligatoria";
    }
    return null;
};

/** Validación de pago reforzada */
const validatePayment = (payment, { allowEmpty = false } = {}) => {
    if (!payment) return allowEmpty ? null : "Falta pago";
    const m = payment.method;
    if (!m) return "Método de pago requerido";
    if (!["POS", "PagoEfectivo", "Yape", "Credito"].includes(m)) return "Método de pago inválido";

    const data = payment.data || {};
    if (m === "POS" && !data.voucher) return "Falta voucher POS";
    if (m === "PagoEfectivo" && !data.cip) return "Falta CIP de PagoEfectivo";
    if (m === "Yape") {
        if (!data.phone) return "Falta teléfono de Yape";
        if (!isPeruPhone9(String(data.phone))) return "Teléfono Yape inválido (9 dígitos, inicia con 9)";
    }
    if (m === "Credito" && !data.plazoDias) return "Falta plazo de crédito (días)";
    return null;
};

/** Traslape de rangos: (A.start < B.end) && (A.end > B.start) */
const hasConflict = async (roomId, start, end, excludeId = null) => {
    const q = {
        room: roomId,
        checkInDate: { $lt: end },
        checkOutDate: { $gt: start }
    };
    if (excludeId) q._id = { $ne: excludeId };
    const conflict = await Reservation.findOne(q).lean();
    return !!conflict;
};

/** Monto extra por noches añadidas (si existe precio en Room) */
const calcAmount = async (roomId, nights, rateOverride) => {
    if (nights <= 0) return 0;
    if (rateOverride) return rateOverride * nights;
    const room = await Room.findById(roomId).lean();
    const rate = room?.price || room?.rate || 0;
    return rate * nights;
};

/* ===================== CRUD ===================== */

export async function getAllReservations(req, res) {
    try {
        // Filtro opcional por rango (from/to en YYYY-MM-DD, traslape con ventana)
        const { from, to } = req.query;
        const q = {};
        if (from || to) {
            const start = from ? DateTime.fromISO(from, { zone: ZONE }).startOf('day').toJSDate() : null;
            const end = to ? DateTime.fromISO(to, { zone: ZONE }).endOf('day').toJSDate() : null;
            if (start && end) {
                q.checkInDate = { $lt: end };
                q.checkOutDate = { $gt: start };
            } else if (start && !end) {
                q.checkOutDate = { $gt: start };
            } else if (!start && end) {
                q.checkInDate = { $lt: end };
            }
        }

        const reservations = await Reservation.find(q).populate('room');
        res.status(200).json(reservations);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function getReservation(req, res) {
    try {
        const reservation = await Reservation.findById(req.params.id).populate('room');
        if (!reservation) return res.status(404).json({ error: "Reservation not found" });
        res.status(200).json(reservation);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function createReservation(req, res) {
    try {
        const { room: roomId, checkInDate, checkOutDate, userData, nationality, payment } = req.body;
        console.log('[createReservation] payload:', JSON.stringify(req.body, null, 2));

        if (!roomId) return res.status(400).json({ message: "room es requerido" });
        if (!checkInDate || !checkOutDate) return res.status(400).json({ message: "checkInDate y checkOutDate son requeridos" });
        if (!Array.isArray(userData) || userData.length === 0) return res.status(400).json({ message: "userData es requerido" });

        const room = await Room.findById(roomId).lean();
        if (!room) return res.status(404).json({ message: "Room not found" });

        // Normaliza a 06:00 y 12:00 Lima
        let start = toCheckIn(checkInDate);
        let end = toCheckOut(checkOutDate);

        // Si la ventana ya pasó completa, empuja +1 día
        [start, end] = rollIfPast(start, end);

        if (!(end > start)) return res.status(400).json({ message: "checkOutDate debe ser posterior a checkInDate" });

        // (Opcional) validar capacidad si el cuarto la tiene
        if (typeof room.capacity === 'number' && userData.length > room.capacity) {
            return res.status(400).json({ message: `Excede capacidad de la habitación (${room.capacity}).` });
        }

        // Sanitizar y validar huéspedes
        const cleanGuests = [];
        for (const raw of userData) {
            const g = sanitizeGuest(raw, nationality);
            const err = validateGuestDoc(g);
            if (err) return res.status(400).json({ message: err });
            if (g.docType === 'RUC' && g.razonSocial && !g.nombres) g.nombres = g.razonSocial; // compat
            cleanGuests.push(g);
        }

        // Validación de pago
        {
            const err = validatePayment(payment);
            if (err) return res.status(400).json({ message: err });
        }

        // Evitar traslapes
        const conflict = await hasConflict(room._id, start, end, null);
        if (conflict) return res.status(409).json({ message: "El cuarto ya está reservado en ese rango de fechas" });

        // Noches por días (mínimo 1)
        const baseNights = nightsBetweenDays(start, end);
        if (baseNights <= 0) return res.status(400).json({ message: "La estancia debe ser al menos 1 noche" });

        const baseAmount = await calcAmount(room._id, baseNights, null);

        const newReservation = await Reservation.create({
            room: room._id,
            checkInDate: start,
            checkOutDate: end,
            userData: cleanGuests,
            nationality: nationality || 'Peru',
            payment,
            status: 'reserved',
            totals: { baseAmount, extraAmount: 0, paidAmount: 0 }
        });

        // Avanza estados automáticamente y recalcula rooms
        await autoAdvanceReservations();
        await updateRoomStatus();

        return res.status(201).json(newReservation);
    } catch (error) {
        console.error('Error al crear la reservación:', error);
        return res.status(400).json({ error: error.message });
    }
}

export async function updateReservation(req, res) {
    try {
        const patch = { ...req.body };

        if ((patch.checkInDate && patch.checkOutDate) || patch.room || patch.checkInDate || patch.checkOutDate) {
            const current = await Reservation.findById(req.params.id);
            if (!current) return res.status(404).json({ error: "Reservation not found" });

            // Tomamos del patch si llega YYYY-MM-DD; si no, convertimos las actuales a ISO local
            const currentInISO = DateTime.fromJSDate(current.checkInDate, { zone: ZONE }).toISODate();
            const currentOutISO = DateTime.fromJSDate(current.checkOutDate, { zone: ZONE }).toISODate();

            let start = toCheckIn(patch.checkInDate || currentInISO);
            let end = toCheckOut(patch.checkOutDate || currentOutISO);

            [start, end] = rollIfPast(start, end);

            if (!(end > start)) return res.status(400).json({ error: "checkOutDate debe ser posterior a checkInDate" });

            const roomId = patch.room || current.room;
            const conflict = await hasConflict(roomId, start, end, current._id);
            if (conflict) return res.status(409).json({ error: "Rango de fechas en conflicto para ese cuarto" });

            // Forzar fechas normalizadas en el patch
            patch.checkInDate = start;
            patch.checkOutDate = end;

            // Asegura al menos 1 noche
            const nb = nightsBetweenDays(start, end);
            if (nb <= 0) return res.status(400).json({ error: "La estancia debe ser al menos 1 noche" });
        }

        if (Array.isArray(patch.userData)) {
            patch.userData = patch.userData.map(g => sanitizeGuest(g, patch.nationality));
            for (const g of patch.userData) {
                const err = validateGuestDoc(g);
                if (err) return res.status(400).json({ error: err });
            }
        }

        if (patch.payment) {
            const err = validatePayment(patch.payment, { allowEmpty: false });
            if (err) return res.status(400).json({ error: err });
        }

        const reservation = await Reservation.findByIdAndUpdate(req.params.id, patch, { new: true }).populate('room');
        if (!reservation) return res.status(404).json({ error: "Reservation not found" });

        await autoAdvanceReservations();
        await updateRoomStatus();

        return res.status(200).json(reservation);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
}

export async function deleteReservation(req, res) {
    try {
        const reservation = await Reservation.findById(req.params.id);
        if (!reservation) return res.status(404).json({ message: "Reservation not found" });

        await Reservation.deleteOne({ _id: reservation._id });
        await autoAdvanceReservations();
        await updateRoomStatus();
        res.status(204).end();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

/* ===================== Extensión de estadía ===================== */
export async function extendReservation(req, res) {
    try {
        const { id } = req.params;
        const { newCheckOutDate, rateOverride, payment } = req.body;

        const errPay = validatePayment(payment, { allowEmpty: true });
        if (errPay) return res.status(400).json({ error: errPay });

        const rsv = await Reservation.findById(id);
        if (!rsv) return res.status(404).json({ error: "Reservación no encontrada" });

        const oldOutL = DateTime.fromJSDate(rsv.checkOutDate, { zone: ZONE });
        const newOutL = DateTime.fromISO(newCheckOutDate, { zone: ZONE }).set({ hour: CHECK_OUT_HOUR, minute: 0, second: 0, millisecond: 0 });
        if (!(newOutL > oldOutL)) return res.status(400).json({ error: "La nueva fecha debe ser posterior al check-out actual" });

        const conflict = await hasConflict(rsv.room, oldOutL.toJSDate(), newOutL.toJSDate(), rsv._id);
        if (conflict) return res.status(409).json({ error: "El cuarto no está disponible para extender esas fechas" });

        const nightsAdded = Math.max(0, Math.floor(newOutL.startOf('day').diff(oldOutL.startOf('day'), 'days').days));
        if (nightsAdded <= 0) return res.status(400).json({ error: "La extensión debe sumar al menos 1 noche" });

        const extraAmount = await calcAmount(rsv.room, nightsAdded, rateOverride);

        rsv.extensions.push({ from: oldOutL.toJSDate(), to: newOutL.toJSDate(), nightsAdded, extraAmount, payment: payment || undefined });
        rsv.checkOutDate = newOutL.toJSDate();
        rsv.totals = rsv.totals || {};
        rsv.totals.extraAmount = (rsv.totals.extraAmount || 0) + extraAmount;

        await rsv.save();

        await autoAdvanceReservations();
        await updateRoomStatus();

        return res.status(200).json(rsv);
    } catch (e) {
        console.error("extendReservation error:", e);
        return res.status(500).json({ error: "No se pudo extender la estadía" });
    }
}

/* ===================== AUTO-ADVANCE: Reserva y Estado de Cuartos ===================== */
/**
 * Avanza automáticamente el estado de TODAS las reservas (no-cancelled):
 * - reserved    -> checked_in   si now ∈ [checkIn, checkOut)
 * - checked_in  -> checked_out  si now >= checkOut
 */
export async function autoAdvanceReservations() {
    const nowL = DateTime.now().setZone(ZONE);
    const nowJS = nowL.toJSDate();

    // 1) reserved -> checked_in si toca
    await Reservation.updateMany(
        {
            status: 'reserved',
            checkInDate: { $lte: nowJS },
            checkOutDate: { $gt: nowJS }
        },
        { $set: { status: 'checked_in' } }
    );

    // 2) checked_in -> checked_out si ya pasó el checkOut
    await Reservation.updateMany(
        {
            status: 'checked_in',
            checkOutDate: { $lte: nowJS }
        },
        { $set: { status: 'checked_out' } }
    );
}

/**
 * Reglas de Room.status:
 * - occupied  si existe reserva status='checked_in' activa ahora
 * - cleaning  si NO hay ocupación activa y existe reserva con checkOutDate HOY (Lima)
 * - available caso contrario
 */
export async function updateRoomStatus() {
    try {
        const rooms = await Room.find({});
        const nowL = DateTime.now().setZone(ZONE);
        const nowJS = nowL.toJSDate();

        const today0 = nowL.startOf('day').toJSDate();
        const today24 = nowL.endOf('day').toJSDate();

        for (const room of rooms) {
            const checkedInActive = await Reservation.findOne({
                room: room._id,
                status: 'checked_in',
                checkInDate: { $lte: nowJS },
                checkOutDate: { $gt: nowJS }
            }).lean();

            if (checkedInActive) {
                if (room.status !== 'occupied') { room.status = 'occupied'; await room.save(); }
                continue;
            }

            const endedToday = await Reservation.findOne({
                room: room._id,
                checkOutDate: { $gte: today0, $lte: today24 }
            }).lean();

            const newStatus = endedToday ? 'cleaning' : 'available';
            if (room.status !== newStatus) { room.status = newStatus; await room.save(); }
        }
    } catch (error) {
        console.error('Error updating room status:', error);
    }
}

/* ===================== REPORTES ===================== */
// (A) Conteo por país (nombre tal cual)
export async function getGuestsByCountry(req, res) {
    try {
        const agg = await Reservation.aggregate([
            { $unwind: "$userData" },
            { $match: { "userData.nationality": { $exists: true, $ne: null, $ne: "" } } },
            { $group: { _id: "$userData.nationality", value: { $sum: 1 } } },
            { $project: { _id: 0, id: "$_id", value: 1 } },
            { $sort: { value: -1, id: 1 } },
        ]);
        return res.status(200).json(agg);
    } catch (error) {
        console.error("getGuestsByCountry error:", error);
        return res.status(500).json({ error: error.message });
    }
}
// Cron cada 5 minutos en TZ Lima: primero avanza reservas, luego rooms
cron.schedule('*/5 * * * *', async () => {
    try {
        await autoAdvanceReservations();
        await updateRoomStatus();
    } catch (e) {
        console.error('Cron error:', e);
    }
}, { timezone: ZONE });

// ===================== util: país -> ISO3 (Nivo usa ISO3 en geoFeatures.id) =====================
const ISO3_MAP = {
    // América
    "Peru": "PER", "Argentina": "ARG", "Bolivia": "BOL", "Brazil": "BRA", "Chile": "CHL", "Colombia": "COL",
    "Ecuador": "ECU", "Paraguay": "PRY", "Uruguay": "URY", "Venezuela": "VEN", "Mexico": "MEX",
    "Guatemala": "GTM", "Honduras": "HND", "El Salvador": "SLV", "Nicaragua": "NIC", "Costa Rica": "CRI",
    "Panama": "PAN", "Cuba": "CUB", "Dominican Republic": "DOM", "Haiti": "HTI", "United States": "USA", "Canada": "CAN",
    // Europa
    "Spain": "ESP", "Portugal": "PRT", "France": "FRA", "Germany": "DEU", "Italy": "ITA", "United Kingdom": "GBR",
    "Ireland": "IRL", "Netherlands": "NLD", "Belgium": "BEL", "Switzerland": "CHE", "Austria": "AUT",
    "Poland": "POL", "Czech Republic": "CZE", "Romania": "ROU", "Hungary": "HUN", "Greece": "GRC",
    "Sweden": "SWE", "Norway": "NOR", "Finland": "FIN", "Denmark": "DNK",
    // África
    "South Africa": "ZAF", "Morocco": "MAR", "Egypt": "EGY", "Algeria": "DZA", "Tunisia": "TUN",
    "Senegal": "SEN", "Ghana": "GHA", "Kenya": "KEN", "Nigeria": "NGA", "Ethiopia": "ETH",
    // Asia
    "China": "CHN", "Japan": "JPN", "South Korea": "KOR", "Korea, South": "KOR", "India": "IND",
    "Indonesia": "IDN", "Malaysia": "MYS", "Singapore": "SGP", "Thailand": "THA", "Philippines": "PHL",
    "United Arab Emirates": "ARE", "Saudi Arabia": "SAU", "Qatar": "QAT", "Kuwait": "KWT", "Turkey": "TUR",
    // Oceanía
    "Australia": "AUS", "New Zealand": "NZL",
    // Variantes frecuentes / alias
    "Vatican City": "VAT", "Russia": "RUS", "Taiwan": "TWN", "Korea, North": "PRK",
    "Congo, Democratic Republic of the": "COD", "Congo, Republic of the": "COG",
    "Cote d'Ivoire": "CIV", "North Macedonia": "MKD", "Eswatini": "SWZ",
};
function countryToISO3(nameRaw = "") {
    if (!nameRaw) return null;
    const name = String(nameRaw).trim();
    if (ISO3_MAP[name]) return ISO3_MAP[name];
    const up = name.toUpperCase();
    if (up.includes("UNITED STATES")) return "USA";
    if (up === "UAE" || up.includes("EMIRATES")) return "ARE";
    if (up.includes("UK")) return "GBR";
    if (up.includes("REPUBLIC") && up.includes("DOMINIC")) return "DOM";
    return null; // desconocido -> se ignora en el mapa
}

// (B) Puntos por país (ISO3 + nombre + value) para burbujas en Nivo
export async function getGuestsGeoPoints(req, res) {
    try {
        const agg = await Reservation.aggregate([
            { $unwind: "$userData" },
            { $match: { "userData.nationality": { $exists: true, $ne: null, $ne: "" } } },
            { $group: { _id: "$userData.nationality", value: { $sum: 1 } } },
            { $project: { _id: 0, name: "$_id", value: 1 } },
        ]);

        const points = agg
            .map(({ name, value }) => {
                const iso3 = countryToISO3(name);
                if (!iso3) return null;
                return { id: iso3, name, value };
            })
            .filter(Boolean);

        return res.status(200).json(points);
    } catch (e) {
        console.error("getGuestsGeoPoints error:", e);
        return res.status(500).json({ error: e.message });
    }
}