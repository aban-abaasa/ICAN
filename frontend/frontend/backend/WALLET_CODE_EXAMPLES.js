/**
 * 💰 Wallet Functions - Copy & Paste Examples
 * Ready-to-use code snippets for quick integration
 */

// ============================================================
// EXAMPLE 1: Basic Send Money
// ============================================================

import { walletService } from '../services/walletService';

// In your component
const handleSendBasic = async () => {
  try {
    await walletService.initialize(currentUser);
    
    const result = await walletService.send({
      amount: '500',
      currency: 'UGX',
      recipientPhone: '256701234567',
      paymentMethod: 'MOMO'
    });
    
    if (result.success) {
      alert(`✅ Sent ${result.amount} ${result.currency}`);
      console.log('Transaction ID:', result.transactionId);
    } else {
      alert(`❌ Error: ${result.error}`);
    }
  } catch (error) {
    alert(`❌ Unexpected error: ${error.message}`);
  }
};

// ============================================================
// EXAMPLE 2: Basic Receive Money
// ============================================================

const handleReceiveBasic = async () => {
  try {
    await walletService.initialize(currentUser);
    
    const result = await walletService.receive({
      amount: '1000',
      currency: 'KES',
      description: 'Invoice payment'
    });
    
    if (result.success) {
      // Copy link to clipboard
      navigator.clipboard.writeText(result.paymentLink);
      alert(`✅ Payment link ready: ${result.paymentLink}`);
      console.log('Payment Reference:', result.paymentRef);
    } else {
      alert(`❌ Error: ${result.error}`);
    }
  } catch (error) {
    alert(`❌ Unexpected error: ${error.message}`);
  }
};

// ============================================================
// EXAMPLE 3: Basic Top Up
// ============================================================

const handleTopUpBasic = async () => {
  try {
    await walletService.initialize(currentUser);
    
    const result = await walletService.topUp({
      amount: '50000',
      currency: 'UGX',
      paymentInput: '256701234567',
      paymentMethod: 'mtn'
    });
    
    if (result.success) {
      alert(`✅ Added ${result.amount} ${result.currency}`);
      console.log('Transaction ID:', result.transactionId);
    } else {
      alert(`❌ Error: ${result.error}`);
    }
  } catch (error) {
    alert(`❌ Unexpected error: ${error.message}`);
  }
};

// ============================================================
// EXAMPLE 4: Send with Validation
// ============================================================

const handleSendWithValidation = async (recipient, amount) => {
  try {
    // Validate inputs
    if (!walletService.validatePhone(recipient)) {
      alert('❌ Invalid phone number format');
      return;
    }
    
    if (!walletService.validateAmount(amount, 1, 1000000)) {
      alert('❌ Amount must be between 1 and 1,000,000');
      return;
    }
    
    await walletService.initialize(currentUser);
    
    const result = await walletService.send({
      amount,
      currency: 'UGX',
      recipientPhone: recipient,
      paymentMethod: 'MOMO'
    });
    
    if (result.success) {
      showSuccessNotification(`✅ Sent ${result.amount} ${result.currency}`);
    } else {
      showErrorNotification(`❌ ${result.error}`);
    }
  } catch (error) {
    showErrorNotification(`❌ ${error.message}`);
  }
};

// ============================================================
// EXAMPLE 5: Receive with Custom Description
// ============================================================

const handleReceiveInvoice = async (invoiceId, amount, invoiceDescription) => {
  try {
    await walletService.initialize(currentUser);
    
    const result = await walletService.receive({
      amount,
      currency: 'USD',
      description: `Invoice ${invoiceId}: ${invoiceDescription}`
    });
    
    if (result.success) {
      // Display payment link with formatted info
      displayPaymentInfo({
        invoiceId,
        amount: result.amount,
        currency: result.currency,
        paymentLink: result.paymentLink,
        description: result.description
      });
    } else {
      console.error('Receive failed:', result.error);
    }
  } catch (error) {
    console.error('Error:', error);
  }
};

