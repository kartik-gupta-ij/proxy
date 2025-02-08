# Proxy Server with Bandwidth Tracking

This proxy server supports basic authentication and tracks bandwidth usage along with site analytics.

## Features
- Supports HTTP and HTTPS traffic
- Requires basic authentication (`username:password`)
- Tracks bandwidth usage and most visited sites
- Provides real-time metrics via the `/metrics` endpoint
- Outputs final usage summary on shutdown

## Usage

### Start the Proxy Server
Ensure you have Node.js installed, then run:
```sh
node app.js
```
The proxy will start on port `8000`.

### Making Requests through the Proxy
To route traffic through the proxy, use the following command:

```sh
curl -x http://proxy_server:proxy_port --proxy-user username:password -L <http://url>
```

Example:
```sh
curl -x http://localhost:8000 --proxy-user abc:abc -L https://example.com
```
```sh
curl -x http://localhost:8000 --proxy-user abc:abc -L http://example.com
```

### Fetching Metrics
To check real-time bandwidth usage and most visited sites:
```sh
curl http://localhost:8000/metrics
```
This returns a JSON response with metrics like:
```json
{
  "bandwidth_usage": "125MB",
  "top_sites": [
    {"url": "example.com", "visits": 10},
    {"url": "google.com", "visits": 5}
  ]
}
```

### Stopping the Server
Press `CTRL+C` to stop the server. It will output total bandwidth usage and site visit counts before exiting.

