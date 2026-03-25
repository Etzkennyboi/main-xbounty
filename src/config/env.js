require('dotenv').config()

module.exports = {
  okx: {
    apiKey: process.env.OKX_API_KEY,
    secretKey: process.env.OKX_SECRET_KEY,
    passphrase: process.env.OKX_PASSPHRASE,
  },
  agent: {
    walletAddress: process.env.AGENT_WALLET_ADDRESS || "0x897a7d106619727238Aaa4b107838995718A8892",
    payoutPrivateKey: process.env.PAYOUT_PRIVATE_KEY
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
  },
  port: process.env.PORT || 3001
}
