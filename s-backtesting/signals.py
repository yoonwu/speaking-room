"""셋업/트리거 신호 생성.

구조: 조건(RSI 다이버전스) → 자리(수평 S/R, 피보 61.8~78.6, 볼린저 재진입) → 방아쇠(캔들 반전, MACD)

룩어헤드 방지 원칙:
- 피벗(스윙 고점/저점)은 좌우 k봉 확인이 끝나는 `pivot+k` 봉에서만 "확정"으로 취급.
- 모든 배열은 i번째 봉 종가 시점에 알 수 있는 정보만으로 계산됨. 진입은 i+1봉 시가.
"""
import numpy as np

from indicators import atr, bollinger, macd, rsi

DIV_VALID = 15        # 다이버전스 확정 후 유효 봉수
DIV_MIN_SPACING = 5   # 다이버전스 두 피벗 간 최소 간격
DIV_MAX_SPACING = 60  # 최대 간격
RSI_OB = 60.0         # 하락 다이버전스: 첫 고점 RSI 최소값
RSI_OS = 40.0         # 상승 다이버전스: 첫 저점 RSI 최대값
SR_WINDOW = 250       # S/R 레벨 유효 기간(봉)
FIB_MIN_IMPULSE_ATR = 2.0
BB_FLAT_ATR = 1.0     # 볼린저 중심선 10봉 변화가 이 ATR 배수 이하일 때만(밴드 수평 필터)
BB_REENTRY_LOOKBACK = 3


def find_pivots(high, low, k):
    """확정 시점 기준 피벗. 반환: [(pivot_idx, confirm_idx)]"""
    n = len(high)
    ph, pl = [], []
    for i in range(k, n - k):
        wh = high[i - k:i + k + 1]
        if high[i] >= wh.max() and int(np.argmax(wh)) == k:
            ph.append((i, i + k))
        wl = low[i - k:i + k + 1]
        if low[i] <= wl.min() and int(np.argmin(wl)) == k:
            pl.append((i, i + k))
    return ph, pl


