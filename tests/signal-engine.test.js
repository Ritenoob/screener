/**
 * Signal Engine Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SignalEngine } from '../src/backend/services/signal-engine.js';

// Mock logger
const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};

// Mock strategy config
const mockConfig = {
  scoring: {
    range: { min: -220, max: 220 },
    caps: { indicator: 200, microstructure: 20, total: 220 },
    classifications: [
      { name: 'EXTREME_BUY', min: 130, max: 220, action: 'STRONG_LONG' },
      { name: 'STRONG_BUY', min: 95, max: 129, action: 'LONG' },
      { name: 'BUY', min: 65, max: 94, action: 'MODERATE_LONG' },
      { name: 'BUY_WEAK', min: 40, max: 64, action: 'WEAK_LONG' },
      { name: 'NEUTRAL', min: -39, max: 39, action: 'NO_ACTION' },
      { name: 'SELL_WEAK', min: -64, max: -40, action: 'WEAK_SHORT' },
      { name: 'SELL', min: -94, max: -65, action: 'MODERATE_SHORT' },
      { name: 'STRONG_SELL', min: -129, max: -95, action: 'SHORT' },
      { name: 'EXTREME_SELL', min: -220, max: -130, action: 'STRONG_SHORT' }
    ]
  },
  indicators: {
    RSI: { weight: 17, maxScore: 34 },
    STOCHRSI: { weight: 20, maxScore: 40 },
    MACD: { weight: 18, maxScore: 36 },
    BOLLINGER: { weight: 20, maxScore: 40 },
    WILLIAMS_R: { weight: 20, maxScore: 50 },
    STOCHASTIC: { weight: 18, maxScore: 36 },
    EMA_TREND: { weight: 19, maxScore: 38 },
    AWESOME_OSCILLATOR: { weight: 17, maxScore: 34 },
    KDJ: { weight: 17, maxScore: 34 },
    OBV: { weight: 18, maxScore: 36 },
    CMF: { weight: 19, maxScore: 38 },
    ATR: { weight: 15, maxScore: 30 },
    CCI: { weight: 16, maxScore: 32 },
    DOM: { weight: 15, maxScore: 30 }
  },
  entryGates: {
    threshold: { minScore: 75 },
    confluence: { minCount: 4 },
    confidence: { minConfidence: 0.85 }
  },
  confidencePenalties: {}
};

// Generate test candle data
function generateCandles(count, startPrice = 100, trend = 'neutral') {
  const candles = [];
  let price = startPrice;
  
  for (let i = 0; i < count; i++) {
    let change;
    if (trend === 'up') {
      change = (Math.random() * 2 - 0.5) * 0.5; // Slight upward bias
    } else if (trend === 'down') {
      change = (Math.random() * 2 - 1.5) * 0.5; // Slight downward bias
    } else {
      change = (Math.random() - 0.5) * 1;
    }
    
    price = price * (1 + change / 100);
    const high = price * (1 + Math.random() * 0.01);
    const low = price * (1 - Math.random() * 0.01);
    
    candles.push({
      timestamp: Date.now() - (count - i) * 30 * 60 * 1000,
      open: price * (1 - Math.random() * 0.005),
      high,
      low,
      close: price,
      volume: 1000000 + Math.random() * 500000
    });
  }
  
  return candles;
}

describe('SignalEngine', () => {
  describe('RSI Calculation', () => {
    it('should return neutral for insufficient data', () => {
      const engine = new SignalEngine(mockConfig, mockLogger);
      const result = engine.calculateRSI([1, 2, 3], 14);
      
      assert.strictEqual(result.signal, 'NEUTRAL');
      assert.strictEqual(result.score, 0);
    });

    it('should return oversold signal for low RSI values', () => {
      const engine = new SignalEngine(mockConfig, mockLogger);
      
      // Generate data that will produce low RSI (consecutive down days)
      const closes = [];
      let price = 100;
      for (let i = 0; i < 20; i++) {
        price = price * 0.98; // 2% down each day
        closes.push(price);
      }
      
      const result = engine.calculateRSI(closes);
      
      assert.strictEqual(result.signal, 'BUY');
      assert.ok(result.score > 0, 'Score should be positive for oversold');
    });

    it('should return overbought signal for high RSI values', () => {
      const engine = new SignalEngine(mockConfig, mockLogger);
      
      // Generate data that will produce high RSI (consecutive up days)
      const closes = [];
      let price = 100;
      for (let i = 0; i < 20; i++) {
        price = price * 1.02; // 2% up each day
        closes.push(price);
      }
      
      const result = engine.calculateRSI(closes);
      
      assert.strictEqual(result.signal, 'SELL');
      assert.ok(result.score < 0, 'Score should be negative for overbought');
    });
  });

  describe('MACD Calculation', () => {
    it('should calculate MACD correctly', () => {
      const engine = new SignalEngine(mockConfig, mockLogger);
      const candles = generateCandles(50, 100, 'up');
      const closes = candles.map(c => c.close);
      
      const result = engine.calculateMACD(closes);
      
      assert.ok('macd' in result);
      assert.ok('signal' in result);
      assert.ok('histogram' in result);
      assert.ok('score' in result);
    });
  });

  describe('Williams %R Calculation', () => {
    it('should calculate Williams %R correctly', () => {
      const engine = new SignalEngine(mockConfig, mockLogger);
      const candles = generateCandles(50);
      
      const result = engine.calculateWilliamsR(
        candles.map(c => c.high),
        candles.map(c => c.low),
        candles.map(c => c.close)
      );
      
      assert.ok(result.value >= -100 && result.value <= 0, 'Williams %R should be between -100 and 0');
    });
  });

  describe('Signal Generation', () => {
    it('should generate complete signal with all indicators', () => {
      const engine = new SignalEngine(mockConfig, mockLogger);
      const candles = generateCandles(100);
      
      const signal = engine.calculateSignal(candles);
      
      assert.ok('score' in signal);
      assert.ok('classification' in signal);
      assert.ok('action' in signal);
      assert.ok('confidence' in signal);
      assert.ok('indicators' in signal);
      assert.ok('timestamp' in signal);
    });

    it('should cap scores within valid range', () => {
      const engine = new SignalEngine(mockConfig, mockLogger);
      const candles = generateCandles(100);
      
      const signal = engine.calculateSignal(candles);
      
      assert.ok(signal.score >= -220, 'Score should be >= -220');
      assert.ok(signal.score <= 220, 'Score should be <= 220');
    });

    it('should classify signals correctly', () => {
      const engine = new SignalEngine(mockConfig, mockLogger);
      
      // Test different score ranges
      const classification130 = engine.classifySignal(130);
      assert.strictEqual(classification130.name, 'EXTREME_BUY');
      
      const classification0 = engine.classifySignal(0);
      assert.strictEqual(classification0.name, 'NEUTRAL');
      
      const classificationNeg130 = engine.classifySignal(-130);
      assert.strictEqual(classificationNeg130.name, 'EXTREME_SELL');
    });

    it('should return neutral for insufficient candle data', () => {
      const engine = new SignalEngine(mockConfig, mockLogger);
      const candles = generateCandles(10); // Too few candles
      
      const signal = engine.calculateSignal(candles);
      
      assert.strictEqual(signal.classification, 'NEUTRAL');
      assert.strictEqual(signal.action, 'NO_ACTION');
    });
  });

  describe('Entry Gates', () => {
    it('should check entry gates correctly', () => {
      const engine = new SignalEngine(mockConfig, mockLogger);
      
      const strongSignal = {
        score: 100,
        confidence: 0.9,
        bullishCount: 8,
        bearishCount: 2
      };
      
      const result = engine.checkEntryGates(strongSignal);
      
      assert.ok(result.passed, 'Strong signal should pass entry gates');
    });

    it('should fail weak signals', () => {
      const engine = new SignalEngine(mockConfig, mockLogger);
      
      const weakSignal = {
        score: 30,
        confidence: 0.5,
        bullishCount: 2,
        bearishCount: 4
      };
      
      const result = engine.checkEntryGates(weakSignal);
      
      assert.ok(!result.passed, 'Weak signal should not pass entry gates');
    });
  });
});

describe('ATR Calculation', () => {
  it('should correctly identify volatility regime', () => {
    const engine = new SignalEngine(mockConfig, mockLogger);
    const candles = generateCandles(50);
    
    const result = engine.calculateATR(
      candles.map(c => c.high),
      candles.map(c => c.low),
      candles.map(c => c.close)
    );
    
    assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(result.regime));
    assert.ok(result.value >= 0);
    assert.ok(result.percent >= 0);
  });
});
