import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("./dist/", import.meta.url));
const api = new URL("http://127.0.0.1:8000");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".txt": "text/plain",
};

http
  .createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        const upstream = http.request(
          new URL(url.pathname + url.search, api),
          {
            method: request.method,
            headers: { ...request.headers, host: api.host },
          },
          (result) => {
            response.writeHead(result.statusCode, result.headers);
            result.pipe(response);
          },
        );
        upstream.on("error", () => {
          if (response.headersSent) return response.destroy();
          response.writeHead(503, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({ detail: "The KHONSU API is unavailable." }),
          );
        });
        response.on("close", () => upstream.destroy());
        request.pipe(upstream);
        return;
      }

      const pathname = decodeURIComponent(url.pathname);
      const file = path.resolve(
        root,
        "." + (pathname === "/" ? "/index.html" : pathname),
      );
      if (!file.startsWith(root)) {
        response.writeHead(403).end();
        return;
      }
      const content = await readFile(file);
      response.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
      });
      response.end(content);
    } catch {
      response.writeHead(404).end("Not found");
    }
  })
  .listen(4173, "127.0.0.1", () => console.log("Local: http://127.0.0.1:4173"));
