/**
 * Paper Trading Engine
 * Simulates trading with virtual funds
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

export class PaperTrader extends EventEmitter {
  constructor(config, riskManager, logger) {
    super();
    this.config = config;
    this.riskManager = riskManager;
    this.logger = logger;

    // Account state
    this.balance = config.initialBalance;
    this.equity = config.initialBalance;
    this.margin = 0;
    this.freeMargin = config.initialBalance;
    this.profit = 0;

    // Positions and orders
    this.positions = new Map();
    this.orders = new Map();
    this.tradeHistory = [];

    // Performance tracking
    this.stats = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalProfit: 0,
      totalLoss: 0,
      maxDrawdown: 0,
      peakEquity: config.initialBalance,
      startTime: Date.now()
    };

    // Initialize risk manager with starting balance
    this.riskManager.initialize(this.balance);
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return crypto.randomUUID();
  }

  /**
   * Execute a market order
   */
  async executeMarketOrder(symbol, side, signal, currentPrice) {
    // Calculate position size using risk manager
    const sizing = this.riskManager.calculatePositionSize(
      signal,
      currentPrice,
      this.equity
    );

    if (sizing.size === 0) {
      return {
        success: false,
        reason: sizing.reason
      };
    }

    // Apply slippage
    const slippage = this.config.slippage * currentPrice;
    const fillPrice = side === 'LONG' 
      ? currentPrice + slippage 
      : currentPrice - slippage;

    // Calculate margin required
    const notional = sizing.size * fillPrice;
    const marginRequired = notional / sizing.leverage;

    // Check if enough margin
    if (marginRequired > this.freeMargin) {
      return {
        success: false,
        reason: `Insufficient margin. Required: ${marginRequired.toFixed(2)}, Available: ${this.freeMargin.toFixed(2)}`
      };
    }

    // Create position
    const position = {
      id: this.generateId(),
      symbol,
      side,
      size: sizing.size,
      entryPrice: fillPrice,
      currentPrice: fillPrice,
      leverage: sizing.leverage,
      margin: marginRequired,
      stopLoss: sizing.stopLoss,
      takeProfit: sizing.takeProfit,
      unrealizedPnL: 0,
      fee: notional * this.config.takerFee,
      signal: {
        score: signal.score,
        classification: signal.classification,
        confidence: signal.confidence
      },
      openTime: Date.now(),
      status: 'OPEN'
    };

    // Update account state
    this.margin += marginRequired;
    this.freeMargin -= marginRequired;
    this.balance -= position.fee;

    // Track position
    this.positions.set(position.id, position);
    this.riskManager.trackPosition(position);

    // Create trade record
    const trade = {
      id: position.id,
      type: 'OPEN',
      symbol,
      side,
      size: sizing.size,
      price: fillPrice,
      fee: position.fee,
      timestamp: Date.now()
    };
    this.tradeHistory.push(trade);

    this.logger.info(`📈 Opened ${side} position: ${symbol} @ ${fillPrice.toFixed(4)}, Size: ${sizing.size.toFixed(4)}, Leverage: ${sizing.leverage}x`);
    
    this.emit('positionOpened', position);
    
    return {
      success: true,
      position,
      trade
    };
  }

  /**
   * Close a position
   */
  async closePosition(positionId, currentPrice, reason = 'manual') {
    const position = this.positions.get(positionId);
    if (!position) {
      return { success: false, reason: 'Position not found' };
    }

    // Apply slippage
    const slippage = this.config.slippage * currentPrice;
    const fillPrice = position.side === 'LONG' 
      ? currentPrice - slippage 
      : currentPrice + slippage;

    // Calculate PnL
    const notional = position.size * fillPrice;
    const closeFee = notional * this.config.takerFee;
    
    let grossPnL;
    if (position.side === 'LONG') {
      grossPnL = (fillPrice - position.entryPrice) * position.size;
    } else {
      grossPnL = (position.entryPrice - fillPrice) * position.size;
    }

    const netPnL = grossPnL - position.fee - closeFee;

    // Update account state
    this.margin -= position.margin;
    this.freeMargin += position.margin;
    this.balance += netPnL;
    this.profit += netPnL;
    this.equity = this.balance;

    // Update stats
    this.stats.totalTrades++;
    if (netPnL >= 0) {
      this.stats.winningTrades++;
      this.stats.totalProfit += netPnL;
    } else {
      this.stats.losingTrades++;
      this.stats.totalLoss += Math.abs(netPnL);
    }

    // Track peak equity and drawdown
    if (this.equity > this.stats.peakEquity) {
      this.stats.peakEquity = this.equity;
    }
    const drawdown = (this.stats.peakEquity - this.equity) / this.stats.peakEquity;
    if (drawdown > this.stats.maxDrawdown) {
      this.stats.maxDrawdown = drawdown;
    }

    // Update risk manager
    this.riskManager.updateBalance(this.balance);
    this.riskManager.recordTradeResult(position, netPnL);

    // Close position
    position.status = 'CLOSED';
    position.closePrice = fillPrice;
    position.closeFee = closeFee;
    position.realizedPnL = netPnL;
    position.closeTime = Date.now();
    position.closeReason = reason;

    this.positions.delete(positionId);

    // Create trade record
    const trade = {
      id: positionId,
      type: 'CLOSE',
      symbol: position.symbol,
      side: position.side === 'LONG' ? 'SELL' : 'BUY',
      size: position.size,
      price: fillPrice,
      pnl: netPnL,
      fee: closeFee,
      reason,
      timestamp: Date.now()
    };
    this.tradeHistory.push(trade);

    const pnlSign = netPnL >= 0 ? '📈' : '📉';
    this.logger.info(`${pnlSign} Closed ${position.side} position: ${position.symbol} @ ${fillPrice.toFixed(4)}, PnL: ${netPnL.toFixed(2)} (${reason})`);

    this.emit('positionClosed', { position, trade });

    return {
      success: true,
      position,
      trade,
      pnl: netPnL
    };
  }

  /**
   * Update positions with current prices
   */
  updatePositions(prices) {
    let totalUnrealizedPnL = 0;

    for (const [id, position] of this.positions) {
      const currentPrice = prices[position.symbol];
      if (!currentPrice) continue;

      position.currentPrice = currentPrice;

      // Calculate unrealized PnL
      if (position.side === 'LONG') {
        position.unrealizedPnL = (currentPrice - position.entryPrice) * position.size;
      } else {
        position.unrealizedPnL = (position.entryPrice - currentPrice) * position.size;
      }

      totalUnrealizedPnL += position.unrealizedPnL;

      // Check stop loss
      if (position.side === 'LONG' && currentPrice <= position.stopLoss) {
        this.closePosition(id, currentPrice, 'stop_loss');
        continue;
      }
      if (position.side === 'SHORT' && currentPrice >= position.stopLoss) {
        this.closePosition(id, currentPrice, 'stop_loss');
        continue;
      }

      // Check take profit
      if (position.side === 'LONG' && currentPrice >= position.takeProfit) {
        this.closePosition(id, currentPrice, 'take_profit');
        continue;
      }
      if (position.side === 'SHORT' && currentPrice <= position.takeProfit) {
        this.closePosition(id, currentPrice, 'take_profit');
        continue;
      }

      // Check liquidation buffer
      const liquidationCheck = this.riskManager.checkLiquidationBuffer(position, currentPrice);
      if (!liquidationCheck.safe) {
        this.logger.warn(`⚠️ Position ${id} approaching liquidation`);
        this.emit('liquidationWarning', { position, liquidationCheck });
      }
    }

    // Update equity
    this.equity = this.balance + totalUnrealizedPnL;
    this.freeMargin = this.equity - this.margin;

    this.emit('update', this.getState());
  }

  /**
   * Close all positions
   */
  async closeAllPositions(prices, reason = 'close_all') {
    const results = [];
    for (const [id, position] of this.positions) {
      const price = prices[position.symbol] || position.currentPrice;
      const result = await this.closePosition(id, price, reason);
      results.push(result);
    }
    return results;
  }

  /**
   * Get current account state
   */
  getState() {
    return {
      balance: this.balance,
      equity: this.equity,
      margin: this.margin,
      freeMargin: this.freeMargin,
      profit: this.profit,
      positions: Array.from(this.positions.values()),
      openPositionCount: this.positions.size
    };
  }

  /**
   * Get performance statistics
   */
  getStats() {
    const winRate = this.stats.totalTrades > 0 
      ? (this.stats.winningTrades / this.stats.totalTrades) * 100 
      : 0;

    const profitFactor = this.stats.totalLoss > 0 
      ? this.stats.totalProfit / this.stats.totalLoss 
      : this.stats.totalProfit > 0 ? Infinity : 0;

    const avgWin = this.stats.winningTrades > 0 
      ? this.stats.totalProfit / this.stats.winningTrades 
      : 0;

    const avgLoss = this.stats.losingTrades > 0 
      ? this.stats.totalLoss / this.stats.losingTrades 
      : 0;

    const expectancy = this.stats.totalTrades > 0
      ? ((winRate / 100) * avgWin) - ((1 - winRate / 100) * avgLoss)
      : 0;

    const roi = ((this.equity - this.config.initialBalance) / this.config.initialBalance) * 100;
    
    const runningDays = (Date.now() - this.stats.startTime) / (1000 * 60 * 60 * 24);
    const annualizedReturn = runningDays > 0 
      ? (roi / runningDays) * 365 
      : 0;

    return {
      totalTrades: this.stats.totalTrades,
      winningTrades: this.stats.winningTrades,
      losingTrades: this.stats.losingTrades,
      winRate: winRate.toFixed(2),
      profitFactor: profitFactor.toFixed(2),
      totalProfit: this.stats.totalProfit.toFixed(2),
      totalLoss: this.stats.totalLoss.toFixed(2),
      netProfit: (this.stats.totalProfit - this.stats.totalLoss).toFixed(2),
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
      expectancy: expectancy.toFixed(2),
      maxDrawdown: (this.stats.maxDrawdown * 100).toFixed(2),
      peakEquity: this.stats.peakEquity.toFixed(2),
      roi: roi.toFixed(2),
      annualizedReturn: annualizedReturn.toFixed(2),
      runningDays: runningDays.toFixed(1)
    };
  }

  /**
   * Get trade history
   */
  getTradeHistory(limit = 100) {
    return this.tradeHistory.slice(-limit);
  }

  /**
   * Reset paper trading account
   */
  reset() {
    this.balance = this.config.initialBalance;
    this.equity = this.config.initialBalance;
    this.margin = 0;
    this.freeMargin = this.config.initialBalance;
    this.profit = 0;
    
    this.positions.clear();
    this.orders.clear();
    this.tradeHistory = [];
    
    this.stats = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalProfit: 0,
      totalLoss: 0,
      maxDrawdown: 0,
      peakEquity: this.config.initialBalance,
      startTime: Date.now()
    };

    this.riskManager.initialize(this.balance);
    
    this.logger.info('Paper trading account reset');
    this.emit('reset');
  }
}

export default PaperTrader;
