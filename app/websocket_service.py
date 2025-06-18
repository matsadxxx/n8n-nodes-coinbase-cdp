# app/websocket_service.py
import asyncio
import logging
import pandas as pd
import json
import os # For environment variable
from bybit.v5 import WebSocketClient
from app.fvg_logic import detect_fvgs

# Get BYBIT_TESTNET flag, default to False if not set
BYBIT_TESTNET_STR = os.environ.get('BYBIT_TESTNET', 'false')
BYBIT_TESTNET_FLAG = BYBIT_TESTNET_STR.lower() == 'true'


class KlineBuffer:
    def __init__(self, max_klines=200): # Ensure enough for FVG logic + context
        self.klines = [] # Store as list of dicts
        self.max_klines = max_klines
        # Standardized column names expected by detect_fvgs
        self.columns = ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'turnover']

    def add_kline(self, kline_data_list): # Bybit often sends a list with one kline object
        if not kline_data_list:
            return False # No data added

        kline_item = kline_data_list[0] # data is usually a list containing one dict for kline

        # Validate all expected fields are in kline_item
        expected_fields = ['start', 'open', 'high', 'low', 'close', 'volume']
        if not all(field in kline_item for field in expected_fields):
            logging.warning(f"Kline item missing expected fields: {kline_item}")
            return False

        new_kline = {
            'timestamp': pd.to_datetime(int(kline_item['start']), unit='ms'), # 'start' is kline open time
            'open': float(kline_item['open']),
            'high': float(kline_item['high']),
            'low': float(kline_item['low']),
            'close': float(kline_item['close']),
            'volume': float(kline_item['volume']),
            'turnover': float(kline_item.get('turnover', 0.0)) # Turnover might not always be there
        }

        updated_existing = False
        if self.klines and self.klines[-1]['timestamp'] == new_kline['timestamp']:
            self.klines[-1] = new_kline
            updated_existing = True
        else:
            self.klines.append(new_kline)

        while len(self.klines) > self.max_klines:
            self.klines.pop(0)

        return True # Data was added/updated

    def get_df(self):
        if not self.klines:
            return pd.DataFrame(columns=self.columns)
        df = pd.DataFrame(self.klines)
        # Ensure required columns even if some are all NaN (e.g. turnover if never present)
        for col in self.columns:
            if col not in df:
                df[col] = 0.0 if col not in ['timestamp'] else pd.NaT
        return df.sort_values(by='timestamp').reset_index(drop=True)


