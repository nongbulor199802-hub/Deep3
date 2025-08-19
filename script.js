// Configuration
const FINNHUB_REST_URL = 'https://finnhub.io/api/v1';
const FINNHUB_WS_URL = 'wss://ws.finnhub.io';
const DEFAULT_SYMBOL = 'OANDA:XAU_USD';
const CANDLE_RESOLUTION = '1';
const HISTORY_DAYS = 5;
const MAX_CANDLES = 5000;

// DOM Elements
const apiKeyInput = document.getElementById('apiKey');
const symbolInput = document.getElementById('symbol');
const connectBtn = document.getElementById('connectBtn');
const statusSpan = document.getElementById('status');
const lastPriceSpan = document.getElementById('lastPrice');
const rsiValueSpan = document.getElementById('rsiValue');
const macdValueSpan = document.getElementById('macdValue');
const atrValueSpan = document.getElementById('atrValue');
const wsStatusSpan = document.getElementById('wsStatus');
const quarterlyLevelsDiv = document.getElementById('quarterlyLevels');
const ictZonesDiv = document.getElementById('ictZones');
const recommendationsDiv = document.getElementById('recommendations');
const exportBtn = document.getElementById('exportBtn');

// Chart setup
const chart = LightweightCharts.createChart(document.getElementById('chart'), {
    layout: {
        backgroundColor: '#2a2a3a',
        textColor: '#e0e0e0',
    },
    grid: {
        vertLines: {
            color: '#3a3a4a',
        },
        horzLines: {
            color: '#3a3a4a',
        },
    },
    crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
    },
    rightPriceScale: {
        borderColor: '#3a3a4a',
    },
    timeScale: {
        borderColor: '#3a3a4a',
        timeVisible: true,
        secondsVisible: false,
    },
});

const candleSeries = chart.addCandlestickSeries({
    upColor: '#4caf50',
    downColor: '#f44336',
    borderDownColor: '#f44336',
    borderUpColor: '#4caf50',
    wickDownColor: '#f44336',
    wickUpColor: '#4caf50',
});

// State
let apiKey = '';
let symbol = DEFAULT_SYMBOL;
let socket = null;
let isConnected = false;
let currentMinute = null;
let currentCandle = null;
let candles = [];
let lastPrice = 0;
let rsiValues = [];
let macdValues = [];
let atrValues = [];
let quarterlyLevels = [];
let ictZones = [];
let recommendations = [];

// Initialize from localStorage
function initFromStorage() {
    const savedApiKey = localStorage.getItem('finnhubApiKey');
    if (savedApiKey) {
        apiKeyInput.value = savedApiKey;
        apiKey = savedApiKey;
    }
    
    const savedSymbol = localStorage.getItem('symbol');
    if (savedSymbol) {
        symbolInput.value = savedSymbol;
        symbol = savedSymbol;
    }
}

// Connect to Finnhub
async function connect() {
    apiKey = apiKeyInput.value.trim();
    symbol = symbolInput.value.trim();
    
    if (!apiKey) {
        alert('Please enter your Finnhub API key');
        return;
    }
    
    if (!symbol) {
        alert('Please enter a symbol');
        return;
    }
    
    // Save to localStorage
    localStorage.setItem('finnhubApiKey', apiKey);
    localStorage.setItem('symbol', symbol);
    
    // Update UI
    connectBtn.disabled = true;
    statusSpan.textContent = 'Connecting...';
    statusSpan.style.color = '#ff9800';
    
    try {
        // Clear existing data
        candles = [];
        rsiValues = [];
        macdValues = [];
        atrValues = [];
        quarterlyLevels = [];
        ictZones = [];
        recommendations = [];
        
        // Load historical data
        await loadHistoricalData();
        
        // Connect to WebSocket
        connectWebSocket();
        
        isConnected = true;
        statusSpan.textContent = 'Connected';
        statusSpan.style.color = '#4caf50';
    } catch (error) {
        console.error('Connection error:', error);
        statusSpan.textContent = 'Connection failed';
        statusSpan.style.color = '#f44336';
        connectBtn.disabled = false;
    }
}

