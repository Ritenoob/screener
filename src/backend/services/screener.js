/**
 * Coin Screener Engine
 * Scans and ranks trading opportunities across multiple symbols
 */

import { EventEmitter } from 'events';

export class ScreenerEngine extends EventEmitter {
  constructor(config, signalEngine, kucoinService, logger) {
    super();
    this.config = config;
    this.signalEngine = signalEngine;
    this.kucoin = kucoinService;
    this.logger = logger;
    
    this.symbols = new Map(); // symbol -> { data, signal, lastUpdate }
    this.opportunities = []; // Ranked opportunities
    this.cooldowns = new Map(); // symbol -> cooldown expiry timestamp
    this.scanInterval = null;
    this.running = false;
    
    // Cache for candle data
    this.candleCache = new Map(); // symbol -> candles[]
  }

  /**
   * Initialize the screener with available contracts
   */
  async initialize() {
    try {
      this.logger.info('Initializing Coin Screener...');
      
      // Get all active futures contracts
      const contracts = await this.kucoin.getContracts();
      
      if (!contracts || contracts.length === 0) {
        this.logger.warn('No contracts found, using default list');
        this.initializeDefaultSymbols();
        return;
      }

      // Filter by volume and liquidity
      const filteredContracts = contracts
        .filter(c => c.isQuanto === false) // Only linear perpetuals
        .filter(c => parseFloat(c.turnoverOf24h || 0) >= this.config.minVolume24h)
        .sort((a, b) => parseFloat(b.turnoverOf24h || 0) - parseFloat(a.turnoverOf24h || 0))
        .slice(0, this.config.topCoinsCount);

      for (const contract of filteredContracts) {
        this.symbols.set(contract.symbol, {
          symbol: contract.symbol,
          baseCurrency: contract.baseCurrency,
          quoteCurrency: contract.quoteCurrency,
          multiplier: parseFloat(contract.multiplier || 1),
          tickSize: parseFloat(contract.tickSize || 0.01),
          lotSize: parseFloat(contract.lotSize || 1),
          maxLeverage: parseFloat(contract.maxLeverage || 100),
          turnover24h: parseFloat(contract.turnoverOf24h || 0),
          volume24h: parseFloat(contract.volumeOf24h || 0),
          signal: null,
          lastUpdate: 0
        });
      }

      this.logger.info(`Initialized screener with ${this.symbols.size} symbols`);

    } catch (err) {
      this.logger.error('Failed to initialize screener:', err);
      this.initializeDefaultSymbols();
    }
  }

  /**
   * Initialize with default popular trading pairs
   */
  initializeDefaultSymbols() {
    const defaultSymbols = [
      'XBTUSDTM', // BTC
      'ETHUSDTM', // ETH
      'SOLUSDTM', // SOL
      'DOGEUSDTM', // DOGE
      'XRPUSDTM', // XRP
      'ADAUSDTM', // ADA
      'AVAXUSDTM', // AVAX
      'DOTUSDTM', // DOT
      'LINKUSDTM', // LINK
      'MATICUSDTM', // MATIC
      'LTCUSDTM', // LTC
      'UNIUSDTM', // UNI
      'ATOMUSDTM', // ATOM
      'NEARUSDTM', // NEAR
      'APEUSDTM', // APE
      'FILUSDTM', // FIL
      'OPUSDTM', // OP
      'ARBUSDTM', // ARB
      'SUIUSDTM', // SUI
      'APTUSDTM' // APT
    ];

    for (const symbol of defaultSymbols) {
      this.symbols.set(symbol, {
        symbol,
        baseCurrency: symbol.replace('USDTM', ''),
        quoteCurrency: 'USDT',
        multiplier: 1,
        tickSize: 0.01,
        lotSize: 1,
        maxLeverage: 100,
        turnover24h: 0,
        volume24h: 0,
        signal: null,
        lastUpdate: 0
      });
    }

    this.logger.info(`Initialized with ${defaultSymbols.length} default symbols`);
  }

