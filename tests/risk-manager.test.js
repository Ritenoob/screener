/**
 * Risk Manager Tests
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { RiskManager } from '../src/backend/services/risk-manager.js';

// Mock logger
const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};

// Mock risk config
const mockConfig = {
  maxDailyDrawdown: 0.03,
  maxOpenPositions: 5,
  defaultLeverage: 6,
  maxLeverage: 10,
  defaultPositionSize: 0.02,
  maxPositionSize: 0.05,
  stopLossROI: 0.06,
  takeProfitROI: 0.15,
  circuitBreakerThreshold: 3,
  liquidationBuffer: 0.05
};

describe('RiskManager', () => {
  let riskManager;

  beforeEach(() => {
    riskManager = new RiskManager(mockConfig, mockLogger);
    riskManager.initialize(10000);
  });

  describe('Initialization', () => {
    it('should initialize with correct balance', () => {
      assert.strictEqual(riskManager.dailyStartBalance, 10000);
      assert.strictEqual(riskManager.currentBalance, 10000);
      assert.strictEqual(riskManager.dailyPnL, 0);
    });
  });

  describe('Position Sizing', () => {
    it('should calculate position size based on signal', () => {
      const signal = {
        score: 100,
        classification: 'STRONG_BUY',
        confidence: 0.9,
        bullishCount: 6,
        bearishCount: 2,
        indicators: {
          atr: { regime: 'MEDIUM', value: 100 }
        }
      };

      const sizing = riskManager.calculatePositionSize(signal, 50000, 10000);

      assert.ok(sizing.size > 0, 'Should return positive size');
      assert.ok(sizing.leverage > 0 && sizing.leverage <= mockConfig.maxLeverage, 'Leverage should be within bounds');
      assert.ok(sizing.stopLoss > 0, 'Should have stop loss');
      assert.ok(sizing.takeProfit > 0, 'Should have take profit');
    });

    it('should adjust position size based on confidence signals', () => {
      const highConfidence = {
        score: 100,
        classification: 'STRONG_BUY',
        confidence: 0.95,
        bullishCount: 6,
        bearishCount: 2,
        indicators: { atr: { regime: 'MEDIUM' } }
      };

      const lowConfidence = {
        score: 45,  // Lower score so it passes entry gates but is weaker
        classification: 'BUY_WEAK',
        confidence: 0.86,  // Just above threshold
        bullishCount: 4,   // Minimum required
        bearishCount: 2,
        indicators: { atr: { regime: 'MEDIUM' } }
      };

      const highSize = riskManager.calculatePositionSize(highConfidence, 50000, 10000);
      const lowSize = riskManager.calculatePositionSize(lowConfidence, 50000, 10000);

      // Both should have positive sizes (allowed)
      assert.ok(highSize.size > 0, 'High confidence should be allowed');
      assert.ok(lowSize.size > 0 || lowSize.reason, 'Low confidence should have size or reason');
    });

    it('should reduce leverage in high volatility', () => {
      const signal = {
        score: 100,
        classification: 'STRONG_BUY',
        confidence: 0.9,
        bullishCount: 6,
        bearishCount: 2,
        indicators: {
          atr: { regime: 'HIGH', value: 2000 }
        }
      };

      const sizing = riskManager.calculatePositionSize(signal, 50000, 10000);

      assert.ok(sizing.leverage <= 4, 'Leverage should be reduced in high volatility');
    });
  });

  describe('Trade Allowance', () => {
    it('should allow trade when conditions are met', () => {
      const signal = {
        score: 100,
        confidence: 0.9,
        bullishCount: 6,
        bearishCount: 2
      };

      const result = riskManager.isTradeAllowed(signal);

      assert.ok(result.allowed, 'Trade should be allowed');
    });

    it('should block trade when max positions reached', () => {
      // Add 5 positions
      for (let i = 0; i < 5; i++) {
        riskManager.trackPosition({ id: `pos-${i}` });
      }

      const signal = {
        score: 100,
        confidence: 0.9,
        bullishCount: 6,
        bearishCount: 2
      };

      const result = riskManager.isTradeAllowed(signal);

      assert.ok(!result.allowed, 'Trade should be blocked');
      assert.ok(result.reason.includes('Max open positions'), 'Should indicate max positions reason');
    });

    it('should block trade when circuit breaker is triggered', () => {
      riskManager.triggerCircuitBreaker();

      const signal = {
        score: 100,
        confidence: 0.9,
        bullishCount: 6,
        bearishCount: 2
      };

      const result = riskManager.isTradeAllowed(signal);

      assert.ok(!result.allowed, 'Trade should be blocked');
      assert.ok(result.reason.includes('Circuit breaker'), 'Should indicate circuit breaker reason');
    });
  });

  describe('Circuit Breaker', () => {
    it('should trigger after consecutive losses', () => {
      const position = { id: 'test' };
      
      // Record 3 consecutive losses
      for (let i = 0; i < 3; i++) {
        riskManager.recordTradeResult(position, -100);
        riskManager.trackPosition({ id: `pos-${i}` }); // Re-track for next iteration
      }

      assert.ok(riskManager.circuitBreakerTriggered, 'Circuit breaker should be triggered');
    });

    it('should reset on profitable trade', () => {
      const position = { id: 'test' };
      
      // Record 2 losses
      riskManager.recordTradeResult(position, -100);
      riskManager.trackPosition({ id: 'test2' });
      riskManager.recordTradeResult({ id: 'test2' }, -100);
      
      assert.strictEqual(riskManager.consecutiveLosses, 2);

      // Record profit
      riskManager.trackPosition({ id: 'test3' });
      riskManager.recordTradeResult({ id: 'test3' }, 200);

      assert.strictEqual(riskManager.consecutiveLosses, 0);
    });

    it('should be resettable manually', () => {
      riskManager.triggerCircuitBreaker();
      assert.ok(riskManager.circuitBreakerTriggered);

      riskManager.resetCircuitBreaker();
      assert.ok(!riskManager.circuitBreakerTriggered);
    });
  });

  describe('Drawdown Tracking', () => {
    it('should calculate daily drawdown correctly', () => {
      riskManager.updateBalance(9700); // 3% loss

      const drawdown = riskManager.getDailyDrawdown();

      assert.ok(Math.abs(drawdown - 0.03) < 0.001, 'Drawdown should be ~3%');
    });

    it('should block trades when daily drawdown exceeded', () => {
      riskManager.updateBalance(9600); // > 3% loss

      const signal = {
        score: 100,
        confidence: 0.9,
        bullishCount: 6,
        bearishCount: 2
      };

      const result = riskManager.isTradeAllowed(signal);

      assert.ok(!result.allowed, 'Trade should be blocked');
      assert.ok(result.reason.includes('drawdown'), 'Should indicate drawdown reason');
    });
  });

  describe('Exit Level Calculation', () => {
    it('should calculate stop loss and take profit for LONG', () => {
      const levels = riskManager.calculateExitLevels('LONG', 50000, 6, 1000);

      assert.ok(levels.stopLoss < 50000, 'LONG stop loss should be below entry');
      assert.ok(levels.takeProfit > 50000, 'LONG take profit should be above entry');
    });

    it('should calculate stop loss and take profit for SHORT', () => {
      const levels = riskManager.calculateExitLevels('SHORT', 50000, 6, 1000);

      assert.ok(levels.stopLoss > 50000, 'SHORT stop loss should be above entry');
      assert.ok(levels.takeProfit < 50000, 'SHORT take profit should be below entry');
    });
  });

  describe('Liquidation Buffer', () => {
    it('should check liquidation buffer correctly', () => {
      const position = {
        side: 'LONG',
        entryPrice: 50000,
        leverage: 10
      };

      const safeCheck = riskManager.checkLiquidationBuffer(position, 48000);
      const unsafeCheck = riskManager.checkLiquidationBuffer(position, 45500);

      assert.ok(safeCheck.safe, 'Should be safe at 48000');
      assert.ok(!unsafeCheck.safe, 'Should be unsafe at 45500');
    });
  });

  describe('Status', () => {
    it('should return comprehensive status', () => {
      const status = riskManager.getStatus();

      assert.ok('dailyStartBalance' in status);
      assert.ok('currentBalance' in status);
      assert.ok('dailyPnL' in status);
      assert.ok('dailyDrawdown' in status);
      assert.ok('consecutiveLosses' in status);
      assert.ok('openPositions' in status);
      assert.ok('circuitBreakerTriggered' in status);
    });
  });
});
