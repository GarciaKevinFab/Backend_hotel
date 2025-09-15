import express from "express";
import { getDniData, getCeeData, getRucData } from "../controllers/id.Controller.js";

const router = express.Router();

router.get("/dni/:dni", getDniData);
router.get("/cee/:cee", getCeeData);
router.get("/ruc/:ruc", getRucData);

export default router;