  /**
   * Start the screener scan loop
   */
  async start() {
    if (this.running) return;

    await this.initialize();
    this.running = true;

    // Connect to KuCoin WebSocket
    await this.kucoin.connect();

    // Subscribe to tickers for all symbols
    for (const symbol of this.symbols.keys()) {
      this.kucoin.subscribeTicker(symbol);
    }

    // Handle ticker updates
    this.kucoin.on('ticker', (ticker) => {
      this.handleTickerUpdate(ticker);
    });

    // Start periodic scanning
    this.scanInterval = setInterval(() => {
      this.scanOpportunities();
    }, this.config.scanIntervalMs);

    // Initial scan
    await this.scanOpportunities();

    this.logger.info('🔍 Screener started');
    this.emit('started');
  }

  /**
   * Stop the screener
   */
  async stop() {
    this.running = false;
    
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }

    await this.kucoin.disconnect();
    this.logger.info('Screener stopped');
    this.emit('stopped');
  }

  /**
   * Handle ticker price update
   */
  handleTickerUpdate(ticker) {
    const symbolData = this.symbols.get(ticker.symbol);
    if (symbolData) {
      symbolData.price = ticker.price;
      symbolData.bestBid = ticker.bestBid;
      symbolData.bestAsk = ticker.bestAsk;
      symbolData.spread = ticker.bestAsk - ticker.bestBid;
      symbolData.spreadPercent = (symbolData.spread / ticker.price) * 100;
      symbolData.volume24h = ticker.volume24h;
      symbolData.turnover24h = ticker.turnover24h;
    }
  }

  /**
   * Scan all symbols for trading opportunities
   */
  async scanOpportunities() {
    if (!this.running) return;

    this.logger.info('Scanning for opportunities...');
    const opportunities = [];
    const now = Date.now();

    // Process symbols in batches to avoid rate limiting
    const symbolsArray = Array.from(this.symbols.keys());
    const batchSize = 10;

    for (let i = 0; i < symbolsArray.length; i += batchSize) {
      const batch = symbolsArray.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (symbol) => {
        try {
          // Skip if on cooldown
          if (this.isOnCooldown(symbol)) {
            return;
          }

          // Get candle data
          const candles = await this.fetchCandleData(symbol);
          if (!candles || candles.length < 50) {
            return;
          }

          // Get order book for DOM analysis
          const orderBook = this.kucoin.getOrderBook(symbol);

          // Calculate signal
          const signal = this.signalEngine.calculateSignal(candles, orderBook);
          
          // Update symbol data
          const symbolData = this.symbols.get(symbol);
          symbolData.signal = signal;
          symbolData.lastUpdate = now;

          // Check if signal meets criteria
          if (this.isValidOpportunity(signal, symbolData)) {
            opportunities.push({
              symbol,
              ...symbolData,
              signal,
              rank: this.calculateRank(signal, symbolData)
            });
          }

        } catch (err) {
          this.logger.error(`Error scanning ${symbol}:`, err.message);
        }
      }));

      // Small delay between batches
      if (i + batchSize < symbolsArray.length) {
        await this.delay(100);
      }
    }

    // Sort by rank (highest first)
    this.opportunities = opportunities
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 10); // Top 10 opportunities

    this.logger.info(`Found ${this.opportunities.length} opportunities`);
    this.emit('opportunities', this.opportunities);

    return this.opportunities;
  }

  /**
   * Fetch candle data for a symbol
   */
  async fetchCandleData(symbol, granularity = 30) {
    // Check cache first
    const cacheKey = `${symbol}-${granularity}`;
    const cached = this.candleCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < 30000) {
      return cached.data;
    }

    try {
      const candles = await this.kucoin.getCandles(symbol, granularity);
      
      if (candles && candles.length > 0) {
        this.candleCache.set(cacheKey, {
          data: candles,
          timestamp: Date.now()
        });
        return candles;
      }
    } catch (err) {
      this.logger.error(`Failed to fetch candles for ${symbol}:`, err.message);
    }

    return cached?.data || [];
  }

  /**
   * Check if symbol is on cooldown
   */
  isOnCooldown(symbol) {
    const cooldownExpiry = this.cooldowns.get(symbol);
    if (cooldownExpiry && Date.now() < cooldownExpiry) {
      return true;
    }
    return false;
  }

  /**
   * Set cooldown for a symbol
   */
  setCooldown(symbol) {
    this.cooldowns.set(symbol, Date.now() + this.config.cooldownMs);
  }

  /**
   * Check if signal represents a valid trading opportunity
   */
  isValidOpportunity(signal, symbolData) {
    // Must have a non-neutral signal
    if (signal.classification === 'NEUTRAL' || signal.action === 'NO_ACTION') {
      return false;
    }

    // Must meet minimum score threshold
    if (Math.abs(signal.score) < 40) {
      return false;
    }

    // Must have minimum confidence
    if (signal.confidence < 0.7) {
      return false;
    }

    // Must have acceptable spread
    if (symbolData.spreadPercent && symbolData.spreadPercent > 0.1) {
      return false; // Spread > 0.1% is too wide
    }

    // Check indicator confluence
    const totalIndicators = signal.bullishCount + signal.bearishCount;
    const dominantCount = Math.max(signal.bullishCount, signal.bearishCount);
    if (totalIndicators > 0 && dominantCount / totalIndicators < 0.5) {
      return false; // Less than 50% confluence
    }

    return true;
  }

  /**
   * Calculate opportunity rank for sorting
   */
  calculateRank(signal, symbolData) {
    let rank = 0;

    // Base score contribution (0-100)
    rank += (Math.abs(signal.score) / 220) * 100;

    // Confidence contribution (0-50)
    rank += signal.confidence * 50;

    // Confluence contribution (0-30)
    const confluence = signal.confluence || 0;
    rank += confluence * 30;

    // Volume bonus (0-20)
    if (symbolData.turnover24h > 100000000) rank += 20;
    else if (symbolData.turnover24h > 50000000) rank += 15;
    else if (symbolData.turnover24h > 10000000) rank += 10;
    else if (symbolData.turnover24h > 5000000) rank += 5;

    // Spread penalty (0 to -20)
    if (symbolData.spreadPercent) {
      if (symbolData.spreadPercent > 0.05) rank -= 10;
      if (symbolData.spreadPercent > 0.08) rank -= 10;
    }

    // Signal strength bonus
    if (signal.classification.includes('EXTREME')) rank += 15;
    else if (signal.classification.includes('STRONG')) rank += 10;

    return rank;
  }

  /**
   * Get current opportunities
   */
  getOpportunities() {
    return this.opportunities;
  }

  /**
   * Get signal for a specific symbol
   */
  getSymbolSignal(symbol) {
    const symbolData = this.symbols.get(symbol);
    return symbolData?.signal || null;
  }

  /**
   * Get all tracked symbols
   */
  getSymbols() {
    return Array.from(this.symbols.values());
  }

  /**
   * Get screener status
   */
  getStatus() {
    return {
      running: this.running,
      symbolCount: this.symbols.size,
      opportunityCount: this.opportunities.length,
      cooldownCount: this.cooldowns.size,
      lastScan: this.opportunities.length > 0 
        ? this.opportunities[0]?.signal?.timestamp 
        : null
    };
  }

  /**
   * Force scan a specific symbol
   */
  async scanSymbol(symbol) {
    const symbolData = this.symbols.get(symbol);
    if (!symbolData) {
      throw new Error(`Symbol ${symbol} not found`);
    }

    const candles = await this.fetchCandleData(symbol);
    if (!candles || candles.length < 50) {
      throw new Error(`Insufficient candle data for ${symbol}`);
    }

    const orderBook = this.kucoin.getOrderBook(symbol);
    const signal = this.signalEngine.calculateSignal(candles, orderBook);

    symbolData.signal = signal;
    symbolData.lastUpdate = Date.now();

    return {
      symbol,
      ...symbolData,
      signal
    };
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default ScreenerEngine;
