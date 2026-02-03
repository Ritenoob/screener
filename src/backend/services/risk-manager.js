/**
 * Risk Manager
 * Enforces trading risk parameters and position sizing
 */

import { EventEmitter } from 'events';

export class RiskManager extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    
    // State tracking
    this.dailyStartBalance = 0;
    this.currentBalance = 0;
    this.consecutiveLosses = 0;
    this.dailyPnL = 0;
    this.circuitBreakerTriggered = false;
    this.openPositions = new Map();
    
    // Reset daily stats at midnight
    this.scheduleDailyReset();
  }

  /**
   * Initialize with account balance
   */
  initialize(balance) {
    this.dailyStartBalance = balance;
    this.currentBalance = balance;
    this.dailyPnL = 0;
  }

  /**
   * Update current balance
   */
  updateBalance(balance) {
    this.currentBalance = balance;
    this.dailyPnL = balance - this.dailyStartBalance;
  }

  /**
   * Calculate position size based on signal and risk parameters
   */
  calculatePositionSize(signal, price, accountEquity) {
    // Check if trading is allowed
    const allowed = this.isTradeAllowed(signal);
    if (!allowed.allowed) {
      return { size: 0, leverage: 0, reason: allowed.reason };
    }

    // Get base position size as percentage of equity
    let sizePct = this.config.defaultPositionSize;

    // Adjust based on signal confidence
    sizePct *= signal.confidence;

    // Adjust based on signal strength
    if (signal.classification.includes('EXTREME')) {
      sizePct *= 1.2; // 20% larger for extreme signals
    } else if (signal.classification.includes('WEAK')) {
      sizePct *= 0.8; // 20% smaller for weak signals
    }

    // Cap at max position size
    sizePct = Math.min(sizePct, this.config.maxPositionSize);

    // Calculate dollar amount
    const positionValue = accountEquity * sizePct;

    // Determine leverage based on volatility
    let leverage = this.config.defaultLeverage;
    if (signal.indicators?.atr?.regime === 'HIGH') {
      leverage = Math.min(leverage, 4); // Reduce leverage in high volatility
    } else if (signal.indicators?.atr?.regime === 'LOW') {
      leverage = Math.min(leverage + 2, this.config.maxLeverage);
    }

    // Calculate actual size
    const size = positionValue / price;

    // Determine trade side from signal
    const action = signal.action || signal.classification || 'NEUTRAL';
    const isBullish = action.includes('LONG') || action.includes('BUY') || signal.score > 0;
    const side = isBullish ? 'LONG' : 'SHORT';

    // Calculate stop loss and take profit prices
    const { stopLoss, takeProfit } = this.calculateExitLevels(
      side,
      price,
      leverage,
      signal.indicators?.atr?.value || price * 0.02
    );

    return {
      size,
      positionValue,
      leverage,
      sizePct,
      stopLoss,
      takeProfit,
      risk: positionValue * this.config.stopLossROI
    };
  }

  /**
   * Calculate stop loss and take profit levels
   */
  calculateExitLevels(side, entryPrice, leverage, atr) {
    const takerFee = 0.0006;
    const stopLossROI = this.config.stopLossROI;
    const takeProfitROI = this.config.takeProfitROI;

    let stopLoss, takeProfit;

    if (side === 'LONG') {
      // SL = entry × (1 - (SL_ROI - 2×fee) / leverage / 100)
      stopLoss = entryPrice * (1 - (stopLossROI - 2 * takerFee) / leverage);
      // TP = entry × (1 + TP_ROI / leverage / 100)
      takeProfit = entryPrice * (1 + takeProfitROI / leverage);
    } else {
      // Short side
      stopLoss = entryPrice * (1 + (stopLossROI - 2 * takerFee) / leverage);
      takeProfit = entryPrice * (1 - takeProfitROI / leverage);
    }

    return { stopLoss, takeProfit };
  }

  /**
   * Check if a trade is allowed based on risk rules
   */
  isTradeAllowed(signal) {
    // Check circuit breaker
    if (this.circuitBreakerTriggered) {
      return {
        allowed: false,
        reason: 'Circuit breaker triggered - trading halted'
      };
    }

    // Check daily drawdown
    const drawdown = this.getDailyDrawdown();
    if (drawdown >= this.config.maxDailyDrawdown) {
      return {
        allowed: false,
        reason: `Daily drawdown limit reached (${(drawdown * 100).toFixed(2)}%)`
      };
    }

    // Check max open positions
    if (this.openPositions.size >= this.config.maxOpenPositions) {
      return {
        allowed: false,
        reason: `Max open positions reached (${this.openPositions.size}/${this.config.maxOpenPositions})`
      };
    }

    // Check signal entry gates
    const gates = this.checkEntryGates(signal);
    if (!gates.passed) {
      return {
        allowed: false,
        reason: `Entry gates not passed: ${JSON.stringify(gates.failed)}`
      };
    }

    return { allowed: true };
  }

  /**
   * Check entry gate requirements
   */
  checkEntryGates(signal) {
    const failed = [];

    // Score threshold
    if (Math.abs(signal.score) < 75) {
      failed.push('score < 75');
    }

    // Indicator confluence
    if (Math.max(signal.bullishCount, signal.bearishCount) < 4) {
      failed.push('confluence < 4');
    }

    // Confidence level
    if (signal.confidence < 0.85) {
      failed.push('confidence < 0.85');
    }

    return {
      passed: failed.length === 0,
      failed
    };
  }

  /**
   * Get current daily drawdown
   */
  getDailyDrawdown() {
    if (this.dailyStartBalance === 0) return 0;
    return Math.max(0, (this.dailyStartBalance - this.currentBalance) / this.dailyStartBalance);
  }

  /**
   * Record a trade result
   */
  recordTradeResult(position, pnl) {
    this.dailyPnL += pnl;
    this.currentBalance += pnl;

    if (pnl < 0) {
      this.consecutiveLosses++;
      
      // Check circuit breaker
      if (this.consecutiveLosses >= this.config.circuitBreakerThreshold) {
        this.triggerCircuitBreaker();
      }
    } else {
      this.consecutiveLosses = 0;
    }

    // Remove from open positions
    this.openPositions.delete(position.id);

    this.emit('tradeRecorded', { position, pnl, consecutiveLosses: this.consecutiveLosses });
  }

  /**
   * Track new position
   */
  trackPosition(position) {
    this.openPositions.set(position.id, position);
    this.emit('positionOpened', position);
  }

  /**
   * Trigger circuit breaker
   */
  triggerCircuitBreaker() {
    this.circuitBreakerTriggered = true;
    this.logger.warn('🚨 CIRCUIT BREAKER TRIGGERED - Trading halted');
    this.emit('circuitBreaker', {
      consecutiveLosses: this.consecutiveLosses,
      dailyDrawdown: this.getDailyDrawdown()
    });
  }

  /**
   * Reset circuit breaker (manual action)
   */
  resetCircuitBreaker() {
    this.circuitBreakerTriggered = false;
    this.consecutiveLosses = 0;
    this.logger.info('Circuit breaker reset');
    this.emit('circuitBreakerReset');
  }

  /**
   * Check liquidation buffer
   */
  checkLiquidationBuffer(position, currentPrice) {
    const side = position.side;
    const entryPrice = position.entryPrice;
    const leverage = position.leverage;
    const mmr = 0.005; // Maintenance margin rate

    let liquidationPrice;
    if (side === 'LONG') {
      liquidationPrice = entryPrice * (1 - (1 / leverage) * (1 - mmr));
    } else {
      liquidationPrice = entryPrice * (1 + (1 / leverage) * (1 - mmr));
    }

    const buffer = Math.abs(currentPrice - liquidationPrice) / currentPrice;
    const safe = buffer >= this.config.liquidationBuffer;

    return {
      liquidationPrice,
      currentBuffer: buffer,
      minBuffer: this.config.liquidationBuffer,
      safe
    };
  }

  /**
   * Get risk status
   */
  getStatus() {
    return {
      dailyStartBalance: this.dailyStartBalance,
      currentBalance: this.currentBalance,
      dailyPnL: this.dailyPnL,
      dailyDrawdown: this.getDailyDrawdown(),
      consecutiveLosses: this.consecutiveLosses,
      openPositions: this.openPositions.size,
      maxOpenPositions: this.config.maxOpenPositions,
      circuitBreakerTriggered: this.circuitBreakerTriggered,
      circuitBreakerThreshold: this.config.circuitBreakerThreshold
    };
  }

  /**
   * Schedule daily reset at midnight UTC
   */
  scheduleDailyReset() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCHours(24, 0, 0, 0);
    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    setTimeout(() => {
      this.resetDaily();
      // Schedule next reset
      setInterval(() => this.resetDaily(), 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
  }

  /**
   * Reset daily stats
   */
  resetDaily() {
    this.dailyStartBalance = this.currentBalance;
    this.dailyPnL = 0;
    this.consecutiveLosses = 0;
    this.circuitBreakerTriggered = false;
    this.logger.info('Daily risk stats reset');
    this.emit('dailyReset');
  }
}

export default RiskManager;
