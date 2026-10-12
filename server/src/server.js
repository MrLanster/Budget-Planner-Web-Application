// Budget Planner server - entry point.
//
// One process does two jobs: it serves the static web app, and it answers the
// API that the app now stores its data through.
//
//   node server/src/server.js
//
// Configuration is by environment variable:
//   HOST        default 127.0.0.1
//   PORT        default 8080
//   NODE_ENV    "production" turns on the Secure cookie flag (use behind HTTPS)
//   BP_DATA_DIR where the databases live (default server/data)

import http from "node:http";
import { handleApi } from "./api.js";
import { HOST, IS_PROD, PORT, USERS_DIR } from "./config.js";
import { applySecurityHeaders } from "./http.js";
import { serveStatic } from "./static.js";

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);

  let pathname = "/";
  try {
    pathname = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad request");
    return;
  }

  if (pathname.startsWith("/api/")) {
    await handleApi(req, res, pathname);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain", Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  const where = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
  console.log("");
  console.log("  Budget Planner");
  console.log("  ----------------");
  console.log(`  App     ${where}/`);
  console.log(`  Mode    ${IS_PROD ? "production" : "development"}`);
  console.log(`  Data    ${USERS_DIR}`);
  console.log("  Stop    Ctrl+C");
  console.log("");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log("\nShutting down.");
    server.close(() => process.exit(0));
  });
}
