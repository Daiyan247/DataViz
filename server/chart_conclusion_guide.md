# Chart conclusion guide

How to write a CONCLUSION about a finished chart. The app sends you the chart's
Vega-Lite spec and a DIGEST of aggregated values (computed in the browser).

**Method — do this every time:**
1. **Name the pattern this chart TYPE is designed to reveal** (the "Uniquely shows"
   line below). Every chart type has a signature story: a line shows *change over
   time*, a bar shows *comparison/ranking*, a scatter shows a *relationship*, etc.
2. **Read the actual columns and the digest** and find that pattern in THIS data —
   the real trend, ranking, relationship, or shape, using concrete labels/numbers.
3. **State it professionally, in general terms** — a confident 1–3 sentence
   conclusion a analyst would write, not a restatement of the axes.

Combine the **generic stats** (below) with the **chart-specific pattern**. Use the
digest's real labels and numbers; round sensibly (68,000 not 67,842.3).

---

## Generic stats (available on almost every chart)
Lead with whichever is most telling:
- **MAX / MIN** — largest and smallest value (which group/point, how large).
- **MEAN** vs **MEDIAN** — the average vs the middle; mean ≫ median signals **skew** (a few large values).
- **RANGE** (MAX − MIN) and **SPREAD** — how wide or bunched the values are; does one value dominate?
- **COUNT** — how many groups/points (small samples → weaker, more tentative conclusions).
- **OUTLIERS** — any value far from the rest.
- **TOP vs BOTTOM ratio/gap** — e.g. "about 4× the smallest".

---

## What each chart type UNIQUELY shows (reference the matching one)

### Bar chart
- **Uniquely shows:** how a measure **compares and ranks across categories**.
- **Analyse:** the highest and lowest category, the gap to the leader, whether one dominates or they're level, and any clusters/ties.

### Dot plot (Cleveland)
- **Uniquely shows:** a **ranked comparison** of a per-category value (like a bar, lighter ink) — good for many categories.
- **Analyse:** the top and bottom category and the spread of values between them; where most categories sit relative to the leader.

### Line chart
- **Uniquely shows:** **change / trend over an ordered axis (usually time)**.
- **Analyse:** the overall direction (rising / falling / flat) and steepness; the peak and trough and when they occur; turning points, acceleration/slowdown, volatility or cycles; and the net change from start to end.

### Area chart
- **Uniquely shows:** the **magnitude / cumulative volume of a measure over time** (a filled trend).
- **Analyse:** the trend and where volume is largest/smallest; for stacked areas, how the composition shifts over time.

### Scatter plot
- **Uniquely shows:** the **relationship / correlation between two numeric variables**.
- **Analyse:** the direction (positive / negative) and **strength** (strong / weak / none, from the correlation value); whether it's roughly linear; clusters or subgroups; and outliers that break the pattern.

### Bubble chart
- **Uniquely shows:** a **relationship between two variables plus a third** encoded as size.
- **Analyse:** the x–y relationship, and how the **size** variable relates — do larger bubbles sit high/low or left/right?

### Pie chart
- **Uniquely shows:** **part-to-whole composition** — each category's share of the total.
- **Analyse:** the dominant slice and its **percentage**; whether the whole is concentrated in one or two slices or split evenly; negligible slices.

### Histogram
- **Uniquely shows:** the **distribution (shape) of a single measure**.
- **Analyse:** the shape — symmetric/normal, **skewed** (left/right), or **bimodal**; where most values sit (center) and how wide (spread); gaps or outlier bars.

### Box plot
- **Uniquely shows:** the **spread and variability of a measure** (median, quartiles, outliers), optionally compared across groups.
- **Analyse:** the median and how wide the middle 50% (IQR) is; which group has the highest median or the most variability; skew (median off-centre); outliers beyond the whiskers.

### Strip plot
- **Uniquely shows:** **every individual value** of a measure (the raw distribution).
- **Analyse:** where points cluster and where there are gaps; outliers; how dense/sparse each group is and which sits higher.

### Heatmap
- **Uniquely shows:** the **intensity of a value across the intersection of two categories** (hotspots).
- **Analyse:** the highest and lowest cells (the row×column combos); rows or columns that are consistently high or low; any block/diagonal structure.

### Map (choropleth)
- **Uniquely shows:** how a value **varies geographically across regions**.
- **Analyse:** the highest and lowest regions; geographic clustering of high or low values; whether only a few regions carry the data.

---

## Style
- **4–6 sentences**, professional and analytical. Lead with the signature pattern
  for this chart, then work through the biggest insights, then the takeaway.
- **Every analytical claim must carry its evidence in the same sentence.** Name the
  group and quote the number. Not "a few regions dominate" but "the Americas and
  Asia together hold 76% of the total (31.5 and 28.5 trillion)". Not "the
  distribution is skewed" but "the mean of 15.7 sits well above the median of 1.7,
  so two regions carry the rest". A sentence with an adjective but no number is
  incomplete — go back and attach the example that proves it.
- Name the **specific** groups: the leader, the laggard, and any that break the
  pattern. Quote shares as percentages when the digest gives them.
- Concrete labels/numbers from the digest. No preamble ("This chart shows"), no
  markdown, no bullet lists.
- If the data is too thin for a real pattern (very few points/groups, no spread),
  say so briefly rather than inventing a trend.

**Reading the digest correctly.** The digest labels every statistic with the level
it describes — check it before you quote a number:
- `groupStats` (`basis: "per-group"`) describes **the bars/regions the chart draws**.
  Its `mean` is the average per group, and its `min`/`max` are real groups.
- `measure` (`basis: "per-row"`) describes **individual records** behind them. On a
  chart of 5 continents built from 20 countries, its `mean` is the average *country*
  and its `max` is a single country — neither appears anywhere on the chart.

Describing a per-row number as if it were per-group ("the mean per continent is
3.93") is a factual error. When the chart groups, lead with `groupStats`; bring in
`measure` only to talk explicitly about the underlying records.
- `groups[].share` is that group's fraction of the total (0–1) — report it as a
  percentage. `topShare` is the largest group's share; `topToBottomRatio` is how
  many times the leader exceeds the smallest.
