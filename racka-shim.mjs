#!/usr/bin/env node
// racka-shim.mjs — local SSE strip-proxy for HF Inference Endpoints.
//
// Why: opencode (bun fetch on Windows) stalls on the HF edge's SSE stream,
// while a localhost pass-through works fine. Point your OpenAI-compatible
// client's baseURL at this shim instead of the HF endpoint directly.
//
//   RACKA_TARGET=https://<endpoint>.endpoints.huggingface.cloud node racka-shim.mjs
//   (default target: the racka-4b endpoint from ~/.racka.json, port 8788)
//
// Zero dependencies, Node >= 18.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = parseInt(process.env.RACKA_SHIM_PORT || "8788", 10);

function defaultTarget() {
  if (process.env.RACKA_TARGET) return process.env.RACKA_TARGET.replace(/\/+$/, "");
  if (process.env.RACKA_URL) return process.env.RACKA_URL.replace(/\/+$/, "");
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".racka.json"), "utf8"));
    if (j.url) return j.url.replace(/\/+$/, "");
  } catch { /* no config */ }
  console.error("Set RACKA_TARGET=https://<endpoint> (or fill ~/.racka.json)");
  process.exit(1);
}

const TARGET = defaultTarget();

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const upstream = await fetch(TARGET + req.url, {
        method: req.method,
        headers: {
          "Content-Type": "application/json",
          Authorization: req.headers.authorization || "",
          Accept: req.headers.accept || "*/*",
        },
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      });
      // NOTE: deliberately forwards ONLY content-type — no content-encoding,
      // no transfer-encoding. This is what un-stalls bun's fetch.
      res.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        "Cache-Control": "no-cache",
      });
      if (upstream.body) {
        const reader = upstream.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
    } catch (e) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: { message: "shim upstream error: " + e.message } }));
    }
  });
  req.on("error", () => res.destroy());
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`racka-shim: http://127.0.0.1:${PORT} -> ${TARGET}`);
});
