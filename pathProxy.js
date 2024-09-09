const http = require("http");
const httpProxy = require("http-proxy");
const { ethers } = require("ethers");
const url = require("url");
const { MongoClient } = require("mongodb");
const cors = require("cors");
const express = require("express");
const app = express();

// Set up CORS to allow requests from localhost
const corsOptions = {
	origin: "*", // Change this to the port your frontend is running on
	methods: "GET,POST,PUT,DELETE,OPTIONS",
	allowedHeaders:
		"Origin, X-Requested-With, Content-Type, Accept, Authorization",
};

app.use(cors(corsOptions));
// MongoDB setup
const uri = "mongodb://admin:adminpassword@localhost:27017/";
const client = new MongoClient(uri, {
	useNewUrlParser: true,
	useUnifiedTopology: true,
});
const dbName = "RouterRelay";
const collectionName = "depositData";

async function connectMongo() {
	try {
		await client.connect();
		console.log("Connected to MongoDB");
	} catch (err) {
		console.error("Failed to connect to MongoDB", err);
	}
}
connectMongo();

// Setup ethers provider
const provider = new ethers.JsonRpcProvider(
	"https://polygon.blockpi.network/v1/rpc/77c61dcd6cd6031f37f82cf022d15cb484c7af13"
);

// Contract ABI and Address
const contractABI = [
	"function addressForTokenDeposit(bytes32 salt, tuple(address callTo, address approvalTo, bytes data, address srcToken, address refundAddress) genericData) external view returns (address)",
];
const contractAddress = "0x26054DeB0968d40F2488f6822d390317047cef18";
const contract = new ethers.Contract(contractAddress, contractABI, provider);

// Create a proxy server
const proxy = httpProxy.createProxyServer({});

// Create an HTTP server that listens to requests on port 8000
const server = http.createServer(async (req, res) => {
	const parsedUrl = url.parse(req.url, true);
	console.log(parsedUrl)
	// Check if the request is for the deposit record
	if (parsedUrl.pathname === "/getDepositRecord") {
		const depositAddress = parsedUrl.query.depositAddress;
		if (!depositAddress) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({ error: "Missing depositAddress query parameter" })
			);
			return;
		}

		// Fetch the record from MongoDB
		try {
			const collection = client.db(dbName).collection(collectionName);
			const record = await collection.findOne({
				"depositMeta.depositAddress": depositAddress,
			});

			if (record) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(record));
			} else {
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Record not found" }));
			}
		} catch (error) {
			console.error("Failed to fetch data from MongoDB", error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Failed to fetch data from MongoDB");
		}
	} else {
		// Handle other proxy requests
		proxy.web(req, res, {
			target: "https://api-beta.pathfinder.routerprotocol.com",
			selfHandleResponse: true,
			changeOrigin: true,
		});
	}
});

// To intercept and modify the response from the target
proxy.on("proxyRes", async function (proxyRes, req, res) {
	let body = [];
	proxyRes.on("data", function (chunk) {
		body.push(chunk);
	});

	proxyRes.on("end", async function () {
		body = Buffer.concat(body).toString();

		// Attempt to parse the JSON body
		try {
			let responseObject = JSON.parse(body);
			if (responseObject.txn) {
				// Perform the contract call to get the deposit address
				const salt =
					"0x0000000000000000000000000000000000000000000000000000000000000000";
				const genericData = {
					callTo: responseObject.txn.to,
					approvalTo: responseObject.txn.to,
					data: responseObject.txn.data,
					srcToken: responseObject.fromTokenAddress,
					refundAddress: responseObject.txn.from,
				};

				const depositAddress = await contract.addressForTokenDeposit(
					salt,
					genericData
				);

				responseObject.depositMeta = { depositAddress, genericData, salt };

				// Save to MongoDB
				const collection = client.db(dbName).collection(collectionName);
				await collection.insertOne({
					depositMeta: responseObject.depositMeta,
					relayTxn: null, // Initial value for relayTxn
				});

				console.log("Saved depositMeta to MongoDB");
			}
			// Convert the updated responseObject back to string and send as the response
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(responseObject));
		} catch (error) {
			console.error(
				"Error processing response or fetching deposit address:",
				error
			);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Something went wrong while processing the response.");
		}
	});
});

proxy.on("error", (err, req, res) => {
	res.writeHead(500, { "Content-Type": "text/plain" });
	res.end("Something went wrong with the proxy server.");
});

console.log("Proxy server listening on port 8000");
server.listen(8000);