// Load historical data
async function loadHistoricalData() {
    statusSpan.textContent = 'Loading historical data...';
    
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - (HISTORY_DAYS * 24 * 60 * 60);
    
    const url = `${FINNHUB_REST_URL}/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${CANDLE_RESOLUTION}&from=${startTime}&to=${endTime}&token=${apiKey}`;
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.s !== 'ok') {
            throw new Error(data.error || 'Failed to load historical data');
        }
        
        // Process candles
        for (let i = 0; i < Math.min(data.t.length, MAX_CANDLES); i++) {
            const timestamp = data.t[i] * 1000;
            const candle = {
                time: timestamp,
                open: data.o[i],
                high: data.h[i],
                low: data.l[i],
                close: data.c[i],
                volume: data.v[i],
            };
            
            candles.push(candle);
            
            // Update indicators
            updateIndicators(candle);
            
            // Update quarterly levels
            updateQuarterlyLevels(candle);
            
            // Update ICT zones (every 5 candles to reduce noise)
            if (i % 5 === 0 && candles.length >= 3) {
                updateIctZones();
            }
        }
        
        // Update chart
        candleSeries.setData(candles);
        
        // Update recommendations
        updateRecommendations();
        
        // Set current minute
        if (candles.length > 0) {
            const lastCandle = candles[candles.length - 1];
            currentMinute = new Date(lastCandle.time);
            currentMinute.setSeconds(0, 0);
            
            // Initialize current candle for realtime updates
            currentCandle = {
                time: currentMinute.getTime(),
                open: lastCandle.close,
                high: lastCandle.close,
                low: lastCandle.close,
                close: lastCandle.close,
                volume: 0,
            };
        }
    } catch (error) {
        console.error('Error loading historical data:', error);
        throw error;
    }
}

// Connect to WebSocket
function connectWebSocket() {
    if (socket) {
        socket.close();
    }
    
    socket = new WebSocket(`${FINNHUB_WS_URL}?token=${apiKey}`);
    
    socket.onopen = () => {
        console.log('WebSocket connected');
        wsStatusSpan.textContent = 'Connected';
        wsStatusSpan.style.color = '#4caf50';
        
        // Subscribe to symbol
        socket.send(JSON.stringify({
            type: 'subscribe',
            symbol: symbol,
        }));
    };
    
    socket.onclose = () => {
        console.log('WebSocket disconnected');
        wsStatusSpan.textContent = 'Disconnected';
        wsStatusSpan.style.color = '#f44336';
        
        if (isConnected) {
            // Attempt to reconnect after 3 seconds
            setTimeout(connectWebSocket, 3000);
        }
    };
    
    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        wsStatusSpan.textContent = 'Error';
        wsStatusSpan.style.color = '#f44336';
    };
    
    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'trade') {
            processTrades(data.data);
        } else if (data.type === 'error') {
            console.error('WebSocket error:', data.msg);
            wsStatusSpan.textContent = 'Error: ' + data.msg;
            wsStatusSpan.style.color = '#f44336';
        }
    };
}

