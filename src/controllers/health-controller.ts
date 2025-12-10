import { Request, Response } from "express";

export const health_check = (_req: Request, res: Response): void => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
};
