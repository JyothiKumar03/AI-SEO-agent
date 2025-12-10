import { Router } from "express";
import { health_check } from "../controllers/health-controller";
import { generate_seo_content } from "../controllers/seo-controller";

const router = Router();

router.get("/health", health_check);
router.post("/seo/generate", generate_seo_content);

export default router;
