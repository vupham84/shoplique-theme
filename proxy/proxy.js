const http = require('http');
const https = require('https');
const { URL } = require('url');

const TARGET = 'https://8f981be05ed6.ngrok-free.app'; // your ngrok URL

const server = http.createServer((req, res) => {
  const url = new URL(req.url, TARGET);
  
  // Copy headers and override Host to target hostname
  const headers = { ...req.headers, host: url.hostname };
  
  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname + url.search,
    method: req.method,
    headers: headers,
  };

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.writeHead(500);
    res.end('Proxy error');
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(9293, () => {
  console.log(`Proxy running at http://localhost:9293 → ${TARGET}`);
});
