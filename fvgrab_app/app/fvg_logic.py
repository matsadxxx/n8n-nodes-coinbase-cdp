import pandas as pd
import numpy as np
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def detect_fvgs(kline_df: pd.DataFrame, auto_threshold: bool = True, atr_period_for_sl: int = 14, atr_multiplier_sl: float = 1.0):
    """
    Detects Fair Value Gaps (FVGs) from k-line data.
    Based on the logic provided in the TradingView PineScript.

    :param kline_df: Pandas DataFrame with columns ['timestamp', 'open', 'high', 'low', 'close'].
                     Must be sorted by timestamp.
    :param auto_threshold: Boolean, if True, use dynamic threshold based on bar delta percent.
    :param atr_period_for_sl: Integer, period for ATR calculation for alternative SL (Not implemented in this version).
    :param atr_multiplier_sl: Float, multiplier for ATR based SL (Not implemented in this version).
    :return: List of dictionaries, each representing an FVG.
    """
    if not isinstance(kline_df, pd.DataFrame) or kline_df.shape[0] < 3:
        logging.warning("Input DataFrame is too small to detect FVGs (requires at least 3 rows) or not a DataFrame.")
        return []

    df = kline_df.copy()

    # Ensure required columns exist
    required_cols = ['timestamp', 'open', 'high', 'low', 'close']
    if not all(col in df.columns for col in required_cols):
        logging.error(f"DataFrame must contain columns: {required_cols}")
        return []

    # Shifted data for bar i-1 and i-2
    df['open_m1'] = df['open'].shift(1)
    df['close_m1'] = df['close'].shift(1)
    df['high_m1'] = df['high'].shift(1)
    df['low_m1'] = df['low'].shift(1)

    df['high_m2'] = df['high'].shift(2) # Represents last2High or high[i-2]
    df['low_m2'] = df['low'].shift(2)   # Represents last2Low or low[i-2]

    # Standard bar delta percent for general candle direction (close[i-1] - open[i-1]) / open[i-1]
    # This is for the bar at index i-1 (hence shifted columns are used directly)
    df['bar_delta_percent_standard'] = np.where(
        df['open_m1'].notna() & (df['open_m1'] != 0),
        (df['close_m1'] - df['open_m1']) / df['open_m1'],
        0.0
    )

    # Bar Delta Percent for threshold calculation, as per PineScript: (close[i-1] - open[i-1]) / (open[i-1] * 100)
    # This refers to the bar at index i-1.
    df['bar_delta_percent_for_thresh'] = np.where(
        df['open_m1'].notna() & (df['open_m1'] != 0),
        (df['close_m1'] - df['open_m1']) / (df['open_m1'] * 100.0),
        0.0
    )

    if auto_threshold:
        # Dynamic threshold: (cumulative_abs_delta_sum / bar_indices) * 2
        # This is equivalent to (expanding mean of abs_delta_percent) * 2
        # The threshold is calculated based on bar_delta_percent_for_thresh
        df['dynamic_threshold'] = (df['bar_delta_percent_for_thresh'].abs().expanding(min_periods=1).mean()) * 2
    else:
        df['dynamic_threshold'] = 0.0 # No threshold if auto_threshold is False

    fvgs = []

    # Iterate from the 3rd row (index 2), as we need data from i, i-1, and i-2
    for i in range(2, len(df)):
        # Current bar (bar i)
        current_timestamp = df['timestamp'].iloc[i]
        current_open = df['open'].iloc[i]
        current_high = df['high'].iloc[i]
        current_low = df['low'].iloc[i]
        current_close = df['close'].iloc[i]

        # Previous bar's data (bar i-1) - accessed via iloc[i] on shifted columns
        close_m1_val = df['close_m1'].iloc[i] # close[i-1]

        # Delta percent and threshold for the condition are based on bar i-1
        # bar_delta_percent_for_thresh_cond is value from bar i-1, used in FVG condition
        bar_delta_percent_for_thresh_cond = df['bar_delta_percent_for_thresh'].iloc[i]
        current_dynamic_threshold_val = df['dynamic_threshold'].iloc[i]

        # Standard delta for non-auto_threshold check (bar i-1)
        bar_delta_standard_val = df['bar_delta_percent_standard'].iloc[i]

        # Data from 2 bars ago (bar i-2) - accessed via iloc[i] on doubly shifted columns
        high_m2_val = df['high_m2'].iloc[i] # high[i-2]
        low_m2_val = df['low_m2'].iloc[i]   # low[i-2]

        fvg_base_details = {
            'timestamp': current_timestamp, # Timestamp of the candle completing the FVG (candle i)
            'fvg_bar_open': current_open,
            'fvg_bar_high': current_high,
            'fvg_bar_low': current_low,
            'fvg_bar_close': current_close,
            'triggering_bar_delta_for_thresh': bar_delta_percent_for_thresh_cond, # from bar i-1
            'threshold_value': current_dynamic_threshold_val if auto_threshold else 0.0 # from bar i-1
        }

        # Bullish FVG Detection
        # Pine: bullishFairValueGap = currentLow > last2High and lastClose > last2High and barDeltaPercent > threshold
        # currentLow = current_low (from bar i)
        # last2High = high_m2_val (from bar i-2)
        # lastClose = close_m1_val (from bar i-1)
        # barDeltaPercent (for condition) = bar_delta_percent_for_thresh_cond (from bar i-1)
        # threshold = current_dynamic_threshold_val (based on bar i-1 deltas)

        cond1_bullish = current_low > high_m2_val
        cond2_bullish = close_m1_val > high_m2_val

        if auto_threshold:
            cond3_bullish = bar_delta_percent_for_thresh_cond > current_dynamic_threshold_val
        else:
            # If not auto_threshold, check if the standard delta of bar i-1 was positive
            cond3_bullish = bar_delta_standard_val > 0

        if cond1_bullish and cond2_bullish and cond3_bullish:
            fvg_top_price = current_low    # Top of the gap is the low of the current bar (i)
            fvg_bottom_price = high_m2_val # Bottom of the gap is the high of bar i-2

            if fvg_top_price > fvg_bottom_price: # Ensure a gap actually exists
                entry = (fvg_top_price + fvg_bottom_price) / 2
                stop_loss = low_m2_val # SL is the low of bar i-2

                if entry > stop_loss : # Ensure SL is meaningful (below entry for bullish)
                    take_profit = entry + 2 * (entry - stop_loss)

                    fvg_details = fvg_base_details.copy()
                    fvg_details.update({
                        'type': 'bullish',
                        'fvg_top': fvg_top_price,
                        'fvg_bottom': fvg_bottom_price,
                        'entry_price': entry,
                        'stop_loss': stop_loss,
                        'take_profit': take_profit,
                    })
                    fvgs.append(fvg_details)

        # Bearish FVG Detection
        # Pine: bearishFairValueGap = currentHigh < last2Low and lastClose < last2Low and -barDeltaPercent > threshold
        # currentHigh = current_high (from bar i)
        # last2Low = low_m2_val (from bar i-2)
        # lastClose = close_m1_val (from bar i-1)
        # -barDeltaPercent (for condition) = -bar_delta_percent_for_thresh_cond (from bar i-1)
        # threshold = current_dynamic_threshold_val (based on bar i-1 deltas)

        cond1_bearish = current_high < low_m2_val
        cond2_bearish = close_m1_val < low_m2_val

        if auto_threshold:
            cond3_bearish = (-bar_delta_percent_for_thresh_cond) > current_dynamic_threshold_val
        else:
            # If not auto_threshold, check if the standard delta of bar i-1 was negative
            cond3_bearish = bar_delta_standard_val < 0

        if cond1_bearish and cond2_bearish and cond3_bearish:
            fvg_top_price = low_m2_val      # Top of the gap is the low of bar i-2
            fvg_bottom_price = current_high # Bottom of the gap is the high of current bar (i)

            if fvg_top_price > fvg_bottom_price: # Ensure a gap actually exists
                entry = (fvg_top_price + fvg_bottom_price) / 2
                stop_loss = high_m2_val # SL is the high of bar i-2

                if entry < stop_loss: # Ensure SL is meaningful (above entry for bearish)
                    take_profit = entry - 2 * (stop_loss - entry)

                    fvg_details = fvg_base_details.copy()
                    fvg_details.update({
                        'type': 'bearish',
                        'fvg_top': fvg_top_price,
                        'fvg_bottom': fvg_bottom_price,
                        'entry_price': entry,
                        'stop_loss': stop_loss,
                        'take_profit': take_profit,
                    })
                    fvgs.append(fvg_details)

    if len(fvgs) > 0:
        logging.info(f"Detected {len(fvgs)} FVGs.")
    else:
        logging.info("No FVGs detected with the given criteria.")
    return fvgs

