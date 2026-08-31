# Chart reference

A guide to each chart type: what it's for, which variable types it needs, and its
Vega-Lite mark + encoding. Use it to pick the right chart and to recognise the
chart the user names (e.g. "bubble plot", "box", "heatmap"). Variable types
(measurement levels): **quantitative** (numbers), **temporal** (dates/times),
**ordinal** (ordered categories), **nominal** (unordered categories).

Encoding channels are Vega-Lite field definitions `{field, type, aggregate?, bin?}`.
Always set `type` to the column's real measurement level. Use `aggregate` ("sum",
"mean", "median", "min", "max") to summarise a measure; use `{type:"quantitative",
"aggregate":"count"}` with **no field** for a plain row count. `"bin": true` buckets
a quantitative field.

Each type below notes three things: what it **needs** (the columns), how much data
it can **hold** before it stops being readable (capacity), and how much data it
**needs** to be meaningful (sufficiency). Read those alongside the encoding — a
chart that renders is not automatically a chart worth showing.

---

## Bar chart — `mark: "bar"`
- **Purpose:** compare a measure across categories (ranking, totals).
- **Needs:** one categorical (nominal/ordinal) or temporal dimension + one quantitative measure.
- **Encoding:** `x` = the category, `y` = the measure (usually `aggregate: "sum"`). Colour by a second category for a grouped/stacked bar.
- **Capacity:** readable up to ~25 bars; a second category on colour adds ~3–5 series (grouped or stacked) before segments get hard to compare. Beyond that, filter to the top values or use a heatmap / small multiples.
- **Example:** total revenue by region → `{x:{field:"region",type:"nominal"}, y:{field:"revenue",type:"quantitative",aggregate:"sum"}}`.

## Dot plot (Cleveland) — `mark: "point"` with a categorical axis
- **Purpose:** compare an **aggregated** value of a measure across categories — like a bar chart but one dot per category. A dot marks a *position*, so (unlike a bar) it needs **no zero baseline** and stays readable with many categories.
- **Needs:** one categorical dimension + one quantitative measure, **aggregated** (usually **mean**).
- **Encoding:** `y` = the category (`type:"nominal"`), `x` = the measure with an aggregate (`{field, type:"quantitative", aggregate:"mean"}`) — one dot per category. (What distinguishes it from a *scatter*: a scatter has two **raw** quantitative axes; a dot plot has one **categorical** axis + an **aggregated** measure.)
- **Capacity:** handles **more categories** than a bar (dots are compact), especially sorted by value; a second category on `color` overlays series (dumbbell-style).
- **Example:** average revenue by region → `{y:{field:"region",type:"nominal"}, x:{field:"revenue",type:"quantitative",aggregate:"mean"}}`.

## Line chart — `mark: "line"`
- **Purpose:** show a trend in a measure over an ordered axis (usually time).
- **Needs:** a temporal (preferred) or ordinal x + a quantitative measure. Do **not** use a nominal (unordered) x — points connected in a meaningless order.
- **Encoding:** `x` = temporal/ordinal, `y` = measure (`aggregate: "sum"`). Colour by a category for one line per series.
- **Capacity — prefer ONE chart with several lines over many charts:** put multiple series on the same axes via `color` (e.g. one line per region) rather than drawing a separate chart each. **1–3 lines is ideal, 4–5 is the practical maximum; 6+ becomes a "spaghetti" tangle** — then switch to **small multiples** (one small panel per series) instead of more separate full charts.
- **Sufficiency:** needs several ordered points to show a trend (a line through 2 points is just a slope). Missing periods should break the line, not interpolate silently.

## Area chart — `mark: "area"`
- **Purpose:** like a line chart but filled, emphasising magnitude/volume over time.
- **Needs & encoding:** same as line chart.
- **Capacity:** a single series or a **stacked** composition reads well; several *overlapping* unstacked areas occlude each other — cap at ~3–4 stacked series, else small multiples.

## Scatter plot — `mark: "point"`
- **Purpose:** show the relationship/correlation between **two** quantitative variables.
- **Needs:** two quantitative fields.
- **Encoding:** `x` and `y` both quantitative (no aggregate — raw points).
- **Capacity/sufficiency:** a scatter can hold thousands of points, but at large N they **overplot** — add transparency (opacity) or bin into a density/heatmap. Too few points (a handful) show no real relationship. Colour by a category to separate groups (keep to a handful of colours).

