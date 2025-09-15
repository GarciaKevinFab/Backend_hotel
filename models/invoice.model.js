import mongoose from 'mongoose';

const itemSchema = new mongoose.Schema({
    descripcion: { type: String, required: [true, 'Descripción requerida'], trim: true },
    cantidad: { type: Number, required: true, min: [0, 'Cantidad no puede ser negativa'] },
    // Precio de venta unitario CON IGV cuando tipAfeIgv = "10"
    precioUnitario: { type: Number, required: true, min: [0, 'Precio no puede ser negativo'] },
    codigo: { type: String, default: '', trim: true },
    // 10 = Gravado IGV, 20 = Exonerado (ajusta si usarás más códigos)
    tipAfeIgv: { type: String, enum: ['10', '20'], default: '10' }
}, { _id: false });

const resumenSchema = new mongoose.Schema({
    // nombres alineados a buildFactilizaPayload
    gravadas: { type: Number, default: 0 }, // monto_Oper_Gravadas
    exoneradas: { type: Number, default: 0 }, // monto_Oper_Exoneradas
    igv: { type: Number, default: 0 }, // monto_Igv
    totalImpuestos: { type: Number, default: 0 }, // total_Impuestos
    valorVenta: { type: Number, default: 0 },
    subTotal: { type: Number, default: 0 },
    montoImpVenta: { type: Number, default: 0 }, // total a pagar
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
    // Cabecera
    ruc: { type: String, required: [true, 'RUC requerido'], trim: true }, // empresa_Ruc
    tipoDocumento: { type: String, required: true, enum: ['01', '03'] },            // 01 Factura, 03 Boleta
    serie: { type: String, required: true, trim: true },                    // F001/B001 ...
    numero: { type: String, required: true, trim: true },                    // correlativo SIEMPRE string
    fechaEmision: { type: Date, required: true },
    tipoMoneda: { type: String, default: 'PEN', enum: ['PEN', 'USD'] },
    tipoOperacion: { type: String, default: '0101' },                               // Venta interna

    // Cliente
    clienteTipoDoc: { type: String, default: '6', enum: ['1', '6'] },                // 1 DNI, 6 RUC
    customerRuc: { type: String, required: [true, 'Documento de cliente requerido'], trim: true },
    customerName: { type: String, required: [true, 'Nombre/Razón Social requerido'], trim: true },
    customerAddress: { type: String, required: [true, 'Dirección requerida'], trim: true },
    customerEmail: { type: String, trim: true },

    // Detalle
    items: { type: [itemSchema], default: [] },

    // Resumen calculado y respuesta del proveedor
    resumen: { type: resumenSchema, default: () => ({}) },
    factilizaResponse: { type: mongoose.Schema.Types.Mixed },

    // Opcional: estado local de control
    estadoLocal: { type: String, default: 'registrado', enum: ['registrado', 'enviado', 'aceptado', 'rechazado'] },
}, { timestamps: true });

/** Normalizaciones previas **/
invoiceSchema.pre('validate', function (next) {
    // fuerza string y mayúsculas donde corresponde
    if (this.numero != null) this.numero = String(this.numero).trim();
    if (this.serie) this.serie = String(this.serie).trim().toUpperCase();

    // valida al menos 1 ítem
    if (!Array.isArray(this.items) || this.items.length < 1) {
        return next(new mongoose.Error.ValidationError(
            new Error('Debe registrar al menos un ítem')
        ));
    }
    // valida cantidades y precios
    for (const it of this.items) {
        if (it.cantidad < 0) return next(new mongoose.Error.ValidationError(new Error('Cantidad negativa no permitida')));
        if (it.precioUnitario < 0) return next(new mongoose.Error.ValidationError(new Error('Precio negativo no permitido')));
    }
    next();
});

/** Virtuales útiles **/
invoiceSchema.virtual('comprobante').get(function () {
    return `${this.tipoDocumento}-${this.serie}-${this.numero}`;
});

invoiceSchema.virtual('clienteDisplay').get(function () {
    return `${this.customerName} (${this.clienteTipoDoc === '6' ? 'RUC' : 'DNI'} ${this.customerRuc})`;
});

/** Índice único normalizado (evita duplicados locales) **/
invoiceSchema.index(
    { ruc: 1, tipoDocumento: 1, serie: 1, numero: 1 },
    {
        unique: true,
        collation: { locale: 'es', strength: 2 } // case-insensitive para serie
    }
);

export default mongoose.model('Invoice', invoiceSchema);
