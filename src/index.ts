import http from "node:http";
import app from "./app";
import { env } from "./config/env";

const server = http.createServer(app);

server.listen(env.port, () => {
  console.log(`Server listening on port ${env.port}`);
});

server.on("error", (error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});