// Process incoming trades
function processTrades(trades) {
    if (!trades || trades.length === 0) return;
    
    // Get the last trade (most recent)
    const trade = trades[trades.length - 1];
    const price = trade.p;
    const timestamp = trade.t;
    const date = new Date(timestamp);
    
    // Update last price
    lastPrice = price;
    lastPriceSpan.textContent = price.toFixed(2);
    
    // Update document title
    document.title = `XAUUSD ${price.toFixed(2)} — Realtime Analyzer`;
    
    // Check if we're in a new minute
    date.setSeconds(0, 0);
    const currentTime = date.getTime();
    
    if (currentTime !== currentMinute.getTime()) {
        // New minute - push the current candle and start a new one
        if (currentCandle) {
            candles.push(currentCandle);
            
            // Update indicators
            updateIndicators(currentCandle);
            
            // Update quarterly levels
            updateQuarterlyLevels(currentCandle);
            
            // Update ICT zones (every 5 candles to reduce noise)
            if (candles.length % 5 === 0 && candles.length >= 3) {
                updateIctZones();
            }
            
            // Update recommendations
            updateRecommendations();
            
            // Update chart (only keep last 500 candles for performance)
            if (candles.length > 500) {
                candleSeries.setData(candles.slice(-500));
            } else {
                candleSeries.update(currentCandle);
            }
        }
        
        // Start new candle
        currentMinute = date;
        currentCandle = {
            time: currentTime,
            open: price,
            high: price,
            low: price,
            close: price,
            volume: 1,
        };
    } else {
        // Update current candle
        if (!currentCandle) {
            currentCandle = {
                time: currentTime,
                open: price,
                high: price,
                low: price,
                close: price,
                volume: 1,
            };
        } else {
            currentCandle.high = Math.max(currentCandle.high, price);
            currentCandle.low = Math.min(currentCandle.low, price);
            currentCandle.close = price;
            currentCandle.volume += 1;
        }
    }
    
    // Update the current candle on the chart
    if (currentCandle) {
        candleSeries.update(currentCandle);
    }
}

// Update indicators (RSI, MACD, ATR)
function updateIndicators(candle) {
    // RSI(14)
    updateRsi(candle);
    
    // MACD(12,26,9)
    updateMacd(candle);
    
    // ATR(14)
    updateAtr(candle);
    
    // Update UI
    if (rsiValues.length > 0) {
        const lastRsi = rsiValues[rsiValues.length - 1];
        rsiValueSpan.textContent = lastRsi.toFixed(2);
        
        // Color based on overbought/oversold
        if (lastRsi > 70) {
            rsiValueSpan.style.color = '#f44336';
        } else if (lastRsi < 30) {
            rsiValueSpan.style.color = '#4caf50';
        } else {
            rsiValueSpan.style.color = '#e0e0e0';
        }
    }
    
    if (macdValues.length > 0) {
        const lastMacd = macdValues[macdValues.length - 1];
        macdValueSpan.textContent = `MACD: ${lastMacd.macd.toFixed(2)}, Signal: ${lastMacd.signal.toFixed(2)}`;
        
        // Color based on MACD direction
        if (lastMacd.macd > lastMacd.signal) {
            macdValueSpan.style.color = '#4caf50';
        } else {
            macdValueSpan.style.color = '#f44336';
        }
    }
    
    if (atrValues.length > 0) {
        const lastAtr = atrValues[atrValues.length - 1];
        atrValueSpan.textContent = lastAtr.toFixed(2);
    }
}