// ============================================================
// EXAMPLE 6: Top Up with Card Details
// ============================================================

const handleTopUpWithCard = async (cardData) => {
  try {
    await walletService.initialize(currentUser);
    
    const result = await walletService.topUp({
      amount: cardData.amount,
      currency: 'USD',
      paymentInput: cardData.cardNumber,
      paymentMethod: 'visa',
      paymentDetails: {
        email: currentUser.email,
        name: currentUser.name,
        phone: currentUser.phone
      }
    });
    
    if (result.success) {
      showSuccessModal({
        title: '✅ Top Up Successful',
        message: `${result.amount} ${result.currency} has been added to your wallet`,
        transactionId: result.transactionId
      });
    } else {
      showErrorModal({
        title: '❌ Top Up Failed',
        message: result.error
      });
    }
  } catch (error) {
    showErrorModal({
      title: '❌ Error',
      message: error.message
    });
  }
};

// ============================================================
// EXAMPLE 7: Send with Transaction History Save
// ============================================================

const handleSendAndLog = async (recipient, amount, note) => {
  try {
    await walletService.initialize(currentUser);
    
    // Perform send
    const result = await walletService.send({
      amount,
      currency: 'KES',
      recipientPhone: recipient,
      description: note,
      paymentMethod: 'MOMO'
    });
    
    if (result.success) {
      // Get updated transaction history
      const history = await walletService.getTransactionHistory({
        limit: 10
      });
      
      console.log('Transaction saved:', result.transactionId);
      console.log('Recent transactions:', history);
      
      // Update UI with new balance
      const newBalance = await walletService.getBalance('KES');
      updateBalanceDisplay(newBalance);
    }
  } catch (error) {
    console.error('Error:', error);
  }
};

// ============================================================
// EXAMPLE 8: Batch Operations (Send multiple)
// ============================================================

const handleBatchSend = async (recipients) => {
  try {
    await walletService.initialize(currentUser);
    
    const results = [];
    
    for (const { phone, amount, note } of recipients) {
      // Validate before sending
      if (!walletService.validatePhone(phone) || !walletService.validateAmount(amount)) {
        results.push({
          phone,
          success: false,
          error: 'Validation failed'
        });
        continue;
      }
      
      // Send money
      const result = await walletService.send({
        amount,
        currency: 'UGX',
        recipientPhone: phone,
        description: note,
        paymentMethod: 'MOMO'
      });
      
      results.push({
        phone,
        ...result
      });
      
      // Add delay between sends to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Show summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    showBatchResultsSummary({
      successful,
      failed,
      details: results
    });
    
  } catch (error) {
    console.error('Batch send error:', error);
  }
};

// ============================================================
// EXAMPLE 9: Payment Link Generation and Sharing
// ============================================================

const handleReceiveAndShare = async (amount) => {
  try {
    await walletService.initialize(currentUser);
    
    const result = await walletService.receive({
      amount,
      currency: 'UGX',
      description: `Payment request from ${currentUser.name}`
    });
    
    if (result.success) {
      // Generate QR code (optional)
      const qrCode = await generateQRCode(result.paymentLink);
      
      // Create shareable content
      const shareContent = {
        title: `Payment Request - ${amount} UGX`,
        text: `I'm requesting ${amount} UGX. Click to pay:`,
        url: result.paymentLink,
        qrCode: qrCode
      };
      
      // Display share options
      showShareDialog(shareContent);
    }
  } catch (error) {
    console.error('Error:', error);
  }
};

// ============================================================
// EXAMPLE 10: Complete Wallet Component Integration
// ============================================================

import React, { useState, useEffect } from 'react';

