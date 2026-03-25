import { useState, useEffect } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import Navbar from './components/Navbar'
import BountyCard from './components/BountyCard'
import BountyDetail from './components/BountyDetail'
import Leaderboard from './components/Leaderboard'
import { Zap, Activity, ShieldCheck, Globe } from 'lucide-react'

function App() {
  const [bounties, setBounties] = useState([])
  const [connectedAddress, setConnectedAddress] = useState(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [activities, setActivities] = useState([])
  
  const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3001/api')

  useEffect(() => {
    fetch(`${API_URL}/bounties`)
      .then(res => res.json())
      .then(data => {
        if(data.success) {
          setBounties(data.bounties)
        }
      })
      .catch(err => console.error("Failed to fetch bounties: ", err))

    // Fetch initial leaderboard for "Live Activity" simulation
    fetch(`${API_URL}/leaderboard`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setActivities(data.leaderboard.slice(0, 5))
        }
      })

    if (window.ethereum) {
      window.ethereum.on('accountsChanged', (accounts) => {
        setConnectedAddress(accounts[0] || null)
      })
    }
  }, [API_URL])

  const connectWallet = async () => {
    if (!window.ethereum) {
      alert("Please install OKX Wallet or MetaMask.")
      return
    }
    setIsConnecting(true)
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      setConnectedAddress(accounts[0])
    } catch (err) {
      console.error(err)
    } finally {
      setIsConnecting(false)
    }
  }

  const HomePage = () => (
    <main>
      <div className="hero">
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(0, 255, 136, 0.1)', color: 'var(--accent-primary)', padding: '0.5rem 1rem', borderRadius: '50px', fontSize: '0.8rem', fontWeight: 600, marginBottom: '1.5rem', border: '1px solid rgba(0, 255, 136, 0.2)' }}>
          <Zap size={14} /> BUILT FOR X LAYER MAINNET
        </div>
        <h1>Autonomous Onchain<br/>Task Marketplace</h1>
        <p>Complete decentralized tasks. Verified by AI. Paid in USDC instantly.</p>
      </div>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.75rem', marginBottom: '2.5rem', textAlign: 'center', opacity: 0.9 }}>
          Onchain Marketplace
        </h2>
        <div className="bounty-grid">
          {bounties.slice(0, 9).map(bounty => (
            <BountyCard key={bounty.id} bounty={bounty} />
          ))}
        </div>
      </section>
    </main>
  )

  return (
    <div className="app">
      <Navbar 
        connectedAddress={connectedAddress} 
        connectWallet={connectWallet} 
        isConnecting={isConnecting} 
      />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route 
          path="/bounty/:id" 
          element={<BountyDetail connectedAddress={connectedAddress} API_URL={API_URL} />} 
        />
        <Route 
          path="/leaderboard" 
          element={<Leaderboard API_URL={API_URL} />} 
        />
      </Routes>
      
      <footer style={{ marginTop: '5rem', padding: '3rem 2rem', borderTop: '1px solid var(--border-color)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        XBounty V2 MVP • Powered by X Layer & DeepSeek
      </footer>
    </div>
  )
}

export default App
