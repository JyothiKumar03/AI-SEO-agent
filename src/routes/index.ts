import { Router } from "express";
import { healthCheck } from "../controllers/healthController";
import { generateSeoContent } from "../controllers/seoController";

const router = Router();

router.get("/health", healthCheck);
router.post("/seo/generate", generateSeoContent);

export default router;
