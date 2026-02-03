# Copilot Instructions for Miniature Enigma Screener

## Overview

This repository implements a **production-grade cryptocurrency coin screener** for KuCoin Futures perpetual contracts. It uses a sophisticated 10+ indicator technical analysis system with market microstructure analysis to identify optimal trading opportunities in real-time.

## Core Principles

### 1. Repository is the Single Source of Truth

**CRITICAL:** Always derive logic, indicators, constraints, and thresholds from the repository contents. Never invent parameters or use arbitrary defaults.

- **Configuration:** All indicator parameters, thresholds, and weights are defined in `STRATEGY_CONFIG.json`
- **Strategy Logic:** Defined in `strategy_10_indicator.md` and `coinscreener.md`
- **Architecture:** Documented in `MINIATURE_ENIGMA_V6_ARCHITECTURE.md`
- **Technical Reference:** See `MINIATURE_ENIGMA_TECH_REFERENCE.md`

### 2. Make Minimal, Surgical Changes

- Only modify what's necessary to address the specific issue
- Don't refactor working code unless explicitly required
- Preserve existing functionality and architecture
- Add new features incrementally with proper testing

### 3. Deterministic and Explainable

Every signal, classification, and decision must be:
- **Deterministic:** Same inputs produce same outputs
- **Explainable:** Clear logic trail from indicators to signals
- **Traceable:** Documented assumptions and derivations
- **Safe:** Ready for automated trading systems

## Technical Stack

### Backend
- **Node.js** - REST/WebSocket API (Fastify framework)
- **Python** - Signal processing and indicator calculations
- **Rust** - Low-latency execution engine

### Frontend
- **React 18 + TypeScript** - Trading dashboard
- **TradingView Lightweight Charts** - Charting library

### Data Storage
- **PostgreSQL 16** - Orders, positions, users
- **TimescaleDB** - Time-series OHLCV data
- **Redis 7** - Caching, pub/sub, rate limiting
- **InfluxDB/Prometheus** - Metrics and monitoring

### Infrastructure
- Docker + Docker Compose
- Kubernetes (optional)
- GitHub Actions (CI/CD)

## Core Components

### 1. Indicator System

**14 Technical Indicators with Precise Configurations:**

From `STRATEGY_CONFIG.json`, all indicators have:
- **Weights:** Contribution to total signal score (-220 to +220 range)
- **Timeframe-specific parameters:** Different settings for 5m, 15m, 30m, 1h, 2h, 4h
- **Signal thresholds:** Oversold/overbought levels per indicator
- **Scoring logic:** How each indicator contributes to the final score

**Primary Indicators (by weight):**
1. **Williams %R** (weight: 20, max score: 50, win rate: 87.5%)
2. **Stochastic RSI** (weight: 20, max score: 40)
3. **Bollinger Bands** (weight: 20, max score: 40)
4. **EMA Trend** (weight: 19, max score: 38)
5. **CMF** (weight: 19, max score: 38)
6. **MACD** (weight: 18, max score: 36)
7. **Stochastic** (weight: 18, max score: 36, win rate: 85.7%)
8. **OBV** (weight: 18, max score: 36)
9. **RSI** (weight: 17, max score: 34)
10. **Awesome Oscillator** (weight: 17, max score: 34)
11. **KDJ** (weight: 17, max score: 34, win rate: 66.7%)
12. **CCI** (weight: 16, max score: 32)
13. **ATR** (weight: 15, max score: 30)
14. **DOM** (weight: 15, max score: 30)

**Important:** Different indicators are enabled/disabled per timeframe. See `indicatorEnables` section in `STRATEGY_CONFIG.json`.

### 2. Signal Classification System

**9-Level Signal Classification** (from `STRATEGY_CONFIG.json`):

| Classification | Score Range | Action |
|---------------|-------------|--------|
| EXTREME_BUY | 130 to 220 | STRONG_LONG |
| STRONG_BUY | 95 to 129 | LONG |
| BUY | 65 to 94 | MODERATE_LONG |
| BUY_WEAK | 40 to 64 | WEAK_LONG |
| NEUTRAL | -39 to 39 | NO_ACTION |
| SELL_WEAK | -64 to -40 | WEAK_SHORT |
| SELL | -94 to -65 | MODERATE_SHORT |
| STRONG_SELL | -129 to -95 | SHORT |
| EXTREME_SELL | -220 to -130 | STRONG_SHORT |

**For Screener:** Only STRONG_SIGNAL and VERY_STRONG_SIGNAL are valid outputs:
- **VERY_STRONG_SIGNAL:** Score ≥ 100 (EXTREME_BUY/EXTREME_SELL) or ≥ 90 (STRONG_BUY/STRONG_SELL)
- **STRONG_SIGNAL:** Score ≥ 75 with confluence ≥ 4 indicators

### 3. Entry Gate Requirements

**7 Entry Gates** (all must pass for valid signal):

