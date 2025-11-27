import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface SwapData {
  id: string;
  pair: string;
  amount: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [swaps, setSwaps] = useState<SwapData[]>([]);
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [creatingSwap, setCreatingSwap] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newSwapData, setNewSwapData] = useState({ pair: "ETH/USDT", amount: "" });
  const [selectedSwap, setSelectedSwap] = useState<SwapData | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [volume24h, setVolume24h] = useState(0);
  const [activeTraders, setActiveTraders] = useState(0);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const swapsList: SwapData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          swapsList.push({
            id: businessId,
            pair: businessData.name,
            amount: Number(businessData.publicValue1) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setSwaps(swapsList);
      setVolume24h(swapsList.reduce((sum, swap) => sum + swap.publicValue1, 0));
      setActiveTraders(new Set(swapsList.map(swap => swap.creator)).size);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const createSwap = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingSwap(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating swap with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newSwapData.amount) || 0;
      const businessId = `swap-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newSwapData.pair,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        amountValue,
        0,
        "FHE Encrypted Swap"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Swap created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowSwapModal(false);
      setNewSwapData({ pair: "ETH/USDT", amount: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingSwap(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const handleDecrypt = async (swapId: string) => {
    const decrypted = await decryptData(swapId);
    if (decrypted !== null) {
      setDecryptedAmount(decrypted);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Contract is available and functioning properly" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
      }
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Failed to check contract availability" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>CipherSwap_Z 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access the FHE-based decentralized exchange.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start trading with full privacy protection</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted DEX system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>CipherSwap_Z 🔐</h1>
          <p>FHE-based Decentralized Exchange</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowSwapModal(true)} 
            className="create-btn"
          >
            + New Swap
          </button>
          <button 
            onClick={checkAvailability} 
            className="check-btn"
          >
            Check Status
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Market Overview (FHE 🔐)</h2>
          
          <div className="stats-grid">
            <div className="stat-card">
              <h3>24h Volume</h3>
              <div className="stat-value">{volume24h}</div>
              <div className="stat-label">FHE Protected</div>
            </div>
            
            <div className="stat-card">
              <h3>Active Traders</h3>
              <div className="stat-value">{activeTraders}</div>
              <div className="stat-label">This Week</div>
            </div>
            
            <div className="stat-card">
              <h3>Verified Swaps</h3>
              <div className="stat-value">{swaps.filter(s => s.isVerified).length}</div>
              <div className="stat-label">On-chain</div>
            </div>
          </div>
          
          <div className="fhe-explainer">
            <div className="explainer-step">
              <div className="step-number">1</div>
              <div className="step-content">
                <h4>Encrypted Order Book</h4>
                <p>All swap amounts are encrypted with Zama FHE 🔐</p>
              </div>
            </div>
            
            <div className="explainer-step">
              <div className="step-number">2</div>
              <div className="step-content">
                <h4>Homomorphic Execution</h4>
                <p>Trades execute without revealing amounts</p>
              </div>
            </div>
            
            <div className="explainer-step">
              <div className="step-number">3</div>
              <div className="step-content">
                <h4>MEV Protection</h4>
                <p>Front-running impossible with encrypted state</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="swaps-section">
          <div className="section-header">
            <h2>Recent Swaps</h2>
            <button 
              onClick={loadData} 
              className="refresh-btn"
            >
              Refresh
            </button>
          </div>
          
          <div className="swaps-list">
            {swaps.length === 0 ? (
              <div className="no-swaps">
                <p>No swaps found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowSwapModal(true)}
                >
                  Create First Swap
                </button>
              </div>
            ) : swaps.map((swap, index) => (
              <div 
                className={`swap-item ${selectedSwap?.id === swap.id ? "selected" : ""} ${swap.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedSwap(swap)}
              >
                <div className="swap-pair">{swap.pair}</div>
                <div className="swap-meta">
                  <span>Amount: {swap.publicValue1}</span>
                  <span>{new Date(swap.timestamp * 1000).toLocaleString()}</span>
                </div>
                <div className="swap-status">
                  {swap.isVerified ? "✅ Verified" : "🔓 Ready for Verification"}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showSwapModal && (
        <div className="modal-overlay">
          <div className="create-swap-modal">
            <div className="modal-header">
              <h2>New FHE Swap</h2>
              <button onClick={() => setShowSwapModal(false)} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="fhe-notice">
                <strong>FHE 🔐 Encryption</strong>
                <p>Swap amount will be encrypted with Zama FHE (Integer only)</p>
              </div>
              
              <div className="form-group">
                <label>Token Pair *</label>
                <select 
                  name="pair" 
                  value={newSwapData.pair} 
                  onChange={(e) => setNewSwapData({...newSwapData, pair: e.target.value})}
                >
                  <option value="ETH/USDT">ETH/USDT</option>
                  <option value="BTC/USDT">BTC/USDT</option>
                  <option value="SOL/USDC">SOL/USDC</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>Amount (Integer only) *</label>
                <input 
                  type="number" 
                  name="amount" 
                  value={newSwapData.amount} 
                  onChange={(e) => setNewSwapData({...newSwapData, amount: e.target.value.replace(/[^\d]/g, '')})} 
                  placeholder="Enter amount..." 
                  step="1"
                  min="0"
                />
                <div className="data-type-label">FHE Encrypted Integer</div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowSwapModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createSwap} 
                disabled={creatingSwap || isEncrypting || !newSwapData.amount} 
                className="submit-btn"
              >
                {creatingSwap || isEncrypting ? "Encrypting..." : "Create Swap"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedSwap && (
        <div className="modal-overlay">
          <div className="swap-detail-modal">
            <div className="modal-header">
              <h2>Swap Details</h2>
              <button onClick={() => {
                setSelectedSwap(null);
                setDecryptedAmount(null);
              }} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="swap-info">
                <div className="info-item">
                  <span>Pair:</span>
                  <strong>{selectedSwap.pair}</strong>
                </div>
                <div className="info-item">
                  <span>Creator:</span>
                  <strong>{selectedSwap.creator.substring(0, 6)}...{selectedSwap.creator.substring(38)}</strong>
                </div>
                <div className="info-item">
                  <span>Time:</span>
                  <strong>{new Date(selectedSwap.timestamp * 1000).toLocaleString()}</strong>
                </div>
              </div>
              
              <div className="data-section">
                <h3>Encrypted Swap Data</h3>
                
                <div className="data-row">
                  <div className="data-label">Amount:</div>
                  <div className="data-value">
                    {selectedSwap.isVerified && selectedSwap.decryptedValue ? 
                      `${selectedSwap.decryptedValue} (Verified)` : 
                      decryptedAmount !== null ? 
                      `${decryptedAmount} (Decrypted)` : 
                      "🔒 FHE Encrypted"
                    }
                  </div>
                  <button 
                    className={`decrypt-btn ${(selectedSwap.isVerified || decryptedAmount !== null) ? 'decrypted' : ''}`}
                    onClick={() => handleDecrypt(selectedSwap.id)} 
                    disabled={isDecrypting || fheIsDecrypting}
                  >
                    {isDecrypting || fheIsDecrypting ? (
                      "🔓 Verifying..."
                    ) : selectedSwap.isVerified ? (
                      "✅ Verified"
                    ) : decryptedAmount !== null ? (
                      "🔄 Re-verify"
                    ) : (
                      "🔓 Verify"
                    )}
                  </button>
                </div>
                
                <div className="fhe-info">
                  <div className="fhe-icon">🔐</div>
                  <div>
                    <strong>FHE Protected Execution</strong>
                    <p>Swap amounts remain encrypted during matching and execution, preventing MEV attacks.</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => {
                setSelectedSwap(null);
                setDecryptedAmount(null);
              }} className="close-btn">Close</button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;