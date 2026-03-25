const config = require('../config/env')
const { ethers } = require('ethers')
const path = require('path')

// Prevent unhandled errors from killing the Node.js server
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception (server survived):', err.message)
})
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection (server survived):', err.message || err)
})

// RPC Source of Truth (Zero API Key Required)
const provider = new ethers.JsonRpcProvider('https://rpc.xlayer.tech')

// Initialize Payout Wallet (Pure Node Implementation)
let payoutWallet = null
if (config.agent.payoutPrivateKey) {
  try {
    payoutWallet = new ethers.Wallet(config.agent.payoutPrivateKey, provider)
    console.log(`📡 Payout Wallet Initialized: ${payoutWallet.address} (Ready on X Layer)`)
  } catch (err) {
    console.error('⚠️ CRITICAL: Failed to initialize Payout Wallet. Incorrect PRIVATE_KEY?')
  }
} else {
  console.warn('⚠️ WARNING: PAYOUT_PRIVATE_KEY is missing. Automated rewards will NOT work!')
}

// FETCH EXACT TX DATA VIA RPC (The AI's "Eyes")
async function getTxData(txHash) {
  console.log(`📡 Fetching pure X Layer blockchain data for TX: ${txHash}...`)
  try {
    const [tx, receipt] = await Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash)
    ])

    if (!tx || !receipt) return null

    // Get the timestamp from the block
    const block = await provider.getBlock(tx.blockNumber)
    
    // Check if `to` is a contract
    let isContract = false
    if (tx.to) {
      const code = await provider.getCode(tx.to)
      isContract = code !== '0x'
    }

    // Extract basic Transfer logs to summarize for the AI
    const iface = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)'])
    const transfers = []
    
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data })
        if (parsed) {
          transfers.push({
            tokenAddr: log.address,
            from: parsed.args[0],
            to: parsed.args[1],
          })
        }
      } catch (e) {
        // Log is not a standard ERC-20 transfer
      }
    }

    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      isContractCall: isContract,
      inputDataPrefix: tx.data.substring(0, 10),
      timestamp: block.timestamp * 1000,
      timestampStr: new Date(block.timestamp * 1000).toLocaleString(),
      status: receipt.status === 1 ? 'SUCCESS' : 'FAILED',
      transfersCount: transfers.length,
      transfers: transfers
    }
  } catch (err) {
    console.error(`RPC Query failed for ${txHash}:`, err.message)
    return null
  }
}

const { OpenAI } = require('openai')
const client = new OpenAI({
    baseURL: config.deepseek.baseUrl || "https://integrate.api.nvidia.com/v1",
    apiKey: config.deepseek.apiKey
})

async function askDeepSeekToVerify(walletAddress, bounty, txData) {
  const prompt = `
You are the central "Brain" verifying an onchain bounty for XBounty.

BOUNTY: ${bounty.task}
CLAIMING WALLET: ${walletAddress}
REQUIREMENT: The user's wallet MUST have executed a DEX swap via an aggregator (like OKX Router or EntryPoint) on X Layer.

BLOCKCHAIN EVIDENCE (TX Hash: ${txData.hash}):
- Status: ${txData.status}
- Time: ${txData.timestampStr}
- Sender (Who initiated TX): ${txData.from}
- Receiver (Target Address): ${txData.to}
- Is Receiver a Smart Contract?: ${txData.isContractCall ? 'YES' : 'NO'}
- Method Data Prefix: ${txData.inputDataPrefix}

ANALYSIS INSTRUCTIONS:
Does this blockchain evidence prove a valid DEX Swap was executed by or on behalf of the CLAIMING WALLET (${walletAddress})?
Reply with EXACTLY:
VERDICT: PASS
or
VERDICT: FAIL
REASON: [one concise sentence explaining your logic. You MUST mention if the wallet address actually matches the transaction ownership.]
`
  console.log('\n--- AI VERIFICATION PROMPT ---')
  console.log(prompt)
  console.log('------------------------------')

  try {
    const completion = await client.chat.completions.create({
      model: "deepseek-ai/deepseek-v3.2",
      messages: [{ role: "user", content: prompt }],
      temperature: 1,
      top_p: 0.95,
      max_tokens: 8192,
      extra_body: { "chat_template_kwargs": { "thinking": true } }
    })

    const text = completion.choices[0].message.content
    console.log('\n--- REASON FROM AI ---')
    console.log(text)
    console.log('----------------------\n')

    const isPass = text.includes('VERDICT: PASS')
    const reasonMatch = text.match(/REASON:\s*(.+)/)
    
    return {
      verdict: isPass ? 'PASS' : 'FAIL',
      reason: isPass ? 'DeepSeek verified this TX as a valid DEX swap for your wallet.' : (reasonMatch ? reasonMatch[1] : 'Criteria not met per AI'),
      rawResponse: text
    }
  } catch (error) {
    console.error('AI API Error:', error.message)
    return { verdict: 'FAIL', reason: 'AI Verification agent timeout. Please try again later.' }
  }
}