From `entryGates` in `STRATEGY_CONFIG.json`:
1. **Score Threshold:** `score >= 75` (minimum for STRONG_SIGNAL)
2. **Indicator Confluence:** At least 4 indicators must confirm (≥50% agreement)
3. **Confidence:** `confidence >= 0.85`
4. **Trend Alignment:** Multi-timeframe alignment required
5. **Drawdown Check:** Account drawdown < 3% (`maxDrawdown: 0.03`)
6. **Spread Acceptable:** Bid-ask spread within limits
7. **Sufficient Liquidity:** Volume requirements met

### 4. Timeframe Alignment

From `timeframes` in `STRATEGY_CONFIG.json`:
- **Primary:** 30min
- **Secondary:** 2hour
- **Available:** 5min, 15min, 30min, 1hour, 2hour, 4hour
- **Alignment Requirements:**
  - Minimum 2 timeframes must agree
  - Maximum 4 timeframes checked
  - Block full alignment (avoid overfit)

### 5. Risk Management

From `riskManagement` in `STRATEGY_CONFIG.json`:

**Position Sizing:**
- Default: 2% of equity per position
- Max: 5% of equity
- Max open positions: 5

**Leverage:**
- Default: 6x
- Max: 10x
- Volatility-based adjustment enabled

**Stop Loss:**
- ROI: 6% (risk per trade)
- Hard limit: 10%
- Includes taker fees: 0.06%

**Take Profit:**
- ROI: 15%
- Partial exits at 4%, 8%, 12%

**Safety Features:**
- Daily drawdown limit: 3%
- Circuit breaker: Halt after 3 consecutive losses
- Liquidation buffer: 5% minimum equity buffer
- Break-even stop: Activates at 1% ROI
- Trailing stop: Activates at 2% ROI, trails at 1%

## Coding Standards

### General Principles

1. **Use Existing Utilities:** Never duplicate logic that already exists
2. **Follow Repo Style:** Match existing naming, formatting, and structure
3. **Error Handling:** Use Result pattern, handle errors gracefully
4. **Validation:** Validate all inputs before processing
5. **Documentation:** Inline comments for complex logic only
6. **No Secrets:** Never hardcode API keys or sensitive data

### File Organization

