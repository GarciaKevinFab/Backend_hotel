// controllers/invoice.Controller.js
import 'dotenv/config';
import axios from 'axios';
import Invoice from '../models/invoice.model.js';
import { buildFactilizaPayload } from '../utils/totals.js';

const EMISOR_RUC = '20602208070'; // RUC ÚNICO Y FIJO

function getBaseUrl() {
    const fromUrl = process.env.FACTILIZA_BASE_URL;
    const fromBase = process.env.FACTILIZA_BASE?.replace(/\/?v1\/?$/, '');
    return fromUrl || fromBase || 'https://apife-qa.factiliza.com';
}
function requireToken() {
    const token = process.env.FACTILIZA_TOKEN_FAC;
    if (!token) throw new Error('Falta FACTILIZA_TOKEN_FAC en .env (sin "Bearer")');
    return token;
}

// ------- Helpers -------
function sanitizeInput(body = {}) {
    const out = { ...body };

    // Forzamos SIEMPRE el RUC del emisor
    out.ruc = EMISOR_RUC;

    // Normalizaciones duras
    if (out.numero != null) out.numero = String(out.numero).trim();
    if (out.correlativo != null) out.correlativo = String(out.correlativo).trim();
    if (out.serie) out.serie = String(out.serie).trim().toUpperCase();
    if (out.tipoDocumento) out.tipoDocumento = String(out.tipoDocumento).trim();
    if (out.tipoMoneda) out.tipoMoneda = String(out.tipoMoneda).trim().toUpperCase();
    if (!out.tipoOperacion) out.tipoOperacion = '0101';
    if (!out.clienteTipoDoc) out.clienteTipoDoc = '6';

    // Ítems: filtro + coerción
    out.items = Array.isArray(out.items)
        ? out.items.map(it => ({
            descripcion: String(it?.descripcion || '').trim(),
            cantidad: Number(it?.cantidad || 0),
            precioUnitario: Number(it?.precioUnitario || 0),
            codigo: String(it?.codigo || '').trim(),
            tipAfeIgv: (it?.tipAfeIgv === '20' ? '20' : '10')
        }))
            .filter(it => it.descripcion && it.cantidad > 0 && it.precioUnitario >= 0)
        : [];

    if (out.items.length === 0) {
        const err = new Error('Debe registrar al menos un ítem válido');
        err.status = 400;
        throw err;
    }

    // Cabeceras mínimas
    if (out.ruc !== EMISOR_RUC) {
        const err = new Error('RUC del emisor no permitido');
        err.status = 400;
        throw err;
    }
    if (!/^(01|03)$/.test(out.tipoDocumento || '')) {
        const err = new Error('tipoDocumento inválido (01 factura / 03 boleta)');
        err.status = 400;
        throw err;
    }
    if (!/^[FB]\d{3}$/i.test(out.serie || '')) {
        const err = new Error('Serie inválida (formato F### o B###)');
        err.status = 400;
        throw err;
    }
    if (!out.numero) {
        const err = new Error('Número (correlativo) requerido');
        err.status = 400;
        throw err;
    }
    if (!out.customerRuc || !out.customerName || !out.customerAddress) {
        const err = new Error('Datos de cliente incompletos (documento, nombre y dirección son obligatorios)');
        err.status = 400;
        throw err;
    }

    return out;
}

function sendUpstreamError(res, e, fallback = 'Error en proveedor') {
    if (e.response) {
        const { status, data } = e.response;
        // Intenta recoger errores de validación del proveedor
        if (data?.errors) return res.status(status).json({ message: data.title || 'Validación proveedor', errors: data.errors });
        return res.status(status).json({ message: data?.message || data?.error || fallback });
    }
    if (e.status) return res.status(e.status).json({ message: e.message });
    if (e.code === 'ECONNABORTED') return res.status(504).json({ message: 'Timeout consultando proveedor' });
    return res.status(500).json({ message: fallback });
}

