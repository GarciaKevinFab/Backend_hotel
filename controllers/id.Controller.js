// controllers/id.controller.js
import axios from 'axios';

const FACTILIZA_BASE = process.env.FACTILIZA_BASE || 'https://api.factiliza.com/v1';
const FACTILIZA_TOKEN = process.env.FACTILIZA_TOKEN; // solo Factiliza

if (!FACTILIZA_TOKEN) {
    console.warn('[WARN] FACTILIZA_TOKEN no está definido. Las consultas fallarán con 500.');
}

const fx = axios.create({
    baseURL: FACTILIZA_BASE,
    headers: { Authorization: `Bearer ${FACTILIZA_TOKEN || ''}` },
    timeout: 10_000
});

// --- Normalizadores para uniformar al frontend ---
const normalizePerson = (d = {}) => ({
    nombres: d.nombres || d.nombre || '',
    apellidoPaterno: d.apellido_paterno || d.apellidoPaterno || '',
    apellidoMaterno: d.apellido_materno || d.apellidoMaterno || '',
});

const normalizeRuc = (d = {}) => ({
    razonSocial: d.razonSocial || d.razon_social || d.nombre_o_razon_social || '',
    ruc: d.ruc || d.numeroDocumento || '',
    estado: d.estado || d.estado_del_contribuyente || '',
    condicion: d.condicion || d.condicion_de_domicilio || '',
    direccion: d.direccion || d.direccion_completa || d.domicilio_fiscal || '',
});

// --- Helper de error consistente ---
const sendUpstreamError = (res, e, msgGeneric) => {
    if (e.response) {
        const { status, data } = e.response;
        // Reenvía status 4xx/5xx del proveedor para que el front sepa si es "no encontrado", inválido, etc.
        return res.status(status).json({ message: data?.message || data?.error || msgGeneric });
    }
    if (e.code === 'ECONNABORTED') return res.status(504).json({ message: 'Timeout consultando proveedor' });
    return res.status(500).json({ message: msgGeneric });
};

// --- Validaciones rápidas (evita pegarle al proveedor con basura) ---
const isValidDni = (v = '') => /^\d{8}$/.test(v);
const isValidRuc = (v = '') => /^\d{11}$/.test(v);
// C.E. puede variar en longitud y formato; acepta al menos 8 alfanum.
const isValidCee = (v = '') => /^[A-Za-z0-9\-]{8,}$/.test(v);

// =================== DNI ===================
export const getDniData = async (req, res) => {
    if (!FACTILIZA_TOKEN) return res.status(500).json({ message: 'FACTILIZA_TOKEN no configurado' });

    const { dni } = req.params;
    if (!isValidDni(dni)) return res.status(400).json({ message: 'DNI inválido (8 dígitos)' });

    try {
        const { data } = await fx.get(`/dni/info/${dni}`);
        const payload = data?.data || data;
        return res.json(normalizePerson(payload));
    } catch (e) {
        return sendUpstreamError(res, e, 'Error al obtener los datos del DNI');
    }
};

// =================== CEE (Carnet de Extranjería PERÚ) ===================
export const getCeeData = async (req, res) => {
    if (!FACTILIZA_TOKEN) return res.status(500).json({ message: 'FACTILIZA_TOKEN no configurado' });

    const { cee } = req.params;
    if (!isValidCee(cee)) return res.status(400).json({ message: 'CEE inválido' });

    try {
        const { data } = await fx.get(`/cee/info/${cee}`);
        const payload = data?.data || data;
        return res.json(normalizePerson(payload));
    } catch (e) {
        return sendUpstreamError(res, e, 'Error al obtener los datos del CEE');
    }
};

// =================== RUC ===================
export const getRucData = async (req, res) => {
    if (!FACTILIZA_TOKEN) return res.status(500).json({ message: 'FACTILIZA_TOKEN no configurado' });

    const { ruc } = req.params;
    if (!isValidRuc(ruc)) return res.status(400).json({ message: 'RUC inválido (11 dígitos)' });

    try {
        const { data } = await fx.get(`/ruc/info/${ruc}`);
        const payload = data?.data || data;
        return res.json(normalizeRuc(payload));
    } catch (e) {
        return sendUpstreamError(res, e, 'Error al obtener los datos del RUC');
    }
};
