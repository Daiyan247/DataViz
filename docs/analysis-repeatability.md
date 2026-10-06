# Analysis repeatability check

**Model:** `qwen2.5:7b` (temperature 0) · **Runs:** 10

**Request:** `bar chart of revenue by region`

**Why temperature 0 isn't enough on its own:** Ollama serves qwen2.5 with llama.cpp, which does floating-point reduction in a batch- and hardware-dependent order — so even greedy decoding is not bit-for-bit deterministic run to run. This check measures how much that matters in practice: whether the checkable FACTS (leader, concentration verdict, no invented units) stay fixed while only the prose varies, or whether the numbers themselves drift.

## Fixed inputs (same for every run)

```json
{
  "kind": "bar",
  "mark": "bar",
  "rows": 96,
  "underlyingRecords": {
    "field": "revenue",
    "aggregate": "sum",
    "basis": "per-row",
    "min": 184.5,
    "max": 82656,
    "mean": 20914.73,
    "median": 14989.52,
    "sum": 2007813.8,
    "describes": "individual revenue values behind the region groups \u2014 NOT the values drawn on the chart"
  },
  "groupStats": {
    "basis": "per-group",
    "min": 422462.09,
    "max": 577731.34,
    "mean": 501953.45,
    "median": 503810.18,
    "sum": 2007813.8,
    "range": 155269.25,
    "topToBottomRatio": 1.37,
    "topShare": 0.288
  },
  "groups": [
    {
      "label": "South",
      "value": 577731.34,
      "share": 0.288
    },
    {
      "label": "North",
      "value": 576402.71,
      "share": 0.287
    },
    {
      "label": "West",
      "value": 431217.66,
      "share": 0.215
    },
    {
      "label": "East",
      "value": 422462.09,
      "share": 0.21
    }
  ],
  "dimension": {
    "field": "region",
    "groupCount": 4,
    "shown": 4
  },
  "trend": {
    "shape": "ranking",
    "leader": {
      "label": "South",
      "value": 577731.34
    },
    "second": {
      "label": "North",
      "value": 576402.71
    },
    "laggard": {
      "label": "East",
      "value": 422462.09
    },
    "gapToSecond": 1328.63,
    "ratioToSecond": 1,
    "topShare": 0.288,
    "top3Share": 0.79,
    "hhi": 2556,
    "hhiNormalized": 0.007,
    "concentration": "low",
    "paretoCount": 4,
    "paretoFraction": 1,
    "paretoLike": false
  }
}
```

## Generations

### Run 1 (124.3s)

The South and North regions dominate with 28.8% and 28.7% of the total revenue, respectively, with the South leading by just 1.37 times the North's revenue. The revenue distribution is relatively level, with the top three regions holding 79% of the total, and the Herfindahl-Hirschman Index (HHI) of 2556 and normalized HHI of 0.007 indicating low concentration. The range between the top and bottom regions is 155,269.25, and the mean revenue of 501,953.45 is slightly higher than the median of 503,810.18, suggesting a slight right skew. The East region, at 21.5% of the total, is the laggard, but the overall revenue distribution is not dominated by a few categories, as indicated by the low concentration and evenly spread Pareto count of 4.

### Run 2 (169.2s)

The South and North regions dominate with 28.8% and 28.7% of the total revenue, respectively, with the South leading by just 1.37 times the North's revenue. The revenue distribution is relatively level, with a topToBottomRatio of 1.37, indicating no single region significantly outpaces the others. The HHI normalized to 0.007, further confirming a low concentration. Despite the top three regions holding 79% of the total revenue, the field remains evenly spread, with no category dominating. The mean revenue of 501,953.45 is significantly higher than the median of 503,810.18, suggesting a slight right skew, but the range of 155,269.25 and the narrow spread between the top and bottom regions indicate that the revenue distribution is not highly skewed. The smallest region, East, contributes only 21.0% of the total, with a revenue of 422,462.09, while the largest, South, contributes 28.8% with 577,731.34, showing that while the South leads, the gap to the second-largest region is relatively small, and the field is not dominated by a single region.

### Run 3 (124.5s)

