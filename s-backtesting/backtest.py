"""트레이드 시뮬레이션 + 성과 지표.

체결 규칙:
- 신호봉(i) 종가 확인 → i+1봉 시가 진입.
- 손절: 캔들 트리거 → 트리거 캔들 극값 ± 0.25*ATR / MACD 트리거 → 다이버전스 스윙 극값 ± 0.25*ATR
- 익절: 진입가 ± target_r * risk
- 같은 봉에서 손절/익절 둘 다 닿으면 손절로 처리(보수적).
- 갭이 손절을 넘겨 시작하면 시가 체결(-1R보다 나쁜 값 허용).
- 최대 보유 40봉 → 종가 청산. 동시 보유 1개(청산 전 신규 진입 없음).
"""
import numpy as np

STOP_BUFFER_ATR = 0.25
MAX_HOLD = 40


def simulate(ctx, direction, loc_keys, trigger, target_r):
    """ctx: signals.build_context 결과. 반환: R 배수 리스트."""
    n = len(ctx["close"])
    o, h, l, c, a = ctx["open"], ctx["high"], ctx["low"], ctx["close"], ctx["atr"]

    if direction == "long":
        setup = ctx["bull_div"].copy()
        for k in loc_keys:
            setup &= ctx[f"{k}_long"]
        cand, macd_t = ctx["candle_long"], ctx["macd_long"]
        swing = ctx["bull_swing"]
    else:
        setup = ctx["bear_div"].copy()
        for k in loc_keys:
            setup &= ctx[f"{k}_short"]
        cand, macd_t = ctx["candle_short"], ctx["macd_short"]
        swing = ctx["bear_swing"]

    if trigger == "candle":
        trig = cand
    elif trigger == "macd":
        trig = macd_t
    else:  # either
        trig = cand | macd_t

    signal = setup & trig
    trades = []
    i = 30
    while i < n - 1:
        if not signal[i]:
            i += 1
            continue
        entry = o[i + 1]
        # 손절 기준: 캔들 트리거면 트리거 캔들 극값, 아니면 다이버전스 스윙
        if trigger == "candle" or (trigger == "either" and cand[i]):
            ref = h[i] if direction == "short" else l[i]
        else:
            ref = swing[i]
            if np.isnan(ref):
                i += 1
                continue
        buf = STOP_BUFFER_ATR * a[i]
        if direction == "short":
            stop = ref + buf
            risk = stop - entry
        else:
            stop = ref - buf
            risk = entry - stop
        if risk <= 0.05 * a[i]:
            i += 1
            continue
        target = entry - target_r * risk if direction == "short" else entry + target_r * risk

        r = None
        exit_j = None
        for j in range(i + 1, min(i + 1 + MAX_HOLD, n)):
            if direction == "short":
                if o[j] >= stop:
                    r = (entry - o[j]) / risk
                elif h[j] >= stop:
                    r = -1.0
                elif l[j] <= target:
                    r = target_r
            else:
                if o[j] <= stop:
                    r = (o[j] - entry) / risk
                elif l[j] <= stop:
                    r = -1.0
                elif h[j] >= target:
                    r = target_r
            if r is not None:
                exit_j = j
                break
        if r is None:
            exit_j = min(i + MAX_HOLD, n - 1)
            r = (entry - c[exit_j]) / risk if direction == "short" else (c[exit_j] - entry) / risk
        trades.append(r)
        i = exit_j + 1
    return trades


def metrics(rs):
    rs = np.asarray(rs, float)
    if len(rs) == 0:
        return {"n": 0, "winrate": np.nan, "avg_r": np.nan, "pf": np.nan, "max_dd_r": np.nan, "total_r": 0.0}
    wins = rs[rs > 0]
    losses = rs[rs <= 0]
    pf = wins.sum() / abs(losses.sum()) if len(losses) and losses.sum() != 0 else np.inf
    eq = np.cumsum(rs)
    dd = (np.maximum.accumulate(eq) - eq).max() if len(eq) else 0.0
    return {
        "n": int(len(rs)),
        "winrate": float(len(wins) / len(rs)),
        "avg_r": float(rs.mean()),
        "pf": float(pf),
        "max_dd_r": float(dd),
        "total_r": float(rs.sum()),
    }