## Bubble chart — `mark: "point"` **with a `size` channel**
- **Purpose:** a scatter plot that encodes a **third** variable as the point size. This is what distinguishes a *bubble* from a plain *scatter*: a bubble always has a `size` encoding.
- **Needs:** two axis fields + a **quantitative** field for size (phrasings like "sized by X", "by size of X").
- **Encoding:** `x`, `y`, plus `size:{field:...,type:"quantitative"}`.
- **Capacity:** up to ~4 encoded variables (x, y, size, and colour for a category) — past that it's unreadable. Size encodes **area**, judged only roughly, so it's for magnitude, not precise values.
- **Example:** "regions vs unit_price sized by units" → `{x:{field:"region",...}, y:{field:"unit_price",type:"quantitative"}, size:{field:"units",type:"quantitative"}}`.

## Pie chart — `mark: "arc"`
- **Purpose:** part-to-whole composition — the share each category contributes to a total.
- **Needs:** one quantitative measure + one categorical dimension (works best with few categories).
- **Encoding:** `theta` = the measure (`aggregate: "sum"`), `color` = the category. Never bin the theta channel; never put a continuous number on `color`.
- **Capacity:** **2–5 slices** that sum to a meaningful whole; values must be non-negative. More than ~6 slices, similar-sized slices, or negative values → a **bar** chart compares far more precisely.

## Histogram — `mark: "bar"` with `bin`
- **Purpose:** show the **distribution** of a single quantitative variable.
- **Needs:** one quantitative field.
- **Encoding:** `x` = the quantitative field with `"bin": true`, `y` = `{type:"quantitative", aggregate:"count"}`. No category required.
- **Sufficiency:** needs a **continuous** field with enough values to reveal a shape (rule of thumb ~**30+** rows, more for a smooth curve). A field with **few distinct values** (e.g. ≤10 — ratings, small integers) isn't a distribution — use a **bar of counts per value** instead. Comparing distributions across groups → a **box plot** or overlaid density.

## Box plot — `mark: "boxplot"`
- **Purpose:** summarise the spread (median, quartiles, IQR, outliers) of a measure, optionally per category.
- **Needs:** one quantitative measure (+ optionally a category to split by).
- **Encoding:** `y` = the measure (raw, no aggregate), `x` = the category.
- **Sufficiency (important — a box plot is easy to draw but easy to mislead with):**
  - **Sample size:** a box plot "works best when the sample size is at least **20**"; below that "the quartiles and outliers … may not be meaningful" (Minitab; Nature Methods, *Visualizing samples with box plots*). When split by a category, that's ~**20 per group**, not 20 total.
  - **Spread:** it summarises *variation*. A measure whose values barely vary (near-zero **IQR** / standard deviation) collapses to a flat line, and one with only a handful of **distinct values** shows coarse steps, not a spread.
  - **When there isn't enough:** prefer a **strip plot** (below) — it shows every raw value and hides nothing — or overlay the raw points on the box. For very few groups or when precise ranking matters, a **bar** or **dot plot** is clearer.

## Strip plot — `mark: "tick"`
- **Purpose:** show **every individual value** of a measure as a tick along an axis, optionally split by a category — hiding nothing, so the real sample size, clusters, gaps, and outliers are all visible. The honest **small-sample alternative to a box plot** (which needs ~20+ per group to be meaningful).
- **Needs:** one quantitative measure (+ optionally one category to split by). Values are **raw** — no aggregate.
- **Encoding:** `y` = the measure (`type:"quantitative"`, no aggregate), `x` = the category (`type:"nominal"/"ordinal"`, optional).
- **Capacity:** best at **small-to-medium N**; at large N ticks pile into a solid band — then a **box plot** (summary) or **histogram** (shape) reads better. Jitter/transparency relieve overlap.
- **Example:** every revenue value by region → `{y:{field:"revenue",type:"quantitative"}, x:{field:"region",type:"nominal"}}`.

## Heatmap — `mark: "rect"`
- **Purpose:** show magnitude/counts across the intersection of **two** categories.
- **Needs:** two categorical (or binned) fields + a measure or count for colour.
- **Encoding:** `x` and `y` = the two categories, `color` = `{type:"quantitative", aggregate:"count"}` or a summed measure.
- **Capacity:** a readable matrix — roughly up to ~25 rows × ~25 columns; beyond that cells shrink too far. Use a **perceptually-uniform, colorblind-safe** colour scale, since colour reads only approximately.

## Map (choropleth) — `mark: "geoshape"`
A **choropleth**: geographic regions shaded (and, in 3D, extruded) by a value. It's
**region-based** — countries or US states. (There are no point/pin "poles": data
with latitude/longitude is rolled up to its region column instead.) Rendered by a
dedicated 3D map view, not by Vega-Lite.

- **Needs:** a **geographic column** — **country names** (world map) or **US state
  names/abbreviations** (US map) — plus, optionally, one **quantitative** measure to
  shade by (without one, regions are shaded by row **count**).
