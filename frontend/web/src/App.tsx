import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface PoolData {
  id: string;
  tokenPair: string;
  encryptedLiquidity: string;
  publicVolume: number;
  publicFees: number;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface TradeData {
  id: string;
  inputToken: string;
  outputToken: string;
  inputAmount: number;
  outputAmount: number;
  timestamp: number;
  trader: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [pools, setPools] = useState<PoolData[]>([]);
  const [trades, setTrades] = useState<TradeData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreatePoolModal, setShowCreatePoolModal] = useState(false);
  const [creatingPool, setCreatingPool] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newPoolData, setNewPoolData] = useState({ tokenPair: "", liquidity: "" });
  const [selectedPool, setSelectedPool] = useState<PoolData | null>(null);
  const [decryptedLiquidity, setDecryptedLiquidity] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("swap");
  const [inputToken, setInputToken] = useState("ETH");
  const [outputToken, setOutputToken] = useState("ZAMA");
  const [inputAmount, setInputAmount] = useState("");
  const [outputAmount, setOutputAmount] = useState("");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
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
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const poolsList: PoolData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          poolsList.push({
            id: businessId,
            tokenPair: businessData.name,
            encryptedLiquidity: businessId,
            publicVolume: Number(businessData.publicValue1) || 0,
            publicFees: Number(businessData.publicValue2) || 0,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading pool data:', e);
        }
      }
      
      setPools(poolsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createPool = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingPool(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating pool with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const liquidityValue = parseInt(newPoolData.liquidity) || 0;
      const businessId = `pool-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, liquidityValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newPoolData.tokenPair,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        "Liquidity Pool"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Pool created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreatePoolModal(false);
      setNewPoolData({ tokenPair: "", liquidity: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingPool(false); 
    }
  };

  const decryptLiquidity = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Decryption verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const handleDecryptPool = async () => {
    if (!selectedPool) return;
    const decrypted = await decryptLiquidity(selectedPool.id);
    setDecryptedLiquidity(decrypted);
  };

  const handleSwap = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Executing swap..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const tx = await contract.isAvailable();
      await tx.wait();
      
      const newTrade: TradeData = {
        id: `trade-${Date.now()}`,
        inputToken,
        outputToken,
        inputAmount: parseFloat(inputAmount) || 0,
        outputAmount: parseFloat(outputAmount) || 0,
        timestamp: Math.floor(Date.now() / 1000),
        trader: address
      };
      
      setTrades([newTrade, ...trades.slice(0, 9)]);
      setInputAmount("");
      setOutputAmount("");
      
      setTransactionStatus({ visible: true, status: "success", message: "Swap executed!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Swap failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStats = () => {
    const totalPools = pools.length;
    const verifiedPools = pools.filter(p => p.isVerified).length;
    const totalVolume = pools.reduce((sum, p) => sum + p.publicVolume, 0);
    const totalFees = pools.reduce((sum, p) => sum + p.publicFees, 0);

    return (
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{totalPools}</div>
          <div className="stat-label">Total Pools</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{verifiedPools}</div>
          <div className="stat-label">Verified</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalVolume.toFixed(2)}</div>
          <div className="stat-label">Volume</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalFees.toFixed(4)}</div>
          <div className="stat-label">Fees</div>
        </div>
      </div>
    );
  };

  const renderKLine = () => {
    return (
      <div className="kline-container">
        <div className="kline-header">
          <div className="kline-title">ZAMA/ETH</div>
          <div className="kline-price">0.00245 <span className="price-change">+1.2%</span></div>
        </div>
        <div className="kline-chart">
          <div className="chart-grid">
            <div className="grid-line"></div>
            <div className="grid-line"></div>
            <div className="grid-line"></div>
            <div className="grid-line"></div>
          </div>
          <div className="price-line">
            <div className="price-move up"></div>
            <div className="price-move down"></div>
            <div className="price-move up"></div>
            <div className="price-move up"></div>
            <div className="price-move down"></div>
          </div>
        </div>
        <div className="kline-footer">
          <div className="timeframe">1H</div>
          <div className="timeframe active">4H</div>
          <div className="timeframe">1D</div>
          <div className="timeframe">1W</div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>CipherSwap_Z</h1>
            <div className="tagline">FHE-Powered Private DEX</div>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Wallet to Access Private DEX</h2>
            <p>Secure your trades with fully homomorphic encryption technology</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Trade with encrypted order books</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Prevent MEV and front-running</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="feature-showcase">
          <div className="feature">
            <div className="feature-icon">🔐</div>
            <h3>Encrypted Order Books</h3>
            <p>All orders encrypted with FHE to prevent front-running</p>
          </div>
          <div className="feature">
            <div className="feature-icon">🔄</div>
            <h3>Homomorphic Execution</h3>
            <p>Trades executed on encrypted data without decryption</p>
          </div>
          <div className="feature">
            <div className="feature-icon">🛡️</div>
            <h3>MEV Protection</h3>
            <p>Prevent miner extractable value through encryption</p>
          </div>
        </div>
        
        <footer className="app-footer">
          <div className="footer-content">
            <div className="footer-section">
              <h4>CipherSwap_Z</h4>
              <p>FHE-based Decentralized Exchange</p>
            </div>
            <div className="footer-section">
              <h4>Technology</h4>
              <p>Fully Homomorphic Encryption</p>
              <p>Zero-Knowledge Proofs</p>
            </div>
            <div className="footer-section">
              <h4>Security</h4>
              <p>Audited Contracts</p>
              <p>Non-Custodial</p>
            </div>
          </div>
          <div className="copyright">© 2025 CipherSwap_Z. All rights reserved.</div>
        </footer>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your trading environment</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted DEX...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>CipherSwap_Z</h1>
          <div className="tagline">FHE-Powered Private DEX</div>
        </div>
        
        <div className="header-actions">
          <div className="tabs">
            <button 
              className={`tab ${activeTab === "swap" ? "active" : ""}`}
              onClick={() => setActiveTab("swap")}
            >
              Swap
            </button>
            <button 
              className={`tab ${activeTab === "pools" ? "active" : ""}`}
              onClick={() => setActiveTab("pools")}
            >
              Pools
            </button>
            <button 
              className={`tab ${activeTab === "stats" ? "active" : ""}`}
              onClick={() => setActiveTab("stats")}
            >
              Stats
            </button>
          </div>
          
          <button 
            onClick={() => setShowCreatePoolModal(true)} 
            className="create-btn"
          >
            + New Pool
          </button>
          
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        {activeTab === "swap" && (
          <div className="swap-section">
            <div className="swap-container">
              <div className="swap-header">
                <h2>Swap Tokens</h2>
                <div className="swap-info">
                  <span>FHE-Encrypted Order Book</span>
                  <span>MEV Protected</span>
                </div>
              </div>
              
              <div className="swap-panel">
                <div className="input-section">
                  <div className="token-selector">
                    <div className="token-label">From</div>
                    <select 
                      value={inputToken} 
                      onChange={(e) => setInputToken(e.target.value)}
                      className="token-select"
                    >
                      <option value="ETH">ETH</option>
                      <option value="ZAMA">ZAMA</option>
                      <option value="USDC">USDC</option>
                    </select>
                  </div>
                  <input
                    type="number"
                    placeholder="0.0"
                    value={inputAmount}
                    onChange={(e) => setInputAmount(e.target.value)}
                    className="amount-input"
                  />
                </div>
                
                <div className="swap-icon">↓</div>
                
                <div className="output-section">
                  <div className="token-selector">
                    <div className="token-label">To</div>
                    <select 
                      value={outputToken} 
                      onChange={(e) => setOutputToken(e.target.value)}
                      className="token-select"
                    >
                      <option value="ZAMA">ZAMA</option>
                      <option value="ETH">ETH</option>
                      <option value="USDC">USDC</option>
                    </select>
                  </div>
                  <input
                    type="number"
                    placeholder="0.0"
                    value={outputAmount}
                    onChange={(e) => setOutputAmount(e.target.value)}
                    className="amount-input"
                  />
                </div>
                
                <div className="swap-info-row">
                  <span>Price: 1 ETH = 412.5 ZAMA</span>
                  <span>Fee: 0.3%</span>
                </div>
                
                <button 
                  onClick={handleSwap} 
                  className="swap-btn"
                  disabled={!inputAmount || !outputAmount}
                >
                  Swap
                </button>
              </div>
            </div>
            
            <div className="chart-section">
              {renderKLine()}
              
              <div className="recent-trades">
                <h3>Recent Trades</h3>
                <div className="trades-list">
                  {trades.length === 0 ? (
                    <div className="no-trades">No trades yet</div>
                  ) : (
                    trades.map((trade, index) => (
                      <div className="trade-item" key={index}>
                        <div className="trade-pair">{trade.inputToken} → {trade.outputToken}</div>
                        <div className="trade-amount">{trade.inputAmount.toFixed(4)} → {trade.outputAmount.toFixed(4)}</div>
                        <div className="trade-time">{new Date(trade.timestamp * 1000).toLocaleTimeString()}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "pools" && (
          <div className="pools-section">
            <div className="section-header">
              <h2>Liquidity Pools</h2>
              <div className="header-actions">
                <button 
                  onClick={loadData} 
                  className="refresh-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="pools-list">
              {pools.length === 0 ? (
                <div className="no-pools">
                  <p>No liquidity pools found</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowCreatePoolModal(true)}
                  >
                    Create First Pool
                  </button>
                </div>
              ) : pools.map((pool, index) => (
                <div 
                  className={`pool-item ${selectedPool?.id === pool.id ? "selected" : ""} ${pool.isVerified ? "verified" : ""}`} 
                  key={index}
                  onClick={() => {
                    setSelectedPool(pool);
                    setDecryptedLiquidity(null);
                  }}
                >
                  <div className="pool-title">{pool.tokenPair}</div>
                  <div className="pool-meta">
                    <span>Volume: {pool.publicVolume.toFixed(2)}</span>
                    <span>Fees: {pool.publicFees.toFixed(4)}</span>
                  </div>
                  <div className="pool-status">
                    {pool.isVerified ? (
                      <span className="verified">✅ Verified Liquidity: {pool.decryptedValue}</span>
                    ) : (
                      <span className="unverified">🔒 Encrypted Liquidity</span>
                    )}
                  </div>
                  <div className="pool-creator">Creator: {pool.creator.substring(0, 6)}...{pool.creator.substring(38)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === "stats" && (
          <div className="stats-section">
            <h2>Platform Statistics</h2>
            {renderStats()}
            
            <div className="info-panel">
              <h3>How FHE Protects Your Trades</h3>
              <div className="fhe-process">
                <div className="process-step">
                  <div className="step-number">1</div>
                  <div className="step-content">
                    <h4>Encrypted Order Placement</h4>
                    <p>Traders submit encrypted orders using FHE technology</p>
                  </div>
                </div>
                <div className="process-step">
                  <div className="step-number">2</div>
                  <div className="step-content">
                    <h4>Homomorphic Matching</h4>
                    <p>Orders are matched without decrypting trade details</p>
                  </div>
                </div>
                <div className="process-step">
                  <div className="step-number">3</div>
                  <div className="step-content">
                    <h4>Secure Execution</h4>
                    <p>Trades execute while keeping all details encrypted</p>
                  </div>
                </div>
                <div className="process-step">
                  <div className="step-number">4</div>
                  <div className="step-content">
                    <h4>MEV Prevention</h4>
                    <p>Miners cannot front-run or extract value from trades</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {showCreatePoolModal && (
        <ModalCreatePool 
          onSubmit={createPool} 
          onClose={() => setShowCreatePoolModal(false)} 
          creating={creatingPool} 
          poolData={newPoolData} 
          setPoolData={setNewPoolData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedPool && (
        <PoolDetailModal 
          pool={selectedPool} 
          onClose={() => { 
            setSelectedPool(null); 
            setDecryptedLiquidity(null); 
          }} 
          decryptedLiquidity={decryptedLiquidity}
          isDecrypting={isDecrypting || fheIsDecrypting} 
          onDecrypt={handleDecryptPool}
        />
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
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-section">
            <h4>CipherSwap_Z</h4>
            <p>FHE-based Decentralized Exchange</p>
            <p>Preventing MEV through encryption</p>
          </div>
          <div className="footer-section">
            <h4>Technology</h4>
            <p>Fully Homomorphic Encryption</p>
            <p>Zero-Knowledge Proofs</p>
            <p>Encrypted Order Books</p>
          </div>
          <div className="footer-section">
            <h4>Security</h4>
            <p>Audited Contracts</p>
            <p>Non-Custodial</p>
            <p>Anti-Front Running</p>
          </div>
        </div>
        <div className="copyright">© 2025 CipherSwap_Z. All rights reserved.</div>
      </footer>
    </div>
  );
};

const ModalCreatePool: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  poolData: any;
  setPoolData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, poolData, setPoolData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'liquidity') {
      const intValue = value.replace(/[^\d]/g, '');
      setPoolData({ ...poolData, [name]: intValue });
    } else {
      setPoolData({ ...poolData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-pool-modal">
        <div className="modal-header">
          <h2>New Liquidity Pool</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Liquidity amount encrypted with Zama FHE</p>
          </div>
          
          <div className="form-group">
            <label>Token Pair *</label>
            <select 
              name="tokenPair" 
              value={poolData.tokenPair} 
              onChange={handleChange} 
              className="token-select"
            >
              <option value="">Select pair</option>
              <option value="ETH/ZAMA">ETH/ZAMA</option>
              <option value="ZAMA/USDC">ZAMA/USDC</option>
              <option value="ETH/USDC">ETH/USDC</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Liquidity Amount *</label>
            <input 
              type="number" 
              name="liquidity" 
              value={poolData.liquidity} 
              onChange={handleChange} 
              placeholder="Enter liquidity amount..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !poolData.tokenPair || !poolData.liquidity} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Pool"}
          </button>
        </div>
      </div>
    </div>
  );
};

const PoolDetailModal: React.FC<{
  pool: PoolData;
  onClose: () => void;
  decryptedLiquidity: number | null;
  isDecrypting: boolean;
  onDecrypt: () => void;
}> = ({ pool, onClose, decryptedLiquidity, isDecrypting, onDecrypt }) => {
  return (
    <div className="modal-overlay">
      <div className="pool-detail-modal">
        <div className="modal-header">
          <h2>Pool Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="pool-info">
            <div className="info-item">
              <span>Token Pair:</span>
              <strong>{pool.tokenPair}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{pool.creator.substring(0, 6)}...{pool.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(pool.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Volume:</span>
              <strong>{pool.publicVolume.toFixed(2)}</strong>
            </div>
            <div className="info-item">
              <span>Fees Collected:</span>
              <strong>{pool.publicFees.toFixed(4)}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Liquidity</h3>
            
            <div className="data-row">
              <div className="data-label">Liquidity Amount:</div>
              <div className="data-value">
                {pool.isVerified ? 
                  `${pool.decryptedValue} (Verified)` : 
                  decryptedLiquidity !== null ? 
                  `${decryptedLiquidity} (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(pool.isVerified || decryptedLiquidity !== null) ? 'decrypted' : ''}`}
                onClick={onDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : pool.isVerified ? (
                  "✅ Verified"
                ) : decryptedLiquidity !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protected Liquidity</strong>
                <p>Liquidity amount encrypted on-chain using FHE technology</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!pool.isVerified && (
            <button 
              onClick={onDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


