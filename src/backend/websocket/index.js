/**
 * WebSocket Handler for Real-time Updates
 */

export function setupWebSocket(fastify) {
  const { services } = fastify;
  const clients = new Set();

  // WebSocket route
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    fastify.log.info('WebSocket client connected');
    clients.add(socket);

    // Send initial state
    const initialState = {
      type: 'INITIAL_STATE',
      data: {
        status: services.screener.getStatus(),
        account: services.paperTrader.getState(),
        opportunities: services.screener.getOpportunities(),
        risk: services.riskManager.getStatus()
      },
      timestamp: Date.now()
    };
    socket.send(JSON.stringify(initialState));

    // Handle incoming messages
    socket.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        await handleClientMessage(socket, data, services);
      } catch (err) {
        socket.send(JSON.stringify({
          type: 'ERROR',
          error: err.message
        }));
      }
    });

    // Handle disconnect
    socket.on('close', () => {
      fastify.log.info('WebSocket client disconnected');
      clients.delete(socket);
    });

    socket.on('error', (err) => {
      fastify.log.error('WebSocket error:', err);
      clients.delete(socket);
    });
  });

  // Broadcast to all clients
  function broadcast(message) {
    const data = JSON.stringify(message);
    for (const client of clients) {
      try {
        client.send(data);
      } catch (err) {
        clients.delete(client);
      }
    }
  }

  // Subscribe to service events
  services.screener.on('opportunities', (opportunities) => {
    broadcast({
      type: 'OPPORTUNITIES',
      data: opportunities,
      timestamp: Date.now()
    });
  });

  services.screener.on('started', () => {
    broadcast({
      type: 'SCREENER_STARTED',
      timestamp: Date.now()
    });
  });

  services.screener.on('stopped', () => {
    broadcast({
      type: 'SCREENER_STOPPED',
      timestamp: Date.now()
    });
  });

  services.signalEngine.on('signal', (signal) => {
    broadcast({
      type: 'SIGNAL',
      data: signal,
      timestamp: Date.now()
    });
  });

  services.paperTrader.on('positionOpened', (position) => {
    broadcast({
      type: 'POSITION_OPENED',
      data: position,
      timestamp: Date.now()
    });
  });

  services.paperTrader.on('positionClosed', ({ position, trade }) => {
    broadcast({
      type: 'POSITION_CLOSED',
      data: { position, trade },
      timestamp: Date.now()
    });
  });

  services.paperTrader.on('update', (state) => {
    broadcast({
      type: 'ACCOUNT_UPDATE',
      data: state,
      timestamp: Date.now()
    });
  });

  services.riskManager.on('circuitBreaker', (data) => {
    broadcast({
      type: 'CIRCUIT_BREAKER',
      data,
      timestamp: Date.now()
    });
  });

  services.riskManager.on('tradeRecorded', (data) => {
    broadcast({
      type: 'TRADE_RECORDED',
      data,
      timestamp: Date.now()
    });
  });

  // Periodic status updates
  setInterval(() => {
    if (clients.size > 0) {
      broadcast({
        type: 'STATUS_UPDATE',
        data: {
          screener: services.screener.getStatus(),
          account: services.paperTrader.getState(),
          risk: services.riskManager.getStatus()
        },
        timestamp: Date.now()
      });
    }
  }, 5000);

  fastify.log.info('WebSocket handler registered');
}

/**
 * Handle incoming client messages
 */
async function handleClientMessage(socket, data, services) {
  const { action, params } = data;

  switch (action) {
    case 'GET_STATE':
      socket.send(JSON.stringify({
        type: 'STATE',
        data: {
          signal: services.screener.getOpportunities()[0]?.signal || null,
          account: services.paperTrader.getState(),
          positions: services.paperTrader.getState().positions
        },
        timestamp: data.timestamp || Date.now()
      }));
      break;

    case 'GET_OPPORTUNITIES':
      socket.send(JSON.stringify({
        type: 'OPPORTUNITIES',
        data: services.screener.getOpportunities(),
        timestamp: Date.now()
      }));
      break;

    case 'BUY':
    case 'SELL':
      if (!params?.symbol) {
        socket.send(JSON.stringify({
          type: 'ERROR',
          error: 'Symbol required'
        }));
        return;
      }

      const symbolData = services.screener.getSymbols().find(s => s.symbol === params.symbol);
      if (!symbolData) {
        socket.send(JSON.stringify({
          type: 'ERROR',
          error: `Symbol ${params.symbol} not found`
        }));
        return;
      }

      const signal = symbolData.signal || {
        score: action === 'BUY' ? 75 : -75,
        classification: action,
        confidence: 0.85,
        bullishCount: 5,
        bearishCount: 2,
        indicators: {}
      };

      const side = action === 'BUY' ? 'LONG' : 'SHORT';
      const result = await services.paperTrader.executeMarketOrder(
        params.symbol,
        side,
        signal,
        params.price || symbolData.price || 0
      );

      socket.send(JSON.stringify({
        type: 'TRADE_RESULT',
        data: result,
        timestamp: Date.now()
      }));
      break;

    case 'CLOSE_POSITION':
      if (!params?.positionId) {
        socket.send(JSON.stringify({
          type: 'ERROR',
          error: 'Position ID required'
        }));
        return;
      }

      const closeResult = await services.paperTrader.closePosition(
        params.positionId,
        params.price,
        'manual'
      );

      socket.send(JSON.stringify({
        type: 'CLOSE_RESULT',
        data: closeResult,
        timestamp: Date.now()
      }));
      break;

    case 'START_SCREENER':
      await services.screener.start();
      socket.send(JSON.stringify({
        type: 'SCREENER_STARTED',
        timestamp: Date.now()
      }));
      break;

    case 'STOP_SCREENER':
      await services.screener.stop();
      socket.send(JSON.stringify({
        type: 'SCREENER_STOPPED',
        timestamp: Date.now()
      }));
      break;

    case 'SCAN':
      const opportunities = await services.screener.scanOpportunities();
      socket.send(JSON.stringify({
        type: 'SCAN_RESULT',
        data: opportunities,
        timestamp: Date.now()
      }));
      break;

    case 'RESET_ACCOUNT':
      services.paperTrader.reset();
      socket.send(JSON.stringify({
        type: 'ACCOUNT_RESET',
        data: services.paperTrader.getState(),
        timestamp: Date.now()
      }));
      break;

    default:
      socket.send(JSON.stringify({
        type: 'ERROR',
        error: `Unknown action: ${action}`
      }));
  }
}

export default setupWebSocket;
