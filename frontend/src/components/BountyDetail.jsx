import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, AlertCircle, Loader2, Send, Wallet } from 'lucide-react';
import { fetchWithPayment } from '../utils/x402';

const BountyDetail = ({ connectedAddress, API_URL }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [bounty, setBounty] = useState(null);
  const [txHash, setTxHash] = useState('');
  const [status, setStatus] = useState({ type: 'idle', msg: '' });
  const [payoutTx, setPayoutTx] = useState(null);

  useEffect(() => {
    fetch(`${API_URL}/bounties`)
      .then(res => res.json())
      .then(data => {
        const found = data.bounties.find(b => b.id === id);
        setBounty(found);
      });
  }, [id, API_URL]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!connectedAddress) return;

    setStatus({ type: 'loading', msg: bounty.task === 'swap' ? 'AI Agent is analyzing the blockchain...' : 'Checking portfolio...' });

    try {
      const response = await fetchWithPayment(`${API_URL}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          walletAddress: connectedAddress, 
          bountyId: id,
          txHash: bounty.task === 'swap' ? txHash : undefined
        })
      });

      const result = await response.json();

      if (result.success && result.verdict === 'PASS') {
        setStatus({ type: 'success', msg: result.reason, submission: result.submission });
        setPayoutTx(result.submission.payoutTx);
      } else {
        setStatus({ type: 'error', msg: result.message || result.reason });
      }
    } catch (err) {
      setStatus({ type: 'error', msg: 'Communication failure with Agent.' });
    }
  };

  if (!bounty) return <div className="app-container"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="app-container">
      <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '2rem' }}>
        <ArrowLeft size={16} /> Back to Hub
      </button>

      <div className="bounty-detail-grid" style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))', 
        gap: '2.5rem' 
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
            <span className={`difficulty-tag ${bounty.difficulty.toLowerCase()}`}>{bounty.difficulty}</span>
            <span className="category-tag">{bounty.category}</span>
          </div>
          <h1 style={{ fontSize: '2.5rem', marginBottom: '1.5rem' }}>{bounty.title}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', lineHeight: '1.6', marginBottom: '2rem' }}>
            {bounty.description}
          </p>

          <div className="requirements-box" style={{ background: 'rgba(255,255,255,0.03)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <h3 style={{ marginBottom: '1.5rem' }}>Submission Guide</h3>
            <ul style={{ color: 'var(--text-secondary)', paddingLeft: '1.2rem' }}>
              <li style={{ marginBottom: '0.8rem' }}>Requirement: {bounty.task === 'swap' ? 'Provide a valid X Layer Transaction Hash of a DEX swap.' : `Hold at least $${bounty.minBalance} in assets.`}</li>
              <li style={{ marginBottom: '0.8rem' }}>Verification: Autonomous AI Agents (Onchain OS + DeepSeek V3)</li>
              <li style={{ marginBottom: '0.8rem' }}>Reward Payout: Instant USDC upon PASS verdict</li>
            </ul>
          </div>
        </div>

        <div className="submission-sidebar">
          <div className="bounty-card" style={{ padding: '2rem' }}>
            <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Reward</div>
              <div style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{bounty.reward} <span style={{ fontSize: '1rem' }}>USDC</span></div>
            </div>

            {connectedAddress ? (
              <form onSubmit={handleSubmit} className="submission-form">
                {bounty.task === 'swap' && (
                  <input 
                    type="text" 
                    className="input-field" 
                    placeholder="Paste Transaction Hash (0x...)" 
                    value={txHash}
                    onChange={(e) => setTxHash(e.target.value)}
                    required
                  />
                )}
                
                <button 
                  className="submit-btn" 
                  type="submit"
                  disabled={status.type === 'loading' || status.type === 'success'}
                >
                  {status.type === 'loading' ? <Loader2 className="animate-spin" /> : <><Send size={18} /> {bounty.task === 'swap' ? 'Submit for Review' : 'Verify Holdings'}</>}
                </button>

                {status.type !== 'idle' && (
                  <div className={`alert ${status.type}`}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {status.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                      <span>{status.msg}</span>
                    </div>
                    {payoutTx && payoutTx !== 'PAYOUT_FAILED' ? (
                      <a href={`https://www.oklink.com/xlayer/tx/${payoutTx}`} target="_blank" rel="noreferrer" className="alert-link" style={{ marginTop: '0.5rem', display: 'inline-block' }}>
                        View Payout Receipt ↗
                      </a>
                    ) : payoutTx === 'PAYOUT_FAILED' ? (
                      <div style={{ color: '#ff4444', fontSize: '0.9rem', marginTop: '0.5rem', fontWeight: 'normal' }}>
                         {status.submission?.error === 'INSUFFICIENT_FUNDS' ? (
                           <>Agent Wallet Balance: {status.submission.agentBalance} USDC. Reward: {status.submission.neededAmount} USDC. Please top up the Agent Wallet.</>
                         ) : status.submission?.message ? (
                            <>Agent Wallet Error: {status.submission.message}</>
                         ) : (
                           <>Verification passed, but the automated USDC payout failed (Agent balance or gas issue). Please contact support.</>
                         )}
                      </div>
                    ) : null}
                  </div>
                )}
              </form>
            ) : (
              <div className="connect-prompt">
                Please connect your wallet to start this bounty.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BountyDetail;