function updateRsi(candle) {
    const period = 14;
    
    if (candles.length < period) {
        return;
    }
    
    // Calculate gains and losses
    let gains = 0;
    let losses = 0;
    
    for (let i = candles.length - period; i < candles.length; i++) {
        const change = candles[i].close - candles[i - 1].close;
        if (change > 0) {
            gains += change;
        } else {
            losses += Math.abs(change);
        }
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    rsiValues.push(rsi);
}

function updateMacd(candle) {
    const ema12Period = 12;
    const ema26Period = 26;
    const signalPeriod = 9;
    
    if (candles.length < ema26Period) {
        return;
    }
    
    // Calculate EMA12
    let ema12 = 0;
    if (candles.length === ema12Period) {
        // Initial SMA
        let sum = 0;
        for (let i = 0; i < ema12Period; i++) {
            sum += candles[i].close;
        }
        ema12 = sum / ema12Period;
    } else if (candles.length > ema12Period) {
        // Subsequent EMA
        const prevEma12 = macdValues.length > 0 ? macdValues[macdValues.length - 1].ema12 : 0;
        const multiplier = 2 / (ema12Period + 1);
        ema12 = (candle.close - prevEma12) * multiplier + prevEma12;
    }
    
    // Calculate EMA26
    let ema26 = 0;
    if (candles.length === ema26Period) {
        // Initial SMA
        let sum = 0;
        for (let i = 0; i < ema26Period; i++) {
            sum += candles[i].close;
        }
        ema26 = sum / ema26Period;
    } else if (candles.length > ema26Period) {
        // Subsequent EMA
        const prevEma26 = macdValues.length > 0 ? macdValues[macdValues.length - 1].ema26 : 0;
        const multiplier = 2 / (ema26Period + 1);
        ema26 = (candle.close - prevEma26) * multiplier + prevEma26;
    }
    
    // Calculate MACD line
    const macd = ema12 - ema26;
    
    // Calculate Signal line (EMA of MACD)
    let signal = 0;
    if (macdValues.length >= signalPeriod - 1) {
        if (macdValues.length === signalPeriod - 1) {
            // Initial SMA
            let sum = 0;
            for (let i = 0; i < signalPeriod; i++) {
                sum += (i < macdValues.length ? macdValues[i].macd : macd);
            }
            signal = sum / signalPeriod;
        } else {
            // Subsequent EMA
            const prevSignal = macdValues[macdValues.length - 1].signal;
            const multiplier = 2 / (signalPeriod + 1);
            signal = (macd - prevSignal) * multiplier + prevSignal;
        }
    }
    
    macdValues.push({
        ema12,
        ema26,
        macd,
        signal,
    });
}

function updateAtr(candle) {
    const period = 14;
    
    if (candles.length < period + 1) {
        return;
    }
    
    // Calculate True Range
    const prevClose = candles[candles.length - 2].close;
    const tr = Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - prevClose),
        Math.abs(candle.low - prevClose)
    );
    
    // Calculate ATR
    if (candles.length === period + 1) {
        // Initial ATR is average of first 'period' TR values
        let sum = tr;
        for (let i = candles.length - period; i < candles.length - 1; i++) {
            const prevCandle = candles[i];
            const prevPrevCandle = candles[i - 1];
            const prevTr = Math.max(
                prevCandle.high - prevCandle.low,
                Math.abs(prevCandle.high - prevPrevCandle.close),
                Math.abs(prevCandle.low - prevPrevCandle.close)
            );
            sum += prevTr;
        }
        atrValues.push(sum / period);
    } else if (candles.length > period + 1) {
        // Subsequent ATR uses smoothing formula
        const prevAtr = atrValues[atrValues.length - 1];
        const atr = (prevAtr * (period - 1) + tr) / period;
        atrValues.push(atr);
    }
}

// Update quarterly levels
function updateQuarterlyLevels(candle) {
    const date = new Date(candle.time);
    const year = date.getUTCFullYear();
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
    const quarterKey = `Q${quarter} ${year}`;
    
    // Find or create quarter
    let quarterData = quarterlyLevels.find(q => q.quarter === quarterKey);
    
    if (!quarterData) {
        quarterData = {
            quarter: quarterKey,
            high: candle.high,
            low: candle.low,
            close: candle.close,
        };
        quarterlyLevels.push(quarterData);
    } else {
        // Update values
        quarterData.high = Math.max(quarterData.high, candle.high);
        quarterData.low = Math.min(quarterData.low, candle.low);
        quarterData.close = candle.close;
    }
    
    // Sort quarters chronologically
    quarterlyLevels.sort((a, b) => {
        const [aQ, aY] = a.quarter.split(' ');
        const [bQ, bY] = b.quarter.split(' ');
        const yearDiff = parseInt(aY) - parseInt(bY);
        if (yearDiff !== 0) return yearDiff;
        return parseInt(aQ[1]) - parseInt(bQ[1]);
    });
    
    // Update UI
    updateQuarterlyLevelsUI();
}