- **Encoding:** `location` = the region-name column (`type:"nominal"`); `color` =
  the measure (`{field, type:"quantitative", aggregate:"sum"}`) or a count.
- **Example:** "map of revenue by country" →
  `{"mark":"geoshape","encoding":{"location":{"field":"country","type":"nominal"},"color":{"field":"revenue","type":"quantitative","aggregate":"sum"}}}`.
- **Recognise from:** "map", "choropleth", "by country", "by state", "geographic",
  "world map".

### A map prompt must say WHAT to map — one of
1. The whole **world** ("world map", "whole map") — geography only. Leave `location`
   unset.
2. A specific **continent** or **country** ("map of Europe", "map of Japan") — the
   app reads the scope from the words. Leave `location` unset.
3. A **measure** — "map of sales by state" **or** "map of the world **for sales**".
   Whenever the user names a measure, set `color` to it (`aggregate:"sum"` usually).
   Also set `location` when they name the geographic column ("by state"); if they
   only give a scope + measure ("the world for sales"), set `color` **without**
   `location` — the app shades the data's own country/state column by that measure.
   A bare "map"/"create a map" with **no** scope and **no** measure is ambiguous:
   don't guess a column — the app asks "map of what?".

### Cartography best practice (so the map is honest, not just colorful)
Grounded in Datawrapper Academy, Axis Maps, and Data-to-Viz:
- **Normalize the value.** A choropleth colors *area*, so raw totals mislead — big
  or populous regions dominate. Prefer **rates / per-capita / density / percentages**
  (e.g. unemployment *rate*, not the raw count of unemployed). For an **absolute
  total**, a proportional-**symbol/bubble** map is more honest than a choropleth.
- **Choropleths show broad regional patterns**, not subtle differences (readers
  can't judge small color steps precisely) and not correlations (use a scatter).
- **Color:** a **sequential** light→dark ramp for ordered values; a **diverging**
  ramp (light middle, dark extremes) for values around a meaningful midpoint
  (above/below average, gains/losses). Keep it few-colored and colorblind-safe.
- Give exact figures on hover/labels, since color is only approximate.

---

## Data sufficiency — when NOT to draw a chart
A chart that renders can still be misleading if the data can't support it. Before
choosing, sanity-check the columns' **row count**, **distinct values**, and
**spread**:
- **Too few rows.** Summary charts that estimate structure — a **box plot**
  (quartiles/outliers, ~20+ per group) or a **histogram** (a distribution, ~30+) —
  need enough observations. With only a handful of rows, show the **raw values**
  (a **strip plot**, or a small bar/table) instead of a summary that implies more
  certainty than exists.
- **No spread.** A measure whose values barely vary gives a flat box plot, a
  single-bin histogram, or a featureless scatter — there's nothing to compare.
- **Few distinct values.** A numeric column with few distinct values (ratings,
  flags, small counts) behaves like a **category**: a bar of counts per value beats
  a histogram or box plot.
- **Wrong shape.** Enforce each type's variable-type rules (ordered x for line/area,
  numeric axes for scatter, a geographic column for a map). When the data doesn't
  fit, say so and name the better-fitting type rather than forcing the requested one.

## How much data fits in ONE chart (capacity & small multiples)
Prefer expressing more data **within** one well-chosen chart over spawning many
charts — up to the point of clutter, then split deliberately:
- **Multiple series belong on one chart** via `color`: several **lines** (1–3 ideal,
  4–5 max), grouped/stacked **bars** (~3–5 series), or a small set of scatter groups.
  This is almost always clearer than one chart per series.
- **When you exceed the limit, use small multiples** — a grid of small panels
  sharing axes, one per series/category — rather than 10 separate full-size charts
  or one unreadable "spaghetti" chart.
- **Encode extra dimensions with channels, not new charts:** position (x, y), then
  colour (a category), size (a measure → bubble), and columns/rows (small multiples).
  Roughly ~4 encoded variables is the readable ceiling for a single view.

---

### Choosing by intent
- "distribution" / "spread" of one measure → **histogram** (shape) or **box plot** (quartiles/outliers, with enough data)
- "every value" / "raw points" / "small sample" of one measure → **strip plot**
- "trend" / "over time" → **line** / **area** (several series on one chart via colour)
- "relationship" / "vs" / "correlation" between two numbers → **scatter** (**bubble** if a third measure is named)
- "share" / "proportion" / "composition" / "breakdown" → **pie** (few slices) or **bar**
- "compare" a measure across categories → **bar** (totals from zero) or **dot plot** (a value/average per category, many categories, no zero baseline)
- "compare across two categories" → **heatmap**
- "map" / "choropleth" / "by country or state" / values across places → **map**
- too many series for one readable chart → **small multiples**
