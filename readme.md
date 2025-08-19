# XAUUSD Realtime Analyzer

A single-page web application for realtime analysis of XAUUSD (Gold vs US Dollar) using Finnhub API.

## Features

- Realtime 1-minute candlestick chart
- Technical indicators: RSI(14), MACD(12,26,9), ATR(14)
- Quarterly levels detection (High/Low/Close per quarter)
- ICT Zones detection (FVG and Order Blocks)
- Trading recommendations with confidence scoring
- Dark mode UI with responsive design

## Requirements

- Finnhub API key (free tier available)
- Modern web browser (Chrome, Firefox, Edge)

## Setup

1. Clone this repository or download the files
2. Open `index.html` in a browser
3. Enter your Finnhub API key and click "Connect"

For local development, you can use Python's built-in HTTP server:

```bash
python -m http.server 8000