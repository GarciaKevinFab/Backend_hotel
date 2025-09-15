// server.js (ESM Hardened)
import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";

// Rutas
import roomRoutes from "./routes/room.routes.js";
import reservationRoutes from "./routes/booking.routes.js";
import invoiceRoutes from "./routes/invoice.routes.js";
import idRoutes from "./routes/id.routes.js";
import userRoutes from "./routes/user.routes.js";
import reportRoutes from "./routes/report.routes.js";
import authRoutes from "./routes/auth.routes.js";

// Controladores
import { generatePDF } from "./controllers/generateReport.Controller.js";
import { updateRoomStatus, getGuestsByCountry } from "./controllers/booking.Controller.js";

// ====== Setup base ======
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 4000);
const NODE_ENV = process.env.NODE_ENV || "development";

// Seguridad/infra
app.set("trust proxy", 1);           // cookies secure detrás de proxy
app.disable("x-powered-by");         // menos fingerprint

// ====== CORS sólido (sin dependencias nuevas) ======
/**
 * Permite orígenes de:
 *  - localhost:3000/5173/4173
 *  - sistema-hotel.netlify.app (principal) y branch deploys
 *  - extras desde .env (CORS_ORIGINS, coma-separado, soporta wildcard *)
 */
const baseAllowList = [
    /^http:\/\/localhost:(3000|5173|4173)$/,
    /^http:\/\/127\.0\.0\.1:(3000|5173|4173)$/,
    /^https:\/\/sistema-hotel\.netlify\.app$/,
    /^https:\/\/.*--sistema-hotel\.netlify\.app$/,
];

const extraAllowList = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(pattern =>
        new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$")
    );

const allowList = [...baseAllowList, ...extraAllowList];

const corsOptions = {
    origin(origin, cb) {
        // No 'origin' => curl/Postman/SSR: permitir
        if (!origin) return cb(null, true);
        const ok = allowList.some(rx => rx.test(origin));
        return ok ? cb(null, true) : cb(new Error(`CORS bloqueado para: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    exposedHeaders: ["Content-Disposition"],
    optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ====== Body parsing ======
app.use(express.json({ limit: process.env.JSON_LIMIT || "1mb" }));

// ====== Healthchecks ======
app.get("/healthz", (req, res) => res.status(200).send("ok"));
app.get("/api/health", (req, res) =>
    res.json({ ok: true, env: NODE_ENV, time: new Date().toISOString() })
);

// ====== Archivos de reportes ======
const reportsDir = process.env.REPORTS_DIR
    ? path.isAbsolute(process.env.REPORTS_DIR)
        ? process.env.REPORTS_DIR
        : path.join(__dirname, process.env.REPORTS_DIR)
    : path.join(__dirname, "reports");

fs.mkdirSync(reportsDir, { recursive: true });

// Servir reportes con caché razonable (puedes ajustar)
app.use(
    "/reports",
    express.static(reportsDir, {
        etag: true,
        lastModified: true,
        maxAge: "12h",
        index: false,
        setHeaders(res) {
            res.setHeader("Cache-Control", "public, max-age=43200, must-revalidate");
        },
    })
);

// Listado de reportes para UI
app.get("/api/reports", (req, res) => {
    fs.readdir(reportsDir, (err, files) => {
        if (err) return res.status(500).send("Unable to scan reports directory");
        res.json(files);
    });
});

// ====== Rutas API ======
app.use("/api/rooms", roomRoutes);
app.use("/api/reservations", reservationRoutes);
app.use("/api", invoiceRoutes);
app.use("/api/id", idRoutes);
app.use("/api/users", userRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/auth", authRoutes);

// Endpoint usado por el mapa (huéspedes por país)
app.get("/api/guestsbycountry", getGuestsByCountry);

// ====== 404 API ======
app.use("/api", (req, res) => {
    res.status(404).json({ error: "Not Found" });
});

// ====== Cron jobs (opcionales) ======
const CRON_ENABLED = String(process.env.CRON_ENABLED || "true").toLowerCase() === "true";
if (CRON_ENABLED && NODE_ENV !== "development") {
    // 00:00 generar PDF
    cron.schedule("0 0 * * *", async () => {
        try {
            console.log("[CRON] Generating daily report…");
            await generatePDF();
        } catch (e) {
            console.error("[CRON] generatePDF failed:", e.message);
        }
    });

    // 00:05 actualizar estados de habitaciones
    cron.schedule("5 0 * * *", async () => {
        try {
            console.log("[CRON] Updating room status…");
            await updateRoomStatus();
        } catch (e) {
            console.error("[CRON] updateRoomStatus failed:", e.message);
        }
    });
} else {
    console.log("CRON deshabilitado (CRON_ENABLED=false o NODE_ENV=development).");
}

// ====== Mongo + arranque ======
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("❌ Falta MONGO_URI en tu .env");
    process.exit(1);
}

try {
    await mongoose.connect(MONGO_URI, {
        dbName: process.env.MONGO_DB || "hotel",
        // useNewUrlParser / useUnifiedTopology ya no son necesarios en Mongoose >=6
    });
    console.log("✅ MongoDB connected");

    const server = app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
    });

    // Manejo de cierre elegante
    const shutdown = async (signal) => {
        console.log(`\n${signal} recibido. Cerrando…`);
        server.close(() => console.log("HTTP server cerrado"));
        try {
            await mongoose.connection.close();
            console.log("MongoDB cerrado");
        } catch (e) {
            console.error("Error cerrando Mongo:", e?.message);
        }
        process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("unhandledRejection", (reason) => {
        console.error("UnhandledRejection:", reason);
    });
    process.on("uncaughtException", (err) => {
        console.error("UncaughtException:", err);
    });

} catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
}