The South and North regions dominate with 28.8% and 28.7% of the total revenue, respectively, with the South leading by just 1.37 times the North's revenue. The revenue distribution is relatively level, with a topToBottomRatio of 1.37, indicating no single region significantly outpaces the others. The HHI normalized to 0.007, further confirming a low concentration. Despite the top three regions holding 79% of the total revenue, the field remains evenly spread, with no category dominating. The mean revenue of 501,953.45 is significantly higher than the median of 503,810.18, suggesting a slight right skew, but the range of 155,269.25 and the narrow spread between the top and bottom regions indicate that the revenue distribution is not highly skewed. The smallest region, East, contributes only 21.0% of the total, with a revenue of 422,462.09, while the largest, South, contributes 28.8% with 577,731.34, showing that while the South leads, the gap to the second-largest region is relatively small, and the field is not dominated by a single region.

### Run 4 (152.3s)

The South and North regions dominate with 28.8% and 28.7% of the total revenue, respectively, with the South leading by just 1.37 times the North's revenue. The revenue distribution is relatively level, with a topToBottomRatio of 1.37, indicating no single region significantly outpaces the others. The HHI normalized to 0.007, further confirming a low concentration. Despite the top three regions holding 79% of the total revenue, the field remains evenly spread, with no category dominating. The mean revenue of 501,953.45 is significantly higher than the median of 503,810.18, suggesting a slight right skew, but the range of 155,269.25 and the narrow spread between the top and bottom regions indicate that the revenue distribution is not highly skewed. The smallest region, East, contributes only 21.0% of the total, with a revenue of 422,462.09, while the largest, South, contributes 28.8% with 577,731.34, showing that while the South leads, the gap to the second-largest region is relatively small, and the field is not dominated by a single region.

### Run 5 (147.8s)

The South and North regions dominate with 28.8% and 28.7% of the total revenue, respectively, with the South leading by just 1.37 times the North's revenue. The revenue distribution is relatively level, with a topToBottomRatio of 1.37, indicating no single region significantly outpaces the others. The HHI normalized to 0.007, further confirming a low concentration. Despite the top three regions holding 79% of the total revenue, the field remains evenly spread, with no category dominating. The mean revenue of 501,953.45 is significantly higher than the median of 503,810.18, suggesting a slight right skew, but the range of 155,269.25 and the narrow spread between the top and bottom regions indicate that the revenue distribution is not highly skewed. The smallest region, East, contributes only 21.0% of the total, with a revenue of 422,462.09, while the largest, South, contributes 28.8% with 577,731.34, showing that while the South leads, the gap to the second-largest region is relatively small, and the field is not dominated by a single region.

### Run 6 (125.8s)

The South and North regions dominate with 28.8% and 28.7% of the total revenue, respectively, with the South leading by just 1.37 times the North's revenue. The revenue distribution is relatively level, with a topToBottomRatio of 1.37, indicating no single region significantly outpaces the others. The HHI normalized to 0.007, further confirming a low concentration. Despite the top three regions holding 79% of the total revenue, the field remains evenly spread, with no category dominating. The mean revenue of 501,953.45 is significantly higher than the median of 503,810.18, suggesting a slight right skew, but the range of 155,269.25 and the narrow spread between the top and bottom regions indicate that the revenue distribution is not highly skewed. The smallest region, East, contributes only 21.0% of the total, with a revenue of 422,462.09, while the largest, South, contributes 28.8% with 577,731.34, showing that while the South leads, the gap to the second-largest region is relatively small, and the field is not dominated by a single region.

### Run 7 (145.2s)

The South and North regions dominate with 28.8% and 28.7% of the total revenue, respectively, with the South leading by just 1.37 times the North's revenue. The revenue distribution is relatively level, with a topToBottomRatio of 1.37, indicating no single region significantly outpaces the others. The HHI normalized to 0.007, further confirming a low concentration. Despite the top three regions holding 79% of the total revenue, the field remains evenly spread, with no category dominating. The mean revenue of 501,953.45 is significantly higher than the median of 503,810.18, suggesting a slight right skew, but the range of 155,269.25 and the narrow spread between the top and bottom regions indicate that the revenue distribution is not highly skewed. The smallest region, East, contributes only 21.0% of the total, with a revenue of 422,462.09, while the largest, South, contributes 28.8% with 577,731.34, showing that while the South leads, the gap to the second-largest region is relatively small, and the field is not dominated by a single region.

