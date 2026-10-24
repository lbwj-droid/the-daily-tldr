// Local preview: serves public/ and stands in for the two Vercel functions.
// Usage: node scripts/dev-server.mjs [--data <dir>] [--overrides <file.json>] [--port 3000]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, dflt) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : dflt);
const dataDir = path.resolve(arg("--data", path.join(root, "public", "data")));
const overridesFile = arg("--overrides", "");
const port = Number(arg("--port", 3000));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".txt": "text/plain" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/overrides") {
    const body = overridesFile ? await readFile(overridesFile, "utf8") : JSON.stringify({ configured: false, overrides: {}, added: [] });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(body);
  }
  if (url.pathname === "/api/click") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { console.log("click", b); res.writeHead(204); res.end(); });
    return;
  }
  const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = rel.startsWith("data/") ? path.join(dataDir, rel.slice(5)) : path.join(root, "public", rel);
  if (!file.startsWith(root) && !file.startsWith(dataDir)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(port, () => console.log(`Preview on http://localhost:${port} (data: ${dataDir})`));