function updateQuarterlyLevelsUI() {
    quarterlyLevelsDiv.innerHTML = '';
    
    quarterlyLevels.forEach(quarter => {
        const div = document.createElement('div');
        div.className = 'level-item';
        
        const quarterSpan = document.createElement('span');
        quarterSpan.textContent = quarter.quarter;
        quarterSpan.style.fontWeight = 'bold';
        
        const highSpan = document.createElement('span');
        highSpan.className = 'level-value';
        highSpan.textContent = `H: ${quarter.high.toFixed(2)}`;
        highSpan.style.color = '#4caf50';
        highSpan.style.marginLeft = '10px';
        
        const lowSpan = document.createElement('span');
        lowSpan.className = 'level-value';
        lowSpan.textContent = `L: ${quarter.low.toFixed(2)}`;
        lowSpan.style.color = '#f44336';
        lowSpan.style.marginLeft = '10px';
        
        const closeSpan = document.createElement('span');
        closeSpan.className = 'level-value';
        closeSpan.textContent = `C: ${quarter.close.toFixed(2)}`;
        closeSpan.style.marginLeft = '10px';
        
        div.appendChild(quarterSpan);
        div.appendChild(highSpan);
        div.appendChild(lowSpan);
        div.appendChild(closeSpan);
        
        quarterlyLevelsDiv.appendChild(div);
    });
}

// Update ICT zones
function updateIctZones() {
    if (candles.length < 3) return;
    
    const newZones = [];
    
    // Check for FVG (Fair Value Gap)
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    
    // FVG Up: low of current candle > high of previous candle
    if (lastCandle.low > prevCandle.high) {
        newZones.push({
            type: 'FVG_UP',
            range: [prevCandle.high, lastCandle.low],
            time: lastCandle.time,
        });
    }
    
    // FVG Down: low of previous candle > high of current candle
    if (prevCandle.low > lastCandle.high) {
        newZones.push({
            type: 'FVG_DOWN',
            range: [lastCandle.high, prevCandle.low],
            time: lastCandle.time,
        });
    }
    
    // Check for Order Blocks (simplified)
    if (candles.length >= 3) {
        const prevPrevCandle = candles[candles.length - 3];
        
        // Bullish Order Block: previous candle is bearish, current is bullish engulfing
        if (prevCandle.close < prevCandle.open && 
            lastCandle.close > lastCandle.open && 
            lastCandle.close > prevCandle.open && 
            lastCandle.open < prevCandle.close) {
            newZones.push({
                type: 'OB_BULL',
                range: [prevCandle.low, prevCandle.high],
                time: lastCandle.time,
            });
        }
        
        // Bearish Order Block: previous candle is bullish, current is bearish engulfing
        if (prevCandle.close > prevCandle.open && 
            lastCandle.close < lastCandle.open && 
            lastCandle.close < prevCandle.open && 
            lastCandle.open > prevCandle.close) {
            newZones.push({
                type: 'OB_BEAR',
                range: [prevCandle.low, prevCandle.high],
                time: lastCandle.time,
            });
        }
    }
    
    // Add new zones to the list
    newZones.forEach(zone => {
        // Check if similar zone already exists
        const exists = ictZones.some(existingZone => 
            existingZone.type === zone.type &&
            Math.abs(existingZone.range[0] - zone.range[0]) < 0.5 &&
            Math.abs(existingZone.range[1] - zone.range[1]) < 0.5
        );
        
        if (!exists) {
            ictZones.push(zone);
        }
    });
    
    // Keep only recent zones (last 20)
    ictZones = ictZones.slice(-20);
    
    // Update UI
    updateIctZonesUI();
}

