/**
 * KuCoin Futures API Service
 * Handles WebSocket connections and REST API calls to KuCoin
 */

import WebSocket from 'ws';
import crypto from 'crypto';
import { EventEmitter } from 'events';

export class KuCoinService extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.ws = null;
    this.wsConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
    this.subscriptions = new Set();
    this.marketData = new Map();
    this.orderBooks = new Map();
    this.pingInterval = null;
    this.tokenData = null;
  }

  /**
   * Sign API request
   */
  sign(timestamp, method, endpoint, body = '') {
    const strToSign = `${timestamp}${method}${endpoint}${body}`;
    return crypto
      .createHmac('sha256', this.config.apiSecret)
      .update(strToSign)
      .digest('base64');
  }

  /**
   * Make authenticated REST API request
   */
  async apiRequest(method, endpoint, body = null) {
    const timestamp = Date.now();
    const bodyStr = body ? JSON.stringify(body) : '';
    const signature = this.sign(timestamp, method, endpoint, bodyStr);
    
    const headers = {
      'Content-Type': 'application/json',
      'KC-API-KEY': this.config.apiKey,
      'KC-API-SIGN': signature,
      'KC-API-TIMESTAMP': timestamp.toString(),
      'KC-API-PASSPHRASE': this.config.apiPassphrase,
      'KC-API-KEY-VERSION': '2'
    };

    try {
      const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
        method,
        headers,
        body: body ? bodyStr : undefined
      });
      
      const data = await response.json();
      
      if (data.code !== '200000') {
        throw new Error(`KuCoin API error: ${data.msg || 'Unknown error'}`);
      }
      
      return data.data;
    } catch (err) {
      this.logger.error(`API request failed: ${method} ${endpoint}`, err);
      throw err;
    }
  }

  /**
   * Get WebSocket token for public/private channels
   */
  async getWsToken(isPrivate = false) {
    const endpoint = isPrivate 
      ? '/api/v1/bullet-private' 
      : '/api/v1/bullet-public';
    
    try {
      // For public token, we don't need authentication
      if (!isPrivate) {
        const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (data.code === '200000') {
          return data.data;
        }
      } else {
        return await this.apiRequest('POST', endpoint);
      }
    } catch (err) {
      this.logger.error('Failed to get WebSocket token:', err);
      throw err;
    }
  }

  /**
   * Connect to KuCoin WebSocket
   */
  async connect() {
    try {
      this.tokenData = await this.getWsToken(false);
      const { token, instanceServers } = this.tokenData;
      const server = instanceServers[0];
      const wsUrl = `${server.endpoint}?token=${token}`;
      
      this.logger.info(`Connecting to KuCoin WebSocket: ${server.endpoint}`);
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => {
        this.wsConnected = true;
        this.reconnectAttempts = 0;
        this.logger.info('✅ Connected to KuCoin WebSocket');
        this.emit('connected');
        
        // Setup ping interval
        this.pingInterval = setInterval(() => {
          if (this.wsConnected) {
            this.ws.send(JSON.stringify({ id: Date.now(), type: 'ping' }));
          }
        }, server.pingInterval || 30000);
        
        // Resubscribe to previous topics
        this.resubscribe();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (err) {
          this.logger.error('Failed to parse WebSocket message:', err);
        }
      });

      this.ws.on('close', () => {
        this.wsConnected = false;
        this.logger.warn('WebSocket disconnected');
        this.emit('disconnected');
        clearInterval(this.pingInterval);
        this.attemptReconnect();
      });

      this.ws.on('error', (err) => {
        this.logger.error('WebSocket error:', err);
        this.emit('error', err);
      });

    } catch (err) {
      this.logger.error('Failed to connect to KuCoin:', err);
      this.attemptReconnect();
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(message) {
    const { type, topic, data, subject } = message;

    if (type === 'pong') {
      return; // Ping response
    }

    if (type === 'welcome') {
      this.logger.info('Received welcome message from KuCoin');
      return;
    }

    if (type === 'ack') {
      return; // Subscription acknowledgment
    }

    if (type === 'message') {
      if (topic && topic.includes('/contractMarket/ticker')) {
        this.handleTickerUpdate(data);
      } else if (topic && topic.includes('/contractMarket/level2')) {
        this.handleOrderBookUpdate(data, subject);
      } else if (topic && topic.includes('/contractMarket/execution')) {
        this.handleTradeUpdate(data);
      } else if (topic && topic.includes('/contract/instrument')) {
        this.handleInstrumentUpdate(data);
      }
    }
  }

  /**
   * Handle ticker price updates
   */
  handleTickerUpdate(data) {
    const symbol = data.symbol;
    if (!symbol) return;

    const ticker = {
      symbol,
      price: parseFloat(data.price) || 0,
      bestBid: parseFloat(data.bestBidPrice) || 0,
      bestAsk: parseFloat(data.bestAskPrice) || 0,
      volume24h: parseFloat(data.size24h) || 0,
      turnover24h: parseFloat(data.turnover24h) || 0,
      timestamp: data.ts || Date.now()
    };

    this.marketData.set(symbol, ticker);
    this.emit('ticker', ticker);
  }

  /**
   * Handle order book updates
   */
  handleOrderBookUpdate(data, subject) {
    if (!subject) return;
    const symbol = subject;
    
    // Initialize order book if not exists
    if (!this.orderBooks.has(symbol)) {
      this.orderBooks.set(symbol, { bids: [], asks: [], timestamp: 0 });
    }

    const book = this.orderBooks.get(symbol);
    book.bids = data.bids || book.bids;
    book.asks = data.asks || book.asks;
    book.timestamp = data.timestamp || Date.now();

    this.emit('orderbook', { symbol, ...book });
  }

  /**
   * Handle trade execution updates
   */
  handleTradeUpdate(data) {
    const trade = {
      symbol: data.symbol,
      side: data.side,
      price: parseFloat(data.price),
      size: parseFloat(data.size),
      timestamp: data.ts
    };
    this.emit('trade', trade);
  }

  /**
   * Handle instrument updates (funding rate, etc.)
   */
  handleInstrumentUpdate(data) {
    this.emit('instrument', data);
  }

  /**
   * Subscribe to market data channel
   */
  subscribe(topic) {
    if (!this.wsConnected) {
      this.subscriptions.add(topic);
      return;
    }

    const message = {
      id: Date.now(),
      type: 'subscribe',
      topic,
      response: true
    };

    this.ws.send(JSON.stringify(message));
    this.subscriptions.add(topic);
    this.logger.info(`Subscribed to: ${topic}`);
  }

  /**
   * Unsubscribe from channel
   */
  unsubscribe(topic) {
    if (!this.wsConnected) return;

    const message = {
      id: Date.now(),
      type: 'unsubscribe',
      topic,
      response: true
    };

    this.ws.send(JSON.stringify(message));
    this.subscriptions.delete(topic);
    this.logger.info(`Unsubscribed from: ${topic}`);
  }

  /**
   * Resubscribe to all channels after reconnect
   */
  resubscribe() {
    for (const topic of this.subscriptions) {
      this.subscribe(topic);
    }
  }

  /**
   * Subscribe to ticker for a symbol
   */
  subscribeTicker(symbol) {
    this.subscribe(`/contractMarket/ticker:${symbol}`);
  }

  /**
   * Subscribe to order book for a symbol
   */
  subscribeOrderBook(symbol, depth = 5) {
    this.subscribe(`/contractMarket/level2Depth${depth}:${symbol}`);
  }

  /**
   * Subscribe to trade executions
   */
  subscribeExecutions(symbol) {
    this.subscribe(`/contractMarket/execution:${symbol}`);
  }

  /**
   * Attempt to reconnect on disconnect
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error('Max reconnection attempts reached');
      this.emit('maxReconnectFailed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    
    this.logger.info(`Attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Get available futures contracts
   */
  async getContracts() {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/v1/contracts/active`);
      const data = await response.json();
      if (data.code === '200000') {
        return data.data;
      }
      throw new Error(data.msg);
    } catch (err) {
      this.logger.error('Failed to get contracts:', err);
      return [];
    }
  }

  /**
   * Get ticker for a symbol
   */
  async getTicker(symbol) {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/v1/ticker?symbol=${symbol}`);
      const data = await response.json();
      if (data.code === '200000') {
        return data.data;
      }
      throw new Error(data.msg);
    } catch (err) {
      this.logger.error(`Failed to get ticker for ${symbol}:`, err);
      return null;
    }
  }

  /**
   * Get OHLCV candles
   */
  async getCandles(symbol, granularity = 30, from = null, to = null) {
    try {
      let url = `${this.config.baseUrl}/api/v1/kline/query?symbol=${symbol}&granularity=${granularity}`;
      if (from) url += `&from=${from}`;
      if (to) url += `&to=${to}`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.code === '200000') {
        return data.data.map(candle => ({
          timestamp: candle[0],
          open: parseFloat(candle[1]),
          high: parseFloat(candle[2]),
          low: parseFloat(candle[3]),
          close: parseFloat(candle[4]),
          volume: parseFloat(candle[5])
        }));
      }
      throw new Error(data.msg);
    } catch (err) {
      this.logger.error(`Failed to get candles for ${symbol}:`, err);
      return [];
    }
  }

  /**
   * Get funding rate for a symbol
   */
  async getFundingRate(symbol) {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/v1/funding-rate/${symbol}/current`);
      const data = await response.json();
      if (data.code === '200000') {
        return data.data;
      }
      throw new Error(data.msg);
    } catch (err) {
      this.logger.error(`Failed to get funding rate for ${symbol}:`, err);
      return null;
    }
  }

  /**
   * Get current market data for a symbol
   */
  getMarketData(symbol) {
    return this.marketData.get(symbol);
  }

  /**
   * Get order book for a symbol
   */
  getOrderBook(symbol) {
    return this.orderBooks.get(symbol);
  }

  /**
   * Disconnect from WebSocket
   */
  async disconnect() {
    if (this.ws) {
      clearInterval(this.pingInterval);
      this.ws.close();
      this.wsConnected = false;
      this.logger.info('Disconnected from KuCoin WebSocket');
    }
  }
}

export default KuCoinService;
