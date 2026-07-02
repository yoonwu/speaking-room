# 다이버전스 복합전략 그리드서치 — 최적 조합 TOP 10

- 전체 조합: 336개, 유효(트레이드 30건 이상 & 2개 이상 인스트루먼트): 58개
- 데이터: GOOG(2148봉), EURUSD(5000봉), MSFT(6744봉), SP500(5031봉), NASDAQ(5031봉)
- score = 평균R × √트레이드수

| # | 방향 | 자리 필터 | 트리거 | 손익비 | RSI | 스윙k | 트레이드 | 승률 | 평균R | PF | 총R | MDD(R) | score |
|---|------|-----------|--------|--------|-----|-------|----------|------|-------|-----|-----|--------|-------|
| 1 | long | sr | candle | 2.5 | 14 | 3 | 73 | 43.8% | +0.421 | 1.76 | +30.7 | 12.8 | 3.60 |
| 2 | long | sr | candle | 2.5 | 9 | 3 | 104 | 40.4% | +0.334 | 1.57 | +34.7 | 12.3 | 3.41 |
| 3 | long | sr | candle | 1.5 | 14 | 3 | 77 | 53.2% | +0.318 | 1.69 | +24.5 | 7.0 | 2.79 |
| 4 | long | sr | either | 2.5 | 9 | 3 | 154 | 39.6% | +0.218 | 1.37 | +33.5 | 9.6 | 2.70 |
| 5 | long | sr | either | 2.5 | 14 | 5 | 47 | 40.4% | +0.333 | 1.60 | +15.7 | 7.0 | 2.28 |
| 6 | long | sr | candle | 1.5 | 14 | 5 | 37 | 54.1% | +0.374 | 1.86 | +13.8 | 7.0 | 2.27 |
| 7 | long | sr | candle | 2.5 | 14 | 5 | 36 | 41.7% | +0.369 | 1.65 | +13.3 | 7.2 | 2.22 |
| 8 | long | sr | macd | 2.5 | 9 | 3 | 121 | 41.3% | +0.199 | 1.34 | +24.0 | 15.5 | 2.19 |
| 9 | long | sr | candle | 1.5 | 9 | 3 | 109 | 48.6% | +0.207 | 1.40 | +22.5 | 10.3 | 2.16 |
| 10 | long | sr | either | 2.5 | 14 | 3 | 104 | 38.5% | +0.181 | 1.30 | +18.8 | 11.0 | 1.85 |

## 인스트루먼트별 상세 (TOP 10)
1. `long/sr/candle/R2.5/rsi14/k3` — GOOG:n=3,avgR=0.17; EURUSD:n=19,avgR=0.38; MSFT:n=19,avgR=0.56; SP500:n=16,avgR=-0.43; NASDAQ:n=16,avgR=1.20
2. `long/sr/candle/R2.5/rsi9/k3` — GOOG:n=3,avgR=0.17; EURUSD:n=28,avgR=0.56; MSFT:n=33,avgR=0.11; SP500:n=21,avgR=-0.06; NASDAQ:n=19,avgR=0.85
3. `long/sr/candle/R1.5/rsi14/k3` — GOOG:n=3,avgR=-0.17; EURUSD:n=20,avgR=0.38; MSFT:n=19,avgR=0.25; SP500:n=19,avgR=-0.08; NASDAQ:n=16,avgR=0.90
4. `long/sr/either/R2.5/rsi9/k3` — GOOG:n=7,avgR=0.28; EURUSD:n=44,avgR=0.12; MSFT:n=47,avgR=0.04; SP500:n=30,avgR=0.36; NASDAQ:n=26,avgR=0.52
5. `long/sr/either/R2.5/rsi14/k5` — GOOG:n=3,avgR=-1.18; EURUSD:n=15,avgR=0.55; MSFT:n=12,avgR=0.62; SP500:n=7,avgR=-0.68; NASDAQ:n=10,avgR=0.82
6. `long/sr/candle/R1.5/rsi14/k5` — GOOG:n=2,avgR=-1.00; EURUSD:n=12,avgR=0.67; MSFT:n=8,avgR=0.56; SP500:n=7,avgR=-1.00; NASDAQ:n=8,avgR=1.29
7. `long/sr/candle/R2.5/rsi14/k5` — GOOG:n=2,avgR=-1.00; EURUSD:n=11,avgR=0.44; MSFT:n=8,avgR=0.91; SP500:n=7,avgR=-1.00; NASDAQ:n=8,avgR=1.27
8. `long/sr/macd/R2.5/rsi9/k3` — GOOG:n=7,avgR=0.28; EURUSD:n=36,avgR=0.04; MSFT:n=34,avgR=0.09; SP500:n=23,avgR=0.61; NASDAQ:n=21,avgR=0.17
9. `long/sr/candle/R1.5/rsi9/k3` — GOOG:n=3,avgR=-0.17; EURUSD:n=30,avgR=0.42; MSFT:n=33,avgR=-0.06; SP500:n=24,avgR=0.04; NASDAQ:n=19,avgR=0.60
10. `long/sr/either/R2.5/rsi14/k3` — GOOG:n=6,avgR=0.07; EURUSD:n=28,avgR=0.07; MSFT:n=28,avgR=0.12; SP500:n=22,avgR=0.08; NASDAQ:n=20,avgR=0.56
