// 生产模式入口：把 vite-plugin-workbench 的 API handler 挂到裸 http server，
// 同时提供静态文件服务（vite build 产物 dist/client）。
// esbuild 打包成单文件 server-bundle.mjs，由 Electron 壳 spawn node 运行。
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { workbenchApiPlugin } from "./vite-plugin-workbench.mjs";

const workbenchRoot = globalThis.__WB_BUNDLE_SERVER_DIR__
  ? path.resolve(globalThis.__WB_BUNDLE_SERVER_DIR__, "..")
  : path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = path.join(workbenchRoot, "dist", "client");

// ---- 用假 vite server 捕获插件的 API handler ----
let apiHandler = null;
const fakeViteServer = {
  config: { logger: console },
  watcher: undefined, // 生产模式不监听文件变化，索引走手动刷新（/api/refresh）
  httpServer: null,
  middlewares: {
    use: (fn) => {
      apiHandler = fn;
    },
  },
};
workbenchApiPlugin().configureServer(fakeViteServer);
if (!apiHandler) {
  console.error("[server] 插件未注册 API handler");
  process.exit(1);
}

// ---- 静态文件服务（vite build 产物 + SPA fallback）----
const contentTypes = {
  css: "text/css; charset=utf-8",
  gif: "image/gif",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  webp: "image/webp",
  txt: "text/plain; charset=utf-8",
};

async function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
  } catch {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }
  const relative = path.posix.normalize(pathname).replace(/^\/+/, "");
  if (relative === ".." || relative.startsWith("../")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  let filePath = path.join(distRoot, relative);
  if (!path.extname(filePath)) filePath = path.join(filePath, "index.html");
  try {
    const info = await stat(filePath);
    if (info.isFile()) {
      const ext = path.extname(filePath).slice(1);
      res.writeHead(200, {
        "Content-Type": contentTypes[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      createReadStream(filePath).pipe(res);
      return;
    }
  } catch {
    // fall through to SPA fallback
  }

  try {
    const index = await readFile(path.join(distRoot, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(index);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
}

// ---- 端口解析：node server-bundle.mjs --port 5173 ----
const portArg = process.argv.indexOf("--port");
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) || 5173 : 5173;

const server = createServer((req, res) => {
  apiHandler(req, res, () => serveStatic(req, res));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[server] Personal Workbench server ready at http://127.0.0.1:${port}`);
  console.log(`[server] dist: ${distRoot}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
