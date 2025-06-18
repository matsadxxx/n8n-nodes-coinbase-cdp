import os
import time
import pandas as pd
import logging
from bybit import http # For Bybit v5 HTTP client

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

BYBIT_API_KEY = os.environ.get('BYBIT_API_KEY')
BYBIT_API_SECRET = os.environ.get('BYBIT_API_SECRET')
BYBIT_TESTNET = os.environ.get('BYBIT_TESTNET', 'false').lower() == 'true'

def get_bybit_client():
    """
    Initializes and returns a Bybit HTTP client (v5 API).
    Uses API key/secret from environment variables (BYBIT_API_KEY, BYBIT_API_SECRET) if available.
    Works for public data access without API keys.
    """
    session = http.HTTP(
        testnet=BYBIT_TESTNET,
        api_key=BYBIT_API_KEY,
        api_secret=BYBIT_API_SECRET
    )
    logging.info(f"Bybit client initialized (Testnet: {BYBIT_TESTNET}). API Key Used: {'Yes' if BYBIT_API_KEY else 'No'}")
    return session

def interval_to_ms(interval_str: str) -> int:
    """
    Converts Bybit interval string (e.g., '1', '5', '15', '60', 'D', 'W', 'M') to milliseconds.
    """
    val = 0
    if interval_str.isdigit(): # Standard minute intervals like '1', '3', '5', '15', '30', '60', '120', '240', '360', '720'
        val = int(interval_str) * 60 * 1000
    elif interval_str == 'D':
        val = 24 * 60 * 60 * 1000
    elif interval_str == 'W':
        val = 7 * 24 * 60 * 60 * 1000
    elif interval_str == 'M': # Approximate month
        val = 30 * 24 * 60 * 60 * 1000
    else:
        logging.error(f"Cannot convert interval string '{interval_str}' to milliseconds. Unsupported interval.")
        raise ValueError(f"Invalid or unsupported interval string: {interval_str}")
    return val