async function verifyWallet(walletAddress, txHash, bounty) {
  console.log(`\nStarting Verification for Wallet: ${walletAddress}`)
  console.log(`Submitted TX Hash: ${txHash}`)

  const txData = await getTxData(txHash)
  if (!txData) {
    return { verdict: 'FAIL', reason: 'Could not find that transaction hash on the X Layer blockchain.' }
  }

  const walletLower = walletAddress.toLowerCase()
  const isSender = txData.from.toLowerCase() === walletLower
  const isInLogs = txData.transfers.some(t => 
    t.from.toLowerCase() === walletLower || t.to.toLowerCase() === walletLower
  )

  if (!isSender && !isInLogs) {
    return { 
      verdict: 'FAIL', 
      reason: 'Fraud detected: This transaction does not involve your wallet address. You cannot claim someone else\'s transaction.' 
    }
  }

  if (txData.timestamp < bounty.startTime) {
    return { verdict: 'FAIL', reason: `Transaction occurred before the bounty start time.` }
  }

  return await askDeepSeekToVerify(walletAddress, bounty, txData)
}

async function verifyBalance(walletAddress, bounty) {
  console.log(`\n💰 Verifying full X Layer portfolio for: ${walletAddress}`)
  const usdcAddress = "0x74b7f16337b8972027f6196a17a631ac6de26d22"
  
  try {
    const nativeBalanceWei = await provider.getBalance(walletAddress)
    const nativeBalance = parseFloat(ethers.formatEther(nativeBalanceWei))
    
    const usdcContract = new ethers.Contract(usdcAddress, ['function balanceOf(address) view returns (uint256)'], provider)
    const usdcBalanceRaw = await usdcContract.balanceOf(walletAddress)
    const usdcBalance = parseFloat(ethers.formatUnits(usdcBalanceRaw, 6))
    
    const okbPrice = 85 
    const totalValueUsd = (nativeBalance * okbPrice) + usdcBalance
    
    console.log(`  Native OKB: ${nativeBalance.toFixed(4)} (~$${(nativeBalance * okbPrice).toFixed(2)})`)
    console.log(`  USDC: ${usdcBalance.toFixed(2)} ($${usdcBalance.toFixed(2)})`)
    console.log(`  Estimated Total X Layer Value: ~$${totalValueUsd.toFixed(2)}`)

    if (totalValueUsd >= (bounty.minBalance || 1)) {
      return { verdict: 'PASS', reason: `Wallet verified with value ~$${totalValueUsd.toFixed(2)}.` }
    } else {
      return { verdict: 'FAIL', reason: `Wallet holds ~$${totalValueUsd.toFixed(2)}. $${bounty.minBalance || 1} required.` }
    }
  } catch (err) {
    console.error('RPC Portfolio Verification error:', err.message)
    return { verdict: 'FAIL', reason: 'Direct blockchain query failed.' }
  }
}

async function sendPayout(walletAddress, amount) {
  const usdcAddress = "0x74b7f16337b8972027f6196a17a631ac6de26d22"
  
  try {
    if (!payoutWallet) {
      console.error('PAYOUT ERROR: Payout wallet not initialized. Check your PRIVATE_KEY.')
      return { success: false, error: 'SYSTEM_ERROR', message: 'Payout system not ready.' }
    }

    const agentAddress = payoutWallet.address
    console.log(`📡 Checking Payout Wallet Balance (${agentAddress})...`)
    
    const usdcContract = new ethers.Contract(usdcAddress, [
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address to, uint256 value) returns (bool)'
    ], payoutWallet)

    const agentBalanceRaw = await usdcContract.balanceOf(agentAddress)
    const agentBalance = parseFloat(ethers.formatUnits(agentBalanceRaw, 6))
    
    console.log(`   Balance: ${agentBalance} USDC`)

    if (agentBalance < parseFloat(amount)) {
      console.error(`INSUFFICIENT FUNDS: Need ${amount}, have ${agentBalance}.`)
      return { success: false, error: 'INSUFFICIENT_FUNDS', balance: agentBalance, needed: amount }
    }

    const minimalUnits = ethers.parseUnits(amount.toString(), 6)

    console.log(`🚀 Executing Payout: ${amount} USDC to ${walletAddress}...`)
    
    // Perform direct ERC20 transfer via EOA Private Key
    const tx = await usdcContract.transfer(walletAddress, minimalUnits)
    console.log(`✅ Payout Submitted! TX: ${tx.hash}`)
    
    // Wait for confirmation (optional but recommended for robustness)
    const receipt = await tx.wait(1)
    console.log(`🏆 Payout Confirmed in block ${receipt.blockNumber}`)

    return { success: true, txHash: tx.hash }
  } catch (err) {
    console.error('CRITICAL: Payout process failed:', err.message)
    return { success: false, error: 'PAYOUT_ERROR', message: err.message }
  }
}

module.exports = { verifyWallet, verifyBalance, sendPayout }