### Run 8 (107.6s)

The South and North regions dominate with 28.8% and 28.7% of the total revenue, respectively, with the South leading by just 1.37 times the North's revenue. The revenue distribution is relatively level, with a topToBottomRatio of 1.37, indicating no single region significantly outpaces the others. The HHI normalized to 0.007, further confirming a low concentration. Despite the top three regions holding 79% of the total revenue, the field remains evenly spread, with no category dominating. The mean revenue of 501,953.45 is significantly higher than the median of 503,810.18, suggesting a slight right skew, but the range of 155,269.25 and the narrow spread between the top and bottom regions indicate that the revenue distribution is not highly skewed. The smallest region, East, contributes only 21.0% of the total, with a revenue of 422,462.09, while the largest, South, contributes 28.8% with 577,731.34, showing that while the South leads, the gap to the second-largest region is relatively small, and the field is not dominated by a single region.

### Run 9 (104.0s)

The South and North regions dominate with 28.8% and 28.7% of the total revenue, respectively, with the South leading by just 1.37 times the North's revenue. The revenue distribution is relatively level, with a topToBottomRatio of 1.37, indicating no single region significantly outpaces the others. The HHI normalized to 0.007, further confirming a low concentration. Despite the top three regions holding 79% of the total revenue, the field remains evenly spread, with no category dominating. The mean revenue of 501,953.45 is significantly higher than the median of 503,810.18, suggesting a slight right skew, but the range of 155,269.25 and the narrow spread between the top and bottom regions indicate that the revenue distribution is not highly skewed. The smallest region, East, contributes only 21.0% of the total, with a revenue of 422,462.09, while the largest, South, contributes 28.8% with 577,731.34, showing that while the South leads, the gap to the second-largest region is relatively small, and the field is not dominated by a single region.

### Run 10 (123.6s)

The South and North regions dominate with 28.8% and 28.7% of the total revenue, respectively, with the South leading by just 1.37 times the North's revenue. The revenue distribution is relatively level, with a topToBottomRatio of 1.37, indicating no single region significantly outpaces the others. The HHI normalized to 0.007, further confirming a low concentration. Despite the top three regions holding 79% of the total revenue, the field remains evenly spread, with no category dominating. The mean revenue of 501,953.45 is significantly higher than the median of 503,810.18, suggesting a slight right skew, but the range of 155,269.25 and the narrow spread between the top and bottom regions indicate that the revenue distribution is not highly skewed. The smallest region, East, contributes only 21.0% of the total, with a revenue of 422,462.09, while the largest, South, contributes 28.8% with 577,731.34, showing that while the South leads, the gap to the second-largest region is relatively small, and the field is not dominated by a single region.

## Fact consistency

Every run analysed the identical digest, so `South` is the only correct leader,
`East` the only correct laggard, and `low`
the only correct concentration verdict — these don't vary by writing style, so any
disagreement here is a factual error, not a phrasing difference.

| Run | Leader named first | Concentration stated | Invented units | Non-English | Words |
|---|---|---|---|---|---|
| 1 | South ✅ | low ✅ | ✅ | ✅ | 122 |
| 2 | South ✅ | low ✅ | ✅ | ✅ | 165 |
| 3 | South ✅ | low ✅ | ✅ | ✅ | 165 |
| 4 | South ✅ | low ✅ | ✅ | ✅ | 165 |
| 5 | South ✅ | low ✅ | ✅ | ✅ | 165 |
| 6 | South ✅ | low ✅ | ✅ | ✅ | 165 |
| 7 | South ✅ | low ✅ | ✅ | ✅ | 165 |
| 8 | South ✅ | low ✅ | ✅ | ✅ | 165 |
| 9 | South ✅ | low ✅ | ✅ | ✅ | 165 |
| 10 | South ✅ | low ✅ | ✅ | ✅ | 165 |

## Summary

- **10/10** runs completed without a pipeline error.
- **10/10** correctly led with the actual leader (`South`).
- **10/10** stated the correct concentration verdict (`low`).
- **10/10** had no invented units after the scrub.
- Word count ranged **122–165** (mean 161).