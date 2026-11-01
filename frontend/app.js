/**
 * NEXUS TRADER AI - Institutional Multi-Asset Client Engine
 * Features:
 * - Second & Minute Timeframes (5s, 15s, 30s, 1m, 5m, 15m, 1h, 1d, 1w)
 * - Official TradingView Lightweight Candlestick Charts
 * - Interactive Conversational AI Market Analyst with Live Telemetry
 * - Universal Global Search Across All World Stock Exchanges & Currencies
 * - Precise Holding Duration Timers (Seconds & Minutes) with Auto-Liquidation
 */

const state = {
  currentTimeframe: '15m',
  currentMarketTab: 'ALL',
  currentCurrency: 'USD',
  selectedSymbol: 'NVDA',
  selectedDurationSeconds: 300, // 5m default
  orderSide: 'BUY',
  executionMode: 'SANDBOX',
  quotes: {},
  portfolio: null,
  chart: null,
  candlestickSeries: null,
  volumeSeries: null,
  emaSeries: null,
  targetLine: null,
  stopLine: null,
  searchDebounceTimer: null,
  chatHistory: [],
  exchangeRates: {
    USD: 1.0,
    INR: 86.85,
    EUR: 0.925,
    GBP: 0.772,
    JPY: 153.20,
    AED: 3.67,
    CAD: 1.39,
    AUD: 1.52,
    CHF: 0.865,
    SGD: 1.32,
    CNY: 7.12,
    SAR: 3.75,
    HKD: 7.78
  },
  currencySymbols: {
    USD: '$',
    INR: '₹',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    AED: 'د.إ',
    CAD: 'C$',
    AUD: 'A$',
    CHF: 'Fr',
    SGD: 'S$',
    CNY: '¥',
    SAR: '﷼',
    HKD: 'HK$'
  }
};

