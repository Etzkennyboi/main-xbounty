require('dotenv').config()

module.exports = {
  okx: {
    apiKey: process.env.OKX_API_KEY,
    secretKey: process.env.OKX_SECRET_KEY,
    passphrase: process.env.OKX_PASSPHRASE,
  },
  agent: {
    walletAddress: process.env.AGENT_WALLET_ADDRESS || "0x1eF1034E7Cd690B40A329bd64209Ce563F95Bb5c",
    payoutPrivateKey: process.env.PAYOUT_PRIVATE_KEY
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
  },
  port: process.env.PORT || 3001
}