if __name__ == '__main__':
    logging.info("Testing FVG Detection Logic...")

    # Common structure for printing FVG details
    def print_fvg_details(fvg_list, test_name):
        logging.info(f"--- {test_name} ---")
        if not fvg_list:
            print("No FVGs detected.")
            return
        for fvg in fvg_list:
            print(f"  Type: {fvg['type']}, Timestamp: {fvg['timestamp'].strftime('%Y-%m-%d %H:%M')}, "
                  f"FVG Bar O: {fvg['fvg_bar_open']:.2f} H: {fvg['fvg_bar_high']:.2f} L: {fvg['fvg_bar_low']:.2f} C: {fvg['fvg_bar_close']:.2f}, "
                  f"Gap Top: {fvg['fvg_top']:.2f}, Gap Bottom: {fvg['fvg_bottom']:.2f}, "
                  f"Entry: {fvg['entry_price']:.2f}, SL: {fvg['stop_loss']:.2f}, TP: {fvg['take_profit']:.2f}, "
                  f"Trig Delta: {fvg['triggering_bar_delta_for_thresh']:.6f}, Thresh: {fvg['threshold_value']:.6f}")

    # Bullish FVG example data:
    # Bar 0 (i-2): O=100 H=103 L=99  C=102
    # Bar 1 (i-1): O=102 H=106 L=101 C=105 (Strong bullish bar. open_m1=102, close_m1=105 for bar_delta calc)
    #              bar_delta_standard = (105-102)/102 = 0.0294
    #              bar_delta_for_thresh = (105-102)/(102*100) = 0.000294
    # Bar 2 (i)  : O=108 H=110 L=107 C=109
    # Conditions for FVG at bar 2 (timestamp: 2023-01-02 00:10):
    #   current_low (107) > high_m2 (103 from bar 0) -> TRUE
    #   close_m1 (105 from bar 1) > high_m2 (103 from bar 0) -> TRUE
    #   auto_threshold=True:
    #     Threshold for bar 1 (iloc[1] for delta, iloc[2] for FVG):
    #       abs_delta_thresh_b0 = 0 (no m1)
    #       abs_delta_thresh_b1 = abs(0.000294)
    #       dynamic_thresh at bar 1 (for FVG at bar 2) = (0 + 0.000294)/2 * 2 = 0.000294 (approx, depends on prior values if any)
    #       If only this bar, expanding mean is abs(0.000294). Threshold = abs(0.000294)*2
    #       cond3: 0.000294 > 0.000294 * 2 -> FALSE (unless there are prior smaller values making mean smaller)
    #       Let's assume threshold is small enough or bar_delta_for_thresh is large enough.
    #       If it's the first possible calculation for threshold (index 1 for delta, FVG at index 2):
    #       df['bar_delta_percent_for_thresh'].abs().iloc[1] = 0.0002941176
    #       df['dynamic_threshold'].iloc[2] = (df['bar_delta_percent_for_thresh'].abs().iloc[1] + df['bar_delta_percent_for_thresh'].abs().iloc[2 - (shift for delta)]) / N * 2
    #       This is tricky. Dynamic threshold at row `i` is based on `bar_delta_percent_for_thresh` at row `i`.
    #       So `bar_delta_percent_for_thresh.iloc[i]` (from bar i-1) vs `dynamic_threshold.iloc[i]` (calculated using bar i-1's delta).
    #   auto_threshold=False:
    #     bar_delta_standard (0.0294) > 0 -> TRUE
    # FVG: Top=107 (current_low), Bottom=103 (high_m2). Entry=(107+103)/2=105. SL=99 (low_m2). TP=105+2*(105-99)=117.

    bullish_data = {
        'timestamp': pd.to_datetime(['2023-01-02 00:00', '2023-01-02 00:05', '2023-01-02 00:10', '2023-01-02 00:15']),
        'open':  [100, 102, 108, 100],
        'high':  [103, 106, 110, 100],
        'low':   [99,  101, 107, 100],
        'close': [102, 105, 109, 100]
    }
    bullish_sample_df = pd.DataFrame(bullish_data)

    detected_fvgs_bullish_auto = detect_fvgs(bullish_sample_df.copy(), auto_threshold=True)
    print_fvg_details(detected_fvgs_bullish_auto, "Bullish FVG Test (auto_threshold=True)")
    # Expected: One bullish FVG at 00:10.
    # bar_delta_for_thresh[i=2] (from bar i-1, open=102, close=105) = (105-102)/(102*100) = 3/10200 = 0.0002941176
    # dynamic_threshold[i=2]:
    #   Shifted values for row 0: all NaN
    #   Shifted values for row 1: open_m1=100, close_m1=102. delta_thresh_1 = (102-100)/(100*100) = 0.0002
    #   Shifted values for row 2: open_m1=102, close_m1=105. delta_thresh_2 = 0.0002941176
    #   dynamic_threshold at row 2 = mean(abs(0.0002), abs(0.0002941176)) * 2 = (0.0002 + 0.0002941176)/2 * 2 = 0.0004941176
    #   Condition: 0.0002941176 > 0.0004941176 -> FALSE. So this specific setup might NOT trigger with auto.
    #   Let's adjust bar 1 to be less strong, so threshold is lower for bar 2's FVG.
    #   Or make bar 2 delta much stronger.
    #   The expanding mean includes the current row's delta for threshold calc.
    #   So for row `i` (FVG bar), threshold uses `bar_delta_percent_for_thresh[i]`.
    #   Correct: `dynamic_threshold.iloc[i]` is calculated considering `bar_delta_percent_for_thresh.iloc[i]`
    #   So cond3 is `df['bar_delta_percent_for_thresh'].iloc[i] > df['dynamic_threshold'].iloc[i]`
    #   This can only be true if current delta is much larger than average * 2, or if previous deltas were negative making current positive stand out.
    #   The formula `mean * 2` means current value must be more than twice the mean (including itself). This is hard.
    #   Perhaps threshold should be based on mean of *previous* values?
    #   The PineScript `ta.cum(val) / bar_index` is an expanding mean.
    #   If `barDeltaPercent > (ta.cum(abs(barDeltaPercent)) / bar_index * 2)`, the current `barDeltaPercent` must be positive.
    #   And `barDeltaPercent > abs(barDeltaPercent).expanding().mean() * 2`.
    #   This means `barDeltaPercent` must be positive and greater than twice its own historical average magnitude.

    detected_fvgs_bullish_manual = detect_fvgs(bullish_sample_df.copy(), auto_threshold=False)
    print_fvg_details(detected_fvgs_bullish_manual, "Bullish FVG Test (auto_threshold=False)")
    # Expected: One bullish FVG at 00:10. bar_delta_standard for bar 1 = (105-102)/102 = 0.0294 > 0. TRUE.

    # Bearish FVG example data:
    # Bar 0 (i-2): O=115 H=118 L=112 C=112
    # Bar 1 (i-1): O=112 H=115 L=110 C=109 (Strong bearish. open_m1=112, close_m1=109)
    #              bar_delta_standard = (109-112)/112 = -0.0267
    #              bar_delta_for_thresh = (109-112)/(112*100) = -0.000267
    # Bar 2 (i)  : O=105 H=108 L=104 C=106
    # Conditions for FVG at bar 2 (timestamp: 2023-01-03 00:10):
    #   current_high (108) < low_m2 (112 from bar 0) -> TRUE
    #   close_m1 (109 from bar 1) < low_m2 (112 from bar 0) -> TRUE
    #   auto_threshold=False:
    #     bar_delta_standard (-0.0267) < 0 -> TRUE
    # FVG: Top=112 (low_m2), Bottom=108 (current_high). Entry=(112+108)/2=110. SL=118 (high_m2). TP=110-2*(118-110)=110-16=94.
    bearish_data = {
        'timestamp': pd.to_datetime(['2023-01-03 00:00', '2023-01-03 00:05', '2023-01-03 00:10', '2023-01-03 00:15']),
        'open':  [115, 112, 105, 100],
        'high':  [118, 115, 108, 100],
        'low':   [112, 110, 104, 100],
        'close': [112, 109, 106, 100]
    }
    bearish_sample_df = pd.DataFrame(bearish_data)
    detected_fvgs_bearish_auto = detect_fvgs(bearish_sample_df.copy(), auto_threshold=True)
    print_fvg_details(detected_fvgs_bearish_auto, "Bearish FVG Test (auto_threshold=True)")

    detected_fvgs_bearish_manual = detect_fvgs(bearish_sample_df.copy(), auto_threshold=False)
    print_fvg_details(detected_fvgs_bearish_manual, "Bearish FVG Test (auto_threshold=False)")
    # Expected: One bearish FVG at 00:10.

    # Test case: No FVG
    no_fvg_data = {
        'timestamp': pd.to_datetime(['2023-01-04 00:00', '2023-01-04 00:05', '2023-01-04 00:10', '2023-01-04 00:15']),
        'open':  [100, 101, 102, 103],
        'high':  [101, 102, 103, 104], # No gap: current_low (102) not > high_m2 (101) for bullish, current_high (103) not < low_m2 (100) for bearish
        'low':   [99,  100, 101, 102],
        'close': [101, 102, 103, 104]
    }
    no_fvg_df = pd.DataFrame(no_fvg_data)
    detected_no_fvgs_auto = detect_fvgs(no_fvg_df.copy(), auto_threshold=True)
    print_fvg_details(detected_no_fvgs_auto, "No FVG Test (auto_threshold=True)")

    detected_no_fvgs_manual = detect_fvgs(no_fvg_df.copy(), auto_threshold=False)
    print_fvg_details(detected_no_fvgs_manual, "No FVG Test (auto_threshold=False)")

    # Test with a stronger delta for auto_threshold to pass
    # Bar 0 (i-2): O=100 H=103 L=99  C=100 (weak bar 0) delta_thresh_0_val = (100-100)/(100*100) = 0
    # Bar 1 (i-1): O=100 H=120 L=99  C=119 (very strong bullish bar. open_m1=100, close_m1=119)
    #              bar_delta_for_thresh = (119-100)/(100*100) = 19/10000 = 0.0019
    # Bar 2 (i)  : O=125 H=130 L=122 C=128
    # Conditions for FVG at bar 2:
    #   current_low (122) > high_m2 (103) -> TRUE
    #   close_m1 (119) > high_m2 (103) -> TRUE
    #   auto_threshold=True:
    #     delta_thresh_bar0_shifted_to_row1 = 0
    #     delta_thresh_bar1_shifted_to_row2 = 0.0019
    #     dynamic_threshold at row 2 = mean(abs(0), abs(0.0019)) * 2 = (0 + 0.0019)/2 * 2 = 0.0019
    #     cond3: 0.0019 > 0.0019 -> FALSE. Still needs to be strictly greater.
    #     Let's make bar 0 have a negative delta to lower the mean.
    # Bar 0 (i-2): O=103 H=104 L=99  C=100 (bearish bar 0) delta_thresh_0_val = (100-103)/(103*100) = -3/10300 approx -0.00029
    #     dynamic_threshold at row 2 = mean(abs(-0.00029), abs(0.0019)) * 2 = (0.00029 + 0.0019)/2 * 2 = 0.00219
    #     cond3: 0.0019 > 0.00219 -> FALSE.

    # The condition `current_delta > expanding_mean(abs(all_deltas_including_current)) * 2` is very strict.
    # A value is rarely more than twice the mean that includes itself, unless other values are negative or much smaller.
    # For PineScript: `barDeltaPercent > dynThresh` where `dynThresh = (ta.cum(math.abs(barDeltaPercent)) / bar_index) * 2`
    # Let's trace:
    # bar_idx | barDeltaPercent | abs(BDP) | cum(abs(BDP)) | mean(abs(BDP)) | dynThresh | BDP > dynThresh?
    # 1       | 0.0002          | 0.0002   | 0.0002        | 0.0002         | 0.0004    | F (0.0002 !> 0.0004)
    # 2       | 0.0019          | 0.0019   | 0.0021        | 0.00105        | 0.0021    | F (0.0019 !> 0.0021)
    # This interpretation means auto-threshold might rarely trigger.
    # The PineScript might be `barDeltaPercent[0] > threshold[1]` (current bar vs prev bar's threshold)
    # Or threshold is not using current bar's delta in its own calculation.
    # If `dynamic_threshold` for bar `i` is based on `bar_delta_percent_for_thresh` up to `i-1`, then:
    # Modify: `df['dynamic_threshold'] = (df['bar_delta_percent_for_thresh'].abs().shift(1).expanding(min_periods=1).mean()) * 2`
    # This seems more plausible for a threshold. Let's stick to the current interpretation first as per instructions.

    strong_bullish_data = {
        'timestamp': pd.to_datetime(['2023-01-05 00:00', '2023-01-05 00:05', '2023-01-05 00:10', '2023-01-05 00:15']),
        'open':  [103, 100, 125, 100], # bar0 open=103, bar1 open=100
        'high':  [104, 120, 130, 100], # bar0 high=104 (high_m2 for FVG bar)
        'low':   [99,  99,  122, 100], # bar2 low=122 (current_low for FVG bar)
        'close': [100, 119, 128, 100]  # bar0 close=100, bar1 close=119 (close_m1 for FVG bar)
    }
    # Bar 0 (shifted to row 1 for delta calc): (100-103)/(103*100) = -0.00029126
    # Bar 1 (shifted to row 2 for delta calc): (119-100)/(100*100) = 0.0019
    # FVG at Bar 2 (row 2):
    #   delta_for_thresh = 0.0019 (from bar 1)
    #   dyn_thresh at row 2: mean(abs(-0.00029126), abs(0.0019)) * 2 = (0.00029126 + 0.0019)/2 * 2 = 0.00219126
    #   Cond3: 0.0019 > 0.00219126 -> FALSE.

    # The logic for `auto_threshold` as `abs(bar_delta_percent).expanding().mean() * 2` makes it very
    # hard for `bar_delta_percent > dynamic_threshold` to be true.
    # The PineScript's `bar_index` in `ta.cum(math.abs(barDeltaPercent)) / bar_index` is 1-based and continuous.
    # Pandas `expanding().mean()` correctly reflects this.
    # This implies the FVG requires a *very* strong bar compared to its history if auto_threshold is on.

    logging.info("\nFinal check on strong_bullish_data (auto_threshold=True)")
    strong_bullish_df = pd.DataFrame(strong_bullish_data)
    detected_strong_bullish_auto = detect_fvgs(strong_bullish_df.copy(), auto_threshold=True)
    print_fvg_details(detected_strong_bullish_auto, "Strong Bullish FVG Test (auto_threshold=True)")
    # Expected: Still likely no FVG due to threshold logic. Will pass if my manual trace is off.

    logging.info("\nFinal check on strong_bullish_data (auto_threshold=False)")
    detected_strong_bullish_manual = detect_fvgs(strong_bullish_df.copy(), auto_threshold=False)
    print_fvg_details(detected_strong_bullish_manual, "Strong Bullish FVG Test (auto_threshold=False)")
    # Expected: Should detect FVG at 00:10.
    #   current_low (122) > high_m2 (104) -> T
    #   close_m1 (119) > high_m2 (104) -> T
    #   bar_delta_standard for bar 1 = (119-100)/100 = 0.19 > 0 -> T. Yes.
    #   FVG: top=122, bottom=104. entry=(122+104)/2=113. SL=low_m2(bar0 low)=99. TP=113+2*(113-99)=113+28=141.

    # Test with a very small starting open price to check float precision issues with delta percent
    small_price_data = {
        'timestamp': pd.to_datetime(['2023-01-06 00:00', '2023-01-06 00:05', '2023-01-06 00:10']),
        'open':  [0.1, 0.12, 0.18],
        'high':  [0.13, 0.16, 0.20],
        'low':   [0.09, 0.11, 0.17],
        'close': [0.12, 0.15, 0.19]
    }
    # Bar 0: O=0.1 H=0.13 L=0.09 C=0.12
    # Bar 1: O=0.12 H=0.16 L=0.11 C=0.15. Delta_std=(0.15-0.12)/0.12=0.25. Delta_thresh=(0.15-0.12)/(0.12*100)=0.0025
    # Bar 2: O=0.18 H=0.20 L=0.17 C=0.19
    # FVG at Bar 2 (auto=false):
    #   low[2](0.17) > high[0](0.13) -> T
    #   close[1](0.15) > high[0](0.13) -> T
    #   delta_std[1](0.25) > 0 -> T. Yes.
    #   FVG: top=0.17, bot=0.13. entry=(0.17+0.13)/2=0.15. SL=low[0](0.09). TP=0.15+2*(0.15-0.09)=0.15+0.12=0.27
    small_price_df = pd.DataFrame(small_price_data)
    logging.info("\nTesting with small price data (auto_threshold=False):")
    detected_small_price_manual = detect_fvgs(small_price_df.copy(), auto_threshold=False)
    print_fvg_details(detected_small_price_manual, "Small Price FVG Test (auto_threshold=False)")

    # Test with insufficient data
    logging.info("\nTesting with insufficient data:")
    insufficient_df = bullish_sample_df.head(2)
    detected_insufficient = detect_fvgs(insufficient_df.copy())
    print_fvg_details(detected_insufficient, "Insufficient Data Test")

    # Test with missing columns
    logging.info("\nTesting with missing columns:")
    missing_cols_df = bullish_sample_df[['timestamp', 'open', 'high', 'low']].copy()
    detected_missing_cols = detect_fvgs(missing_cols_df)
    print_fvg_details(detected_missing_cols, "Missing Columns Test")
