import express from 'express';
import {
    createInvoice,
    getInvoiceLocalById,
    getInvoicePdf,
    getInvoiceXml,
    getInvoiceCdr
} from '../controllers/invoice.Controller.js';
const router = express.Router();

router.post('/invoice', createInvoice);
router.get('/invoice/local/:id', getInvoiceLocalById);

// Nuevos endpoints para archivos SUNAT:
router.post('/invoice/pdf', getInvoicePdf);
router.post('/invoice/xml', getInvoiceXml);
router.post('/invoice/cdr', getInvoiceCdr);

export default router;
