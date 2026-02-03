/**
 * Signal Engine
 * Calculates technical indicators and generates trading signals
 */

import { EventEmitter } from 'events';
import * as ti from 'technicalindicators';

export class SignalEngine extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.signalHistory = new Map();
    
    // Initialize indicator parameters from config
    this.indicatorConfig = config.indicators || {};
    this.scoringConfig = config.scoring || {};
    this.classifications = this.scoringConfig.classifications || [];
  }

  /**
   * Calculate RSI (Relative Strength Index)
   * Max Score: ±34
   */
  calculateRSI(closes, period = 14, oversold = 30, overbought = 70) {
    if (closes.length < period + 1) {
      return { value: 50, score: 0, signal: 'NEUTRAL' };
    }

    const rsiValues = ti.RSI.calculate({
      values: closes,
      period
    });

    if (!rsiValues.length) {
      return { value: 50, score: 0, signal: 'NEUTRAL' };
    }

    const rsi = rsiValues[rsiValues.length - 1];
    const prevRsi = rsiValues.length > 1 ? rsiValues[rsiValues.length - 2] : rsi;
    
    let score = 0;
    let signal = 'NEUTRAL';
    const config = this.indicatorConfig.RSI || { weight: 17 };

    if (rsi <= oversold) {
      // Oversold - bullish signal
      const intensity = (oversold - rsi) / oversold;
      score = config.weight + (intensity * config.weight);
      signal = 'BUY';
      
      // Bonus for turning up from oversold
      if (rsi > prevRsi) {
        score += 5;
      }
    } else if (rsi >= overbought) {
      // Overbought - bearish signal
      const intensity = (rsi - overbought) / (100 - overbought);
      score = -(config.weight + (intensity * config.weight));
      signal = 'SELL';
      
      // Bonus for turning down from overbought
      if (rsi < prevRsi) {
        score -= 5;
      }
    }

    return { value: rsi, score: Math.round(score), signal, prevValue: prevRsi };
  }

  /**
   * Calculate Stochastic RSI
   * Max Score: ±40
   */
  calculateStochasticRSI(closes, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3, oversold = 20, overbought = 80) {
    if (closes.length < rsiPeriod + stochPeriod + Math.max(kPeriod, dPeriod)) {
      return { k: 50, d: 50, score: 0, signal: 'NEUTRAL' };
    }

    const stochRsi = ti.StochasticRSI.calculate({
      values: closes,
      rsiPeriod,
      stochasticPeriod: stochPeriod,
      kPeriod,
      dPeriod
    });

    if (!stochRsi.length) {
      return { k: 50, d: 50, score: 0, signal: 'NEUTRAL' };
    }

    const current = stochRsi[stochRsi.length - 1];
    const prev = stochRsi.length > 1 ? stochRsi[stochRsi.length - 2] : current;
    const config = this.indicatorConfig.STOCHRSI || { weight: 20 };

    let score = 0;
    let signal = 'NEUTRAL';

    // K/D crossover in oversold zone - strong bullish
    if (current.k < oversold && current.k > current.d && prev.k <= prev.d) {
      score = config.weight;
      signal = 'BUY';
    }
    // K/D crossover in overbought zone - strong bearish
    else if (current.k > overbought && current.k < current.d && prev.k >= prev.d) {
      score = -config.weight;
      signal = 'SELL';
    }
    // Oversold condition
    else if (current.k < oversold) {
      score = config.weight / 2;
      signal = 'BUY';
    }
    // Overbought condition
    else if (current.k > overbought) {
      score = -(config.weight / 2);
      signal = 'SELL';
    }

    return { k: current.k, d: current.d, score: Math.round(score), signal };
  }

  /**
   * Calculate MACD
   * Max Score: ±36
   */
  calculateMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (closes.length < slowPeriod + signalPeriod) {
      return { macd: 0, signal: 0, histogram: 0, score: 0, direction: 'NEUTRAL' };
    }

    const macdValues = ti.MACD.calculate({
      values: closes,
      fastPeriod,
      slowPeriod,
      signalPeriod,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    });

    if (!macdValues.length) {
      return { macd: 0, signal: 0, histogram: 0, score: 0, direction: 'NEUTRAL' };
    }

    const current = macdValues[macdValues.length - 1];
    const prev = macdValues.length > 1 ? macdValues[macdValues.length - 2] : current;
    const config = this.indicatorConfig.MACD || { weight: 18 };

    let score = 0;
    let direction = 'NEUTRAL';
    const hist = current.histogram || 0;
    const prevHist = prev.histogram || 0;

    // Bullish accelerating
    if (current.MACD > current.signal && hist > 0 && hist > prevHist) {
      score = config.weight;
      direction = 'BUY';
    }
    // Bullish decelerating
    else if (current.MACD > current.signal && hist > 0 && hist <= prevHist) {
      score = config.weight * 0.67;
      direction = 'BUY';
    }
    // Bullish crossover
    else if (current.MACD > current.signal && prev.MACD <= prev.signal) {
      score = config.weight * 0.83;
      direction = 'BUY';
    }
    // Bearish accelerating
    else if (current.MACD < current.signal && hist < 0 && hist < prevHist) {
      score = -config.weight;
      direction = 'SELL';
    }
    // Bearish decelerating
    else if (current.MACD < current.signal && hist < 0 && hist >= prevHist) {
      score = -(config.weight * 0.67);
      direction = 'SELL';
    }
    // Bearish crossover
    else if (current.MACD < current.signal && prev.MACD >= prev.signal) {
      score = -(config.weight * 0.83);
      direction = 'SELL';
    }

    return {
      macd: current.MACD,
      signal: current.signal,
      histogram: hist,
      score: Math.round(score),
      direction
    };
  }

  /**
   * Calculate Bollinger Bands
   * Max Score: ±40
   */
  calculateBollingerBands(closes, period = 20, multiplier = 2) {
    if (closes.length < period) {
      return { upper: 0, middle: 0, lower: 0, percentB: 0.5, score: 0, signal: 'NEUTRAL' };
    }

    const bb = ti.BollingerBands.calculate({
      values: closes,
      period,
      stdDev: multiplier
    });

    if (!bb.length) {
      return { upper: 0, middle: 0, lower: 0, percentB: 0.5, score: 0, signal: 'NEUTRAL' };
    }

    const current = bb[bb.length - 1];
    const close = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];
    const config = this.indicatorConfig.BOLLINGER || { weight: 20 };

    // Calculate %B
    const percentB = (close - current.lower) / (current.upper - current.lower);
    
    let score = 0;
    let signal = 'NEUTRAL';

    // Bullish bounce from lower band
    if (close < current.lower && close > prevClose) {
      score = config.weight;
      signal = 'BUY';
    }
    // Bullish reversal at lower band
    else if (close < current.lower) {
      score = config.weight / 2;
      signal = 'BUY';
    }
    // Bearish rejection from upper band
    else if (close > current.upper && close < prevClose) {
      score = -config.weight;
      signal = 'SELL';
    }
    // Bearish reversal at upper band
    else if (close > current.upper) {
      score = -(config.weight / 2);
      signal = 'SELL';
    }
    // Walking bands
    else if (percentB > 0.8 && close > current.middle) {
      score = config.weight * 0.25;
      signal = 'BUY';
    }
    else if (percentB < 0.2 && close < current.middle) {
      score = -(config.weight * 0.25);
      signal = 'SELL';
    }

    return {
      upper: current.upper,
      middle: current.middle,
      lower: current.lower,
      percentB,
      score: Math.round(score),
      signal
    };
  }

  /**
   * Calculate Williams %R
   * Max Score: ±50 (highest weight - 87.5% win rate)
   */
  calculateWilliamsR(highs, lows, closes, period = 14, oversold = -80, overbought = -20) {
    if (closes.length < period) {
      return { value: -50, score: 0, signal: 'NEUTRAL' };
    }

    const willR = ti.WilliamsR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period
    });

    if (!willR.length) {
      return { value: -50, score: 0, signal: 'NEUTRAL' };
    }

    const current = willR[willR.length - 1];
    const prev = willR.length > 1 ? willR[willR.length - 2] : current;
    const config = this.indicatorConfig.WILLIAMS_R || { weight: 20, maxScore: 50 };

    let score = 0;
    let signal = 'NEUTRAL';

    // Bullish turning from oversold
    if (current <= oversold && current > prev) {
      score = config.weight * 1.25; // +25
      signal = 'BUY';
    }
    // Oversold condition
    else if (current <= oversold) {
      score = config.weight;
      signal = 'BUY';
    }
    // Bearish turning from overbought
    else if (current >= overbought && current < prev) {
      score = -(config.weight * 1.25); // -25
      signal = 'SELL';
    }
    // Overbought condition
    else if (current >= overbought) {
      score = -config.weight;
      signal = 'SELL';
    }

    return {
      value: current,
      score: Math.round(score),
      signal,
      prevValue: prev
    };
  }

  /**
   * Calculate Stochastic Oscillator
   * Max Score: ±36 (85.7% win rate)
   */
  calculateStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3, oversold = 20, overbought = 80) {
    if (closes.length < kPeriod + dPeriod) {
      return { k: 50, d: 50, score: 0, signal: 'NEUTRAL' };
    }

    const stoch = ti.Stochastic.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: kPeriod,
      signalPeriod: dPeriod
    });

    if (!stoch.length) {
      return { k: 50, d: 50, score: 0, signal: 'NEUTRAL' };
    }

    const current = stoch[stoch.length - 1];
    const prev = stoch.length > 1 ? stoch[stoch.length - 2] : current;
    const config = this.indicatorConfig.STOCHASTIC || { weight: 18 };

    let score = 0;
    let signal = 'NEUTRAL';

    // Bullish crossover in oversold zone
    if (current.k < oversold && current.k > current.d && prev.k <= prev.d) {
      score = config.weight;
      signal = 'BUY';
    }
    // Bearish crossover in overbought zone
    else if (current.k > overbought && current.k < current.d && prev.k >= prev.d) {
      score = -config.weight;
      signal = 'SELL';
    }
    // Oversold
    else if (current.k < oversold) {
      score = config.weight * 0.56;
      signal = 'BUY';
    }
    // Overbought
    else if (current.k > overbought) {
      score = -(config.weight * 0.56);
      signal = 'SELL';
    }

    return { k: current.k, d: current.d, score: Math.round(score), signal };
  }

  /**
   * Calculate EMA Trend
   * Max Score: ±38
   */
  calculateEMATrend(closes, shortPeriod = 10, mediumPeriod = 25, longPeriod = 50) {
    if (closes.length < longPeriod) {
      return { short: 0, medium: 0, long: 0, score: 0, signal: 'NEUTRAL' };
    }

    const shortEma = ti.EMA.calculate({ values: closes, period: shortPeriod });
    const mediumEma = ti.EMA.calculate({ values: closes, period: mediumPeriod });
    const longEma = ti.EMA.calculate({ values: closes, period: longPeriod });

    if (!shortEma.length || !mediumEma.length || !longEma.length) {
      return { short: 0, medium: 0, long: 0, score: 0, signal: 'NEUTRAL' };
    }

    const short = shortEma[shortEma.length - 1];
    const medium = mediumEma[mediumEma.length - 1];
    const long = longEma[longEma.length - 1];
    const prevShort = shortEma.length > 1 ? shortEma[shortEma.length - 2] : short;
    const prevLong = longEma.length > 1 ? longEma[longEma.length - 2] : long;
    const close = closes[closes.length - 1];
    const config = this.indicatorConfig.EMA_TREND || { weight: 19 };

    let score = 0;
    let signal = 'NEUTRAL';

    // Golden Cross
    if (short > long && prevShort <= prevLong) {
      score = config.weight * 1.05; // ~20
      signal = 'BUY';
    }
    // Death Cross
    else if (short < long && prevShort >= prevLong) {
      score = -(config.weight * 1.05); // ~-20
      signal = 'SELL';
    }
    // Bullish aligned (short > medium > long)
    else if (short > medium && medium > long) {
      score = config.weight * 0.79; // ~15
      signal = 'BUY';
    }
    // Bearish aligned (short < medium < long)
    else if (short < medium && medium < long) {
      score = -(config.weight * 0.79);
      signal = 'SELL';
    }
    // Price above long EMA
    else if (close > long) {
      score = config.weight * 0.26; // ~5
      signal = 'BUY';
    }
    // Price below long EMA
    else if (close < long) {
      score = -(config.weight * 0.26);
      signal = 'SELL';
    }

    return { short, medium, long, score: Math.round(score), signal };
  }

  /**
   * Calculate Awesome Oscillator
   * Max Score: ±34
   */
  calculateAwesomeOscillator(highs, lows) {
    if (highs.length < 34 || lows.length < 34) {
      return { value: 0, score: 0, signal: 'NEUTRAL' };
    }

    const ao = ti.AwesomeOscillator.calculate({
      high: highs,
      low: lows,
      fastPeriod: 5,
      slowPeriod: 34
    });

    if (!ao.length) {
      return { value: 0, score: 0, signal: 'NEUTRAL' };
    }

    const current = ao[ao.length - 1];
    const prev = ao.length > 1 ? ao[ao.length - 2] : current;
    const prevPrev = ao.length > 2 ? ao[ao.length - 3] : prev;
    const config = this.indicatorConfig.AWESOME_OSCILLATOR || { weight: 17 };

    let score = 0;
    let signal = 'NEUTRAL';

    // Zero-line bullish cross
    if (current > 0 && prev <= 0) {
      score = config.weight;
      signal = 'BUY';
    }
    // Zero-line bearish cross
    else if (current < 0 && prev >= 0) {
      score = -config.weight;
      signal = 'SELL';
    }
    // Bullish saucer (AO > 0, was falling, now rising)
    else if (current > 0 && prev < prevPrev && current > prev) {
      score = config.weight * 0.71; // ~12
      signal = 'BUY';
    }
    // Bearish saucer (AO < 0, was rising, now falling)
    else if (current < 0 && prev > prevPrev && current < prev) {
      score = -(config.weight * 0.71);
      signal = 'SELL';
    }
    // AO positive
    else if (current > 0) {
      score = config.weight * 0.29; // ~5
      signal = 'BUY';
    }
    // AO negative
    else if (current < 0) {
      score = -(config.weight * 0.29);
      signal = 'SELL';
    }

    return { value: current, score: Math.round(score), signal };
  }

  /**
   * Calculate KDJ Indicator
   * Max Score: ±34 (66.7% win rate)
   */
  calculateKDJ(highs, lows, closes, period = 9, kSmooth = 3, dSmooth = 3) {
    if (closes.length < period + Math.max(kSmooth, dSmooth)) {
      return { k: 50, d: 50, j: 50, score: 0, signal: 'NEUTRAL' };
    }

    // Calculate RSV first
    const rsvValues = [];
    for (let i = period - 1; i < closes.length; i++) {
      const periodHighs = highs.slice(i - period + 1, i + 1);
      const periodLows = lows.slice(i - period + 1, i + 1);
      const highestHigh = Math.max(...periodHighs);
      const lowestLow = Math.min(...periodLows);
      const rsv = highestHigh === lowestLow ? 50 : 
        ((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100;
      rsvValues.push(rsv);
    }

    // Calculate K (smoothed RSV)
    const kValues = [];
    let prevK = 50;
    for (const rsv of rsvValues) {
      const k = (2 / 3) * prevK + (1 / 3) * rsv;
      kValues.push(k);
      prevK = k;
    }

    // Calculate D (smoothed K)
    const dValues = [];
    let prevD = 50;
    for (const k of kValues) {
      const d = (2 / 3) * prevD + (1 / 3) * k;
      dValues.push(d);
      prevD = d;
    }

    // Calculate J
    const jValues = kValues.map((k, i) => 3 * k - 2 * dValues[i]);

    const k = kValues[kValues.length - 1];
    const d = dValues[dValues.length - 1];
    const j = jValues[jValues.length - 1];
    const prevK2 = kValues.length > 1 ? kValues[kValues.length - 2] : k;
    const prevD2 = dValues.length > 1 ? dValues[dValues.length - 2] : d;
    const config = this.indicatorConfig.KDJ || { weight: 17 };

    let score = 0;
    let signal = 'NEUTRAL';

    // J-line extreme bullish
    if (j < 0) {
      score = config.weight;
      signal = 'BUY';
    }
    // J-line extreme bearish
    else if (j > 100) {
      score = -config.weight;
      signal = 'SELL';
    }
    // Bullish crossover (K crosses above D) in oversold zone
    else if (k > d && prevK2 <= prevD2 && k < 20) {
      score = config.weight * 0.88; // ~15
      signal = 'BUY';
    }
    // Bearish crossover (K crosses below D) in overbought zone
    else if (k < d && prevK2 >= prevD2 && k > 80) {
      score = -(config.weight * 0.88);
      signal = 'SELL';
    }
    // Oversold
    else if (k < 20) {
      score = config.weight * 0.59; // ~10
      signal = 'BUY';
    }
    // Overbought
    else if (k > 80) {
      score = -(config.weight * 0.59);
      signal = 'SELL';
    }

    return { k, d, j, score: Math.round(score), signal };
  }

  /**
   * Calculate OBV (On-Balance Volume)
   * Max Score: ±36
   */
  calculateOBV(closes, volumes, smaPeriod = 20) {
    if (closes.length < smaPeriod) {
      return { value: 0, sma: 0, score: 0, signal: 'NEUTRAL' };
    }

    const obv = ti.OBV.calculate({
      close: closes,
      volume: volumes
    });

    if (obv.length < smaPeriod) {
      return { value: 0, sma: 0, score: 0, signal: 'NEUTRAL' };
    }

    const obvSma = ti.SMA.calculate({
      values: obv,
      period: smaPeriod
    });

    const currentObv = obv[obv.length - 1];
    const prevObv = obv[obv.length - 2];
    const currentSma = obvSma[obvSma.length - 1];
    const close = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];
    const config = this.indicatorConfig.OBV || { weight: 18 };

    let score = 0;
    let signal = 'NEUTRAL';

    const priceRising = close > prevClose;
    const priceFalling = close < prevClose;
    const obvRising = currentObv > prevObv;
    const obvFalling = currentObv < prevObv;
    const obvAboveSma = currentObv > currentSma;
    const obvBelowSma = currentObv < currentSma;

    // Bullish confirmation
    if (priceRising && obvRising && obvAboveSma) {
      score = config.weight;
      signal = 'BUY';
    }
    // Bearish confirmation
    else if (priceFalling && obvFalling && obvBelowSma) {
      score = -config.weight;
      signal = 'SELL';
    }
    // Bullish divergence (price falling, OBV rising)
    else if (priceFalling && obvRising) {
      score = config.weight * 0.56; // ~10
      signal = 'BUY';
    }
    // Bearish divergence (price rising, OBV falling)
    else if (priceRising && obvFalling) {
      score = -(config.weight * 0.56);
      signal = 'SELL';
    }

    return { value: currentObv, sma: currentSma, score: Math.round(score), signal };
  }

  /**
   * Calculate CMF (Chaikin Money Flow)
   * Max Score: ±38
   */
  calculateCMF(highs, lows, closes, volumes, period = 20) {
    if (closes.length < period) {
      return { value: 0, score: 0, signal: 'NEUTRAL' };
    }

    // Calculate Money Flow Multiplier and Money Flow Volume
    const mfv = [];
    for (let i = 0; i < closes.length; i++) {
      const high = highs[i];
      const low = lows[i];
      const close = closes[i];
      const volume = volumes[i];
      
      let mfm = 0;
      if (high !== low) {
        mfm = ((close - low) - (high - close)) / (high - low);
      }
      mfv.push(mfm * volume);
    }

    // Calculate CMF
    let cmfValues = [];
    for (let i = period - 1; i < closes.length; i++) {
      const sumMfv = mfv.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      const sumVol = volumes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      cmfValues.push(sumVol === 0 ? 0 : sumMfv / sumVol);
    }

    const current = cmfValues[cmfValues.length - 1];
    const prev = cmfValues.length > 1 ? cmfValues[cmfValues.length - 2] : current;
    const config = this.indicatorConfig.CMF || { weight: 19 };

    let score = 0;
    let signal = 'NEUTRAL';

    // Strong bullish (CMF > 0.1)
    if (current > 0.1) {
      score = config.weight;
      signal = 'BUY';
    }
    // Strong bearish (CMF < -0.1)
    else if (current < -0.1) {
      score = -config.weight;
      signal = 'SELL';
    }
    // Bullish (CMF > 0)
    else if (current > 0) {
      score = config.weight * 0.53; // ~10
      signal = 'BUY';
    }
    // Bearish (CMF < 0)
    else if (current < 0) {
      score = -(config.weight * 0.53);
      signal = 'SELL';
    }

    // Cross bonus
    if (current > 0 && prev <= 0) {
      score += 5; // Bullish cross bonus
    } else if (current < 0 && prev >= 0) {
      score -= 5; // Bearish cross bonus
    }

    return { value: current, score: Math.round(score), signal };
  }

  /**
   * Calculate ATR (Average True Range) for volatility
   * Max Score: ±30 (used for volatility regime)
   */
  calculateATR(highs, lows, closes, period = 14) {
    if (closes.length < period + 1) {
      return { value: 0, percent: 0, regime: 'MEDIUM', score: 0 };
    }

    const atr = ti.ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period
    });

    if (!atr.length) {
      return { value: 0, percent: 0, regime: 'MEDIUM', score: 0 };
    }

    const currentAtr = atr[atr.length - 1];
    const close = closes[closes.length - 1];
    const atrPercent = (currentAtr / close) * 100;
    const config = this.indicatorConfig.ATR || { weight: 15 };

    // Determine volatility regime
    let regime, score;
    if (atrPercent < 2) {
      regime = 'LOW';
      score = config.weight; // Favorable for trading
    } else if (atrPercent < 4) {
      regime = 'MEDIUM';
      score = config.weight / 3; // Normal
    } else {
      regime = 'HIGH';
      score = -config.weight; // High volatility risk
    }

    return { value: currentAtr, percent: atrPercent, regime, score: Math.round(score) };
  }

  /**
   * Calculate CCI (Commodity Channel Index)
   * Max Score: ±32
   */
  calculateCCI(highs, lows, closes, period = 20) {
    if (closes.length < period) {
      return { value: 0, score: 0, signal: 'NEUTRAL' };
    }

    const cci = ti.CCI.calculate({
      high: highs,
      low: lows,
      close: closes,
      period
    });

    if (!cci.length) {
      return { value: 0, score: 0, signal: 'NEUTRAL' };
    }

    const current = cci[cci.length - 1];
    const prev = cci.length > 1 ? cci[cci.length - 2] : current;
    const config = this.indicatorConfig.CCI || { weight: 16 };

    let score = 0;
    let signal = 'NEUTRAL';

    // Extreme oversold
    if (current < -200) {
      score = config.weight;
      signal = 'BUY';
    }
    // Oversold
    else if (current < -100) {
      score = config.weight * 0.625; // ~10
      signal = 'BUY';
    }
    // Extreme overbought
    else if (current > 200) {
      score = -config.weight;
      signal = 'SELL';
    }
    // Overbought
    else if (current > 100) {
      score = -(config.weight * 0.625);
      signal = 'SELL';
    }

    // Cross bonus
    if (current > 0 && prev <= 0) {
      score += 5; // Bullish zero-line cross
    } else if (current < 0 && prev >= 0) {
      score -= 5; // Bearish zero-line cross
    }

    return { value: current, score: Math.round(score), signal };
  }

  /**
   * Calculate DOM (Depth of Market) Analyzer
   * Max Score: ±30 (live only)
   */
  calculateDOM(orderBook) {
    if (!orderBook || !orderBook.bids || !orderBook.asks) {
      return { imbalance: 0, score: 0, signal: 'NEUTRAL' };
    }

    const config = this.indicatorConfig.DOM || { weight: 15 };

    // Calculate total bid/ask volumes
    const totalBidVolume = orderBook.bids.reduce((sum, [, vol]) => sum + parseFloat(vol), 0);
    const totalAskVolume = orderBook.asks.reduce((sum, [, vol]) => sum + parseFloat(vol), 0);
    const totalVolume = totalBidVolume + totalAskVolume;

    if (totalVolume === 0) {
      return { imbalance: 0, score: 0, signal: 'NEUTRAL' };
    }

    const imbalance = (totalBidVolume - totalAskVolume) / totalVolume;

    let score = 0;
    let signal = 'NEUTRAL';

    if (imbalance > 0.3) {
      score = config.weight;
      signal = 'BUY';
    } else if (imbalance > 0.1) {
      score = config.weight * 0.53; // ~8
      signal = 'BUY';
    } else if (imbalance < -0.3) {
      score = -config.weight;
      signal = 'SELL';
    } else if (imbalance < -0.1) {
      score = -(config.weight * 0.53);
      signal = 'SELL';
    }

    return { imbalance, totalBidVolume, totalAskVolume, score: Math.round(score), signal };
  }

  /**
   * Calculate all indicators and generate aggregated signal
   */
  calculateSignal(candles, orderBook = null) {
    if (!candles || candles.length < 50) {
      return {
        score: 0,
        classification: 'NEUTRAL',
        action: 'NO_ACTION',
        confidence: 0,
        indicators: {},
        timestamp: Date.now()
      };
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    // Calculate all indicators
    const indicators = {
      rsi: this.calculateRSI(closes),
      stochasticRsi: this.calculateStochasticRSI(closes),
      macd: this.calculateMACD(closes),
      bollingerBands: this.calculateBollingerBands(closes),
      williamsR: this.calculateWilliamsR(highs, lows, closes),
      stochastic: this.calculateStochastic(highs, lows, closes),
      emaTrend: this.calculateEMATrend(closes),
      awesomeOscillator: this.calculateAwesomeOscillator(highs, lows),
      kdj: this.calculateKDJ(highs, lows, closes),
      obv: this.calculateOBV(closes, volumes),
      cmf: this.calculateCMF(highs, lows, closes, volumes),
      atr: this.calculateATR(highs, lows, closes),
      cci: this.calculateCCI(highs, lows, closes)
    };

    // Add DOM analysis if order book available
    if (orderBook) {
      indicators.dom = this.calculateDOM(orderBook);
    }

    // Calculate total indicator score (capped at 200)
    let indicatorScore = Object.values(indicators)
      .filter(i => i.score !== undefined && i !== indicators.dom)
      .reduce((sum, i) => sum + i.score, 0);
    
    const caps = this.scoringConfig.caps || { indicator: 200, microstructure: 20, total: 220 };
    indicatorScore = Math.max(-caps.indicator, Math.min(caps.indicator, indicatorScore));

    // Add microstructure score (capped at 20)
    let microstructureScore = 0;
    if (indicators.dom) {
      microstructureScore = Math.max(-caps.microstructure, Math.min(caps.microstructure, indicators.dom.score));
    }

    // Total score (capped at 220)
    let totalScore = indicatorScore + microstructureScore;
    totalScore = Math.max(-caps.total, Math.min(caps.total, totalScore));

    // Classify signal
    const classification = this.classifySignal(totalScore);

    // Calculate confidence
    const confidence = this.calculateConfidence(indicators, totalScore);

    // Count bullish/bearish indicators for confluence
    const bullishCount = Object.values(indicators).filter(i => i.signal === 'BUY').length;
    const bearishCount = Object.values(indicators).filter(i => i.signal === 'SELL').length;
    const confluence = Math.max(bullishCount, bearishCount) / Object.keys(indicators).length;

    const signal = {
      score: totalScore,
      indicatorScore,
      microstructureScore,
      classification: classification.name,
      action: classification.action,
      confidence,
      confluence,
      bullishCount,
      bearishCount,
      indicators,
      timestamp: Date.now()
    };

    this.emit('signal', signal);
    return signal;
  }

  /**
   * Classify signal based on score
   */
  classifySignal(score) {
    for (const classification of this.classifications) {
      if (score >= classification.min && score <= classification.max) {
        return classification;
      }
    }
    return { name: 'NEUTRAL', action: 'NO_ACTION' };
  }

  /**
   * Calculate confidence score with penalties
   */
  calculateConfidence(indicators, score) {
    let confidence = 1.0;
    const penalties = this.config.confidencePenalties || {};

    // Weak score penalty
    if (Math.abs(score) < 60) {
      confidence -= penalties.weakScore?.penalty || 0.10;
    }

    // High volatility penalty
    if (indicators.atr && indicators.atr.percent > 6) {
      confidence -= penalties.highVolatility?.penalty || 0.06;
    } else if (indicators.atr && indicators.atr.percent > 4) {
      confidence -= penalties.mediumVolatility?.penalty || 0.03;
    }

    // Conflicting signals penalty
    const bullish = Object.values(indicators).filter(i => i.score > 0).length;
    const bearish = Object.values(indicators).filter(i => i.score < 0).length;
    if (bullish > 0 && bearish > 0) {
      const conflicts = Math.min(bullish, bearish);
      confidence -= conflicts * (penalties.conflictingSignals?.penaltyPerConflict || 0.02);
    }

    // Low confluence penalty
    const confluence = Math.max(bullish, bearish) / Object.keys(indicators).length;
    if (confluence < 0.6) {
      confidence -= penalties.lowConfluence?.penalty || 0.05;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Check if signal meets entry gate requirements
   */
  checkEntryGates(signal, accountDrawdown = 0) {
    const gates = this.config.entryGates || {};
    const threshold = gates.threshold || { minScore: 75 };
    const confluenceReq = gates.confluence || { minPercentage: 50, minCount: 4 };
    const confidenceReq = gates.confidence || { minConfidence: 0.85 };
    const drawdownLimit = gates.drawdown || { maxDrawdown: 0.03 };

    const checks = {
      scoreThreshold: Math.abs(signal.score) >= threshold.minScore,
      indicatorConfluence: Math.max(signal.bullishCount, signal.bearishCount) >= confluenceReq.minCount,
      confidenceLevel: signal.confidence >= confidenceReq.minConfidence,
      accountDrawdown: accountDrawdown < drawdownLimit.maxDrawdown
    };

    const allPassed = Object.values(checks).every(v => v);

    return { passed: allPassed, checks };
  }
}

export default SignalEngine;
