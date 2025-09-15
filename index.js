// server.js  (ESM)
import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";

import roomRoutes from "./routes/room.routes.js";
import reservationRoutes from "./routes/booking.routes.js";
import invoiceRoutes from "./routes/invoice.routes.js";
import idRoutes from "./routes/id.routes.js";
import userRoutes from "./routes/user.routes.js";
import reportRoutes from "./routes/report.routes.js";
import authRoutes from "./routes/auth.routes.js";

import { generatePDF } from "./controllers/generateReport.Controller.js";
import { updateRoomStatus, getGuestsByCountry } from "./controllers/booking.Controller.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000; // usa 4000 si tu front va en 3000

// CORS (ajusta origin si usas Vite en 5173)
app.use(cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
}));

app.use(express.json());

// Rutas API
app.use("/api/rooms", roomRoutes);
app.use("/api/reservations", reservationRoutes);
app.use("/api", invoiceRoutes);
app.use("/api/id", idRoutes);
app.use("/api/users", userRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/auth", authRoutes);

app.get("/api/guestsbycountry", getGuestsByCountry);

// Servir reportes
app.use("/reports", express.static(path.join(__dirname, "reports")));

app.get("/api/reports", (req, res) => {
    const reportsDir = path.join(__dirname, "reports");
    fs.readdir(reportsDir, (err, files) => {
        if (err) return res.status(500).send("Unable to scan reports directory");
        res.json(files);
    });
});

// Cron jobs
cron.schedule("0 0 * * *", async () => {
    try {
        console.log("[CRON] Generating daily report…");
        await generatePDF();
    } catch (e) {
        console.error("[CRON] generatePDF failed:", e.message);
    }
});

cron.schedule("0 0 * * *", async () => {
    try {
        console.log("[CRON] Updating room status…");
        await updateRoomStatus();
    } catch (e) {
        console.error("[CRON] updateRoomStatus failed:", e.message);
    }
});

// === Conexión a Mongo y arranque del server ===
const MONGO_URI = process.env.MONGO_URI; // asegúrate que existe en .env

if (!MONGO_URI) {
    console.error("❌ Falta MONGO_URI en tu .env");
    process.exit(1);
}

try {
    await mongoose.connect(MONGO_URI, { dbName: process.env.MONGO_DB || "hotel" });
    console.log("✅ MongoDB connected");

    const server = app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
    });

    // Cierre elegante
    const shutdown = async (signal) => {
        console.log(`\n${signal} recibido. Cerrando…`);
        server.close(() => console.log("HTTP server cerrado"));
        await mongoose.connection.close();
        console.log("MongoDB cerrado");
        process.exit(0);
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

} catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
}
