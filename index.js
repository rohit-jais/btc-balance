const http = require('http');
const httpProxy = require('http-proxy');
const cors = require('cors');
const express = require('express');

const app = express();

// Set up CORS to allow requests from localhost
const corsOptions = {
    origin: '*', // Change this to the port your frontend is running on
    methods: 'GET,POST,PUT,DELETE,OPTIONS',
    allowedHeaders: 'Origin, X-Requested-With, Content-Type, Accept, Authorization'
};

app.use(cors(corsOptions));

// Create a proxy server
const proxy = httpProxy.createProxyServer({});

// Create an HTTP server that listens to requests on port 8000
const server = http.createServer((req, res) => {
    // Forward the request to the target server, passing all headers
    proxy.web(req, res, { target: 'https://api.blockcypher.com', changeOrigin: true });
});

// Error handling
proxy.on('error', (err, req, res) => {
    res.writeHead(500, {
        'Content-Type': 'text/plain'
    });
    res.end('Something went wrong.');
});

console.log('Proxy server listening on port 3000');
server.listen(3000);
