// In-memory Database for XBounty V2 MVP

const db = {
  bounties: [
    {
      id: 'bounty_001',
      title: 'Hold $1 X Layer Assets',
      description: 'Hold at least $1 worth of assets on X Layer mainnet.',
      category: 'Portfolio',
      difficulty: 'Easy',
      type: 'balance',
      task: 'Hold at least $1 worth of assets on X Layer',
      minBalance: 1,
      reward: 0.02,
      slots: 100,
      claimedCount: 0,
      startTime: Date.now(),
      deadline: Date.now() + (30 * 24 * 60 * 60 * 1000),
      active: true,
      featured: true
    },
    {
      id: 'bounty_002',
      title: 'Hold $10 X Layer Assets',
      description: 'Hold at least $10 worth of assets on X Layer mainnet.',
      category: 'Portfolio',
      difficulty: 'Medium',
      type: 'balance',
      task: 'Hold at least $10 worth of assets on X Layer',
      minBalance: 10,
      reward: 0.02,
      slots: 50,
      claimedCount: 0,
      startTime: Date.now(),
      deadline: Date.now() + (30 * 24 * 60 * 60 * 1000),
      active: true,
      featured: true
    },
    {
      id: 'bounty_003',
      title: '$XDOG Enthusiast',
      description: 'Hold at least $1 worth of $XDOG on X Layer mainnet.',
      category: 'Meme',
      difficulty: 'Easy',
      type: 'balance_xdog',
      tokenAddress: '0x0cc24c51bf89c00c5affbfcf5e856c25ecbdb48e',
      minUsd: 1,
      reward: 0.02,
      slots: 100,
      claimedCount: 0,
      startTime: Date.now(),
      deadline: Date.now() + (30 * 24 * 60 * 60 * 1000),
      active: true,
      featured: true
    },
    {
      id: 'bounty_004',
      title: 'Loyal Dog: 1 Week Hold',
      description: 'Hold $XDOG tokens for at least 7 consecutive days on X Layer.',
      category: 'Loyalty',
      difficulty: 'Medium',
      type: 'loyalty_xdog',
      tokenAddress: '0x0cc24c51bf89c00c5affbfcf5e856c25ecbdb48e',
      reward: 0.02,
      slots: 50,
      claimedCount: 0,
      startTime: Date.now(),
      deadline: Date.now() + (30 * 24 * 60 * 60 * 1000),
      active: true,
      holdPeriod: '1 week'
    }
  ],
  
  submissions: [],
  leaderboard: [],
  
  getBounties() { return this.bounties.filter(b => b.active) },
  getBountyById(id) { return this.bounties.find(b => b.id === id) },
  getSubmissionByWallet(walletAddress, bountyId) {
    return this.submissions.find(s => 
      s.walletAddress.toLowerCase() === walletAddress.toLowerCase() && 
      s.bountyId === bountyId
    )
  },
  getSubmissions() { return this.submissions },
  addSubmission(sub) { this.submissions.push(sub) },
  updateBountyClaim(id) {
    const bounty = this.getBountyById(id)
    if (bounty) {
      bounty.claimedCount += 1
      if (bounty.claimedCount >= bounty.slots) {
        bounty.active = false
      }
    }
  },
  updateLeaderboard(walletAddress, earnedAmount) {
    const entry = this.leaderboard.find(l => l.walletAddress.toLowerCase() === walletAddress.toLowerCase())
    if (entry) {
      entry.totalBounties += 1
      entry.totalEarned += earnedAmount
    } else {
      this.leaderboard.push({
        walletAddress,
        totalBounties: 1,
        totalEarned: earnedAmount,
        firstSeen: Date.now()
      })
    }
    this.leaderboard.sort((a, b) => b.totalEarned - a.totalEarned)
    this.leaderboard.forEach((l, index) => { l.rank = index + 1 })
  },
  getLeaderboard() { return this.leaderboard }
}

module.exports = db
