const config = require('../config/env')
const { ethers } = require('ethers')
const { exec } = require('child_process')
const util = require('util')
const path = require('path')

const execAsync = util.promisify(exec)

// Prevent onchainos crashes from killing the Node.js server
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception (server survived):', err.message)
})
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection (server survived):', err.message || err)
})

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
    const { stdout, stderr } = await execAsync(`"${onchainosPath}" ${args}`, { env, encoding: 'utf8', timeout: 30000 })
    const jsonStart = stdout.indexOf('{')
    if (jsonStart === -1) return null
    const json = JSON.parse(stdout.substring(jsonStart))
    if (!json.ok && json.message) {
      return { _error: json.message, _json: json }
    }
    return json.data
  } catch (error) {
    console.error(`OnchainOS Execution Error:`, error.message)
    try {
       const jsonStart = error.stdout?.indexOf('{') ?? -1;
       if (jsonStart !== -1) {
          const json = JSON.parse(error.stdout.substring(jsonStart));
          return { _error: json.message || error.message, _json: json };
       }
    } catch (e) {}
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
  const usdcAddress = "0x74b7f16337b8972027f6196a17a631ac6de26d22"
  
  try {
    // 1. Fetch native OKB balance
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
    const totalValueUsd = (nativeBalance * okbPrice) + usdcBalance
    
    console.log(`  Native OKB: ${nativeBalance.toFixed(4)} (~$${(nativeBalance * okbPrice).toFixed(2)})`)
    console.log(`  USDC: ${usdcBalance.toFixed(2)} ($${usdcBalance.toFixed(2)})`)
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
    
    // Contract setup for USDC
    const usdcContract = new ethers.Contract(usdcAddress, [
      'function balanceOf(address) view returns (uint256)',
      'function decimals() view returns (uint8)'
    ], provider)

    // Call balanceOf(agentAddress)
    const agentBalanceRaw = await usdcContract.balanceOf(agentAddress)
    const agentBalance = parseFloat(ethers.formatUnits(agentBalanceRaw, 6)) // USDC is 6 decimals
    
    console.log(`   Agent Balance: ${agentBalance} USDC`)

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
       return { success: false, error: 'EXECUTION_REVERTED', message: result._error };
    }
    
    return { success: false, error: 'EXECUTION_REVERTED' }
  } catch (err) {
    console.error('Payout process crashed:', err.message)
    return { success: false, error: 'SYSTEM_ERROR' }
  }
}

module.exports = { verifyWallet, verifyBalance, sendPayout }
