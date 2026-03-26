require('dotenv').config()

module.exports = {
  okx: {
    apiKey: process.env.OKX_API_KEY,
    secretKey: process.env.OKX_SECRET_KEY,
    passphrase: process.env.OKX_PASSPHRASE,
  },
  agent: {
    walletAddress: process.env.AGENT_WALLET_ADDRESS || "0x1ef1034e7cd690b40a329bd64209ce563f95bb5c",
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
  },
  port: process.env.PORT || 3001
}
