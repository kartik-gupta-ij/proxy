const http = require("http");
const net = require("net");
const httpProxy = require("http-proxy");
const express = require("express");
const fs = require("fs");
const path = require("path");

const PORT = 8000;
const METRICS_FILE = path.join(__dirname, "bandwidth.json");
const proxy = httpProxy.createProxyServer({ changeOrigin: true });

const app = express();
app.use(express.json());

const bandwidthData = loadMetrics();

function loadMetrics() {
  try {
    return JSON.parse(fs.readFileSync(METRICS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveMetrics() {
  fs.writeFileSync(
    METRICS_FILE,
    JSON.stringify(bandwidthData, null, 2),
    "utf8"
  );
}

function authenticate(req, res, next) {
  const authHeader = req.headers["proxy-authorization"];
  if (!authHeader) {
    res.setHeader("Proxy-Authenticate", 'Basic realm="Proxy Server"');
    return res.status(407).send("Proxy Authentication Required");
  }

  const [username, password] = decodeCredentials(authHeader);
  if (username !== "abc" || password !== "abc") {
    return res.status(403).send("Forbidden: Invalid Proxy Credentials");
  }
  next();
}

function authenticateProxy(req) {
  const authHeader = req.headers["proxy-authorization"];
  if (!authHeader) return false;
  const [username, password] = decodeCredentials(authHeader);
  return username === "abc" && password === "abc";
}

function decodeCredentials(authHeader) {
  const encodedCreds = authHeader.split(" ")[1];
  return Buffer.from(encodedCreds, "base64").toString().split(":");
}

function updateMetrics(host, bytesSent = 0, bytesReceived = 0) {
  if (!bandwidthData[host]) {
    bandwidthData[host] = {
      totalBytesSent: 0,
      totalBytesReceived: 0,
      requestCount: 0,
    };
  }
  bandwidthData[host].requestCount++;
  bandwidthData[host].totalBytesSent += bytesSent;
  bandwidthData[host].totalBytesReceived += bytesReceived;
}

app.get("/", authenticate, (req, res) => {
  const targetUrl = req.url.startsWith("http")
    ? req.url
    : `http://${req.headers.host}${req.url}`;
  console.log(`Proxying request to: ${targetUrl}`);

  proxy.on("proxyRes", (proxyRes, req) => {
    updateMetrics(req.headers.host);
    proxyRes.on("data", (chunk) =>
      updateMetrics(req.headers.host, 0, chunk.length)
    );
    proxyRes.on("end", saveMetrics);
  });

  proxy.web(req, res, { target: targetUrl }, (err) => {
    res.status(500).end(`Error proxying request: ${err.message}`);
  });
});

const server = http.createServer(app);
server.on("connect", (req, clientSocket) => {
  if (!authenticateProxy(req)) {
    clientSocket.write(
      'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Proxy Server"\r\n\r\n'
    );
    return clientSocket.end();
  }

  const { port = 443, hostname } = new URL(`http://${req.url}`);
  console.log(`Establishing HTTPS tunnel to: ${hostname}:${port}`);

  updateMetrics(hostname);
  const serverSocket = net.connect(port, hostname, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
    console.log(`HTTPS tunnel established: ${hostname}:${port}`);
  });

  serverSocket.on("data", (chunk) => updateMetrics(hostname, 0, chunk.length));
  clientSocket.on("data", (chunk) => updateMetrics(hostname, chunk.length, 0));

  serverSocket.on("end", saveMetrics);
  clientSocket.on("end", saveMetrics);

  serverSocket.on("error", (err) => {
    console.error("Server socket error:", err);
    clientSocket.end("HTTP/1.1 500 Internal Server Error\r\n\r\n");
  });
  clientSocket.on("error", () => serverSocket.end());
});

app.get("/metrics", (req, res) => res.json(bandwidthData));

function logFinalSummary() {
  console.log("\n=== Proxy Final Metrics Summary ===");
  Object.entries(bandwidthData).forEach(([host, stats]) => {
    console.log(
      `${host}: ${stats.requestCount} requests, Sent: ${stats.totalBytesSent} bytes, Received: ${stats.totalBytesReceived} bytes`
    );
  });
  saveMetrics();
  console.log("Metrics saved. Proxy shutting down.");
}

process.on("SIGINT", logFinalSummary);
process.on("SIGTERM", logFinalSummary);

server.listen(PORT, () => console.log(`Proxy server running on port ${PORT}`));
