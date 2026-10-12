// Static file serving for the web app.
//
// Only files inside web/ can be served, and only if their extension is known.
// Both checks are what stop a crafted URL like /../../accounts.db from reading
// something it should not.

import fs from "node:fs";
import path from "node:path";
import { WEB_DIR } from "./config.js";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const IMMUTABLE = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf)$/i;

export function serveStatic(req, res, pathname) {
  let relative = decodeURIComponent(pathname);
  if (relative === "/" || relative === "") relative = "/index.html";

  const target = path.join(WEB_DIR, relative);
  const resolved = path.resolve(target);

  // Refuse anything that escaped web/ and anything without a known type.
  if (!resolved.startsWith(WEB_DIR + path.sep) && resolved !== WEB_DIR) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }
  const type = TYPES[path.extname(resolved).toLowerCase()];
  if (!type) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": stat.size,
    "Cache-Control": IMMUTABLE.test(resolved)
      ? "public, max-age=86400"
      : "no-cache",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(resolved).pipe(res);
}
