const config = require('../config/env')
const { ethers } = require('ethers')
const { exec } = require('child_process')
const util = require('util')
const path = require('path')

const execAsync = util.promisify(exec)

// Determine the correct onchainos path based on host system (Windows vs Linux)
const IS_WIN = process.platform === 'win32'
const onchainosPath = IS_WIN 
  ? path.join(process.env.USERPROFILE || '', '.local', 'bin', 'onchainos.exe')
  : 'onchainos' // Installed via script on Linux

// RPC Source of Truth (Zero API Key Required)
const provider = new ethers.JsonRpcProvider('https://rpc.xlayer.tech')

async function runOnchainos(args) {
  const env = { 
    ...process.env,
    OKX_API_KEY: config.okx.apiKey,
    OKX_SECRET_KEY: config.okx.secretKey,
    OKX_PASSPHRASE: config.okx.passphrase
  }
  try {
    const { stdout, stderr } = await execAsync(`"${onchainosPath}" ${args}`, { env, encoding: 'utf8' })
    if (stderr) console.error(`OnchainOS Stderr: ${stderr}`)
    const jsonStart = stdout.indexOf('{')
    if (jsonStart === -1) return null
    return JSON.parse(stdout.substring(jsonStart)).data
  } catch (error) {
    console.error(`OnchainOS Execution Error:`, error.message)
    if (error.stdout) console.log(`Stdout: ${error.stdout}`)
    if (error.stderr) console.log(`Stderr: ${error.stderr}`)
    return null
  }
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
            // Only capturing generic values to show token movement
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
      inputDataPrefix: tx.data.substring(0, 10), // Helps AI identify function calls
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

  // 1. Fetch exact blockchain evidence first
  const txData = await getTxData(txHash)
  
  if (!txData) {
    return { verdict: 'FAIL', reason: 'Could not find that transaction hash on the X Layer blockchain.' }
  }

  // 2. STRICTURE OWNERSHIP CHECK (Before AI)
  // Ensure the wallet is either the sender OR mentioned in the ERC20 logs
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

  // 3. Validate time constraint mechanically
  if (txData.timestamp < bounty.startTime) {
    return { verdict: 'FAIL', reason: `Transaction occurred before the bounty start time.` }
  }

  // 4. Delegate the final complex swap analysis to DeepSeek
  return await askDeepSeekToVerify(walletAddress, bounty, txData)
}

// ── BALANCE VERIFICATION (for "Hold $1" bounty) ──────────────────────
async function verifyBalance(walletAddress, bounty) {
  console.log(`\n💰 Verifying full X Layer portfolio for: ${walletAddress}`)
  
  try {
    // We use the Onchain OS Portfolio tool - the source of truth for OKX wallet data
    // This automatically handles native OKB + all ERC-20s + DeFi at real-time prices
    const result = await runOnchainos(`portfolio total-value --address ${walletAddress} --chains xlayer --asset-type 0`)
    
    if (!result || !result[0]) {
      throw new Error('Portfolio service returned no data.')
    }

    const totalValueUsd = parseFloat(result[0].totalValue || 0)
    console.log(`  Total X Layer Portfolio Value: ~$${totalValueUsd.toFixed(2)}`)

    if (totalValueUsd >= (bounty.minBalance || 1)) {
      return {
        verdict: 'PASS',
        reason: `Wallet verified with a total X Layer value of ~$${totalValueUsd.toFixed(2)}. Requirement met.`
      }
    } else {
      return {
        verdict: 'FAIL',
        reason: `Wallet only holds ~$${totalValueUsd.toFixed(2)} on X Layer (including native assets and tokens). Minimum $${bounty.minBalance || 1} required.`
      }
    }
  } catch (err) {
    console.error('Portfolio Verification error:', err.message)
    return { verdict: 'FAIL', reason: 'High-level portfolio check failed. Ensure your wallet has active assets on X Layer Mainnet.' }
  }
}

async function sendPayout(walletAddress, amount) {
  const usdcAddress = "0x74b7f16337b8972027f6196a17a631ac6de26d22" // X Layer Mainnet USDC
  const agentAddress = config.agent.walletAddress
  
  try {
    // 1. Initial check: Does agent have enough USDC?
    const balanceResult = await runOnchainos(`wallet balance --chain 196 --token-address "${usdcAddress}"`)
    let agentBalance = 0
    if (balanceResult && balanceResult.details && balanceResult.details[0] && balanceResult.details[0].tokenAssets[0]) {
      agentBalance = parseFloat(balanceResult.details[0].tokenAssets[0].balance || 0)
    }

    if (agentBalance < parseFloat(amount)) {
      console.error(`INSUFFICIENT FUNDS: Agent has ${agentBalance} USDC, needs ${amount} USDC.`)
      return { success: false, error: 'INSUFFICIENT_FUNDS', balance: agentBalance, needed: amount }
    }

    // 2. Perform Send
    console.log(`Executing payout: onchainos wallet send --chain 196 --amount "${amount}" --receipt "${walletAddress}" --contract-token "${usdcAddress}" --from "${agentAddress}" --force`)
    const result = await runOnchainos(`wallet send --chain 196 --amount "${amount}" --receipt "${walletAddress}" --contract-token "${usdcAddress}" --from "${agentAddress}" --force`)
    if (result && result.txHash) {
      return { success: true, txHash: result.txHash }
    }
    
    return { success: false, error: 'EXECUTION_REVERTED' }
  } catch (err) {
    console.error('Payout process crashed:', err.message)
    return { success: false, error: 'SYSTEM_ERROR' }
  }
}

module.exports = { verifyWallet, verifyBalance, sendPayout }
