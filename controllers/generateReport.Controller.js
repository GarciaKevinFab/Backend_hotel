// controllers/generateReport.Controller.js
import fs from "fs";
import path from "path";
import { jsPDF } from "jspdf";
import "jspdf-autotable";
import { Reservation } from "../models/booking.model.js";

/**
 * Genera un PDF en reportsDir
 * @param {string} reportsDir - ruta absoluta a la carpeta de reportes
 */
export const generatePDF = async (reportsDir) => {
    // Asegurar carpeta
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    const doc = new jsPDF();
    const d = new Date();
    const formattedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
    ).padStart(2, "0")}`;

    // Traer reservas
    const reservations = await Reservation.find().populate("room").lean().exec();

    // Mapear filas (tolerante a empresa/persona y valores faltantes)
    const reportData = reservations.flatMap((r) =>
        (r.userData || []).map((u) => {
            const isCompany = !!u.razonSocial;
            const name = isCompany
                ? u.razonSocial
                : [u.nombres, u.apellidoPaterno, u.apellidoMaterno].filter(Boolean).join(" ");
            const docNum = u.docNumber || u.dni || u.cedula || "-";
            return {
                id: r._id?.toString() || "-",
                checkInDate: r.checkInDate ? new Date(r.checkInDate) : null,
                checkOutDate: r.checkOutDate ? new Date(r.checkOutDate) : null,
                name: name || "-",
                dni: docNum,
                price: r.room?.price ?? "-",
                roomNumber: r.room?.number ?? "-",
                roomType: r.room?.type ?? "-",
                nationality: u.nationality || "-",
            };
        })
    );

    // Encabezado
    doc.setFontSize(16);
    doc.text("Confort Inn Hostal", 70, 20);
    doc.setFontSize(12);
    doc.text(`FECHA: ${formattedDate}`, 140, 20);

    // Tabla
    const headers = [
        [
            "N°",
            "NOMBRE / RAZÓN SOCIAL",
            "DNI / CE / RUC",
            "FECHA/HORA INGRESO",
            "FECHA/HORA SALIDA",
            "PRECIO S/.",
            "N° HAB.",
            "TIPO DE HAB.",
            "NACIONALIDAD",
            "FIRMA",
        ],
    ];

    const rows = reportData.map((e, i) => [
        i + 1,
        e.name,
        e.dni,
        e.checkInDate ? e.checkInDate.toLocaleString() : "-",
        e.checkOutDate ? e.checkOutDate.toLocaleString() : "-",
        e.price,
        e.roomNumber,
        e.roomType,
        e.nationality,
        "",
    ]);

    doc.autoTable({
        startY: 30,
        head: headers,
        body: rows,
        theme: "grid",
        styles: { fontSize: 10 },
        headStyles: { fillColor: [22, 160, 133] },
    });

    // Guardar como binario (crítico para que no se corrompa)
    const filePath = path.join(reportsDir, `reservations_${formattedDate}.pdf`);
    const pdfArrayBuffer = doc.output("arraybuffer");
    const buffer = Buffer.from(pdfArrayBuffer);
    fs.writeFileSync(filePath, buffer);

    console.log(`Report saved as ${filePath}`);
};
