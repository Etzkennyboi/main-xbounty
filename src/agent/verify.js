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
  // Tailor prompt based on bounty type
  let requirementDetails = ""
  if (bounty.type === 'swap') {
    requirementDetails = "REQUIREMENT: The user's wallet MUST have executed a DEX swap via an aggregator (like OKX Router or EntryPoint) on X Layer."
  } else {
    requirementDetails = `REQUIREMENT: The user's wallet MUST hold a balance equivalent to at least $${bounty.minBalance} in X Layer assets (OKB or USDC).`
  }

  const prompt = `
You are the central "Brain" verifying an onchain bounty for XBounty.

BOUNTY TYPE: ${bounty.type}
BOUNTY TASK: ${bounty.task}
CLAIMING WALLET: ${walletAddress}
${requirementDetails}

BLOCKCHAIN EVIDENCE (TX Hash: ${txData.hash}):
- Status: ${txData.status}
- Time: ${txData.timestampStr}
- Sender (Who initiated TX): ${txData.from}
- Receiver (Target Address): ${txData.to}
- Is Receiver a Smart Contract?: ${txData.isContractCall ? 'YES' : 'NO'}
- Method Data Prefix: ${txData.inputDataPrefix}

ANALYSIS INSTRUCTIONS:
1. OWNERSHIP CHECK: You MUST verify if the CLAIMING WALLET (${walletAddress}) is involved in this transaction. 
   - Is the 'Sender' (${txData.from}) equal to the 'CLAIMING WALLET'? 
   - Note: If the user uses Account Abstraction, the 'Sender' will be a Bundler, but the logs (not shown here but implied by the EntryPoint interaction) should have moved assets for the CLAIMING WALLET.
2. SWAP CRITERIA: A swap interacts with a DEX Smart Contract or Account Abstraction EntryPoint (Is Receiver a Contract? YES). 
3. ACCOUNT ABSTRACTION: If the receiver is the EntryPoint (0x0000000071727De22E5E9d8BAf0edAc6f37da032), confirm if this specific transaction was triggered for the CLAIMING WALLET.
4. SIMPLE TRANSFER CRITERIA: A simple transfer just goes to a regular human/agent wallet (Is Receiver a Contract? NO). If 'Receiver' is a regular human or the Agent Payout wallet (0x1ef1...), it is NOT a swap!
5. The transaction Status MUST be SUCCESS.
6. The Time MUST be AFTER ${new Date(bounty.startTime).toLocaleString()}

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
      model: "deepseek-ai/deepseek-v3",
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

// ── BALANCE VERIFICATION (for "Hold $1" bounty) ──────────────────────
async function verifyBalance(walletAddress, bounty) {
  console.log(`\n💰 Verifying X Layer portfolio for: ${walletAddress}`)
  const usdcAddress = "0x74b7f16337b8972027f6196a17a631ac6de26d22"
  const xdogAddress = "0x0cc24c51bf89c00c5affbfcf5e856c25ecbdb48e"
  
  try {
    const nativeBalanceWei = await provider.getBalance(walletAddress)
    const nativeBalance = parseFloat(ethers.formatEther(nativeBalanceWei))
    
    // 2. Fetch USDC balance (ERC-20)
    const usdcContract = new ethers.Contract(usdcAddress, ['function balance(address) view returns (uint256)', 'function decimals() view returns (uint8)'], provider)
    // Note: OKX USDC on X Layer uses standard ERC20 balance/decimals but we check standard format
    const usdcBalanceRaw = await provider.call({
       to: usdcAddress,
       data: '0x70a08231' + walletAddress.substring(2).padStart(64, '0') // balanceOf(address)
    });
    
    const usdcBalance = parseFloat(ethers.formatUnits(usdcBalanceRaw, 6)) // USDC on X Layer is 6 decimals
    
    // 3. Simple price estimation ($85 for OKB, $1 for USDC)
    const okbPrice = 85 

    // 2. Fetch specific token if bounty requires it
    let totalValueUsd = (nativeBalance * okbPrice)
    let tokenDetails = `OKB: ${nativeBalance.toFixed(4)} (~$${(nativeBalance * okbPrice).toFixed(2)})`

    if (bounty.type === 'balance_xdog') {
      const xdogContract = new ethers.Contract(xdogAddress, ['function balanceOf(address) view returns (uint256)'], provider)
      const xdogBalanceWei = await xdogContract.balanceOf(walletAddress)
      const xdogBalance = parseFloat(ethers.formatUnits(xdogBalanceWei, 18))
      
      // REAL PRICE FLOW
      const xdogPrice = await getTokenPrice(xdogAddress) || 0.0034 // Fallback
      
      totalValueUsd = xdogBalance * xdogPrice
      tokenDetails = `$XDOG Balance: ${xdogBalance.toLocaleString()} (~$${totalValueUsd.toFixed(2)} at $${xdogPrice.toFixed(6)})`
    } else {
      // Default (original Hold bounty)
      const usdcContract = new ethers.Contract(usdcAddress, ['function balanceOf(address) view returns (uint256)'], provider)
      const usdcBalanceWei = await usdcContract.balanceOf(walletAddress)
      const usdcBalance = parseFloat(ethers.formatUnits(usdcBalanceWei, 6))
      totalValueUsd += usdcBalance
      tokenDetails += `, USDC: ${usdcBalance.toFixed(2)}`
    }
    
    console.log(`  ${tokenDetails}`)
    console.log(`  Estimated Total X Layer Value: ~$${totalValueUsd.toFixed(2)}`)

    if (totalValueUsd >= (bounty.minBalance || 1)) {
      return {
        verdict: 'PASS',
        reason: `Wallet verified with a total X Layer value of ~$${totalValueUsd.toFixed(2)}. Requirement met.`
      }
    } else {
      return {
        verdict: 'FAIL',
        reason: `Wallet only holds ~$${totalValueUsd.toFixed(2)} on X Layer (native OKB + USDC). Minimum $${bounty.minBalance || 1} required.`
      }
    }
  } catch (err) {
    console.error('RPC Portfolio Verification error:', err.message)
    return { verdict: 'FAIL', reason: 'Direct blockchain query failed. Ensure the wallet address is valid and has activity on X Layer Mainnet.' }
  }
}

async function sendPayout(walletAddress, amount) {
  const usdcAddress = "0x74b7f16337b8972027f6196a17a631ac6de26d22" // X Layer Mainnet USDC
  const agentAddress = "0x1ef1034e7cd690b40a329bd64209ce563f95bb5c"
  
  try {
    // 1. Initial check: Does agent have enough USDC? Use direct RPC to be session-independent
    console.log(`📡 Checking Agent Wallet (${agentAddress}) balance for payout...`)
    
    const usdcContract = new ethers.Contract(usdcAddress, [
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address to, uint256 value) returns (bool)'
    ], payoutWallet)

    const agentBalanceRaw = await usdcContract.balanceOf(agentAddress)
    const agentBalance = parseFloat(ethers.formatUnits(agentBalanceRaw, 6))
    
    console.log(`   Balance: ${agentBalance} USDC`)

    if (agentBalance < parseFloat(amount)) {
      console.error(`INSUFFICIENT FUNDS: Agent has ${agentBalance} USDC, but this reward requires ${amount} USDC.`);
      return { success: false, error: 'INSUFFICIENT_FUNDS', balance: agentBalance, needed: amount }
    }

    // 2. Perform Send
    console.log(`Executing payout: onchainos wallet send --chain 196 --amt "${amount}" --receipt "${walletAddress}" --contract-token "${usdcAddress}" --from "${agentAddress}" --force`)
    const result = await runOnchainos(`wallet send --chain 196 --amt "${amount}" --receipt "${walletAddress}" --contract-token "${usdcAddress}" --from "${agentAddress}" --force`)
    
    if (result && result.txHash) {
      return { success: true, txHash: result.txHash }
    }
    
    // Explicitly check for simulation/execution error from runOnchainos
    if (result && result._error) {
       console.error(`PAYOUT REVERTED: ${result._error}`);
       return { success: false, error: 'PAYOUT_ERROR', message: result._error };
    }
    
    return { success: false, error: 'PAYOUT_ERROR', message: 'Unknown error during execution' }
  } catch (err) {
    console.error('Payout process crashed:', err.message)
    return { success: false, error: 'SYSTEM_ERROR' }
  }
}

module.exports = { verifyWallet, verifyBalance, sendPayout }