def fetch_historical_klines(client, category: str, symbol: str, interval: str,
                            start_time_ms: int, end_time_ms: int, limit_per_request: int = 1000):
    """
    Fetches historical k-line data from Bybit v5 API.

    Args:
        client: Initialized Bybit HTTP client.
        category: Product category (e.g., 'spot', 'linear', 'inverse').
        symbol: Trading pair (e.g., 'BTCUSDT').
        interval: Kline interval (e.g., '1', '15', '60', 'D').
        start_time_ms: Start timestamp in milliseconds.
        end_time_ms: End timestamp in milliseconds.
        limit_per_request: Number of klines per API call (max 1000).

    Returns:
        A Pandas DataFrame with kline data, or an empty DataFrame on error.
        Columns: ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'turnover']
    """
    if not client:
        logging.error("Bybit client is not available.")
        return pd.DataFrame()

    all_klines_data = []
    current_start_ms = start_time_ms

    try:
        kline_interval_ms = interval_to_ms(interval)
    except ValueError as e:
        logging.error(f"Cannot fetch klines due to interval error: {e}")
        return pd.DataFrame()

    logging.info(f"Fetching klines for {symbol} (category: {category}), interval: {interval}, "
                 f"from {pd.to_datetime(start_time_ms, unit='ms')} to {pd.to_datetime(end_time_ms, unit='ms')}")

    while current_start_ms < end_time_ms:
        # Bybit's API limit is 1000 for klines
        actual_limit = min(limit_per_request, 1000)

        # logging.debug(f"Fetching chunk: symbol={symbol}, interval={interval}, category={category}, start_ms={current_start_ms}, limit={actual_limit}")
        try:
            response = client.get_kline(
                category=category,
                symbol=symbol,
                interval=interval,
                start=current_start_ms,
                limit=actual_limit
            )

            if response and response.get('retCode') == 0:
                klines = response.get('result', {}).get('list', [])
                if not klines:
                    logging.debug(f"No more klines for {symbol} in this chunk or before specified start {pd.to_datetime(current_start_ms, unit='ms')}.")
                    break

                all_klines_data.extend(klines)
                # Bybit returns klines with the oldest first. The timestamp of the last kline in the list is the newest one.
                last_kline_ts_in_chunk = int(klines[-1][0])

                # To avoid fetching the same kline again, the next request should start after the last fetched kline.
                current_start_ms = last_kline_ts_in_chunk + kline_interval_ms

                if len(klines) < actual_limit:
                    logging.debug(f"Fetched {len(klines)} klines (less than limit {actual_limit}), assuming end of available historical data for {symbol} in this range.")
                    break

                time.sleep(0.2) # Respect rate limits
            else:
                err_msg = response.get('retMsg', 'Unknown error') if response else 'No response or malformed response'
                ret_code = response.get('retCode') if response else 'N/A'
                logging.error(f"Error fetching klines for {symbol} from Bybit: {err_msg} (Code: {ret_code})")
                if ret_code == 10006: # Specific Bybit rate limit error code
                    logging.warning("Rate limit error (10006) from Bybit. Sleeping for 60 seconds before retrying...")
                    time.sleep(60)
                    # Continue to retry the same chunk in the next iteration
                else: # For other errors, break the loop
                    break
        except Exception as e:
            logging.error(f"Exception during Bybit API call for {symbol}: {e}")
            break # Break on general exception

    if not all_klines_data:
        logging.warning(f"No kline data fetched for {symbol} from {pd.to_datetime(start_time_ms, unit='ms')} to {pd.to_datetime(end_time_ms, unit='ms')}.")
        return pd.DataFrame()

    # Convert to DataFrame
    df = pd.DataFrame(all_klines_data, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume', 'turnover'])

    # Data type conversions
    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
    for col in ['open', 'high', 'low', 'close', 'volume', 'turnover']:
        df[col] = pd.to_numeric(df[col], errors='coerce')

    df.dropna(inplace=True) # Remove rows where numeric conversion might have failed

    # Sort by timestamp, remove duplicates, and filter to be strictly within the requested range
    df = df.sort_values('timestamp').drop_duplicates(subset=['timestamp'], keep='first')

    # Filter data strictly within the *original* requested start_time_ms and end_time_ms
    # This is important because the pagination logic might fetch klines slightly outside this range
    # (e.g., if the last kline_ts_in_chunk + kline_interval_ms goes beyond end_time_ms but the kline itself is still before end_time_ms)
    df = df[(df['timestamp'] >= pd.to_datetime(start_time_ms, unit='ms')) &
              (df['timestamp'] <= pd.to_datetime(end_time_ms, unit='ms'))]

    logging.info(f"Successfully fetched {len(df)} unique klines for {symbol} (category: {category}, interval: {interval}) after processing.")
    return df.reset_index(drop=True)

def subscribe_to_kline_websocket(symbol, interval, callback):
    """
    Placeholder for subscribing to real-time kline data via WebSocket.
    (Implementation details to be added later)
    """
    logging.info(f"Placeholder: Would subscribe to {symbol} {interval} klines via WebSocket.")
    # Example usage (conceptual):
    # ws_client = bybit.WebSocket(testnet=BYBIT_TESTNET, channel_type="spot") # or "linear", "inverse"
    # ws_client.subscribe_kline(symbol, interval, callback)
    # while True: time.sleep(1) # Keep main thread alive for ws
    pass

if __name__ == '__main__':
    logging.info("Testing Bybit client (fetch_historical_klines)...")
    # For this test, ensure BYBIT_API_KEY and BYBIT_API_SECRET are set in your environment
    # if you want to test with authenticated requests. Public endpoints (like spot BTCUSDT) should work without.
    # Set BYBIT_TESTNET='true' or 'false' in your environment. Default is 'false' (mainnet).

    client = get_bybit_client()
    if client:
        symbol_to_test = "BTCUSDT"
        category_to_test = "spot" # 'spot', 'linear', or 'inverse'
        interval_to_test = '15'    # Bybit interval string: '1', '5', '15', '60', 'D', etc.

        # Fetch for a defined period, e.g., last 6 hours
        end_time_ms_test = int(time.time() * 1000)
        start_time_ms_test = end_time_ms_test - (6 * 60 * 60 * 1000) # 6 hours ago

        # Example for fetching 2 days of data (uncomment to test more extensive fetching)
        # start_time_ms_test = end_time_ms_test - (2 * 24 * 60 * 60 * 1000) # 2 days ago

        logging.info(f"Attempting to fetch data for {symbol_to_test}, Category: {category_to_test}, Interval: {interval_to_test} "
                     f"from {pd.to_datetime(start_time_ms_test, unit='ms')} UTC to {pd.to_datetime(end_time_ms_test, unit='ms')} UTC")

        # Using a smaller limit_per_request to test pagination logic more easily
        df_klines = fetch_historical_klines(client, category_to_test, symbol_to_test,
                                            interval_to_test, start_time_ms_test, end_time_ms_test,
                                            limit_per_request=200)

        if not df_klines.empty:
            logging.info(f"Fetched klines data for {symbol_to_test}:")
            print(f"DataFrame Shape: {df_klines.shape}")
            print("First 3 rows:")
            print(df_klines.head(3))
            print("\nLast 3 rows:")
            print(df_klines.tail(3))

            # Validate if timestamps are within the requested range
            if not df_klines.empty:
                is_within_start = df_klines['timestamp'].min() >= pd.to_datetime(start_time_ms_test, unit='ms')
                is_within_end = df_klines['timestamp'].max() <= pd.to_datetime(end_time_ms_test, unit='ms')
                logging.info(f"Data timestamp minimum >= requested start: {is_within_start}")
                logging.info(f"Data timestamp maximum <= requested end: {is_within_end}")

                # Check for continuity (optional, can be verbose)
                # expected_interval_ms = interval_to_ms(interval_to_test)
                # df_klines['time_diff_ms'] = df_klines['timestamp'].diff().dt.total_seconds() * 1000
                # gaps = df_klines[ (df_klines['time_diff_ms'] > expected_interval_ms * 1.1) & (df_klines['time_diff_ms'].notna()) ]
                # if not gaps.empty:
                #    logging.warning(f"Found {len(gaps)} potential gaps or incorrect intervals where time diff > {expected_interval_ms}ms:")
                #    print(gaps[['timestamp', 'time_diff_ms']].head())

        else:
            logging.warning(f"No klines fetched for {symbol_to_test}. "
                             "This could be due to: \n"
                             "1. Incorrect symbol/category combination for Bybit.\n"
                             "2. No trading data available for the symbol in the specified time range.\n"
                             "3. API key issues if the endpoint requires authentication and keys are missing/invalid.\n"
                             "4. Network connectivity problems or Bybit API downtime.\n"
                             "5. Rate limits being hit repeatedly without successful recovery.")
    else:
        logging.error("Failed to initialize Bybit client. Cannot run test.")

    # Example of how interval_to_ms works
    # logging.info(f"Interval '60' is {interval_to_ms('60')} ms")
    # logging.info(f"Interval 'D' is {interval_to_ms('D')} ms")
    # try:
    #     interval_to_ms("X") # Test invalid interval
    # except ValueError as e:
    #     logging.error(f"Error with interval_to_ms: {e}")