// ------- Controllers -------
export const createInvoice = async (req, res) => {
    try {
        const FACTILIZA_BASE_URL = getBaseUrl();
        const FACTILIZA_TOKEN = requireToken();

        // Sanea y normaliza el input ANTES de armar payload (con RUC fijo)
        const clean = sanitizeInput(req.body);

        // buildFactilizaPayload DEBE devolver { payload, resumen }
        const { payload, resumen } = buildFactilizaPayload(clean);

        // Emisión
        const { data } = await axios.post(
            `${FACTILIZA_BASE_URL}/api/v1/invoice/send`,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${FACTILIZA_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        // Persistimos local (alineamos campos por si el front envió variantes)
        const doc = new Invoice({
            ...clean,
            tipoMoneda: payload.tipo_Moneda,
            tipoOperacion: payload.tipo_Operacion,
            clienteTipoDoc: payload.cliente_Tipo_Doc,
            resumen,
            factilizaResponse: data
        });
        await doc.save();

        return res.status(200).json({ ok: true, factiliza: data, idLocal: doc._id });
    } catch (e) {
        console.error('[createInvoice] error:', e?.response?.data || e.message);
        return sendUpstreamError(res, e, 'No se pudo emitir el comprobante');
    }
};

export const getInvoicePdf = async (req, res) => {
    try {
        const FACTILIZA_BASE_URL = getBaseUrl();
        const FACTILIZA_TOKEN = requireToken();

        // Ignoramos empresa_Ruc del body: usamos EMISOR_RUC fijo
        const { tipo_Doc, serie, correlativo } = req.body;
        if (!tipo_Doc || !serie || !correlativo) {
            return res.status(400).json({ message: 'Faltan parámetros: tipo_Doc, serie, correlativo' });
        }

        const body = { empresa_Ruc: EMISOR_RUC, tipo_Doc, serie: String(serie).toUpperCase(), correlativo: String(correlativo) };

        const { data } = await axios.post(
            `${FACTILIZA_BASE_URL}/api/v1/invoice/pdf`,
            body,
            {
                headers: { Authorization: `Bearer ${FACTILIZA_TOKEN}` },
                responseType: 'arraybuffer',
                timeout: 30000
            }
        );

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${tipo_Doc}-${body.serie}-${body.correlativo}.pdf"`);
        return res.send(Buffer.from(data));
    } catch (e) {
        console.error('[getInvoicePdf] error:', e?.response?.data || e.message);
        return sendUpstreamError(res, e, 'No se pudo obtener el PDF');
    }
};

export const getInvoiceXml = async (req, res) => {
    try {
        const FACTILIZA_BASE_URL = getBaseUrl();
        const FACTILIZA_TOKEN = requireToken();

        const { tipo_Doc, serie, correlativo } = req.body;
        if (!tipo_Doc || !serie || !correlativo) {
            return res.status(400).json({ message: 'Faltan parámetros: tipo_Doc, serie, correlativo' });
        }

        const body = { empresa_Ruc: EMISOR_RUC, tipo_Doc, serie: String(serie).toUpperCase(), correlativo: String(correlativo) };

        const { data, headers } = await axios.post(
            `${FACTILIZA_BASE_URL}/api/v1/invoice/xml`,
            body,
            {
                headers: { Authorization: `Bearer ${FACTILIZA_TOKEN}` },
                responseType: 'arraybuffer',
                timeout: 30000
            }
        );

        const ct = headers?.['content-type'] || 'application/octet-stream';
        res.setHeader('Content-Type', ct);
        res.setHeader('Content-Disposition', `attachment; filename="${tipo_Doc}-${body.serie}-${body.correlativo}.xml"`);
        return res.send(Buffer.from(data));
    } catch (e) {
        console.error('[getInvoiceXml] error:', e?.response?.data || e.message);
        return sendUpstreamError(res, e, 'No se pudo obtener el XML');
    }
};

export const getInvoiceCdr = async (req, res) => {
    try {
        const FACTILIZA_BASE_URL = getBaseUrl();
        const FACTILIZA_TOKEN = requireToken();

        const { tipo_Doc, serie, correlativo } = req.body;
        if (!tipo_Doc || !serie || !correlativo) {
            return res.status(400).json({ message: 'Faltan parámetros: tipo_Doc, serie, correlativo' });
        }

        const body = { empresa_Ruc: EMISOR_RUC, tipo_Doc, serie: String(serie).toUpperCase(), correlativo: String(correlativo) };

        const { data } = await axios.post(
            `${FACTILIZA_BASE_URL}/api/v1/invoice/cdr`,
            body,
            {
                headers: { Authorization: `Bearer ${FACTILIZA_TOKEN}` },
                responseType: 'arraybuffer',
                timeout: 30000
            }
        );

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="R-${tipo_Doc}-${body.serie}-${body.correlativo}.zip"`);
        return res.send(Buffer.from(data));
    } catch (e) {
        console.error('[getInvoiceCdr] error:', e?.response?.data || e.message);
        return sendUpstreamError(res, e, 'No se pudo obtener el CDR');
    }
};

export const getInvoiceLocalById = async (req, res) => {
    try {
        const inv = await Invoice.findById(req.params.id).lean();
        if (!inv) return res.status(404).json({ message: 'Invoice no encontrada' });
        return res.json(inv);
    } catch (_) {
        return res.status(400).json({ message: 'ID inválido' });
    }
};