def build_context(df, rsi_period: int, pivot_k: int) -> dict:
    o = df["Open"].to_numpy(float)
    h = df["High"].to_numpy(float)
    l = df["Low"].to_numpy(float)
    c = df["Close"].to_numpy(float)
    n = len(c)

    rsi_v = rsi(c, rsi_period)
    atr_v = atr(h, l, c, 14)
    mid, upper, lower = bollinger(c, 20, 2.0)
    _, macd_sig, macd_hist = macd(c)
    macd_line = macd_hist + macd_sig

    ph, pl = find_pivots(h, l, pivot_k)

    # ---------- 1) RSI 다이버전스 (조건) ----------
    bear_div = np.zeros(n, bool)
    bull_div = np.zeros(n, bool)
    bear_swing = np.full(n, np.nan)  # 다이버전스 스윙 고점(⑯ 트리거의 손절 기준)
    bull_swing = np.full(n, np.nan)

    prev = None
    for p, conf in ph:
        if prev is not None:
            pp = prev
            if (DIV_MIN_SPACING <= p - pp <= DIV_MAX_SPACING
                    and h[p] > h[pp] and rsi_v[p] < rsi_v[pp] and rsi_v[pp] >= RSI_OB):
                end = min(conf + DIV_VALID, n)
                bear_div[conf:end] = True
                bear_swing[conf:end] = h[p]
        prev = p
    prev = None
    for p, conf in pl:
        if prev is not None:
            pp = prev
            if (DIV_MIN_SPACING <= p - pp <= DIV_MAX_SPACING
                    and l[p] < l[pp] and rsi_v[p] > rsi_v[pp] and rsi_v[pp] <= RSI_OS):
                end = min(conf + DIV_VALID, n)
                bull_div[conf:end] = True
                bull_swing[conf:end] = l[p]
        prev = p

    # ---------- 2) 자리 필터 ----------
    # ① 수평 S/R: 확정 피벗들을 0.5*ATR 간격으로 클러스터링, 2회 이상 반응한 레벨만 인정
    sr_short = np.zeros(n, bool)
    sr_long = np.zeros(n, bool)
    res_levels = []  # [sum, cnt, last_touch_idx] — 저항(피벗 고점 클러스터)
    sup_levels = []
    ph_i, pl_i = 0, 0
    for i in range(n):
        a = atr_v[i]
        while ph_i < len(ph) and ph[ph_i][1] == i:
            p = ph[ph_i][0]
            price, tol = h[p], 0.5 * a
            for lv in res_levels:
                if abs(lv[0] / lv[1] - price) <= tol:
                    lv[0] += price; lv[1] += 1; lv[2] = i
                    break
            else:
                res_levels.append([price, 1, i])
            ph_i += 1
        while pl_i < len(pl) and pl[pl_i][1] == i:
            p = pl[pl_i][0]
            price, tol = l[p], 0.5 * a
            for lv in sup_levels:
                if abs(lv[0] / lv[1] - price) <= tol:
                    lv[0] += price; lv[1] += 1; lv[2] = i
                    break
            else:
                sup_levels.append([price, 1, i])
            pl_i += 1
        res_levels = [lv for lv in res_levels if i - lv[2] <= SR_WINDOW]
        sup_levels = [lv for lv in sup_levels if i - lv[2] <= SR_WINDOW]
        if a > 0:
            for lv in res_levels:
                lvl = lv[0] / lv[1]
                # 저항 레벨이 종가 위 1ATR 이내(살짝 찌른 것 -0.25ATR까지 허용)
                if lv[1] >= 2 and -0.25 * a <= lvl - c[i] <= 1.0 * a:
                    sr_short[i] = True
                    break
            for lv in sup_levels:
                lvl = lv[0] / lv[1]
                if lv[1] >= 2 and -0.25 * a <= c[i] - lvl <= 1.0 * a:
                    sr_long[i] = True
                    break

    # ② 피보나치 61.8~78.6 되돌림: 마지막 확정 임펄스 기준
    fib_long = np.zeros(n, bool)
    fib_short = np.zeros(n, bool)
    last_ph = None  # (idx, price)
    last_pl = None
    ph_i, pl_i = 0, 0
    for i in range(n):
        while ph_i < len(ph) and ph[ph_i][1] == i:
            last_ph = (ph[ph_i][0], h[ph[ph_i][0]]); ph_i += 1
        while pl_i < len(pl) and pl[pl_i][1] == i:
            last_pl = (pl[pl_i][0], l[pl[pl_i][0]]); pl_i += 1
        a = atr_v[i]
        if a <= 0 or last_ph is None or last_pl is None:
            continue
        tol = 0.1 * a
        if last_pl[0] < last_ph[0]:  # 상승 임펄스 L→H → 눌림목 매수 존
            span = last_ph[1] - last_pl[1]
            if span >= FIB_MIN_IMPULSE_ATR * a:
                zone_hi = last_ph[1] - 0.618 * span + tol
                zone_lo = last_ph[1] - 0.786 * span - tol
                if zone_lo <= c[i] <= zone_hi:
                    fib_long[i] = True
        if last_ph[0] < last_pl[0]:  # 하락 임펄스 H→L → 반등 매도 존
            span = last_ph[1] - last_pl[1]
            if span >= FIB_MIN_IMPULSE_ATR * a:
                zone_lo = last_pl[1] + 0.618 * span - tol
                zone_hi = last_pl[1] + 0.786 * span + tol
                if zone_lo <= c[i] <= zone_hi:
                    fib_short[i] = True

    # ③ 볼린저: 밴드 밖 마감 → 3봉 내 재진입 마감, 밴드 수평일 때만
    bb_long = np.zeros(n, bool)
    bb_short = np.zeros(n, bool)
    for i in range(25, n):
        a = atr_v[i]
        if a <= 0 or np.isnan(upper[i]) or np.isnan(mid[i - 10]):
            continue
        if abs(mid[i] - mid[i - 10]) > BB_FLAT_ATR * a:
            continue
        lo_i = max(0, i - BB_REENTRY_LOOKBACK)
        if c[i] < upper[i] and np.any(c[lo_i:i] > upper[lo_i:i]):
            bb_short[i] = True
        if c[i] > lower[i] and np.any(c[lo_i:i] < lower[lo_i:i]):
            bb_long[i] = True

    # ---------- 3) 방아쇠 ----------
    body = np.abs(c - o)
    rng = np.maximum(h - l, 1e-12)
    up_wick = h - np.maximum(c, o)
    dn_wick = np.minimum(c, o) - l

    prev_o = np.roll(o, 1)
    prev_c = np.roll(c, 1)
    prev_body = np.abs(prev_c - prev_o)
    bear_engulf = (c < o) & (prev_c > prev_o) & (o >= prev_c) & (c <= prev_o) & (body > prev_body)
    bull_engulf = (c > o) & (prev_c < prev_o) & (o <= prev_c) & (c >= prev_o) & (body > prev_body)
    bear_pin = (up_wick >= 0.66 * rng) & (body <= 0.3 * rng)
    bull_pin = (dn_wick >= 0.66 * rng) & (body <= 0.3 * rng)
    candle_short = bear_engulf | bear_pin
    candle_long = bull_engulf | bull_pin
    candle_short[0] = candle_long[0] = False

    macd_short = np.zeros(n, bool)
    macd_long = np.zeros(n, bool)
    for i in range(2, n):
        cross_dn = macd_line[i - 1] >= macd_sig[i - 1] and macd_line[i] < macd_sig[i]
        cross_up = macd_line[i - 1] <= macd_sig[i - 1] and macd_line[i] > macd_sig[i]
        tick_dn = macd_hist[i - 2] > 0 and macd_hist[i - 1] < macd_hist[i - 2] and macd_hist[i] < macd_hist[i - 1]
        tick_up = macd_hist[i - 2] < 0 and macd_hist[i - 1] > macd_hist[i - 2] and macd_hist[i] > macd_hist[i - 1]
        macd_short[i] = cross_dn or tick_dn
        macd_long[i] = cross_up or tick_up

    return {
        "open": o, "high": h, "low": l, "close": c, "atr": atr_v,
        "bull_div": bull_div, "bear_div": bear_div,
        "bull_swing": bull_swing, "bear_swing": bear_swing,
        "sr_long": sr_long, "sr_short": sr_short,
        "fib_long": fib_long, "fib_short": fib_short,
        "bb_long": bb_long, "bb_short": bb_short,
        "candle_long": candle_long, "candle_short": candle_short,
        "macd_long": macd_long, "macd_short": macd_short,
        "index": df.index,
    }
