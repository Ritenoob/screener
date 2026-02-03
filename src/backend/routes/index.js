/**
 * API Routes for Miniature Enigma
 */

export function setupRoutes(fastify) {
  const { services } = fastify;

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: Date.now() };
  });

  // Get system status
  fastify.get('/api/status', async () => {
    return {
      screener: services.screener.getStatus(),
      risk: services.riskManager.getStatus(),
      account: services.paperTrader.getState(),
      mode: services.config.mode,
      timestamp: Date.now()
    };
  });

  // Get current opportunities
  fastify.get('/api/opportunities', async () => {
    return {
      opportunities: services.screener.getOpportunities(),
      timestamp: Date.now()
    };
  });

  // Force scan opportunities
  fastify.post('/api/scan', async () => {
    const opportunities = await services.screener.scanOpportunities();
    return {
      opportunities,
      timestamp: Date.now()
    };
  });

  // Get signal for specific symbol
  fastify.get('/api/signal/:symbol', async (request) => {
    const { symbol } = request.params;
    
    try {
      const result = await services.screener.scanSymbol(symbol);
      return {
        ...result,
        timestamp: Date.now()
      };
    } catch (err) {
      return { error: err.message };
    }
  });

  // Get all tracked symbols
  fastify.get('/api/symbols', async () => {
    return {
      symbols: services.screener.getSymbols(),
      timestamp: Date.now()
    };
  });

  // Account endpoints
  fastify.get('/api/account', async () => {
    return {
      state: services.paperTrader.getState(),
      stats: services.paperTrader.getStats(),
      risk: services.riskManager.getStatus()
    };
  });

  // Get open positions
  fastify.get('/api/positions', async () => {
    const state = services.paperTrader.getState();
    return {
      positions: state.positions,
      count: state.openPositionCount
    };
  });

  // Get trade history
  fastify.get('/api/trades', async (request) => {
    const limit = parseInt(request.query.limit) || 100;
    return {
      trades: services.paperTrader.getTradeHistory(limit),
      stats: services.paperTrader.getStats()
    };
  });

  // Execute trade (paper trading)
  fastify.post('/api/trade', async (request) => {
    const { symbol, side, price } = request.body;

    if (!symbol || !side) {
      return { error: 'Missing required fields: symbol, side' };
    }

    // Get current signal for the symbol
    const symbolData = services.screener.getSymbols().find(s => s.symbol === symbol);
    if (!symbolData) {
      return { error: `Symbol ${symbol} not found` };
    }

    const signal = symbolData.signal || {
      score: side.toUpperCase() === 'BUY' ? 75 : -75,
      classification: side.toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
      confidence: 0.85,
      bullishCount: 5,
      bearishCount: 2,
      indicators: {}
    };

    const currentPrice = price || symbolData.price || 0;
    if (!currentPrice) {
      return { error: 'Unable to determine price' };
    }

    const positionSide = side.toUpperCase() === 'BUY' ? 'LONG' : 'SHORT';
    const result = await services.paperTrader.executeMarketOrder(
      symbol,
      positionSide,
      signal,
      currentPrice
    );

    return result;
  });

  // Close position
  fastify.post('/api/position/:id/close', async (request) => {
    const { id } = request.params;
    const { price } = request.body;

    const state = services.paperTrader.getState();
    const position = state.positions.find(p => p.id === id);
    
    if (!position) {
      return { error: 'Position not found' };
    }

    const currentPrice = price || position.currentPrice;
    const result = await services.paperTrader.closePosition(id, currentPrice, 'manual');

    return result;
  });

  // Close all positions
  fastify.post('/api/positions/close-all', async (request) => {
    const state = services.paperTrader.getState();
    const prices = {};
    
    for (const pos of state.positions) {
      prices[pos.symbol] = pos.currentPrice;
    }

    const results = await services.paperTrader.closeAllPositions(prices, 'close_all');
    return { results };
  });

  // Reset paper trading account
  fastify.post('/api/account/reset', async () => {
    services.paperTrader.reset();
    return { success: true, message: 'Account reset' };
  });

  // Get risk status
  fastify.get('/api/risk', async () => {
    return services.riskManager.getStatus();
  });

  // Reset circuit breaker
  fastify.post('/api/risk/reset-circuit-breaker', async () => {
    services.riskManager.resetCircuitBreaker();
    return { success: true, message: 'Circuit breaker reset' };
  });

  // Configuration endpoints
  fastify.get('/api/config', async () => {
    return {
      mode: services.config.mode,
      screener: services.config.screener,
      risk: services.config.risk,
      strategy: {
        scoring: services.config.strategy.scoring,
        timeframes: services.config.strategy.timeframes,
        entryGates: services.config.strategy.entryGates
      }
    };
  });

  // Start screener
  fastify.post('/api/screener/start', async () => {
    await services.screener.start();
    return { success: true, message: 'Screener started' };
  });

  // Stop screener
  fastify.post('/api/screener/stop', async () => {
    await services.screener.stop();
    return { success: true, message: 'Screener stopped' };
  });

  fastify.log.info('Routes registered');
}

export default setupRoutes;
