import { useState, useEffect, useRef } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function App() {
  const [connected, setConnected] = useState(false)
  const [latency, setLatency] = useState(0)
  const [account, setAccount] = useState({
    balance: 10000,
    equity: 10000,
    margin: 0,
    freeMargin: 10000,
    profit: 0
  })
  const [positions, setPositions] = useState([])
  const [opportunities, setOpportunities] = useState([])
  const [risk, setRisk] = useState({})
  const [profitHistory, setProfitHistory] = useState([])
  const ws = useRef(null)
  const intervalRef = useRef(null)

  useEffect(() => {
    connectWebSocket()
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (ws.current) ws.current.close()
    }
  }, [])

  const connectWebSocket = () => {
    const wsUrl = window.location.hostname === 'localhost' 
      ? 'ws://localhost:3000/ws'
      : `ws://${window.location.host}/ws`
    
    ws.current = new WebSocket(wsUrl)

    ws.current.onopen = () => {
      setConnected(true)
      // Clear any existing interval
      if (intervalRef.current) clearInterval(intervalRef.current)
      // Request state periodically
      intervalRef.current = setInterval(() => {
        if (ws.current?.readyState === WebSocket.OPEN) {
          const start = Date.now()
          ws.current.send(JSON.stringify({ action: 'GET_STATE', timestamp: start }))
        }
      }, 2000)
    }

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data)
      
      if (data.timestamp) {
        setLatency(Date.now() - data.timestamp)
      }

      switch (data.type) {
        case 'INITIAL_STATE':
        case 'STATUS_UPDATE':
          if (data.data.account) setAccount(data.data.account)
          if (data.data.risk) setRisk(data.data.risk)
          break
        case 'STATE':
          if (data.data.account) {
            setAccount(data.data.account)
            setProfitHistory(prev => {
              const newHistory = [...prev, {
                time: new Date().toLocaleTimeString(),
                profit: data.data.account.profit
              }]
              return newHistory.slice(-30)
            })
          }
          if (data.data.positions) setPositions(data.data.positions)
          break
        case 'OPPORTUNITIES':
          setOpportunities(data.data || [])
          break
        case 'ACCOUNT_UPDATE':
          setAccount(data.data)
          break
        case 'POSITION_OPENED':
        case 'POSITION_CLOSED':
          // Refresh positions
          ws.current.send(JSON.stringify({ action: 'GET_STATE' }))
          break
      }
    }

    ws.current.onclose = () => {
      setConnected(false)
      setTimeout(connectWebSocket, 3000)
    }

    ws.current.onerror = () => {
      setConnected(false)
    }
  }

  const sendCommand = (action, params = {}) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ action, ...params }))
    }
  }

  const startScreener = () => sendCommand('START_SCREENER')
  const stopScreener = () => sendCommand('STOP_SCREENER')
  const scanNow = () => sendCommand('SCAN')
  const resetAccount = () => sendCommand('RESET_ACCOUNT')

  const closePosition = (positionId, price) => {
    sendCommand('CLOSE_POSITION', { params: { positionId, price } })
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">🤖 Miniature Enigma</h1>
          <p className="text-gray-400">KuCoin Futures Screener Bot</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-sm text-gray-400">Latency</div>
            <div className={`text-lg font-mono ${latency < 50 ? 'text-green-500' : 'text-yellow-500'}`}>
              {latency}ms
            </div>
          </div>
          <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Account Info */}
        <div className="border-2 border-blue-500 rounded-lg p-6 bg-blue-500/10">
          <h2 className="text-xl font-bold mb-4">💰 Account</h2>
          <div className="space-y-3">
            <div>
              <div className="text-gray-400 text-sm">Balance</div>
              <div className="text-2xl font-bold">${account.balance?.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-gray-400 text-sm">Equity</div>
              <div className="text-xl font-bold">${account.equity?.toFixed(2)}</div>
            </div>
            <div className="flex justify-between text-sm">
              <div>
                <div className="text-gray-400">Margin</div>
                <div className="font-mono">${account.margin?.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-gray-400">Free Margin</div>
                <div className="font-mono">${account.freeMargin?.toFixed(2)}</div>
              </div>
            </div>
            <div className="pt-3 border-t border-gray-700">
              <div className="text-gray-400 text-sm">P&L</div>
              <div className={`text-2xl font-bold ${account.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {account.profit >= 0 ? '+' : ''}{account.profit?.toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        {/* Risk Status */}
        <div className="border-2 border-purple-500 rounded-lg p-6 bg-purple-500/10">
          <h2 className="text-xl font-bold mb-4">🛡️ Risk Status</h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-400">Daily Drawdown</span>
              <span className={`font-mono ${(risk.dailyDrawdown || 0) > 0.02 ? 'text-red-500' : 'text-green-500'}`}>
                {((risk.dailyDrawdown || 0) * 100).toFixed(2)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Open Positions</span>
              <span className="font-mono">{risk.openPositions || 0} / {risk.maxOpenPositions || 5}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Consecutive Losses</span>
              <span className={`font-mono ${(risk.consecutiveLosses || 0) >= 2 ? 'text-yellow-500' : 'text-green-500'}`}>
                {risk.consecutiveLosses || 0} / {risk.circuitBreakerThreshold || 3}
              </span>
            </div>
            <div className="pt-3 border-t border-gray-700">
              <div className={`text-center py-2 rounded ${risk.circuitBreakerTriggered ? 'bg-red-500/30 text-red-400' : 'bg-green-500/30 text-green-400'}`}>
                {risk.circuitBreakerTriggered ? '🚨 CIRCUIT BREAKER ACTIVE' : '✅ Trading Active'}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="border-2 border-orange-500 rounded-lg p-6 bg-orange-500/10">
          <h2 className="text-xl font-bold mb-4">⚡ Controls</h2>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={startScreener}
                className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded transition"
              >
                ▶ Start
              </button>
              <button
                onClick={stopScreener}
                className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded transition"
              >
                ⏹ Stop
              </button>
            </div>
            <button
              onClick={scanNow}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded transition"
            >
              🔍 Scan Now
            </button>
            <button
              onClick={resetAccount}
              className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 rounded transition"
            >
              🔄 Reset Account
            </button>
          </div>
          <div className="mt-4 p-3 bg-yellow-500/20 border border-yellow-500 rounded text-xs">
            <div className="text-yellow-500 font-bold mb-1">⚠️ Paper Trading Mode</div>
            <div className="text-gray-300">Using simulated funds for testing.</div>
          </div>
        </div>
      </div>

      {/* Profit Chart */}
      <div className="border-2 border-gray-700 rounded-lg p-6 bg-gray-800/50 mb-6">
        <h2 className="text-xl font-bold mb-4">📈 Profit History</h2>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={profitHistory}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="time" stroke="#9CA3AF" fontSize={12} />
            <YAxis stroke="#9CA3AF" fontSize={12} />
            <Tooltip
              contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151' }}
              labelStyle={{ color: '#9CA3AF' }}
            />
            <Line
              type="monotone"
              dataKey="profit"
              stroke="#10B981"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Opportunities */}
      <div className="border-2 border-gray-700 rounded-lg p-6 bg-gray-800/50 mb-6">
        <h2 className="text-xl font-bold mb-4">🎯 Trading Opportunities ({opportunities.length})</h2>
        {opportunities.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            No opportunities found. Click "Scan Now" to search.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-2">Symbol</th>
                  <th className="text-right py-2">Score</th>
                  <th className="text-left py-2">Signal</th>
                  <th className="text-right py-2">Confidence</th>
                  <th className="text-right py-2">Rank</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.slice(0, 10).map((opp, idx) => (
                  <tr key={idx} className="border-b border-gray-800 hover:bg-gray-700/50">
                    <td className="py-3 font-mono font-bold">{opp.symbol}</td>
                    <td className={`py-3 text-right font-mono ${opp.signal?.score >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {opp.signal?.score}
                    </td>
                    <td className="py-3">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                        opp.signal?.classification?.includes('BUY') ? 'bg-green-500/30 text-green-400' :
                        opp.signal?.classification?.includes('SELL') ? 'bg-red-500/30 text-red-400' :
                        'bg-gray-500/30 text-gray-400'
                      }`}>
                        {opp.signal?.classification}
                      </span>
                    </td>
                    <td className="py-3 text-right font-mono">
                      {((opp.signal?.confidence || 0) * 100).toFixed(0)}%
                    </td>
                    <td className="py-3 text-right font-mono text-yellow-400">
                      {opp.rank?.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Open Positions */}
      <div className="border-2 border-gray-700 rounded-lg p-6 bg-gray-800/50">
        <h2 className="text-xl font-bold mb-4">📋 Open Positions ({positions.length})</h2>
        {positions.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            No open positions
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-2">Symbol</th>
                  <th className="text-left py-2">Side</th>
                  <th className="text-right py-2">Entry</th>
                  <th className="text-right py-2">Current</th>
                  <th className="text-right py-2">SL</th>
                  <th className="text-right py-2">TP</th>
                  <th className="text-right py-2">P&L</th>
                  <th className="text-right py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => (
                  <tr key={pos.id} className="border-b border-gray-800 hover:bg-gray-700/50">
                    <td className="py-3 font-mono">{pos.symbol}</td>
                    <td className={`py-3 font-bold ${pos.side === 'LONG' ? 'text-green-500' : 'text-red-500'}`}>
                      {pos.side}
                    </td>
                    <td className="py-3 text-right font-mono">{pos.entryPrice?.toFixed(4)}</td>
                    <td className="py-3 text-right font-mono">{pos.currentPrice?.toFixed(4)}</td>
                    <td className="py-3 text-right font-mono text-red-400">{pos.stopLoss?.toFixed(4)}</td>
                    <td className="py-3 text-right font-mono text-green-400">{pos.takeProfit?.toFixed(4)}</td>
                    <td className={`py-3 text-right font-mono font-bold ${pos.unrealizedPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {pos.unrealizedPnL >= 0 ? '+' : ''}{pos.unrealizedPnL?.toFixed(2)}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => closePosition(pos.id, pos.currentPrice)}
                        className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-xs"
                      >
                        Close
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
