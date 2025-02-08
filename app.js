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
  } catch (err) {
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

const authenticate = (req, res, next) => {
  const authHeader = req.headers["proxy-authorization"]; // Get Proxy-Authorization header

  if (!authHeader) {
    res.setHeader("Proxy-Authenticate", 'Basic realm="Proxy Server"');
    return res.status(407).send("Proxy Authentication Required");
  }

  // Extract base64 credentials
  const encodedCreds = authHeader.split(" ")[1];
  const decodedCreds = Buffer.from(encodedCreds, "base64").toString();
  const [username, password] = decodedCreds.split(":");

  // Validate username and password
  if (username !== "abc" || password !== "abc") {
    return res.status(403).send("Forbidden: Invalid Proxy Credentials");
  }

  next();
};


const authenticateProxy = (req) => {
  const authHeader = req.headers["proxy-authorization"]; // Get Proxy-Authorization header

  if (!authHeader) return false; // No auth header, reject

  const encodedCreds = authHeader.split(" ")[1];
  const decodedCreds = Buffer.from(encodedCreds, "base64").toString();
  const [username, password] = decodedCreds.split(":");

  return username === "abc" && password === "abc";
};

// Proxy logic on "/"
app.get("/", authenticate, (req, res) => {
  const targetUrl = req.url.startsWith("http")
    ? req.url
    : `http://${req.headers.host}${req.url}`;
  console.log(`Proxying request to: ${targetUrl}`);

  // --proxy-user abc:abc auth logic

  proxy.on("proxyRes", (proxyRes, req, res) => {
    console.log(`Proxying response from: ${req.headers.host}`);

    if (!bandwidthData[req.headers.host]) {
      bandwidthData[req.headers.host] = {
        totalBytesSent: 0,
        totalBytesReceived: 0,
        requestCount: 0,
      };
    }
    bandwidthData[req.headers.host].requestCount++;

    proxyRes.on("data", (chunk) => {
      console.log(`Received data: ${chunk.length} bytes`);
      bandwidthData[req.headers.host].totalBytesReceived += chunk.length;
    });

    proxyRes.on("end", saveMetrics);
  });

  proxy.web(req, res, { target: targetUrl }, (err) => {
    res.statusCode = 500;
    res.end(`Error proxying request: ${err.message}`);
  });
});

// Handle HTTPS CONNECT requests
const server = http.createServer(app);
server.on("connect", (req, clientSocket, head) => {
    if (!authenticateProxy(req)) {
      clientSocket.write(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Proxy Server"\r\n\r\n'
      );
      clientSocket.end();
      return;
    }
  const { port, hostname } = new URL(`http://${req.url}`);
  console.log(`Establishing HTTPS tunnel to: ${hostname}:${port}`);

  if (!bandwidthData[hostname]) {
    bandwidthData[hostname] = {
      totalBytesSent: 0,
      totalBytesReceived: 0,
      requestCount: 0,
    };
  }
  bandwidthData[hostname].requestCount++;

  const serverSocket = net.connect(port || 443, hostname, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
    console.log(`HTTPS tunnel established: ${hostname}:${port}`);
  });

  serverSocket.on("data", (chunk) => {
    bandwidthData[hostname].totalBytesReceived += chunk.length;
  });

  clientSocket.on("data", (chunk) => {
    bandwidthData[hostname].totalBytesSent += chunk.length;
  });

  serverSocket.on("end", saveMetrics);
  clientSocket.on("end", saveMetrics);

  serverSocket.on("error", (err) => {
    console.error("Error in HTTPS tunnel:", err);
    clientSocket.end("HTTP/1.1 500 Internal Server Error\r\n\r\n");
  });

  clientSocket.on("error", (err) => {
    console.error("Client socket error:", err);
    serverSocket.end();
  });
});

// Real-time metrics endpoint
app.get("/metrics", (req, res) => {
  res.json(bandwidthData);
});

// Final summary on shutdown
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

process.on("SIGINT", () => {
  logFinalSummary();
  process.exit();
});

process.on("SIGTERM", () => {
  logFinalSummary();
  process.exit();
});

// Start the proxy server
server.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
``;
