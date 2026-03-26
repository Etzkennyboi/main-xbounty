const path = require('path')
const express = require('express')
const cors = require('cors')
const config = require('./config/env')
const bountyRoutes = require('./routes/bounty')

const { x402 } = require('x402-express')
const app = express()

app.use(cors())
app.use(express.json())

// custom x402 Payment Gateway Middleware for Hackathon
const paymentGateway = (req, res, next) => {
  const paymentProof = req.header('x-402-payment-proof');
  
  if (!paymentProof) {
    return res.status(402).json({
      success: false,
      message: '402 Payment Required',
      recipient: "0x1eF1034E7Cd690B40A329bd64209Ce563F95Bb5c",
      amount: 0.00012,
      token: 'OKB'
    });
  }
  
  console.log(`Payment verify: Received proof ${paymentProof}`);
  next();
};

// Serve Frontend - Correct pattern for Express 5+
const distPath = path.resolve(__dirname, '..', 'frontend', 'dist');
app.use(express.static(distPath));

// API Routes
app.use('/api/submit', paymentGateway) // Gate submission
app.use('/api', bountyRoutes);

// Catch-all - only for non-API requests
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err && !res.headersSent) {
      res.json({ 
        status: 'Agent Running (API-Only)', 
        wallet: config.agent.walletAddress 
      });
    }
  });
});

app.listen(config.port, () => {
  console.log(`XBounty backend running on port ${config.port}`)
  console.log(`Agent wallet: ${config.agent.walletAddress}`)
})
