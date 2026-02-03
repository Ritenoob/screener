/**
 * Configuration loader for Miniature Enigma
 * Loads and validates configuration from environment and STRATEGY_CONFIG.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '../../../../');

/**
 * Load strategy configuration from STRATEGY_CONFIG.json
 */
function loadStrategyConfig() {
  try {
    const configPath = path.join(ROOT_DIR, 'STRATEGY_CONFIG.json');
    const data = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.warn('Warning: Could not load STRATEGY_CONFIG.json, using defaults');
    return getDefaultStrategyConfig();
  }
}

/**
 * Default strategy configuration
 */
function getDefaultStrategyConfig() {
  return {
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
    timeframes: {
      primary: '30min',
      secondary: '2hour',
      available: ['5min', '15min', '30min', '1hour', '2hour', '4hour']
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
      threshold: { minScore: 75, strongScore: 90, extremeScore: 100 },
      confluence: { minPercentage: 50, minCount: 4 },
      confidence: { minConfidence: 0.85 },
      drawdown: { maxDrawdown: 0.03 }
    }
  };
}

/**
 * Load complete configuration
 */
export function loadConfig() {
  const strategyConfig = loadStrategyConfig();
  
  return {
    // Server config
    port: parseInt(process.env.PORT) || 3000,
    host: process.env.HOST || '0.0.0.0',
    logLevel: process.env.LOG_LEVEL || 'info',
    corsOrigin: process.env.CORS_ORIGIN || '*',
    
    // Bot mode
    mode: process.env.BOT_MODE || 'paper', // 'paper', 'live', 'backtest'
    
    // KuCoin API config
    kucoin: {
      apiKey: process.env.KUCOIN_API_KEY || '',
      apiSecret: process.env.KUCOIN_API_SECRET || '',
      apiPassphrase: process.env.KUCOIN_API_PASSPHRASE || '',
      baseUrl: process.env.KUCOIN_BASE_URL || 'https://api-futures.kucoin.com',
      wsUrl: process.env.KUCOIN_WS_URL || 'wss://ws-api-spot.kucoin.com',
      sandbox: process.env.KUCOIN_SANDBOX === 'true'
    },
    
    // Strategy configuration
    strategy: strategyConfig,
    
    // Screener configuration
    screener: {
      topCoinsCount: parseInt(process.env.TOP_COINS_COUNT) || 100,
      minVolume24h: parseFloat(process.env.MIN_VOLUME_24H) || 5000000,
      scanIntervalMs: parseInt(process.env.SCAN_INTERVAL_MS) || 60000,
      cooldownMs: parseInt(process.env.COOLDOWN_MS) || 300000
    },
    
    // Risk management
    risk: {
      maxDailyDrawdown: parseFloat(process.env.MAX_DAILY_DRAWDOWN) || 0.03,
      maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS) || 5,
      defaultLeverage: parseFloat(process.env.LEVERAGE_DEFAULT) || 6,
      maxLeverage: parseFloat(process.env.LEVERAGE_MAX) || 10,
      defaultPositionSize: parseFloat(process.env.POSITION_SIZE_DEFAULT) || 0.02,
      maxPositionSize: parseFloat(process.env.POSITION_SIZE_MAX) || 0.05,
      stopLossROI: parseFloat(process.env.STOP_LOSS_ROI) || 0.06,
      takeProfitROI: parseFloat(process.env.TAKE_PROFIT_ROI) || 0.15,
      circuitBreakerThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD) || 3,
      liquidationBuffer: parseFloat(process.env.LIQUIDATION_BUFFER) || 0.05
    },
    
    // Paper trading
    paperTrading: {
      initialBalance: parseFloat(process.env.PAPER_INITIAL_BALANCE) || 10000,
      takerFee: parseFloat(process.env.PAPER_TAKER_FEE) || 0.0006,
      makerFee: parseFloat(process.env.PAPER_MAKER_FEE) || 0.0002,
      slippage: parseFloat(process.env.PAPER_SLIPPAGE) || 0.0001
    }
  };
}

export default loadConfig;