class RealtimeFVGDetector:
    def __init__(self, category: str, symbol: str, interval: str, connection_manager,
                 loop, # Pass the main asyncio event loop
                 bybit_api_key=None, bybit_api_secret=None):
        self.category = category
        self.symbol = symbol
        self.interval = interval
        self.connection_manager = connection_manager
        self.kline_buffer = KlineBuffer(max_klines=50)
        self.last_detected_fvgs_signatures = set()
        self.bybit_ws_client = None
        self.is_running = False
        self.bybit_executor_task = None # For run_in_executor
        self.main_loop = loop # Main FastAPI event loop

        # Topic for Bybit v5 public klines
        self.topic = f"kline.{self.interval}.{self.symbol}"
        logging.info(f"RealtimeFVGDetector initialized for {self.symbol} on topic {self.topic} (Testnet: {BYBIT_TESTNET_FLAG})")

    def _sync_bybit_message_handler(self, msg):
        # This handler is called by the Bybit WebSocket's thread.
        # It needs to schedule the async part (_handle_bybit_message_async)
        # onto the main FastAPI event loop.
        asyncio.run_coroutine_threadsafe(self._handle_bybit_message_async(msg), self.main_loop)

    async def _handle_bybit_message_async(self, msg):
        # This method runs in the main FastAPI event loop.
        # logging.debug(f"Bybit WS Async Handler Msg ({self.symbol}): {msg}")
        try:
            if msg and isinstance(msg, dict) and msg.get("topic") == self.topic:
                data = msg.get("data")
                if data and isinstance(data, list):
                    if not self.kline_buffer.add_kline(data): # If data was not valid or not added
                        return

                    kline_df = self.kline_buffer.get_df()

                    if kline_df.shape[0] < 3: # Not enough data for FVG detection
                        return

                    # logging.debug(f"Detecting FVGs for {self.symbol} on {kline_df.shape[0]} klines. Last: {kline_df.iloc[-1]['timestamp']}")
                    current_fvgs = detect_fvgs(kline_df, auto_threshold=True) # Default to auto_threshold=True for realtime

                    new_fvgs_found_this_tick = []
                    for fvg in current_fvgs:
                        fvg_timestamp_dt = pd.to_datetime(fvg['timestamp'])
                        # Signature: (FVG_form_timestamp_ms, type, top_price, bottom_price)
                        sig = (int(fvg_timestamp_dt.timestamp() * 1000), fvg['type'], fvg['fvg_top'], fvg['fvg_bottom'])

                        if sig not in self.last_detected_fvgs_signatures:
                            self.last_detected_fvgs_signatures.add(sig)
                            # To prevent set from growing indefinitely, implement a cleanup if needed (e.g. TTL or max size)
                            fvg_copy = fvg.copy() # Avoid modifying original dict from detect_fvgs if it's reused
                            fvg_copy['timestamp'] = fvg_timestamp_dt.isoformat() # Convert datetime to string for JSON
                            new_fvgs_found_this_tick.append(fvg_copy)

                    if new_fvgs_found_this_tick:
                        logging.info(f"New FVGs detected for {self.symbol} ({self.interval}): {len(new_fvgs_found_this_tick)}")
                        await self.connection_manager.broadcast_to_key(
                            f"{self.category}_{self.symbol}_{self.interval}",
                            json.dumps({"type": "new_fvg", "symbol": self.symbol, "interval": self.interval, "data": new_fvgs_found_this_tick})
                        )
            elif msg and isinstance(msg, dict) and "op" in msg and msg.get("op") == "subscribe":
                 logging.info(f"Subscription to {msg.get('args')} for {self.symbol} status: success={msg.get('success')}, msg={msg.get('ret_msg')}")
            elif msg and isinstance(msg, dict) and "op" in msg and msg.get("op") == "auth":
                 logging.info(f"Authentication for {self.symbol} status: success={msg.get('success')}, msg={msg.get('ret_msg')}")

        except Exception as e:
            logging.error(f"Error in _handle_bybit_message_async for {self.symbol} {self.interval}: {e}", exc_info=True)


    async def start(self):
        if self.is_running:
            logging.warning(f"Detector for {self.symbol} {self.interval} already running.")
            return

        logging.info(f"Starting RealtimeFVGDetector for {self.symbol} {self.interval}")
        self.is_running = True

        self.bybit_ws_client = WebSocketClient(
            testnet=BYBIT_TESTNET_FLAG,
            channel_type="public",
            message_handler=self._sync_bybit_message_handler # Pass the synchronous wrapper
        )
        self.bybit_ws_client.subscribe(self.topic)

        # Run the blocking WebSocket client in a separate thread using asyncio's default executor
        self.bybit_executor_task = self.main_loop.run_in_executor(None, self.bybit_ws_client.run_forever)
        logging.info(f"Bybit WebSocket client for {self.symbol} {self.interval} scheduled in background executor.")


    async def stop(self):
        if not self.is_running:
            logging.info(f"Detector for {self.symbol} {self.interval} already stopped or not started.")
            return

        logging.info(f"Attempting to stop RealtimeFVGDetector for {self.symbol} {self.interval}...")
        self.is_running = False # Prevent new operations or restarts

        if self.bybit_ws_client:
            try:
                self.bybit_ws_client.exit()
                logging.info(f"Bybit WS client exit() called for {self.symbol} {self.interval}.")
            except Exception as e:
                logging.error(f"Error calling exit() on Bybit WS client for {self.symbol} {self.interval}: {e}")

        if self.bybit_executor_task:
            try:
                # Wait for the executor task to complete.
                # This task is running run_forever(), which blocks until exit() is effective.
                await asyncio.wait_for(self.bybit_executor_task, timeout=10.0) # Increased timeout
                logging.info(f"Bybit WS background task for {self.symbol} {self.interval} has completed.")
            except asyncio.TimeoutError:
                logging.warning(f"Timeout waiting for Bybit WS task for {self.symbol} {self.interval} to stop. It might be stuck or taking longer to exit.")
            except Exception as e:
                logging.error(f"Exception while waiting for Bybit WS task for {self.symbol} {self.interval} to stop: {e}")

        self.bybit_ws_client = None
        self.bybit_executor_task = None
        self.last_detected_fvgs_signatures.clear() # Clear cache for next potential start
        logging.info(f"RealtimeFVGDetector for {self.symbol} {self.interval} has been stopped.")

# Note: Global manager for detectors (active_detectors dict) will be in main.py
# to avoid circular dependencies and keep service layer focused on detection logic.