// Subtle Web Audio tone
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq, dur, type = 'sine') {
  try {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}

function showToast(msg, type = 'info') {
  const rack = document.getElementById('toastBox');
  if (!rack) return;
  const pill = document.createElement('div');
  pill.className = `toast-pill ${type}`;
  pill.textContent = msg;
  rack.appendChild(pill);
  setTimeout(() => {
    pill.style.opacity = '0';
    setTimeout(() => pill.remove(), 250);
  }, 4000);
}

function fmtCurrency(val, currencyCode = null) {
  const code = currencyCode || state.currentCurrency;
  const sym = state.currencySymbols[code] || '$';
  if (val === undefined || val === null || isNaN(val)) return `${sym}0.00`;
  return `${sym}${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initTradingViewChart();
  setupEventListeners();
  loadInitialQuotes();
  loadPortfolio();
  loadSystemInfo();
  initWorldClocks();
  loadOrderBookAndTrades();
  pollLiveAlertsAndTracker();

  // High-frequency live polling (1.5s)
  setInterval(() => {
    loadLiveQuotes(false);
    loadPortfolio(false);
    loadOrderBookAndTrades();
    pollLiveAlertsAndTracker();
  }, 1500);

  // High-frequency 1-second countdown ticker for active positions
  setInterval(updateLiveTimersAndPnL, 1000);
});

// Setup TradingView Lightweight Chart
function initTradingViewChart() {
  const container = document.getElementById('tvChartContainer');
  if (!container || !window.LightweightCharts) return;

  container.innerHTML = '';

  state.chart = LightweightCharts.createChart(container, {
    width: container.clientWidth || 800,
    height: 380,
    layout: {
      background: { color: '#080b10' },
      textColor: '#94a3b8',
      fontSize: 10,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    },
    grid: {
      vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
      horzLines: { color: 'rgba(255, 255, 255, 0.03)' }
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: '#388bfd', width: 1, style: 2 },
      horzLine: { color: '#388bfd', width: 1, style: 2 }
    },
    rightPriceScale: {
      borderColor: 'rgba(255, 255, 255, 0.08)',
      scaleMargins: { top: 0.08, bottom: 0.22 }
    },
    timeScale: {
      borderColor: 'rgba(255, 255, 255, 0.08)',
      timeVisible: true,
      secondsVisible: true
    }
  });

  state.candlestickSeries = state.chart.addCandlestickSeries({
    upColor: '#10b981',
    downColor: '#ef4444',
    borderVisible: false,
    wickUpColor: '#10b981',
    wickDownColor: '#ef4444'
  });

  state.volumeSeries = state.chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    scaleMargins: { top: 0.82, bottom: 0 }
  });

  state.emaSeries = state.chart.addLineSeries({
    color: '#06b6d4',
    lineWidth: 1.5,
    title: '20 EMA'
  });

  // Crosshair Interactive Legend Sync
  state.chart.subscribeCrosshairMove(param => {
    if (!param || !param.time || !param.seriesData) {
      updateOhlcLegendBarWithQuote(state.quotes[state.selectedSymbol]);
      return;
    }
    const bar = param.seriesData.get(state.candlestickSeries);
    if (bar && bar.open !== undefined) {
      updateOhlcLegendBar(bar.open, bar.high, bar.low, bar.close);
    }
  });

  const ro = new ResizeObserver(entries => {
    if (!entries || !entries.length) return;
    const { width, height } = entries[0].contentRect;
    state.chart.applyOptions({ width, height });
  });
  ro.observe(container);
}

// UI Event Listeners
function setupEventListeners() {
  // Global Search Input
  const searchInput = document.getElementById('globalSearchInput');
  const searchMenu = document.getElementById('searchResultsMenu');

  if (searchInput && searchMenu) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      clearTimeout(state.searchDebounceTimer);
      if (q.length < 2) {
        searchMenu.style.display = 'none';
        return;
      }
      state.searchDebounceTimer = setTimeout(() => performGlobalSearch(q), 250);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchMenu.style.display = 'none';
        searchInput.blur();
      }
    });

    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !searchMenu.contains(e.target)) {
        searchMenu.style.display = 'none';
      }
    });
  }

  // Timeframe Buttons (Seconds & Minutes: 5S, 15S, 30S, 1M, 5M, 15M, 1H, 1D, 1W)
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentTimeframe = btn.dataset.tf;
      loadActiveAssetCandles(state.selectedSymbol, state.currentTimeframe);
    });
  });

  // Duration Chips in Seconds & Minutes (15s, 30s, 1m, 5m, 15m, 30m, 1h, Custom)
  document.querySelectorAll('.dur-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.dur-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      const val = chip.dataset.sec;

      const customRow = document.getElementById('customDurationRow');
      if (val === 'custom') {
        if (customRow) customRow.style.display = 'flex';
        computeCustomDuration();
      } else {
        if (customRow) customRow.style.display = 'none';
        state.selectedDurationSeconds = parseInt(val, 10);
        updatePreFlightSummary();
      }
    });
  });

  const customValInput = document.getElementById('customDurValue');
  const customUnitSelect = document.getElementById('customDurUnit');
  if (customValInput && customUnitSelect) {
    customValInput.addEventListener('input', computeCustomDuration);
    customUnitSelect.addEventListener('change', computeCustomDuration);
  }

  // Direction Switch (BUY / SELL)
  const buyBtn = document.getElementById('btnSideBuy');
  const sellBtn = document.getElementById('btnSideSell');
  if (buyBtn && sellBtn) {
    buyBtn.addEventListener('click', () => {
      buyBtn.classList.add('active');
      sellBtn.classList.remove('active');
      state.orderSide = 'BUY';
      updatePreFlightSummary();
    });
    sellBtn.addEventListener('click', () => {
      sellBtn.classList.add('active');
      buyBtn.classList.remove('active');
      state.orderSide = 'SELL';
      updatePreFlightSummary();
    });
  }

  // Currency Switcher
  const curSelect = document.getElementById('currencySelect');
  if (curSelect) {
    curSelect.addEventListener('change', (e) => {
      state.currentCurrency = e.target.value;
      updateCurrencySymbolsUI();
      loadPortfolio();
      renderActiveAssetAnalysis(state.selectedSymbol, false);
      renderScreenerTable();
      updatePreFlightSummary();
    });
  }

  // Execution Mode Switcher
  const routeSelect = document.getElementById('routingSelect');
  if (routeSelect) {
    routeSelect.addEventListener('change', (e) => {
      state.executionMode = e.target.value;
      showToast(`Routing mode set: ${e.target.value === 'SANDBOX' ? 'Institutional Sandbox' : 'Live Broker Gateway'}`);
    });
  }

  // Market Category Tabs
  document.querySelectorAll('.market-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.market-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentMarketTab = tab.dataset.market;
      renderScreenerTable();
    });
  });

  // Capital Amount Quick Chips (10%, 25%, 50%, Max)
  document.querySelectorAll('.pct-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const pct = parseFloat(chip.dataset.pct);
      if (state.portfolio && state.portfolio.cash) {
        const amt = (state.portfolio.cash * pct) / 100;
        const input = document.getElementById('capitalAmountInput');
        if (input) input.value = Math.max(10, Math.floor(amt));
        updatePreFlightSummary();
      }
    });
  });

  const capInput = document.getElementById('capitalAmountInput');
  if (capInput) {
    capInput.addEventListener('input', updatePreFlightSummary);
  }

  // Order Type Selection (MARKET, LIMIT, STOP)
  document.querySelectorAll('.order-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.order-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.orderType = btn.dataset.type;
      updatePreFlightSummary();
    });
  });

  // Margin Leverage Chips (1x, 2x, 5x, 10x)
  document.querySelectorAll('.lev-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.lev-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.leverage = parseInt(chip.dataset.lev, 10);
      updatePreFlightSummary();
    });
  });

  // Execute Order Button
  const execBtn = document.getElementById('btnExecuteTradeOrder');
  if (execBtn) {
    execBtn.addEventListener('click', handleOrderSubmission);
  }

  // AI Chat Drawer Close
  const closeChatBtn = document.getElementById('btnCloseAiChat');
  if (closeChatBtn) {
    closeChatBtn.addEventListener('click', () => window.toggleAiChatDrawer(false));
  }

  // Send AI Chat
  const sendChatBtn = document.getElementById('btnSendAiChat');
  const chatInput = document.getElementById('aiChatInput');
  if (sendChatBtn && chatInput) {
    sendChatBtn.addEventListener('click', () => {
      const txt = chatInput.value.trim();
      if (txt) {
        submitAiChatPrompt(txt);
        chatInput.value = '';
      }
    });

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const txt = chatInput.value.trim();
        if (txt) {
          submitAiChatPrompt(txt);
          chatInput.value = '';
        }
      }
    });
  }

  // Emergency Liquidate All Open
  const emBtn = document.getElementById('btnEmergencyLiquidate');
  if (emBtn) {
    emBtn.addEventListener('click', async () => {
      if (confirm('Verify: Trigger emergency liquidation of all open market positions at prevailing prices?')) {
        try {
          const res = await fetch('/api/kill-switch', { method: 'POST' });
          const data = await res.json();
          playTone(330, 0.25);
          showToast(`Liquidated ${data.closed_count} open positions. Capital returned to margin balance.`, 'error');
          loadPortfolio();
        } catch (e) {
          showToast('Failed to trigger emergency liquidation', 'error');
        }
      }
    });
  }

  // Reset Sandbox Capital
  const resetBtn = document.getElementById('btnResetCapital');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (confirm('Reset sandbox paper portfolio back to initial starting balances?')) {
        await fetch('/api/reset-portfolio', { method: 'POST' });
        showToast('Sandbox capital reset successfully', 'success');
        loadPortfolio();
      }
    });
  }

  // Broker Modal Handlers
  const openBrokerBtn = document.getElementById('btnOpenBrokerModal');
  const closeBrokerBtn = document.getElementById('btnCloseBrokerModal');
  const cancelBrokerBtn = document.getElementById('btnCancelBrokerModal');
  const brokerModal = document.getElementById('brokerConfigModal');
  const brokerSelect = document.getElementById('modalBrokerProvider');

  if (openBrokerBtn && brokerModal) {
    openBrokerBtn.addEventListener('click', () => brokerModal.style.display = 'flex');
    closeBrokerBtn.addEventListener('click', () => brokerModal.style.display = 'none');
    cancelBrokerBtn.addEventListener('click', () => brokerModal.style.display = 'none');
  }

  if (brokerSelect) {
    brokerSelect.addEventListener('change', (e) => {
      const isIndian = e.target.value === 'ZERODHA' || e.target.value === 'ANGEL_ONE';
      document.getElementById('modalAlpacaInputs').style.display = isIndian ? 'none' : 'block';
      document.getElementById('modalIndianInputs').style.display = isIndian ? 'block' : 'none';
    });
  }

  const saveBrokerBtn = document.getElementById('btnSaveBrokerSettings');
  if (saveBrokerBtn) {
    saveBrokerBtn.addEventListener('click', async () => {
      const provider = document.getElementById('modalBrokerProvider').value;
      const alpacaKey = document.getElementById('modalAlpacaKey').value;
      const alpacaSecret = document.getElementById('modalAlpacaSecret').value;
      const indianKey = document.getElementById('modalIndianKey').value;
      const indianToken = document.getElementById('modalIndianToken').value;

      try {
        const res = await fetch('/api/broker/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider,
            alpaca_api_key: alpacaKey,
            alpaca_secret_key: alpacaSecret,
            zerodha_api_key: indianKey,
            zerodha_access_token: indianToken
          })
        });
        const data = await res.json();
        if (data.status === 'CONNECTED' || data.status === 'CONFIGURED') {
          showToast(`Broker Gateway configured: ${provider} (${data.status})`, 'success');
          brokerModal.style.display = 'none';
        } else {
          showToast(`Broker authentication rejected: ${data.error || 'Failed'}`, 'error');
        }
      } catch (e) {
        showToast('Error saving broker parameters', 'error');
      }
    });
  }
}

function computeCustomDuration() {
  const val = parseFloat(document.getElementById('customDurValue')?.value || 1);
  const unit = document.getElementById('customDurUnit')?.value || 'minutes';
  if (unit === 'seconds') {
    state.selectedDurationSeconds = Math.max(5, Math.floor(val));
  } else if (unit === 'minutes') {
    state.selectedDurationSeconds = Math.max(5, Math.floor(val * 60));
  } else if (unit === 'hours') {
    state.selectedDurationSeconds = Math.max(5, Math.floor(val * 3600));
  }
  updatePreFlightSummary();
}

function updateCurrencySymbolsUI() {
  const sym = state.currencySymbols[state.currentCurrency] || '$';
  const prefix = document.getElementById('capitalCurrencyPrefix');
  if (prefix) prefix.textContent = sym;
}

// Global Universal Search
async function performGlobalSearch(query) {
  const menu = document.getElementById('searchResultsMenu');
  if (!menu) return;

  menu.innerHTML = `<div style="padding:10px; text-align:center; color:var(--text-faint);">Searching global exchanges...</div>`;
  menu.style.display = 'block';

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!data.results || !data.results.length) {
      menu.innerHTML = `<div style="padding:10px; text-align:center; color:var(--text-faint);">No securities found.</div>`;
      return;
    }

    menu.innerHTML = data.results.map(r => `
      <div class="search-result-item" onclick="selectSearchedAsset('${r.symbol}')">
        <div>
          <span class="search-item-sym">${r.symbol}</span>
          <span class="search-item-name">${r.name}</span>
        </div>
        <div>
          <span class="asset-tag tag-market">${r.market}</span>
          <span style="color:var(--text-faint); margin-left:4px; font-size:10px;">${r.currency}</span>
        </div>
      </div>
    `).join('');
  } catch (e) {
    menu.innerHTML = `<div style="padding:10px; text-align:center; color:var(--bearish);">Search error</div>`;
  }
}

window.selectSearchedAsset = function(symbol) {
  document.getElementById('searchResultsMenu').style.display = 'none';
  document.getElementById('globalSearchInput').value = '';
  selectAsset(symbol);
};

// Initial Quote Fetch
async function loadInitialQuotes() {
  try {
    const res = await fetch('/api/quotes');
    const data = await res.json();
    if (data.quotes) {
      data.quotes.forEach(q => {
        state.quotes[q.symbol] = q;
      });
      renderScreenerTable();
      renderActiveAssetAnalysis(state.selectedSymbol, true);
    }
  } catch (e) {
    console.error('Initial quote retrieval failed:', e);
  }
}

async function loadLiveQuotes(renderTable = false) {
  try {
    const res = await fetch('/api/quotes');
    const data = await res.json();
    if (data.quotes) {
      data.quotes.forEach(q => {
        state.quotes[q.symbol] = q;
      });
      if (renderTable) {
        renderScreenerTable();
      } else {
        updateScreenerPricesFast();
      }
      if (state.quotes[state.selectedSymbol]) {
        const activeQ = state.quotes[state.selectedSymbol];
        updateActiveAssetPriceHeader(activeQ);
        streamLivePriceToChart(activeQ);
      }
    }
  } catch (e) {}
}

window.selectAsset = function(symbol) {
  state.selectedSymbol = symbol;
  renderActiveAssetAnalysis(symbol, true);
  updateChatActiveAssetHeader();
};

// Render Detailed Asset Analysis & Chart
async function renderActiveAssetAnalysis(symbol, refreshChart = true) {
  try {
    const res = await fetch(`/api/quote/${symbol}?timeframe=${state.currentTimeframe}`);
    const data = await res.json();
    if (data.quote) {
      state.quotes[data.quote.symbol] = data.quote;
      updateActiveAssetPriceHeader(data.quote);
      renderAIDiagnosticVerdict(data.quote);
      updatePreFlightSummary();

      if (refreshChart && data.candles) {
        renderTradingViewCandles(data.candles, data.quote);
      }
    }
  } catch (e) {
    console.error('Failed to load asset analysis:', e);
  }
}

async function loadActiveAssetCandles(symbol, tf) {
  try {
    const res = await fetch(`/api/quote/${symbol}?timeframe=${tf}`);
    const data = await res.json();
    if (data.candles) {
      const q = data.quote || state.quotes[symbol];
      renderTradingViewCandles(data.candles, q);
    }
  } catch (e) {
    console.error('Failed to load active asset candles:', e);
  }
}

function updateActiveAssetPriceHeader(q) {
  const symEl = document.getElementById('assetSymbol');
  const nameEl = document.getElementById('assetCompanyName');
  const mktEl = document.getElementById('assetMarket');
  const tagEl = document.getElementById('assetTrendTag');
  const priceEl = document.getElementById('assetLivePrice');
  const deltaEl = document.getElementById('assetLiveDelta');
  const lowEl = document.getElementById('assetDayLow');
  const highEl = document.getElementById('assetDayHigh');
  const volEl = document.getElementById('assetVolume');

  if (symEl) symEl.textContent = q.symbol;
  if (nameEl) nameEl.textContent = `${q.name} • ${q.sector}`;
  if (mktEl) mktEl.textContent = `${q.market} • ${q.currency}`;
  if (lowEl) lowEl.textContent = fmtCurrency(q.day_low, q.currency);
  if (highEl) highEl.textContent = fmtCurrency(q.day_high, q.currency);
  if (volEl) volEl.textContent = q.volume.toLocaleString();

  const isUp = q.change >= 0;
  if (priceEl) priceEl.textContent = fmtCurrency(q.price, q.currency);
  if (deltaEl) {
    deltaEl.className = `asset-live-delta num ${isUp ? 'up' : 'down'}`;
    deltaEl.textContent = `${isUp ? '+' : ''}${q.change.toFixed(2)} (${isUp ? '+' : ''}${q.change_pct.toFixed(2)}%)`;
  }
  if (tagEl) {
    tagEl.className = `asset-tag ${isUp ? 'tag-bull' : 'tag-bear'}`;
    tagEl.textContent = q.trend;
  }
}

// Render TradingView Candlesticks & Volume
function renderTradingViewCandles(candles, quote) {
  if (!state.candlestickSeries || !candles || !candles.length) return;

  const candleData = [];
  const volumeData = [];
  const emaData = [];

  let emaVal = Number(candles[0].close);
  const k = 2 / (20 + 1);

  candles.forEach(c => {
    const o = Number(c.open);
    const cl = Number(c.close);
    const h = Math.max(o, cl, Number(c.high));
    const l = Math.min(o, cl, Number(c.low));

    candleData.push({
      time: c.time,
      open: o,
      high: h,
      low: l,
      close: cl
    });

    volumeData.push({
      time: c.time,
      value: c.volume || 1500,
      color: cl >= o ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'
    });

    emaVal = cl * k + emaVal * (1 - k);
    emaData.push({
      time: c.time,
      value: Math.round(emaVal * 100) / 100
    });
  });

  try {
    state.candlestickSeries.setData(candleData);
    if (state.volumeSeries) state.volumeSeries.setData(volumeData);
    if (state.emaSeries) state.emaSeries.setData(emaData);

    // Save latest bar for real-time live tick streaming
    const lastBar = candleData[candleData.length - 1];
    state.lastCandle = { ...lastBar };
    state.lastEma = emaVal;
  } catch (err) {
    console.error('LightweightCharts setData error:', err);
  }

  // Target and Stop Loss lines
  try {
    if (state.targetLine) state.candlestickSeries.removePriceLine(state.targetLine);
    if (state.stopLine) state.candlestickSeries.removePriceLine(state.stopLine);

    const q = quote || state.quotes[state.selectedSymbol];
    if (q && q.target_price) {
      state.targetLine = state.candlestickSeries.createPriceLine({
        price: q.target_price,
        color: '#10b981',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Target'
      });
    }

    if (q && q.stop_loss) {
      state.stopLine = state.candlestickSeries.createPriceLine({
        price: q.stop_loss,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Stop-Loss'
      });
    }
  } catch (e) {
    console.warn('Price lines error:', e);
  }

  try {
    state.chart.timeScale().fitContent();
  } catch (e) {}
}

// Live Candle Streaming Engine for Real-Time Ticks
function streamLivePriceToChart(quote) {
  if (!state.candlestickSeries || !state.lastCandle || !quote || quote.symbol !== state.selectedSymbol) return;

  const tfSecMap = {
    '5s': 5,
    '15s': 15,
    '30s': 30,
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1h': 3600,
    '1d': 86400,
    '1w': 604800
  };
  const stepSec = tfSecMap[state.currentTimeframe.toLowerCase()] || 900;
  const nowSec = Math.floor(Date.now() / 1000);
  const currentBucket = Math.floor(nowSec / stepSec) * stepSec;
  const livePrice = Number(quote.price);

  if (currentBucket > state.lastCandle.time) {
    // A new bar begins forming live!
    const newBar = {
      time: currentBucket,
      open: livePrice,
      high: livePrice,
      low: livePrice,
      close: livePrice
    };
    state.lastCandle = newBar;
    try {
      state.candlestickSeries.update(newBar);
      if (state.volumeSeries) {
        state.volumeSeries.update({
          time: currentBucket,
          value: Math.floor(Math.random() * 2500 + 800),
          color: 'rgba(16, 185, 129, 0.25)'
        });
      }
      if (state.emaSeries && state.lastEma) {
        const k = 2 / (20 + 1);
        state.lastEma = livePrice * k + state.lastEma * (1 - k);
        state.emaSeries.update({
          time: currentBucket,
          value: Math.round(state.lastEma * 100) / 100
        });
      }
    } catch (e) {}
  } else {
    // Dynamically update the active bar currently forming
    state.lastCandle.high = Math.max(state.lastCandle.high, livePrice);
    state.lastCandle.low = Math.min(state.lastCandle.low, livePrice);
    state.lastCandle.close = livePrice;
    try {
      state.candlestickSeries.update(state.lastCandle);
    } catch (e) {}
  }
}

// Render AI Diagnostic Verdict & Narrative
function renderAIDiagnosticVerdict(q) {
  const recEl = document.getElementById('verdictRecommendation');
  const confEl = document.getElementById('verdictConfidence');
  const narrEl = document.getElementById('verdictNarrative');

  const isUp = q.direction === 'UP';
  if (recEl) {
    recEl.textContent = `${q.recommendation} — Expected to move ${isUp ? 'UP' : 'DOWN'}`;
    recEl.style.color = isUp ? 'var(--bullish)' : 'var(--bearish)';
  }
  if (confEl) confEl.textContent = `AI Confidence: ${q.confidence}%`;
  if (narrEl) narrEl.textContent = q.ai_summary;

  const rsiVal = document.getElementById('valRsi');
  const rsiStat = document.getElementById('statRsi');
  if (rsiVal && rsiStat) {
    rsiVal.textContent = q.rsi;
    rsiStat.textContent = q.rsi > 70 ? 'Overbought Territory' : q.rsi < 30 ? 'Oversold Accumulation' : 'Neutral Momentum';
    rsiStat.style.color = q.rsi > 70 ? 'var(--bearish)' : q.rsi < 30 ? 'var(--bullish)' : 'var(--text-muted)';
  }

  const emaVal = document.getElementById('valEma');
  const emaStat = document.getElementById('statEma');
  if (emaVal && emaStat) {
    emaVal.textContent = fmtCurrency(q.ema_20, q.currency);
    emaStat.textContent = q.price > q.ema_20 ? 'Above 20 EMA Support' : 'Below 20 EMA Resistance';
    emaStat.style.color = q.price > q.ema_20 ? 'var(--bullish)' : 'var(--bearish)';
  }

  const macdVal = document.getElementById('valMacd');
  const macdStat = document.getElementById('statMacd');
  if (macdVal && macdStat) {
    macdVal.textContent = (q.macd >= 0 ? '+' : '') + q.macd;
    macdStat.textContent = q.macd >= 0 ? 'Bullish Histogram' : 'Bearish Distribution';
    macdStat.style.color = q.macd >= 0 ? 'var(--bullish)' : 'var(--bearish)';
  }

  const targetVal = document.getElementById('valTargetSl');
  const targetStat = document.getElementById('statTargetSl');
  if (targetVal && targetStat) {
    targetVal.textContent = fmtCurrency(q.target_price, q.currency);
    targetStat.textContent = `SL: ${fmtCurrency(q.stop_loss, q.currency)} (${q.expected_roi}% Return)`;
  }
}

// Pre-Flight Risk Calculation in Seconds & Minutes
function updatePreFlightSummary() {
  const quote = state.quotes[state.selectedSymbol] || { price: 216.5, currency: 'USD', expected_roi: 2.5 };

  const amt = parseFloat(document.getElementById('capitalAmountInput')?.value || 0);
  const targetPct = quote.expected_roi || 2.5;
  const stopPct = 1.2;
  const durSec = state.selectedDurationSeconds || 300;

  let targetPrice = quote.price * (1 + targetPct / 100);
  let stopPrice = quote.price * (1 - stopPct / 100);
  if (state.orderSide === 'SELL') {
    targetPrice = quote.price * (1 - targetPct / 100);
    stopPrice = quote.price * (1 + stopPct / 100);
  }

  const estGainInUserCurr = amt * (targetPct / 100);
  const estLossInUserCurr = amt * (stopPct / 100);
  const rr = (targetPct / stopPct).toFixed(1);

  const pfTarget = document.getElementById('pfTargetPrice');
  const pfStop = document.getElementById('pfStopLossPrice');
  const pfRr = document.getElementById('pfRiskReward');
  const pfDur = document.getElementById('pfDurationText');
  const errBanner = document.getElementById('orderErrorBanner');
  const execBtn = document.getElementById('btnExecuteTradeOrder');

  const lev = state.leverage || 1;
  const effectivePower = amt * lev;
  const powerEl = document.getElementById('deskEffectivePower');
  if (powerEl) powerEl.textContent = `Effective Power: ${fmtCurrency(effectivePower)}`;

  const routeEl = document.getElementById('pfRouteText');
  if (routeEl) {
    routeEl.textContent = state.executionMode === 'LIVE_BROKER' ? 'DMA FIX 4.4 ULTRA DIRECT' : 'SANDBOX SIMULATED DMA';
  }

  const slipEl = document.getElementById('pfSlippageText');
  if (slipEl) {
    const spreadVal = state.orderBook ? state.orderBook.spread : 0.02;
    slipEl.textContent = `0.002% (${fmtCurrency(spreadVal, quote.currency)})`;
  }

  if (pfTarget) pfTarget.textContent = `${fmtCurrency(targetPrice, quote.currency)} (+${fmtCurrency(estGainInUserCurr)})`;
  if (pfStop) pfStop.textContent = `${fmtCurrency(stopPrice, quote.currency)} (-${fmtCurrency(estLossInUserCurr)})`;
  if (pfRr) pfRr.textContent = `${rr} : 1 Favorable Ratio`;

  let durLabel = '';
  if (durSec < 60) {
    durLabel = `In ${durSec} Seconds`;
  } else if (durSec < 3600) {
    const mins = Math.floor(durSec / 60);
    const secs = durSec % 60;
    durLabel = secs > 0 ? `In ${mins}m ${secs}s` : `In ${mins} Minutes`;
  } else {
    durLabel = `In ${(durSec / 3600).toFixed(1)} Hours`;
  }
  if (pfDur) pfDur.textContent = `Auto-Liquidates ${durLabel}`;

  const availMargin = state.portfolio ? state.portfolio.cash : 50000;
  if (amt <= 0) {
    if (errBanner) {
      errBanner.style.display = 'block';
      errBanner.textContent = 'Please enter an investment capital amount greater than zero.';
    }
    if (execBtn) execBtn.disabled = true;
  } else if (amt > availMargin) {
    if (errBanner) {
      errBanner.style.display = 'block';
      errBanner.textContent = `Insufficient Margin: Available ${fmtCurrency(availMargin)}, requested ${fmtCurrency(amt)}. Adjust allocation or reset sandbox.`;
    }
    if (execBtn) execBtn.disabled = true;
  } else {
    if (errBanner) errBanner.style.display = 'none';
    if (execBtn) execBtn.disabled = false;
  }
}

// Handle Order Submission
async function handleOrderSubmission() {
  const quote = state.quotes[state.selectedSymbol];
  if (!quote) return;

  const amt = parseFloat(document.getElementById('capitalAmountInput')?.value || 0);
  const durSec = state.selectedDurationSeconds || 300;
  const targetPct = quote.expected_roi || 2.5;
  const stopPct = 1.2;

  const execBtn = document.getElementById('btnExecuteTradeOrder');
  execBtn.disabled = true;
  execBtn.textContent = 'Transmitting Algorithmic Order...';

  try {
    const res = await fetch('/api/execute-trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: quote.symbol,
        amount: amt,
        currency: state.currentCurrency,
        side: state.orderSide,
        duration_seconds: durSec,
        target_pct: targetPct,
        stop_pct: stopPct,
        execution_mode: state.executionMode
      })
    });

    const data = await res.json();
    if (data.success) {
      playTone(880, 0.2);
      const durLabel = durSec < 60 ? `${durSec}s` : `${Math.floor(durSec / 60)}m`;
      showToast(`Order filled: ${state.orderSide} on ${quote.symbol} (${fmtCurrency(amt)}). Auto-withdrawal armed for ${durLabel}!`, 'success');
      loadPortfolio();
    } else {
      showToast(data.detail || 'Order execution rejected', 'error');
    }
  } catch (e) {
    showToast('Failed to contact execution engine', 'error');
  } finally {
    execBtn.disabled = false;
    execBtn.textContent = 'EXECUTE AI AUTO-TRADE & ARM TIMER';
  }
}

// Render Screener Table
function renderScreenerTable() {
  const tbody = document.getElementById('screenerTableBody');
  const countBadge = document.getElementById('screenerCountBadge');
  if (!tbody) return;

  let quotesList = Object.values(state.quotes);

  if (state.currentMarketTab !== 'ALL') {
    quotesList = quotesList.filter(q => q.market === state.currentMarketTab);
  }

  quotesList.sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct));

  if (countBadge) countBadge.textContent = `${quotesList.length} Active Assets`;

  if (!quotesList.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:20px; color:var(--text-faint);">Loading live quotes...</td></tr>`;
    return;
  }

  tbody.innerHTML = quotesList.map(q => {
    const isUp = q.change >= 0;
    const isSelected = q.symbol === state.selectedSymbol;
    return `
      <tr onclick="selectAsset('${q.symbol}')" style="${isSelected ? 'background:rgba(59,130,246,0.08);' : ''}">
        <td><strong style="color:#fff;">${q.symbol}</strong></td>
        <td><div style="font-weight:600; color:#fff;">${q.name}</div></td>
        <td><span class="asset-tag tag-market" style="font-size:9px;">${q.sector}</span></td>
        <td class="num row-price" style="text-align:right; font-weight:700;">${fmtCurrency(q.price, q.currency)}</td>
        <td class="num ${isUp ? 'up' : 'down'}" style="text-align:right; font-weight:700;">
          ${isUp ? '+' : ''}${q.change_pct.toFixed(2)}%
        </td>
        <td class="num" style="text-align:right;">${q.rsi}</td>
        <td><span class="asset-tag ${isUp ? 'tag-bull' : 'tag-bear'}">${q.trend}</span></td>
        <td>
          <span class="num" style="font-weight:700; color:var(--accent-cyan);">${q.confidence}%</span>
          <span style="font-size:10px; color:var(--text-faint); margin-left:4px;">${q.recommendation}</span>
        </td>
      </tr>
    `;
  }).join('');
}

