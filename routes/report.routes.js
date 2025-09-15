// routes/reports.routes.js
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generatePDF } from "../controllers/generateReport.Controller.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carpeta de reportes (absoluta)
const reportsDir = path.join(__dirname, "..", "reports");

// Asegura que la carpeta exista
function ensureReportsDir() {
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
    }
}

// Generar un reporte manualmente
router.get("/generate", async (req, res) => {
    try {
        ensureReportsDir();
        await generatePDF(reportsDir); // <- le pasamos la ruta
        res.status(200).send("Report generated successfully");
    } catch (error) {
        console.error("Error generating report:", error);
        res.status(500).send("Failed to generate report");
    }
});

// Listar todos los reportes
router.get("/", async (req, res) => {
    try {
        ensureReportsDir();
        const files = await fs.promises.readdir(reportsDir, { withFileTypes: true });
        const onlyFiles = files.filter((d) => d.isFile()).map((d) => d.name);
        return res.json(onlyFiles);
    } catch (err) {
        console.error("Unable to scan reports directory:", err);
        return res.status(500).json({ error: "Unable to scan reports directory" });
    }
});

export default router;