- **indicators/**: All technical indicator implementations
- **microstructure/**: Market microstructure analyzers (buy/sell ratio, funding rates, price ratios)
- **lib/**: Core libraries (SignalGenerator, OrderValidator, etc.)
- **screener/**: Coin ranking and filtering logic
- **optimizer/**: Paper trading and strategy optimization
- **backtest/**: Backtesting engine and performance metrics

### Naming Conventions

- **Classes:** PascalCase (e.g., `SignalGenerator`, `CoinRanker`)
- **Functions:** camelCase (e.g., `calculateScore`, `validateOrder`)
- **Constants:** UPPER_SNAKE_CASE (e.g., `MAX_LEVERAGE`, `MIN_VOLUME`)
- **Files:** PascalCase for classes, camelCase for utilities

### Indicator Implementation Pattern

When implementing or modifying indicators:

```javascript
class IndicatorName {
  constructor(config) {
    // Extract timeframe-specific params from STRATEGY_CONFIG.json
    this.params = config.indicators.INDICATOR_NAME.parameters[timeframe];
    this.weight = config.indicators.INDICATOR_NAME.weight;
    this.maxScore = config.indicators.INDICATOR_NAME.maxScore;
  }
  
  calculate(data) {
    // 1. Calculate indicator value
    // 2. Determine signal (bullish/bearish/neutral)
    // 3. Calculate score based on weight
    // 4. Return structured result
    return {
      value: indicatorValue,
      signal: 'BUY' | 'SELL' | 'NEUTRAL',
      score: calculatedScore,  // -maxScore to +maxScore
      confidence: confidenceLevel
    };
  }
}
```

### Signal Generation Pattern

```javascript
// Aggregate all indicators
const indicators = {
  rsi: await rsiIndicator.calculate(data),
  stochRsi: await stochRsiIndicator.calculate(data),
  // ... all enabled indicators for this timeframe
};

// Calculate total score
const totalScore = Object.values(indicators)
  .reduce((sum, ind) => sum + ind.score, 0);

// Apply caps
const cappedScore = Math.max(-220, Math.min(220, totalScore));

// Calculate confidence (based on indicator agreement)
const confidence = calculateConfidence(indicators);

// Classify signal
const classification = classifySignal(cappedScore);

// Check entry gates
const passesGates = checkEntryGates({
  score: cappedScore,
  confidence,
  indicators,
  marketData
});
```

## Screener Requirements

### Functional Requirements

The screener must:

1. **Scan all supported coins** defined in the repository
2. **Operate on correct timeframe(s)** from `STRATEGY_CONFIG.json`
3. **Recompute on each new candle** or data tick
4. **Evaluate entry-quality signals only** (not execution)
5. **Classify into 4 categories:**
   - `NO_SIGNAL` - Score < 75 or gates failed
   - `WEAK_SIGNAL` - Score 40-74
   - `STRONG_SIGNAL` - Score ≥ 75, all gates passed
   - `VERY_STRONG_SIGNAL` - Score ≥ 90-100, all gates passed

### Signal Logic (Non-Negotiable)

1. **Use Primary Trigger Indicator(s):** Williams %R (highest weight, 87.5% win rate) and Stochastic RSI
2. **Require Confluence:** All secondary indicators must confirm
3. **Respect Confirmation Windows:** Indicator alignment per candle offsets
4. **Reject Signals If:**
   - Any required indicator missing or invalid
   - Market data incomplete
   - Indicator state ambiguous
   - Any entry gate fails

### Output Format

```json
{
  "symbol": "BTCUSDT",
  "timeframe": "30min",
  "signal_strength": "STRONG_SIGNAL",
  "signal_classification": "STRONG_BUY",
  "score": 102.5,
  "trigger_indicator": "Williams %R",
  "confirmations": ["Stochastic RSI", "MACD", "Bollinger Bands", "EMA Trend"],
  "confluence_pct": 70,
  "confidence_score": 0.87,
  "entry_gates_passed": 7,
  "timestamp": "2026-02-03T11:08:10.202Z",
  "volatility_regime": "MEDIUM",
  "indicators": {
    "williams_r": { "value": -85, "signal": "BUY", "score": 25 },
    "stoch_rsi": { "value": 15, "signal": "BUY", "score": 20 }
    // ... all indicators
  }
}
```

### Performance Requirements

- Handle hundreds of symbols efficiently
- Avoid redundant indicator recomputation
- Cache intermediate results where possible
- Safe to run multiple times per minute
- Use async/concurrent logic if consistent with architecture

## Testing Requirements

### Before Making Changes

1. **Run existing linters and tests** to understand baseline
2. **Document any pre-existing failures** - you're not responsible for fixing them
3. **Only fix test failures related to your changes**

### After Making Changes

1. **Lint your code** using repository's linting tools
2. **Run targeted tests** for the areas you modified
3. **Add tests for new functionality** if test infrastructure exists
4. **Run full test suite** before finalizing

### Test Patterns

```javascript
describe('Indicator', () => {
  test('should calculate correct score range', () => {
    const result = indicator.calculate(testData);
    expect(result.score).toBeGreaterThanOrEqual(-maxScore);
    expect(result.score).toBeLessThanOrEqual(maxScore);
  });
  
  test('should respect STRATEGY_CONFIG parameters', () => {
    const params = config.indicators.INDICATOR_NAME.parameters['30min'];
    expect(indicator.params).toEqual(params);
  });
});
```

## Common Pitfalls to Avoid

1. **Don't Invent Parameters:** Always use `STRATEGY_CONFIG.json` values
2. **Don't Use Default Indicator Settings:** Each timeframe has specific parameters
3. **Don't Skip Entry Gates:** All 7 gates must be checked
4. **Don't Ignore Confidence Penalties:** Apply all penalties from `confidencePenalties`
5. **Don't Mix Timeframes:** Each signal is timeframe-specific
6. **Don't Execute Trades in Screener:** Screener identifies opportunities only
7. **Don't Bypass Validation:** Validate all inputs and outputs
8. **Don't Hardcode Values:** Use configuration files
9. **Don't Break Existing Tests:** Fix issues related to your changes only
10. **Don't Remove Safety Features:** Maintain all risk management constraints

## Integration Rules

1. **Reuse Existing Utilities:** Check for existing implementations first
2. **Follow Folder Conventions:** Place files in appropriate directories
3. **Match Coding Style:** Consistent with repository patterns
4. **No Broken Imports:** Ensure all imports resolve correctly
5. **No Unused Code:** Remove debug code and commented-out sections
6. **Document Assumptions:** If anything is unclear, document your reasoning

## Quality Bar

This is a **production-grade system** safe for automated trading:

✅ **Deterministic** - Same inputs always produce same outputs  
✅ **Explainable** - Clear logic from indicators to signals  
✅ **Aligned** - Fully consistent with strategy rules  
✅ **Safe** - All risk management constraints enforced  
✅ **Tested** - Comprehensive test coverage  
✅ **Documented** - Clear inline documentation for complex logic  
✅ **Performant** - Handles scale efficiently  
✅ **Maintainable** - Clear structure and conventions

## Key Documentation Files

Before making changes, read these in order:

1. **STRATEGY_CONFIG.json** - Complete indicator specification (read first!)
2. **strategy_10_indicator.md** - Strategy overview
3. **coinscreener.md** - Screener specification (189KB)
4. **MINIATURE_ENIGMA_V6_ARCHITECTURE.md** - System architecture
5. **MINIATURE_ENIGMA_TECH_REFERENCE.md** - Technical integration guide
6. **README.md** - Project overview and quick start

## When You're Uncertain

If repository contents are unclear:
1. **Infer conservatively** from existing patterns
2. **Document your assumption** in code comments
3. **Never guess silently** - make assumptions explicit
4. **Ask for clarification** if critical decision required

---

**Remember:** This screener will be wired into an automated trading system. Every decision must be defensible, traceable, and aligned with the repository's specifications. Quality and correctness are paramount.