function updateIctZonesUI() {
    ictZonesDiv.innerHTML = '';
    
    ictZones.forEach(zone => {
        const div = document.createElement('div');
        div.className = 'zone-item';
        
        const typeSpan = document.createElement('span');
        typeSpan.className = `zone-type ${zone.type.toLowerCase().replace('_', '-')}`;
        typeSpan.textContent = zone.type.replace('_', ' ');
        
        const rangeSpan = document.createElement('span');
        rangeSpan.className = 'level-value';
        rangeSpan.textContent = `${zone.range[0].toFixed(2)} - ${zone.range[1].toFixed(2)}`;
        rangeSpan.style.marginLeft = '10px';
        
        const dateSpan = document.createElement('span');
        dateSpan.style.float = 'right';
        dateSpan.style.fontSize = '0.8rem';
        dateSpan.style.color = '#999';
        dateSpan.textContent = new Date(zone.time).toLocaleTimeString();
        
        div.appendChild(typeSpan);
        div.appendChild(rangeSpan);
        div.appendChild(dateSpan);
        
        ictZonesDiv.appendChild(div);
    });
}

// Update recommendations
function updateRecommendations() {
    if (ictZones.length === 0 || atrValues.length === 0) return;
    
    const lastAtr = atrValues[atrValues.length - 1];
    const currentPrice = lastPrice;
    
    recommendations = [];
    
    ictZones.forEach(zone => {
        const recommendation = {
            zone: zone,
            bias: '',
            entry: 0,
            stopLoss: 0,
            takeProfit: 0,
            atr: lastAtr,
            confidence: 40, // Baseline
        };
        
        // Determine bias based on zone type
        if (zone.type === 'FVG_UP' || zone.type === 'OB_BULL') {
            recommendation.bias = 'BUY';
            
            // Entry: midpoint of zone, but not above zone high
            const midpoint = (zone.range[0] + zone.range[1]) / 2;
            recommendation.entry = Math.min(midpoint, zone.range[1]);
            
            // Stop loss: below zone low minus 0.8*ATR
            recommendation.stopLoss = zone.range[0] - 0.8 * lastAtr;
            
            // Take profit: nearest quarterly level above or 2.2*ATR
            const quarterlyAbove = quarterlyLevels
                .flatMap(q => [q.high, q.low, q.close])
                .filter(level => level > recommendation.entry)
                .sort((a, b) => a - b)[0];
            
            recommendation.takeProfit = quarterlyAbove || (recommendation.entry + 2.2 * lastAtr);
        } else if (zone.type === 'FVG_DOWN' || zone.type === 'OB_BEAR') {
            recommendation.bias = 'SELL';
            
            // Entry: midpoint of zone, but not below zone low
            const midpoint = (zone.range[0] + zone.range[1]) / 2;
            recommendation.entry = Math.max(midpoint, zone.range[0]);
            
            // Stop loss: above zone high plus 0.8*ATR
            recommendation.stopLoss = zone.range[1] + 0.8 * lastAtr;
            
            // Take profit: nearest quarterly level below or 2.2*ATR
            const quarterlyBelow = quarterlyLevels
                .flatMap(q => [q.high, q.low, q.close])
                .filter(level => level < recommendation.entry)
                .sort((a, b) => b - a)[0];
            
            recommendation.takeProfit = quarterlyBelow || (recommendation.entry - 2.2 * lastAtr);
        }
        
        // Calculate confidence
        // +20% if entry is within ATR of current price
        if (Math.abs(recommendation.entry - currentPrice) <= lastAtr) {
            recommendation.confidence += 20;
        }
        
        // +20% if zone intersects with quarterly levels
        const zoneIntersectsQuarterly = quarterlyLevels.some(q => 
            (zone.range[0] <= q.high && zone.range[1] >= q.low) ||
            (zone.range[0] >= q.low && zone.range[0] <= q.high) ||
            (zone.range[1] >= q.low && zone.range[1] <= q.high)
        );
        
        if (zoneIntersectsQuarterly) {
            recommendation.confidence += 20;
        }
        
        // Clamp confidence between 0-95%
        recommendation.confidence = Math.max(0, Math.min(95, recommendation.confidence));
        
        recommendations.push(recommendation);
    });
    
    // Sort by confidence (highest first)
    recommendations.sort((a, b) => b.confidence - a.confidence);
    
    // Update UI
    updateRecommendationsUI();
}

