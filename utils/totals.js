export function buildFactilizaPayload(body) {
    const {
        ruc,
        tipoDocumento,      // "01" o "03"
        serie,
        numero,
        fechaEmision,
        tipoMoneda = 'PEN',
        tipoOperacion = '0101',
        clienteTipoDoc = '6',
        customerRuc,
        customerName,
        customerAddress,
        items = []
    } = body;

    if (!ruc || !tipoDocumento || !serie || !numero || !fechaEmision || !customerRuc || !customerName || !customerAddress) {
        throw new Error('Campos requeridos faltantes en el body');
    }

    const IGV_RATE = 0.18;

    const detalle = items.map((it) => {
        const cantidad = Number(it.cantidad || 0);
        const precioUnitarioConIGV = Number(it.precioUnitario || 0);
        const afectacion = it.tipAfeIgv || '10';

        const valorUnitarioSinIGV = afectacion === '10'
            ? +(precioUnitarioConIGV / (1 + IGV_RATE)).toFixed(6)
            : +precioUnitarioConIGV.toFixed(6);

        const montoValorVenta = +(valorUnitarioSinIGV * cantidad).toFixed(2);
        const baseIgv = afectacion === '10' ? montoValorVenta : 0;
        const igv = afectacion === '10' ? +(baseIgv * IGV_RATE).toFixed(2) : 0;
        const totalImpuestos = igv;

        return {
            unidad: 'NIU',
            cantidad,
            cod_Producto: it.codigo || '',
            descripcion: it.descripcion || '',
            monto_Valor_Unitario: +valorUnitarioSinIGV.toFixed(6),
            monto_Base_Igv: +baseIgv.toFixed(2),
            porcentaje_Igv: afectacion === '10' ? 18 : 0,
            igv,
            tip_Afe_Igv: afectacion,
            total_Impuestos: totalImpuestos,
            monto_Precio_Unitario: +precioUnitarioConIGV.toFixed(6),
            monto_Valor_Venta: montoValorVenta,
            factor_Icbper: 0
        };
    });

    const montoOperExoneradas = detalle
        .filter(d => d.tip_Afe_Igv === '20')
        .reduce((acc, d) => acc + d.monto_Valor_Venta, 0);

    const montoOperGravadas = detalle
        .filter(d => d.tip_Afe_Igv === '10')
        .reduce((acc, d) => acc + d.monto_Valor_Venta, 0);

    const montoIgv = +(detalle.reduce((acc, d) => acc + d.igv, 0)).toFixed(2);
    const totalImpuestos = montoIgv;
    const valorVenta = +(montoOperGravadas + montoOperExoneradas).toFixed(2);
    const subTotal = valorVenta;
    const montoImpVenta = +(valorVenta + totalImpuestos).toFixed(2);

    const payload = {
        tipo_Operacion: tipoOperacion,
        tipo_Doc: tipoDocumento,
        serie,
        correlativo: numero,
        tipo_Moneda: tipoMoneda,
        fecha_Emision: new Date(fechaEmision).toISOString(),
        empresa_Ruc: ruc,
        cliente_Tipo_Doc: clienteTipoDoc,
        cliente_Num_Doc: customerRuc,
        cliente_Razon_Social: customerName,
        cliente_Direccion: customerAddress,
        monto_Oper_Gravadas: +montoOperGravadas.toFixed(2),
        monto_Igv: +montoIgv.toFixed(2),
        total_Impuestos: +totalImpuestos.toFixed(2),
        valor_Venta: +valorVenta.toFixed(2),
        sub_Total: +subTotal.toFixed(2),
        monto_Imp_Venta: +montoImpVenta.toFixed(2),
        monto_Oper_Exoneradas: +montoOperExoneradas.toFixed(2),
        estado_Documento: 'ACTIVO',
        manual: true,
        id_Base_Dato: '',
        detalle,
        forma_pago: [
            { tipo: 'Contado', monto: +montoImpVenta.toFixed(2), cuota: 1, fecha_Pago: new Date(fechaEmision).toISOString() }
        ],
        legend: []
    };

    const resumen = {
        montoOperGravadas,
        montoOperExoneradas,
        montoIgv,
        totalImpuestos,
        valorVenta,
        subTotal,
        montoImpVenta
    };

    return { payload, resumen };
}
