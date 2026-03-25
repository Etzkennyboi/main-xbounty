const express = require('express')
const router = express.Router()
const db = require('../config/db')
const { verifyBalance, verifyWallet, sendPayout } = require('../agent/verify')

// GET all active bounties
router.get('/bounties', (req, res) => {
  const active = db.getBounties()
  res.json({ success: true, bounties: active })
})

// POST submit wallet for verification
router.post('/submit', async (req, res) => {
  const { walletAddress, bountyId, txHash } = req.body

  // Basic validation
  if (!walletAddress || !bountyId) {
    return res.status(400).json({ 
      success: false, 
      message: 'walletAddress and bountyId are required' 
    })
  }

  // Find bounty first
  const bounty = db.getBountyById(bountyId)
  if (!bounty || !bounty.active) {
    return res.status(404).json({ 
      success: false, 
      message: 'Bounty not found or inactive' 
    })
  }

  // Check if wallet already claimed
  const existingSub = db.getSubmissionByWallet(walletAddress, bountyId)
  if (existingSub && existingSub.verdict === 'PASS') {
    return res.status(400).json({ 
      success: false, 
      message: 'Wallet already claimed this bounty' 
    })
  }

  // Check slots
  if (bounty.claimedCount >= bounty.slots) {
    return res.status(400).json({ 
      success: false, 
      message: 'All bounty slots have been claimed' 
    })
  }

  try {
    let result
    if (bounty.task === 'swap') {
      if (!txHash) return res.status(400).json({ success: false, message: 'txHash is required for swap bounties' })
      result = await verifyWallet(walletAddress, txHash, bounty)
    } else {
      // Default to balance check if task is not swap
      result = await verifyBalance(walletAddress, bounty)
    }

    // Record submission
    const submission = {
      walletAddress,
      bountyId,
      verdict: result.verdict,
      reason: result.reason,
      reward: bounty.reward,
      payoutTx: null
    }

    if (result.verdict === 'PASS') {
      // Increment claim count
      db.updateBountyClaim(bountyId)
      
      // Trigger payout
      console.log(`PASS verdict. Sending ${bounty.reward} USDC reward to ${walletAddress}...`)
      const payout = await sendPayout(walletAddress, bounty.reward)
      
      if (payout.success) {
        submission.payoutTx = payout.txHash
      } else {
        submission.payoutTx = 'PAYOUT_FAILED'
        submission.error = payout.error
        submission.agentBalance = payout.balance
        submission.neededAmount = payout.needed
        console.error(`CRITICAL: Payout of ${bounty.reward} USDC failed. Error: ${payout.error}`)
      }
    }

    db.addSubmission(submission)

    return res.json({
      success: true,
      verdict: result.verdict,
      reason: result.reason,
      submission
    })

  } catch (error) {
    console.error('Submission error:', error)
    return res.status(500).json({ 
      success: false, 
      message: 'Verification failed, try again' 
    })
  }
})

// GET leaderboard
router.get('/leaderboard', (req, res) => {
  res.json({ success: true, leaderboard: db.getLeaderboard() })
})

// GET all submissions (admin)
router.get('/submissions', (req, res) => {
  res.json({ success: true, submissions: db.getSubmissions() })
})

module.exports = router
