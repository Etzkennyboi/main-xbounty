// x402 Payment Helper for Frontend
// Handles the 402 Payment Required flow

export async function fetchWithPayment(url, options = {}) {
  // 1. Initial request to see if payment is required
  let response = await fetch(url, options);

  if (response.status === 402) {
    const paymentData = await response.json();
    console.log('Payment Required:', paymentData);

    // 2. Trigger wallet payment (standardized x402 flow)
    // This assumes the user has a wallet connected and we can call a payment function
    // For the hackathon, we simulate or use the window.ethereum / OKX wallet
    try {
      if (typeof window.okxwallet !== 'undefined' || typeof window.ethereum !== 'undefined') {
        const provider = window.okxwallet || window.ethereum;
        
        // Request accounts if not already
        await provider.request({ method: 'eth_requestAccounts' });
        
        // Send transaction for the small fee ($0.01)
        // Note: Real x402 would include a signature/proof in the next header
        const txHash = await provider.request({
          method: 'eth_sendTransaction',
          params: [{
            from: (await provider.request({ method: 'eth_accounts' }))[0],
            to: paymentData.recipient,
            value: '0x6D1DA798000', // 0.00012 OKB ($0.01)
            // In a real USDC flow, this would be a contract call
          }]
        });

        console.log('Payment successful, TX:', txHash);

        // 3. Retry with payment proof (header)
        const newOptions = {
          ...options,
          headers: {
            ...options.headers,
            'x-402-payment-proof': txHash
          }
        };

        return await fetch(url, newOptions);
      } else {
        throw new Error('No wallet found for payment');
      }
    } catch (err) {
      console.error('Payment failed:', err);
      return response; // Return original 402 if payment failed
    }
  }

  return response;
}