function updateScreenerPricesFast() {
  Object.values(state.quotes).forEach(q => {
    const rows = document.querySelectorAll(`tr[onclick="selectAsset('${q.symbol}')"]`);
    rows.forEach(r => {
      const priceCell = r.querySelector('.row-price');
      if (priceCell) priceCell.textContent = fmtCurrency(q.price, q.currency);
    });
  });
}

// Portfolio & Ledger Management
async function loadPortfolio(renderFull = true) {
  try {
    const res = await fetch(`/api/portfolio?currency=${state.currentCurrency}`);
    const data = await res.json();
    state.portfolio = data;

    document.getElementById('ribbonNav').textContent = fmtCurrency(data.net_equity);
    document.getElementById('ribbonCash').textContent = fmtCurrency(data.cash);
    document.getElementById('ribbonInvested').textContent = fmtCurrency(data.total_invested);

    const fPnl = document.getElementById('ribbonFloatingPnl');
    const isProfit = data.total_unrealized_pnl >= 0;
    fPnl.className = `ribbon-val num ${isProfit ? 'up' : 'down'}`;
    fPnl.textContent = `${isProfit ? '+' : ''}${fmtCurrency(data.total_unrealized_pnl)}`;

    document.getElementById('ribbonOpenCount').textContent = `${data.active_positions_count} Open`;
    document.getElementById('activeTradesCountBadge').textContent = `${data.active_positions_count} Active`;

    const deskAvail = document.getElementById('deskAvailMargin');
    if (deskAvail) deskAvail.textContent = fmtCurrency(data.cash);

    renderActivePositionsTickets(data.active_positions);

    if (renderFull) {
      renderAuditLedgerTable(data.closed_trades);
    }
  } catch (e) {
    console.error('Failed to load portfolio:', e);
  }
}