export const WalletExample = ({ currentUser }) => {
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [selectedCurrency, setSelectedCurrency] = useState('UGX');

  useEffect(() => {
    initializeWallet();
  }, [currentUser]);

  const initializeWallet = async () => {
    if (!currentUser) return;
    
    try {
      await walletService.initialize(currentUser);
      await loadBalance();
      await loadTransactions();
    } catch (error) {
      console.error('Init error:', error);
    }
  };

  const loadBalance = async () => {
    const bal = await walletService.getBalance(selectedCurrency);
    setBalance(bal);
  };

  const loadTransactions = async () => {
    const txs = await walletService.getTransactionHistory({
      currency: selectedCurrency,
      limit: 10
    });
    setTransactions(txs);
  };

  const handleSend = async (recipient, amount, note) => {
    setLoading(true);
    try {
      const result = await walletService.send({
        amount,
        currency: selectedCurrency,
        recipientPhone: recipient,
        description: note,
        paymentMethod: 'MOMO'
      });
      
      if (result.success) {
        alert('✅ Sent successfully');
        await loadBalance();
        await loadTransactions();
      } else {
        alert(`❌ ${result.error}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReceive = async (amount, note) => {
    setLoading(true);
    try {
      const result = await walletService.receive({
        amount,
        currency: selectedCurrency,
        description: note
      });
      
      if (result.success) {
        // Copy link to clipboard
        navigator.clipboard.writeText(result.paymentLink);
        alert('✅ Payment link copied to clipboard');
        await loadTransactions();
      } else {
        alert(`❌ ${result.error}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTopUp = async (phone, amount) => {
    setLoading(true);
    try {
      const result = await walletService.topUp({
        amount,
        currency: selectedCurrency,
        paymentInput: phone,
        paymentMethod: 'mtn'
      });
      
      if (result.success) {
        alert('✅ Top up successful');
        await loadBalance();
        await loadTransactions();
      } else {
        alert(`❌ ${result.error}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="wallet-container">
      <h2>💰 Wallet</h2>
      <p>Balance: {balance} {selectedCurrency}</p>
      
      <button onClick={() => handleSend('256701234567', '500', 'payment')} disabled={loading}>
        📤 Send
      </button>
      
      <button onClick={() => handleReceive('1000', 'invoice')} disabled={loading}>
        📥 Receive
      </button>
      
      <button onClick={() => handleTopUp('256701234567', '50000')} disabled={loading}>
        💳 Top Up
      </button>

      <h3>Recent Transactions</h3>
      <ul>
        {transactions.map(tx => (
          <li key={tx.id}>
            {tx.icon} {tx.direction} {tx.amount} {tx.currency} - {tx.date}
          </li>
        ))}
      </ul>
    </div>
  );
};

// ============================================================
// HELPER UTILITIES
// ============================================================

// Show success notification
const showSuccessNotification = (message) => {
  console.log('✅', message);
  // TODO: Implement your notification UI
};

// Show error notification
const showErrorNotification = (message) => {
  console.error('❌', message);
  // TODO: Implement your notification UI
};

// Generate QR code
const generateQRCode = async (text) => {
  // TODO: Use library like qrcode.react
  return null;
};

// Show share dialog
const showShareDialog = (content) => {
  // TODO: Implement share dialog
  console.log('Share:', content);
};

// Display payment info
const displayPaymentInfo = (info) => {
  // TODO: Implement payment info display
  console.log('Payment Info:', info);
};

// Show batch results
const showBatchResultsSummary = (summary) => {
  // TODO: Implement batch results display
  console.log('Batch Results:', summary);
};

// Show success modal
const showSuccessModal = (config) => {
  // TODO: Implement success modal
  console.log('Success:', config);
};

// Show error modal
const showErrorModal = (config) => {
  // TODO: Implement error modal
  console.error('Error Modal:', config);
};

// Update balance display
const updateBalanceDisplay = (balance) => {
  // TODO: Implement balance display update
  console.log('New Balance:', balance);
};

export default WalletExample;
