const config = require('./src/config/env');
const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const execAsync = util.promisify(exec);

const onchainosPath = path.join(process.env.USERPROFILE, '.local', 'bin', 'onchainos.exe');

async function runOnchainos(args) {
  const env = { 
    ...process.env,
    OKX_API_KEY: config.okx.apiKey,
    OKX_SECRET_KEY: config.okx.secretKey,
    OKX_PASSPHRASE: config.okx.passphrase
  }
  try {
    const { stdout, stderr } = await execAsync(`"${onchainosPath}" ${args}`, { env, encoding: 'utf8' })
    const jsonStart = stdout.indexOf('{')
    if (jsonStart === -1) return null
    return JSON.parse(stdout.substring(jsonStart)).data
  } catch (error) {
    return null
  }
}

async function testBalance() {
  const usdcAddress = "0x74b7f16337b8972027f6196a17a631ac6de26d22"
  const balanceResult = await runOnchainos(`wallet balance --chain 196 --token-address "${usdcAddress}"`)
  console.log("Full balanceResult:", JSON.stringify(balanceResult, null, 2));
  
  let agentBalance = 0
  if (balanceResult && balanceResult.details && balanceResult.details[0] && balanceResult.details[0].tokenAssets[0]) {
    agentBalance = parseFloat(balanceResult.details[0].tokenAssets[0].balance || 0)
  }
  console.log("Parsed agentBalance:", agentBalance);
}

testBalance();
