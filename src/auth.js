const { Wallet } = require("ethers");
const config = require("./config.js");

function normalizePrivateKey(raw) {
  if (!raw || typeof raw !== "string") return null;
  let key = raw.trim().replace(/\s/g, "");
  if (!key.startsWith("0x")) key = "0x" + key;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  return key;
}

/**
 * Returns a configured ClobClient for live trading, or null if API creds are missing.
 * Call this only when SIMULATED is false; requires PRIVATE_KEY and API_KEY, SECRET, PASSPHRASE in .env.
 * @returns {Promise<import("@polymarket/clob-client").ClobClient | null>}
 */
async function getClobClient() {
  const privateKey = normalizePrivateKey(process.env.PRIVATE_KEY);
  const apiKey = process.env.API_KEY?.trim();
  const secret = process.env.SECRET?.trim();
  const passphrase = process.env.PASSPHRASE?.trim();

  if (!privateKey || !apiKey || !secret || !passphrase) {
    return null;
  }

  const { ClobClient } = require("@polymarket/clob-client");
  const signer = new Wallet(privateKey);
  const creds = { apiKey, secret, passphrase };

  return new ClobClient(
    config.CLOB_HOST,
    137,
    signer,
    creds,
    0, // EOA
    signer.address,
  );
}

module.exports = { getClobClient, normalizePrivateKey };
