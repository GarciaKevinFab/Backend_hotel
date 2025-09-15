import mongoose from 'mongoose';

/**
 * Huesped / Empresa
 * - Para persona (DNI/CEE): nombres y apellidos.
 * - Para empresa (RUC): razonSocial y direccion. (por compat, también guardamos en 'nombres')
 */
const userDataSchema = new mongoose.Schema({
    // Persona natural
    nombres: { type: String },
    apellidoPaterno: { type: String },
    apellidoMaterno: { type: String },

    // Empresa
    razonSocial: { type: String },
    direccion: { type: String },

    // Documento (obligatorio)
    docType: { type: String, enum: ["DNI", "CEE", "RUC"], required: true },
    docNumber: { type: String, required: true },

    nationality: { type: String, required: true }
}, { _id: false });

/**
 * Pago
 */
const paymentSchema = new mongoose.Schema({
    method: { type: String, enum: ["POS", "PagoEfectivo", "Yape", "Credito"], required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

/**
 * Historial de extensiones
 */
const extensionSchema = new mongoose.Schema({
    from: { type: Date, required: true },  // antiguo checkOut
    to: { type: Date, required: true },    // nuevo checkOut
    nightsAdded: { type: Number, required: true },
    extraAmount: { type: Number, required: true, default: 0 },
    payment: { type: paymentSchema, required: false },
    createdAt: { type: Date, default: Date.now }
}, { _id: false });

/**
 * Totales simples (opcional)
 */
const totalsSchema = new mongoose.Schema({
    baseAmount: { type: Number, default: 0 },
    extraAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 }
}, { _id: false });

const reservationSchema = new mongoose.Schema({
    room: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
    checkInDate: { type: Date, required: true },
    checkOutDate: { type: Date, required: true },
    userData: { type: [userDataSchema], default: [] },
    nationality: { type: String, default: "Peru" },

    // Pago inicial de la reserva
    payment: { type: paymentSchema, required: true },

    // Estado lógico de la reserva (no del cuarto)
    status: { type: String, enum: ['reserved', 'checked_in', 'checked_out', 'cancelled'], default: 'reserved' },

    // Extensiones
    extensions: { type: [extensionSchema], default: [] },

    // Totales
    totals: { type: totalsSchema, default: () => ({}) }
}, { timestamps: true });

reservationSchema.index({ room: 1, checkInDate: 1, checkOutDate: 1 });

export const Reservation = mongoose.model('Reservation', reservationSchema);
