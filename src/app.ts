import express, { Express } from "express";
import routes from "./routes";

const app: Express = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.json({ status: "ready" });
});

app.use("/api", routes);

export default app;
