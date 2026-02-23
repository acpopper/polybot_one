import { ClobClient } from "@polymarket/clob-client";
import { Wallet } from "ethers"; // v5.8.0
import dotenv from "dotenv";

dotenv.config();

if (!process.env.PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY is not set in .env");
}

// Normalize: trim whitespace/newlines; ensure 0x prefix for ethers
let privateKey = process.env.PRIVATE_KEY.trim().replace(/\s/g, "");
if (!privateKey.startsWith("0x")) {
  privateKey = "0x" + privateKey;
}
// ethers expects 32 bytes = 64 hex chars (66 with 0x)
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error(
    "PRIVATE_KEY must be 64 hex characters (with or without 0x prefix). Check for extra spaces, newlines, or wrong format."
  );
}

const client = new ClobClient(
  "https://clob.polymarket.com",
  137, // Polygon mainnet
  new Wallet(privateKey),
);

// Creates new credentials or derives existing ones
const credentials = await client.createOrDeriveApiKey();

console.log(credentials);
// {
//   apiKey: "550e8400-e29b-41d4-a716-446655440000",
//   secret: "base64EncodedSecretString",
//   passphrase: "randomPassphraseString"
// }