// Render Active Running Position Tickets
function renderActivePositionsTickets(positions) {
  const container = document.getElementById('activePositionsContainer');
  if (!container) return;

  if (!positions || !positions.length) {
    container.innerHTML = `
      <div style="text-align:center; padding:24px 10px; color:var(--text-faint); font-size:11px;">
        No active market trades running. Select an asset and click "EXECUTE AI AUTO-TRADE".
      </div>
    `;
    return;
  }

  const now = Date.now() / 1000;

  container.innerHTML = positions.map(pos => {
    const isProfit = pos.unrealized_pnl >= 0;
    const remainingSec = Math.max(0, Math.floor(pos.exit_time - now));
    const progressPct = Math.max(0, Math.min(100, (remainingSec / pos.duration_seconds) * 100));

    let timeFormatted = '';
    if (remainingSec < 60) {
      timeFormatted = `${remainingSec}s`;
    } else {
      const mins = Math.floor(remainingSec / 60);
      const secs = remainingSec % 60;
      timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    return `
      <div class="position-ticket ${isProfit ? 'profit' : 'loss'}" id="posTicket_${pos.id}">
        <div class="ticket-header">
          <div class="ticket-sym-title">
            <span>${pos.side === 'BUY' ? '🟢 LONG' : '🔴 SHORT'}</span>
            <strong>${pos.symbol}</strong>
            <span class="asset-tag tag-market" style="font-size:9px;">${pos.execution_mode}</span>
          </div>
          <div class="ticket-pnl">
            <div class="ticket-pnl-val num ${isProfit ? 'up' : 'down'}">
              ${isProfit ? '+' : ''}${fmtCurrency(pos.unrealized_pnl, pos.currency)}
            </div>
            <div class="ticket-pnl-pct num ${isProfit ? 'up' : 'down'}">
              ${isProfit ? '+' : ''}${pos.unrealized_pnl_pct.toFixed(2)}%
            </div>
          </div>
        </div>

        <div class="ticket-grid num">
          <div>
            <span style="color:var(--text-faint); font-size:9px;">CAPITAL</span><br>
            <strong>${fmtCurrency(pos.invested_amount, pos.currency)}</strong>
          </div>
          <div>
            <span style="color:var(--text-faint); font-size:9px;">ENTRY</span><br>
            <strong>${fmtCurrency(pos.entry_price, pos.currency)}</strong>
          </div>
          <div>
            <span style="color:var(--text-faint); font-size:9px;">CURRENT</span><br>
            <strong>${fmtCurrency(pos.current_price, pos.currency)}</strong>
          </div>
        </div>

        <div class="timer-strip">
          <div class="timer-text-row">
            <span>AUTO-WITHDRAWAL TIMER:</span>
            <strong class="num ticket-timer-text" style="color:var(--text-main); font-size:11px;">⏳ ${timeFormatted} REMAINING</strong>
          </div>
          <div class="timer-bar-track">
            <div class="timer-bar-fill" style="width:${progressPct}%;"></div>
          </div>
        </div>

        <button class="btn-withdraw-early" onclick="withdrawPositionImmediately('${pos.id}')">
          Withdraw Capital & Realize P&L Now
        </button>
      </div>
    `;
  }).join('');
}

// High-Frequency 1-Second Timer Ticker
function updateLiveTimersAndPnL() {
  if (!state.portfolio || !state.portfolio.active_positions) return;

  const now = Date.now() / 1000;
  state.portfolio.active_positions.forEach(pos => {
    const remainingSec = Math.max(0, Math.floor(pos.exit_time - now));
    const ticket = document.getElementById(`posTicket_${pos.id}`);
    if (ticket) {
      const timerText = ticket.querySelector('.ticket-timer-text');
      const barFill = ticket.querySelector('.timer-bar-fill');

      let timeFormatted = '';
      if (remainingSec < 60) {
        timeFormatted = `${remainingSec}s`;
      } else {
        const mins = Math.floor(remainingSec / 60);
        const secs = remainingSec % 60;
        timeFormatted = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      }

      if (timerText) timerText.textContent = `⏳ ${timeFormatted} REMAINING`;
      if (barFill) {
        const pct = Math.max(0, Math.min(100, (remainingSec / pos.duration_seconds) * 100));
        barFill.style.width = `${pct}%`;
      }
    }
  });
}

window.withdrawPositionImmediately = async function(posId) {
  try {
    const res = await fetch(`/api/withdraw/${posId}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      playTone(440, 0.2);
      const isProf = data.trade.pnl >= 0;
      showToast(`Position liquidated! P&L: ${isProf ? '+' : ''}${fmtCurrency(data.trade.pnl, data.trade.currency)} (${data.trade.pnl_pct.toFixed(2)}%). Capital returned to margin.`, isProf ? 'success' : 'info');
      loadPortfolio();
    }
  } catch (e) {
    showToast('Failed to execute early withdrawal', 'error');
  }
};

function renderAuditLedgerTable(trades) {
  const tbody = document.getElementById('auditLedgerBody');
  if (!tbody) return;

  if (!trades || !trades.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:16px; color:var(--text-faint);">No closed executions yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = trades.map(t => {
    const isProf = t.pnl >= 0;
    return `
      <tr>
        <td><strong style="color:#fff;">${t.symbol}</strong></td>
        <td><span class="${t.side === 'BUY' ? 'up' : 'down'}">${t.side}</span></td>
        <td class="num">${fmtCurrency(t.invested_amount, t.currency)}</td>
        <td class="num ${isProf ? 'up' : 'down'}" style="font-weight:700;">
          ${isProf ? '+' : ''}${fmtCurrency(t.pnl, t.currency)} (${t.pnl_pct.toFixed(2)}%)
        </td>
        <td><span class="asset-tag tag-market" style="font-size:9px;">${t.reason}</span></td>
      </tr>
    `;
  }).join('');
}

// Conversational AI Market Analyst Engine
function updateChatActiveAssetHeader() {
  const lbl = document.getElementById('chatActiveAssetLabel');
  if (lbl) lbl.textContent = state.selectedSymbol;
}

let lastAiChatToggleTs = 0;
window.toggleAiChatDrawer = function(forceState) {
  const now = Date.now();
  if (now - lastAiChatToggleTs < 150 && forceState === undefined) return;
  lastAiChatToggleTs = now;

  const drawer = document.getElementById('aiChatDrawer');
  if (!drawer) return;

  if (typeof forceState === 'boolean') {
    if (forceState) drawer.classList.add('open');
    else drawer.classList.remove('open');
  } else {
    drawer.classList.toggle('open');
  }

  if (drawer.classList.contains('open')) {
    playTone(660, 0.1);
    updateChatActiveAssetHeader();
    const input = document.getElementById('aiChatInput');
    if (input) setTimeout(() => input.focus(), 150);
  }
};

window.openAiChatWithQuery = function(promptText) {
  window.toggleAiChatDrawer(true);
  submitAiChatPrompt(promptText);
};

window.sendAiChatQuickPrompt = function(promptText) {
  window.toggleAiChatDrawer(true);
  submitAiChatPrompt(promptText);
};

async function submitAiChatPrompt(userMsg) {
  const body = document.getElementById('aiChatMessages');
  if (!body) return;

  // Append user message bubble
  const userBubble = document.createElement('div');
  userBubble.className = 'chat-bubble user';
  userBubble.textContent = userMsg;
  body.appendChild(userBubble);

  // Append thinking bubble
  const aiBubble = document.createElement('div');
  aiBubble.className = 'chat-bubble ai';
  aiBubble.innerHTML = `<em>Analyzing real-time order book, volume delta, RSI, and EMA bands for ${state.selectedSymbol}...</em>`;
  body.appendChild(aiBubble);
  body.scrollTop = body.scrollHeight;

  try {
    const res = await fetch('/api/ai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: state.selectedSymbol,
        message: userMsg,
        chat_history: state.chatHistory.slice(-6)
      })
    });

    const data = await res.json();
    playTone(600, 0.15);

    // Format rich markdown response with tables and badges
    aiBubble.innerHTML = formatMarkdownToHtml(data.response);
    state.chatHistory.push({ role: 'user', content: userMsg });
    state.chatHistory.push({ role: 'assistant', content: data.response });

  } catch (e) {
    aiBubble.innerHTML = `<span style="color:var(--bearish);">Unable to retrieve AI analysis telemetry. Check network connectivity.</span>`;
  }

  body.scrollTop = body.scrollHeight;
}

// ==========================================
// Institutional Market Depth & Live Tape
// ==========================================
window.switchDepthTab = function(tab) {
  state.depthTab = tab;
  const bookBtn = document.getElementById('tabOrderBook');
  const tapeBtn = document.getElementById('tabTimeSales');
  const bookView = document.getElementById('depthOrderBookView');
  const tapeView = document.getElementById('depthTimeSalesView');

  if (tab === 'book') {
    if (bookBtn) bookBtn.classList.add('active');
    if (tapeBtn) tapeBtn.classList.remove('active');
    if (bookView) bookView.style.display = 'grid';
    if (tapeView) tapeView.style.display = 'none';
  } else {
    if (tapeBtn) tapeBtn.classList.add('active');
    if (bookBtn) bookBtn.classList.remove('active');
    if (tapeView) tapeView.style.display = 'flex';
    if (bookView) bookView.style.display = 'none';
  }
};

async function loadOrderBookAndTrades() {
  const sym = state.selectedSymbol;
  try {
    const [bookRes, tapeRes] = await Promise.all([
      fetch(`/api/order-book/${sym}`),
      fetch(`/api/recent-trades/${sym}`)
    ]);

    const bookData = await bookRes.json();
    state.orderBook = bookData;
    renderOrderBookDOM(bookData);

    const tapeData = await tapeRes.json();
    renderTimeAndSalesTape(tapeData.trades || []);
  } catch (e) {}
}

function renderOrderBookDOM(data) {
  if (!data || !data.bids || !data.asks) return;

  const quote = state.quotes[state.selectedSymbol];
  const curr = quote ? quote.currency : 'USD';

  const totalBids = data.total_bid_vol || 1;
  const totalAsks = data.total_ask_vol || 1;
  const grandTotal = totalBids + totalAsks;
  const bidPct = Math.round((totalBids / grandTotal) * 100);
  const askPct = 100 - bidPct;

  const bidPill = document.getElementById('depthBidPressure');
  const askPill = document.getElementById('depthAskPressure');
  if (bidPill) bidPill.textContent = `BIDS ${bidPct}%`;
  if (askPill) askPill.textContent = `${askPct}% ASKS`;

  const spreadVal = document.getElementById('obSpreadVal');
  const spreadPct = document.getElementById('obSpreadPct');
  if (spreadVal) spreadVal.textContent = fmtCurrency(data.spread, curr);
  if (spreadPct) spreadPct.textContent = `${data.spread_pct}%`;

  const legSpread = document.getElementById('legSpread');
  if (legSpread) legSpread.textContent = fmtCurrency(data.spread, curr);

  // Render Bids
  const bidsContainer = document.getElementById('obBidsRows');
  if (bidsContainer) {
    const maxBidVol = Math.max(...data.bids.map(b => b.volume), 1);
    bidsContainer.innerHTML = data.bids.map(b => {
      const barWidth = Math.min(100, Math.round((b.volume / maxBidVol) * 100));
      return `
        <div class="ob-row bid">
          <div class="ob-row-bar" style="width:${barWidth}%;"></div>
          <span style="color:var(--text-faint); font-size:10px;">LIMIT</span>
          <span style="text-align:right;">${b.volume.toLocaleString()}</span>
          <span class="ob-price" style="text-align:right;">${b.price.toFixed(2)}</span>
        </div>
      `;
    }).join('');
  }

  // Render Asks
  const asksContainer = document.getElementById('obAsksRows');
  if (asksContainer) {
    const maxAskVol = Math.max(...data.asks.map(a => a.volume), 1);
    asksContainer.innerHTML = data.asks.map(a => {
      const barWidth = Math.min(100, Math.round((a.volume / maxAskVol) * 100));
      return `
        <div class="ob-row ask">
          <div class="ob-row-bar" style="width:${barWidth}%;"></div>
          <span class="ob-price">${a.price.toFixed(2)}</span>
          <span style="text-align:right;">${a.volume.toLocaleString()}</span>
          <span style="text-align:right; color:var(--text-faint); font-size:10px;">${a.total.toLocaleString()}</span>
        </div>
      `;
    }).join('');
  }
}

function renderTimeAndSalesTape(trades) {
  const container = document.getElementById('tapeRowsContainer');
  if (!container || !trades) return;

  container.innerHTML = trades.map(t => {
    const isBuy = t.side === 'BUY';
    return `
      <div class="tape-row">
        <span style="color:var(--text-faint); font-size:10px;">${t.time}</span>
        <span class="num ${isBuy ? 'up' : 'down'}" style="text-align:right; font-weight:700;">${t.price.toFixed(2)}</span>
        <span style="text-align:right; color:#fff;">${t.quantity.toLocaleString()}</span>
        <span style="text-align:right;"><strong class="${isBuy ? 'up' : 'down'}">${t.side}</strong></span>
      </div>
    `;
  }).join('');
}

// ==========================================
// Real-Time OHLC Legend Sync
// ==========================================
function updateOhlcLegendBarWithQuote(q) {
  if (!q) return;
  const legSym = document.getElementById('legSym');
  const legTf = document.getElementById('legTf');
  const legOpen = document.getElementById('legOpen');
  const legHigh = document.getElementById('legHigh');
  const legLow = document.getElementById('legLow');
  const legClose = document.getElementById('legClose');
  const legChange = document.getElementById('legChange');

  if (legSym) legSym.textContent = q.symbol;
  if (legTf) legTf.textContent = state.currentTimeframe.toUpperCase();
  if (legOpen) legOpen.textContent = q.price ? q.price.toFixed(2) : '0.00';
  if (legHigh) legHigh.textContent = q.day_high ? q.day_high.toFixed(2) : '0.00';
  if (legLow) legLow.textContent = q.day_low ? q.day_low.toFixed(2) : '0.00';
  if (legClose) legClose.textContent = q.price ? q.price.toFixed(2) : '0.00';

  if (legChange) {
    const isUp = q.change >= 0;
    legChange.className = `legend-chg num ${isUp ? 'up' : 'down'}`;
    legChange.textContent = `${isUp ? '+' : ''}${q.change.toFixed(2)} (${isUp ? '+' : ''}${q.change_pct.toFixed(2)}%)`;
  }
}

function updateOhlcLegendBar(open, high, low, close) {
  const legOpen = document.getElementById('legOpen');
  const legHigh = document.getElementById('legHigh');
  const legLow = document.getElementById('legLow');
  const legClose = document.getElementById('legClose');
  const legChange = document.getElementById('legChange');

  if (legOpen) legOpen.textContent = Number(open).toFixed(2);
  if (legHigh) legHigh.textContent = Number(high).toFixed(2);
  if (legLow) legLow.textContent = Number(low).toFixed(2);
  if (legClose) legClose.textContent = Number(close).toFixed(2);

  if (legChange) {
    const diff = close - open;
    const pct = open > 0 ? (diff / open) * 100 : 0;
    const isUp = diff >= 0;
    legChange.className = `legend-chg num ${isUp ? 'up' : 'down'}`;
    legChange.textContent = `${isUp ? '+' : ''}${diff.toFixed(2)} (${isUp ? '+' : ''}${pct.toFixed(2)}%)`;
  }
}

// ==========================================
// Institutional World Clocks
// ==========================================
function initWorldClocks() {
  function tickClocks() {
    const now = new Date();
    const utcStr = now.toUTCString().slice(17, 25);
    const nycStr = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false });
    const lonStr = now.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour12: false });
    const mumStr = now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });

    const cUtc = document.getElementById('clockUtc');
    const cNyc = document.getElementById('clockNyc');
    const cLon = document.getElementById('clockLon');
    const cMum = document.getElementById('clockMum');

    if (cUtc) cUtc.textContent = utcStr;
    if (cNyc) cNyc.textContent = nycStr;
    if (cLon) cLon.textContent = lonStr;
    if (cMum) cMum.textContent = mumStr;
  }
  tickClocks();
  setInterval(tickClocks, 1000);
}

// ==========================================
// Mobile Phone Connectivity & QR Code
// ==========================================
// System Info & Global Phone Access
// ==========================================
state.phoneAccessMode = 'public';

async function loadSystemInfo() {
  try {
    const res = await fetch('/api/system-info');
    const data = await res.json();
    state.systemInfo = data;
    renderPhoneModalView();
  } catch (e) {
    console.error('Failed to load system info:', e);
  }
}

function renderPhoneModalView() {
  const isPublic = state.phoneAccessMode === 'public';
  const url = isPublic
    ? (state.systemInfo?.public_url || 'https://nexus-trader-live.loca.lt')
    : (state.systemInfo?.mobile_url || 'http://192.168.1.6:8000');

  const urlEl = document.getElementById('phoneAccessUrl');
  const directLink = document.getElementById('phoneDirectLink');
  const labelEl = document.getElementById('phoneAccessLabel');
  const passBox = document.getElementById('tunnelPasswordBox');
  const passVal = document.getElementById('tunnelPasswordVal');
  const tabPublic = document.getElementById('tabModePublic');
  const tabWifi = document.getElementById('tabModeWifi');

  if (urlEl) urlEl.textContent = url;
  if (directLink) directLink.href = url;
  if (labelEl) labelEl.textContent = isPublic ? 'Worldwide HTTPS URL (Any 4G/5G Network):' : 'Direct Wi-Fi / Local Network URL:';
  if (passBox) passBox.style.display = isPublic ? 'block' : 'none';
  if (passVal && state.systemInfo?.tunnel_password) passVal.textContent = state.systemInfo.tunnel_password;

  if (tabPublic && tabWifi) {
    if (isPublic) {
      tabPublic.style.background = 'rgba(0,230,118,0.15)';
      tabPublic.style.color = 'var(--bullish)';
      tabPublic.style.borderColor = 'var(--bullish)';
      tabWifi.style.background = 'transparent';
      tabWifi.style.color = 'var(--text-muted)';
      tabWifi.style.borderColor = 'var(--border-subtle)';
    } else {
      tabWifi.style.background = 'rgba(0,230,118,0.15)';
      tabWifi.style.color = 'var(--bullish)';
      tabWifi.style.borderColor = 'var(--bullish)';
      tabPublic.style.background = 'transparent';
      tabPublic.style.color = 'var(--text-muted)';
      tabPublic.style.borderColor = 'var(--border-subtle)';
    }
  }

  // Render SVG QR code for active URL
  const qrContainer = document.getElementById('phoneQrContainer');
  if (qrContainer && window.QRCode) {
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
      text: url,
      width: 160,
      height: 160,
      colorDark: '#0b0e14',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }
}

window.switchPhoneAccessMode = function(mode) {
  state.phoneAccessMode = mode;
  renderPhoneModalView();
};

window.openPhoneModal = function() {
  const modal = document.getElementById('phoneConnectModal');
  if (modal) modal.style.display = 'flex';
  if (!state.systemInfo) loadSystemInfo();
  else renderPhoneModalView();
};

window.closePhoneModal = function() {
  const modal = document.getElementById('phoneConnectModal');
  if (modal) modal.style.display = 'none';
};

window.copyPhoneUrl = function() {
  const isPublic = state.phoneAccessMode === 'public';
  const url = isPublic
    ? (state.systemInfo?.public_url || 'https://nexus-trader-live.loca.lt')
    : (state.systemInfo?.mobile_url || `http://${window.location.hostname}:8000`);

  navigator.clipboard.writeText(url).then(() => {
    showToast(`Copied ${isPublic ? 'Global' : 'Wi-Fi'} URL: ${url}`, 'success');
  }).catch(() => {
    showToast(`Active URL: ${url}`, 'info');
  });
};

// ==========================================
// Mobile App Bottom Navigation
// ==========================================
window.mobileSwitchTab = function(tab) {
  document.querySelectorAll('.mob-nav-item').forEach(item => item.classList.remove('active'));
  if (window.event && window.event.currentTarget) {
    window.event.currentTarget.classList.add('active');
  }

  if (tab === 'chart') {
    document.querySelector('.chart-card')?.scrollIntoView({ behavior: 'smooth' });
  } else if (tab === 'depth') {
    document.querySelector('.depth-tape-card')?.scrollIntoView({ behavior: 'smooth' });
  } else if (tab === 'trade') {
    document.getElementById('executionOrderBox')?.scrollIntoView({ behavior: 'smooth' });
  } else if (tab === 'orders') {
    document.getElementById('activeTradesDeckCard')?.scrollIntoView({ behavior: 'smooth' });
  } else if (tab === 'ai') {
    window.toggleAiChatDrawer(true);
  } else if (tab === 'phone') {
    window.openPhoneModal();
  }
};

// ==========================================
// Rich Markdown Formatter (Tables, Headers, Lists)
// ==========================================
function formatMarkdownToHtml(md) {
  if (!md) return '';

  const lines = md.split('\n');
  let inTable = false;
  let tableHtml = '';
  let processedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableHtml = '<table class="ai-markdown-table"><thead><tr>';
        const headers = line.slice(1, -1).split('|').map(h => h.trim());
        headers.forEach(h => {
          tableHtml += `<th>${h}</th>`;
        });
        tableHtml += '</tr></thead><tbody>';
        if (i + 1 < lines.length && lines[i + 1].includes('---')) {
          i++; // Skip delimiter row
        }
      } else {
        const cells = line.slice(1, -1).split('|').map(c => c.trim());
        tableHtml += '<tr>';
        cells.forEach(c => {
          tableHtml += `<td>${c}</td>`;
        });
        tableHtml += '</tr>';
      }
    } else {
      if (inTable) {
        tableHtml += '</tbody></table>';
        processedLines.push(tableHtml);
        inTable = false;
        tableHtml = '';
      }
      processedLines.push(line);
    }
  }
  if (inTable) {
    tableHtml += '</tbody></table>';
    processedLines.push(tableHtml);
  }

  let text = processedLines.join('\n');

  // Headers
  text = text.replace(/### (.*)/g, '<div style="font-size:13px; font-weight:800; color:#fff; margin:10px 0 4px 0; letter-spacing:0.3px;">$1</div>');
  text = text.replace(/#### (.*)/g, '<div style="font-size:11px; font-weight:700; color:var(--text-muted); margin:8px 0 3px 0; text-transform:uppercase;">$1</div>');

  // Bold & code
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#fff;">$1</strong>');
  text = text.replace(/`([^`]+)`/g, '<code class="ai-badge">$1</code>');

  // Bullet items
  text = text.replace(/^- (.*)/gm, '<div style="margin:3px 0 3px 10px; display:flex; align-items:flex-start; gap:6px;"><span>•</span><span>$1</span></div>');

  // Line breaks
  text = text.replace(/\n\n/g, '<br>');
  text = text.replace(/\n/g, '<br>');

  return text;
}

// ==========================================
// Web Audio API Synthesis Chime Alerts
// ==========================================
let audioContextInstance = null;
function getAudioCtx() {
  if (!audioContextInstance) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) audioContextInstance = new AudioCtx();
  }
  if (audioContextInstance && audioContextInstance.state === 'suspended') {
    audioContextInstance.resume();
  }
  return audioContextInstance;
}

function playChime(type = 'BUY') {
  try {
    const chk = document.getElementById('chkAudioAlert');
    if (chk && !chk.checked) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    const now = ctx.currentTime;
    if (type === 'BUY') {
      // Ascending crisp arpeggio chime (C5 -> E5 -> G5)
      const freqs = [523.25, 659.25, 783.99];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0.25, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.36);
      });
    } else if (type === 'SELL') {
      // Descending alert tone (G5 -> Eb5)
      const freqs = [783.99, 622.25];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + idx * 0.1);
        gain.gain.setValueAtTime(0.2, now + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 0.32);
      });
    } else {
      // High bell ding (880Hz)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.46);
    }
  } catch (e) {
    console.warn('Audio chime warning:', e);
  }
}

// ==========================================
// Browser Desktop & Mobile Push Notifications
// ==========================================
window.requestPushPermission = function() {
  if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        showToast('Browser notifications enabled! You will receive live Buy/Sell signals.', 'success');
      }
    });
  }
};

function triggerBrowserNotification(title, body) {
  try {
    const chk = document.getElementById('chkPushNotification');
    if (chk && !chk.checked) return;
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body: body,
        icon: '/favicon.ico'
      });
    }
  } catch (e) {}
}

// ==========================================
// Live Signal Alert Banner
// ==========================================
let currentActiveAlert = null;

function displaySignalBanner(alert) {
  currentActiveAlert = alert;
  const bar = document.getElementById('liveSignalAlertBar');
  const badge = document.getElementById('signalBannerBadge');
  const asset = document.getElementById('signalBannerAsset');
  const msg = document.getElementById('signalBannerMsg');
  const metrics = document.getElementById('signalBannerMetrics');
  const btnAction = document.getElementById('btnSignalAction');

  if (!bar) return;

  const isBuy = alert.side === 'BUY';
  bar.className = `live-signal-banner ${isBuy ? 'buy' : 'sell'}`;
  bar.style.display = 'block';

  if (badge) badge.textContent = isBuy ? '🟢 BUY NOW SIGNAL' : '🔴 SELL / SHORT SIGNAL';
  if (asset) asset.textContent = alert.symbol;
  if (msg) msg.textContent = alert.message || `AI detected ${alert.side} breakout setup.`;
  if (metrics) {
    metrics.textContent = `Price: ${alert.currency} ${alert.price.toFixed(2)} | Target: ${alert.currency} ${alert.target_price.toFixed(2)} | SL: ${alert.currency} ${alert.stop_loss.toFixed(2)}`;
  }
  if (btnAction) {
    btnAction.textContent = isBuy ? '⚡ 1-CLICK BUY NOW (5m)' : '⚡ 1-CLICK SELL NOW (5m)';
  }
}

window.dismissSignalBar = function() {
  const bar = document.getElementById('liveSignalAlertBar');
  if (bar) bar.style.display = 'none';
};

window.quickExecuteFromSignal = function() {
  if (!currentActiveAlert) return;
  const alert = currentActiveAlert;
  if (state.selectedSymbol !== alert.symbol) {
    selectSymbol(alert.symbol);
  }
  const btnBuy = document.getElementById('btnSideBuy');
  const btnSell = document.getElementById('btnSideSell');
  if (alert.side === 'BUY') {
    if (btnBuy) btnBuy.click();
  } else {
    if (btnSell) btnSell.click();
  }
  const dur5m = document.querySelector('.dur-chip[data-sec="300"]');
  if (dur5m) dur5m.click();

  const dock = document.getElementById('executionOrderBox');
  if (dock) {
    dock.scrollIntoView({ behavior: 'smooth', block: 'center' });
    dock.style.boxShadow = '0 0 24px rgba(0,230,118,0.6)';
    setTimeout(() => { dock.style.boxShadow = ''; }, 2500);
  }
  showToast(`Pre-filled order dock for ${alert.symbol} (${alert.side})! Click Execute to arm.`, 'success');
};

window.quickExecuteFromSignalObj = function(symbol, side, target, sl) {
  currentActiveAlert = {
    symbol: symbol,
    side: side,
    target_price: target || 0,
    stop_loss: sl || 0,
    currency: 'USD',
    price: 100,
    message: `Executing ${side} setup on ${symbol}`
  };
  window.quickExecuteFromSignal();
};

// ==========================================
// Alerts Bell Feed & Polling
// ==========================================
state.seenAlertIds = new Set();
state.unreadAlertCount = 0;

window.toggleAlertsDrawer = function() {
  const dd = document.getElementById('alertsDropdown');
  if (!dd) return;
  const isHidden = dd.style.display === 'none' || !dd.style.display;
  dd.style.display = isHidden ? 'flex' : 'none';
  if (isHidden) {
    state.unreadAlertCount = 0;
    const badge = document.getElementById('alertBellBadge');
    if (badge) badge.textContent = '0';
  }
};

window.clearAlertsFeed = function() {
  const list = document.getElementById('alertsFeedList');
  if (list) {
    list.innerHTML = `<div style="padding:16px; text-align:center; color:var(--text-faint); font-size:11px;">Alert feed cleared. Listening for new breakouts...</div>`;
  }
  state.unreadAlertCount = 0;
  const badge = document.getElementById('alertBellBadge');
  if (badge) badge.textContent = '0';
};

async function pollLiveAlertsAndTracker() {
  try {
    const res = await fetch('/api/alerts');
    const data = await res.json();
    const alerts = data.alerts || [];
    const tracked = data.tracked || [];

    // Render active tracker status
    if (tracked.length > 0) {
      const active = tracked[0];
      const lblSym = document.getElementById('lblActiveTrackedSymbol');
      const lblPrice = document.getElementById('lblActiveTrackedPrice');
      const lblSig = document.getElementById('lblActiveTrackedSignal');
      const lblTgt = document.getElementById('lblActiveTrackedTarget');

      if (lblSym) lblSym.textContent = active.symbol;
      if (lblPrice && active.current_price) lblPrice.textContent = `${active.currency} ${active.current_price.toFixed(2)}`;
      if (lblSig) {
        lblSig.className = `signal-badge ${active.recommendation && active.recommendation.includes('BUY') ? 'buy' : 'sell'}`;
        lblSig.textContent = `${active.recommendation || 'WATCH'} (${active.confidence || 85}%)`;
      }
      if (lblTgt && active.target_price_preset) {
        lblTgt.textContent = `Target: ${active.currency} ${active.target_price_preset.toFixed(2)} | SL: ${active.currency} ${active.stop_loss_preset.toFixed(2)}`;
      }
    }

    // Process incoming alerts
    let newAlertCount = 0;
    alerts.forEach(alert => {
      if (!state.seenAlertIds.has(alert.id)) {
        state.seenAlertIds.add(alert.id);
        newAlertCount++;
        renderAlertItemInFeed(alert);

        const isFresh = (Date.now() / 1000 - alert.timestamp) < 30;
        if (isFresh) {
          playChime(alert.side);
          triggerBrowserNotification(`🚨 ${alert.side} NOW: ${alert.symbol}`, alert.message);
          displaySignalBanner(alert);
          showToast(alert.message, alert.side === 'BUY' ? 'success' : 'error');
        }
      }
    });

    if (newAlertCount > 0) {
      state.unreadAlertCount += newAlertCount;
      const badge = document.getElementById('alertBellBadge');
      if (badge) badge.textContent = state.unreadAlertCount;
    }
  } catch (e) {}
}

function renderAlertItemInFeed(alert) {
  const list = document.getElementById('alertsFeedList');
  if (!list) return;

  if (list.children.length === 1 && list.children[0].textContent.includes('Listening for')) {
    list.innerHTML = '';
  }

  const isBuy = alert.side === 'BUY';
  const item = document.createElement('div');
  item.className = `alert-feed-item ${isBuy ? 'buy' : 'sell'}`;
  item.innerHTML = `
    <div class="alert-feed-top">
      <span class="alert-feed-symbol">${alert.symbol} • ${isBuy ? '🟢 BUY NOW' : '🔴 SELL NOW'}</span>
      <span class="alert-feed-time num">${alert.time_str || ''}</span>
    </div>
    <div class="alert-feed-msg">${alert.message}</div>
    <button type="button" class="alert-feed-action-btn" onclick="quickExecuteFromSignalObj('${alert.symbol}', '${alert.side}', ${alert.target_price}, ${alert.stop_loss})">
      ⚡ 1-Click ${alert.side} (5m)
    </button>
  `;
  list.prepend(item);
}

// ==========================================
// Target Tracker Controls
// ==========================================
window.onTrackerModeChange = function() {
  const mode = document.getElementById('trackTriggerMode')?.value;
  const wrap = document.getElementById('targetPriceInputWrap');
  if (wrap) {
    wrap.style.display = (mode === 'PRICE_ABOVE' || mode === 'PRICE_BELOW') ? 'block' : 'none';
  }
};

window.setTrackerToCurrentSymbol = function() {
  const inp = document.getElementById('trackAssetInput');
  if (inp) inp.value = state.selectedSymbol;
};

window.activateTrackerNow = async function() {
  const inp = document.getElementById('trackAssetInput');
  const symbol = (inp ? inp.value.trim().toUpperCase() : '') || state.selectedSymbol;
  const mode = document.getElementById('trackTriggerMode')?.value || 'AI_SIGNALS';
  const targetPriceVal = parseFloat(document.getElementById('trackTargetPrice')?.value || 0) || null;

  try {
    const res = await fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: symbol,
        mode: mode,
        target_price: targetPriceVal
      })
    });
    const data = await res.json();
    playChime('DING');
    showToast(`🎯 Live 24/7 AI Tracker active for ${symbol}! Scanning every 1.5s.`, 'success');
    pollLiveAlertsAndTracker();
  } catch (e) {
    showToast('Failed to activate tracker', 'error');
  }
};

window.triggerTestAlertNow = async function() {
  const sym = state.selectedSymbol || 'NVDA';
  try {
    const res = await fetch('/api/test-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: sym, mode: 'AI_SIGNALS' })
    });
    const data = await res.json();
    playChime('BUY');
    triggerBrowserNotification(`🚨 TEST ALERT: ${sym}`, data.alert.message);
    displaySignalBanner(data.alert);
    showToast('🔔 Test notification & audio chime fired successfully!', 'success');
  } catch (e) {
    showToast('Failed to trigger test alert', 'error');
  }
};

// ==========================================
// Inline AI Copilot Console
// ==========================================
window.quickAsk = function(promptText) {
  const inp = document.getElementById('inlineAiPromptInput');
  if (inp) inp.value = promptText;
  submitInlineAiPrompt();
};

window.closeInlineAiAnswer = function() {
  const box = document.getElementById('inlineAiAnswerBox');
  if (box) box.style.display = 'none';
};

window.submitInlineAiPrompt = async function() {
  const inp = document.getElementById('inlineAiPromptInput');
  const prompt = inp ? inp.value.trim() : '';
  if (!prompt) return;

  const box = document.getElementById('inlineAiAnswerBox');
  const content = document.getElementById('inlineAiAnswerContent');
  const btn = document.getElementById('btnSubmitInlineAi');

  if (box) box.style.display = 'flex';
  if (content) {
    content.innerHTML = `<em>Thinking... Analyzing live order book, moving averages, RSI, and corporate catalysts for ${state.selectedSymbol}...</em>`;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Analyzing...';
  }

  try {
    const res = await fetch('/api/ai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: state.selectedSymbol,
        message: prompt,
        chat_history: state.chatHistory.slice(-6)
      })
    });
    const data = await res.json();
    playTone(600, 0.15);

    const formatted = formatMarkdownToHtml(data.response);
    if (content) content.innerHTML = formatted;

    state.chatHistory.push({ role: 'user', content: prompt });
    state.chatHistory.push({ role: 'assistant', content: data.response });
  } catch (e) {
    if (content) {
      content.innerHTML = `<span style="color:var(--bearish);">Unable to contact AI engine. Please verify the backend server is running.</span>`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Ask AI Copilot';
    }
  }
};