function updateRecommendationsUI() {
    recommendationsDiv.innerHTML = '';
    
    if (recommendations.length === 0) {
        const noRecs = document.createElement('div');
        noRecs.textContent = 'No recommendations yet';
        noRecs.style.color = '#999';
        recommendationsDiv.appendChild(noRecs);
        return;
    }
    
    recommendations.forEach(rec => {
        const div = document.createElement('div');
        div.className = `recommendation-item ${rec.bias.toLowerCase()}`;
        
        const biasSpan = document.createElement('span');
        biasSpan.style.fontWeight = 'bold';
        biasSpan.style.color = rec.bias === 'BUY' ? '#4caf50' : '#f44336';
        biasSpan.textContent = rec.bias;
        
        const typeSpan = document.createElement('span');
        typeSpan.style.marginLeft = '10px';
        typeSpan.textContent = rec.zone.type.replace('_', ' ');
        
        const entrySpan = document.createElement('div');
        entrySpan.textContent = `Entry: ${rec.entry.toFixed(2)}`;
        
        const slSpan = document.createElement('div');
        slSpan.textContent = `SL: ${rec.stopLoss.toFixed(2)} (${Math.abs(rec.entry - rec.stopLoss).toFixed(2)})`;
        
        const tpSpan = document.createElement('div');
        tpSpan.textContent = `TP: ${rec.takeProfit.toFixed(2)} (${Math.abs(rec.entry - rec.takeProfit).toFixed(2)})`;
        
        const rrSpan = document.createElement('div');
        const risk = Math.abs(rec.entry - rec.stopLoss);
        const reward = Math.abs(rec.entry - rec.takeProfit);
        const rrRatio = (reward / risk).toFixed(2);
        rrSpan.textContent = `Risk/Reward: 1:${rrRatio}`;
        
        const confidenceDiv = document.createElement('div');
        confidenceDiv.className = 'confidence-meter';
        
        const confidenceLabel = document.createElement('span');
        confidenceLabel.textContent = 'Confidence:';
        
        const confidenceBar = document.createElement('div');
        confidenceBar.className = 'confidence-bar';
        
        const confidenceProgress = document.createElement('div');
        confidenceProgress.className = 'confidence-progress';
        confidenceProgress.style.width = `${rec.confidence}%`;
        
        const confidenceValue = document.createElement('span');
        confidenceValue.textContent = `${rec.confidence}%`;
        
        confidenceBar.appendChild(confidenceProgress);
        confidenceDiv.appendChild(confidenceLabel);
        confidenceDiv.appendChild(confidenceBar);
        confidenceDiv.appendChild(confidenceValue);
        
        div.appendChild(biasSpan);
        div.appendChild(typeSpan);
        div.appendChild(entrySpan);
        div.appendChild(slSpan);
        div.appendChild(tpSpan);
        div.appendChild(rrSpan);
        div.appendChild(confidenceDiv);
        
        recommendationsDiv.appendChild(div);
    });
}

// Export snapshot
function exportSnapshot() {
    if (!isConnected || candles.length === 0) {
        alert('No data to export');
        return;
    }
    
    const snapshot = {
        symbol: symbol,
        timestamp: new Date().toISOString(),
        lastPrice: lastPrice,
        ohlc: candles.slice(-100), // Last 100 candles
        quarterlyLevels: quarterlyLevels,
        ictZones: ictZones,
        indicators: {
            rsi: rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : null,
            macd: macdValues.length > 0 ? macdValues[macdValues.length - 1] : null,
            atr: atrValues.length > 0 ? atrValues[atrValues.length - 1] : null,
        },
        recommendations: recommendations,
    };
    
    const dataStr = JSON.stringify(snapshot, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    
    const exportName = `XAUUSD_Analysis_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportName);
    linkElement.click();
}

// Event listeners
connectBtn.addEventListener('click', connect);
exportBtn.addEventListener('click', exportSnapshot);

// Initialize
initFromStorage();