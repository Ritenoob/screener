/**
 * Miniature Enigma - KuCoin Futures Trading Bot
 * Main Entry Point
 */

import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import dotenv from 'dotenv';

import { createLogger } from './utils/logger.js';
import { KuCoinService } from './services/kucoin.js';
import { SignalEngine } from './services/signal-engine.js';
import { ScreenerEngine } from './services/screener.js';
import { RiskManager } from './services/risk-manager.js';
import { PaperTrader } from './services/paper-trader.js';
import { loadConfig } from './config/index.js';
import { setupRoutes } from './routes/index.js';
import { setupWebSocket } from './websocket/index.js';

dotenv.config();

const logger = createLogger('main');

async function buildServer() {
  const config = loadConfig();
  
  const fastify = Fastify({
    logger: {
      level: config.logLevel || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname'
        }
      }
    }
  });

  // Register plugins
  await fastify.register(fastifyCors, {
    origin: config.corsOrigin || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  });
  
  await fastify.register(fastifyWebsocket);

  // Initialize services
  const kucoinService = new KuCoinService(config.kucoin, logger);
  const signalEngine = new SignalEngine(config.strategy, logger);
  const screenerEngine = new ScreenerEngine(config.screener, signalEngine, kucoinService, logger);
  const riskManager = new RiskManager(config.risk, logger);
  const paperTrader = new PaperTrader(config.paperTrading, riskManager, logger);

  // Store services for route handlers
  fastify.decorate('services', {
    kucoin: kucoinService,
    signalEngine,
    screener: screenerEngine,
    riskManager,
    paperTrader,
    config
  });

  // Setup routes and WebSocket
  setupRoutes(fastify);
  setupWebSocket(fastify);

  // Graceful shutdown handler
  const shutdown = async () => {
    logger.info('Shutting down gracefully...');
    await screenerEngine.stop();
    await kucoinService.disconnect();
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return fastify;
}

async function start() {
  try {
    const server = await buildServer();
    const port = process.env.PORT || 3000;
    const host = process.env.HOST || '0.0.0.0';
    
    await server.listen({ port, host });
    logger.info(`🚀 Miniature Enigma running at http://${host}:${port}`);
    logger.info('📊 Dashboard available at http://localhost:3000');
    logger.info('🔌 WebSocket endpoint at ws://localhost:3000/ws');
    
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
