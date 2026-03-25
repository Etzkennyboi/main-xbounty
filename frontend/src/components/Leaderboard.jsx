import React, { useState, useEffect } from 'react';
import { Trophy, Medal, ExternalLink } from 'lucide-react';

const Leaderboard = ({ API_URL }) => {
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    fetch(`${API_URL}/leaderboard`)
      .then(res => res.json())
      .then(data => setLeaderboard(data.leaderboard));
  }, [API_URL]);

  const formatAddress = (addr) => `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;

  return (
    <div className="app-container">
      <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', marginBottom: '1rem' }}>Global Rankings</h1>
        <p style={{ color: 'var(--text-secondary)' }}>The most active onchain agents in the XBounty ecosystem.</p>
      </div>

      <div className="leaderboard-container">
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Wallet Address</th>
              <th>Bounties Won</th>
              <th>Total Earned</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((entry, index) => (
              <tr key={entry.walletAddress}>
                <td>
                  <div className={`rank-badge ${index < 3 ? `rank-${index + 1}` : ''}`}>
                    {index + 1}
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {formatAddress(entry.walletAddress)}
                    <a href={`https://www.oklink.com/xlayer/address/${entry.walletAddress}`} target="_blank" style={{ color: 'var(--text-muted)' }}>
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </td>
                <td>{entry.totalBounties}</td>
                <td style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{entry.totalEarned.toFixed(2)} USDC</td>
              </tr>
            ))}
            {leaderboard.length === 0 && (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  No winners yet. Be the first to claim!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Leaderboard;
