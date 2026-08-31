# Chart trade-offs & axis reference

General knowledge about each chart type — what it's good for, what belongs on each
axis, and the variable types those axes expect. Use it to (a) map a request onto
the right encoding and (b) judge whether a chosen chart is the best way to describe
the data, recommending a better-fitting type when it clearly is.

## Variable types (measurement levels)
- **Nominal** — unordered categories: region, product, city, condition. (categorical)
- **Ordinal** — ordered categories: low/medium/high, S/M/L, ratings 1–5. (categorical)
- **Discrete quantitative** — countable whole numbers: units sold, number of orders.
- **Continuous quantitative** — any real value: revenue, price, temperature, weight.
- **Temporal** — dates / times: order date, month, timestamp.

Categorical = nominal + ordinal. Numeric = discrete + continuous. On axes, categorical
and temporal fields form *discrete* positions (one tick per value/bin); continuous
numeric fields form a *continuous* scale.

---

## Bar chart
- **X axis:** a category — **nominal** or **ordinal** (also a temporal field with few periods). Discrete positions, one bar per category.
- **Y axis:** a **quantitative** measure (continuous or discrete), almost always **aggregated** (sum, mean, count) per category.
- **Other:** a second nominal/ordinal field on **color** → grouped or stacked bars.
- **Good for:** comparing a measure across a modest number of discrete categories; ranking; counts per category. Easy and precise to read (length encodes value from a zero baseline).
- **Weak for / avoid:** many categories (> ~25 bars become unreadable); showing change over continuous time (a line reveals the shape better); precise part-to-whole (a stacked bar hides segment comparisons). Bars should start at zero.

## Dot plot (Cleveland)
- **X axis:** a **quantitative** measure, **aggregated** per category (mean, median, sum) — the dot's position along X is the value.
- **Y axis:** a **nominal/ordinal** category — one dot per row; sort by value to make ranks pop.
- **Other:** a second category on **color** overlays series (a dumbbell / connected-dot comparison).
- **Good for:** comparing a value across **many** categories with minimal ink; when a **zero baseline isn't required** (means, rates, indices) — a bar would waste space or mislead; ranking.
- **Weak for / avoid:** magnitudes that genuinely need a zero baseline or part-to-whole (a bar is more honest); showing a **distribution** (each category is one aggregated dot, not its spread — use a box/strip plot); only a few categories (a bar is simpler).

## Line chart
- **X axis:** an **ordered** axis — **temporal** (preferred) or **ordinal**; a continuous numeric X also works (a function/relationship line).
- **Y axis:** a **quantitative** measure, usually aggregated per X value.
- **Other:** a nominal/ordinal field on **color** → one line per series.
- **Capacity:** hold several series on ONE chart via color instead of drawing many separate charts — **1–3 lines ideal, 4–5 the practical max**; **6+ becomes "spaghetti"**, at which point use **small multiples** (a grid of small panels, one per series).
- **Good for:** trends and change over time; comparing the trajectory of several series; interpolation between ordered points.
- **Weak for / avoid:** **nominal (unordered) X** — connecting unordered categories implies a trend that doesn't exist (use a bar); too many series ("spaghetti" — switch to small multiples); very sparse data (a line through 2 points is just a slope).

## Area chart
- **X axis:** **temporal** or **ordinal** (ordered), like a line.
- **Y axis:** a **quantitative** measure; the fill emphasizes magnitude. Stacked area shows parts of a whole over time.
- **Good for:** cumulative totals and volume over time; a single series or stacked composition over time.
- **Weak for / avoid:** several overlapping unstacked series (fills occlude each other); precise value comparison; nominal X (same as line).

## Scatter plot
- **X axis:** a **continuous quantitative** variable (a categorical X is possible but then it's really a strip/dot plot).
- **Y axis:** a **continuous quantitative** variable.
- **Other:** nominal/ordinal on **color** to separate groups; a quantitative field on **size** turns it into a bubble chart.
- **Good for:** the relationship/correlation between two numeric variables; spotting clusters, outliers, and the direction/strength of a trend.
- **Weak for / avoid:** when an axis is categorical (a bar or box plot compares groups better); heavy overplotting at large N (add transparency or bin).

## Bubble chart
- **X axis / Y axis:** two variables as in a scatter (ideally both **continuous quantitative**; one may be categorical).
- **Size:** a **quantitative** field (continuous or discrete) — the third dimension. Size encodes value by **area**.
- **Other:** nominal on **color** for a fourth (categorical) dimension.
- **Good for:** a scatter relationship plus a third numeric dimension; comparing entities on three measures at once.
- **Weak for / avoid:** precise reading of the size value (area is judged poorly — good for rough magnitude, not exact figures); crowded plots where bubbles overlap; more than ~4 encoded variables.

## Pie chart
- **Category:** one **nominal** (or ordinal) field → the slices.
- **Angle/size:** one **quantitative** measure (aggregated, e.g. sum) → each slice's share of the total.
- **Good for:** part-to-whole composition with FEW slices (2–5) that sum to a meaningful 100%.
- **Weak for / avoid:** many categories (angles are hard to compare); precise comparison between similar slices; negative values; comparing across multiple pies; a continuous field as the category. A bar chart is usually clearer.

## Histogram
- **X axis:** ONE **continuous quantitative** variable, automatically **binned** into ranges (discrete bins along a continuous scale).
- **Y axis:** the **count** (or frequency/density) of records in each bin.
- **Good for:** the distribution and shape of a single numeric variable — center, spread, skew, modes, gaps.
- **Weak for / avoid:** a variable with few distinct values (a bar chart of counts per value is clearer); comparing distributions across groups (use box plots or overlaid density); bin count that's too coarse or too fine.

## Box plot
Sources: Minitab (*Data considerations for Boxplot*); Nature Methods (*Visualizing samples with box plots*).
- **X axis:** a **nominal/ordinal** category to compare groups (optional — a single box needs no X).
- **Y axis:** a **continuous quantitative** measure whose spread is summarized (median, quartiles, IQR, whiskers, outliers).
- **Data needs (this is where box plots go wrong):** meaningful quartiles/outliers want **≥ ~20 observations per group** — split by a category, that's ~20 *each*, not 20 total. The measure must actually **vary** (near-zero IQR / standard deviation = a flat box with nothing to show) and have more than a handful of **distinct values** (few distinct → coarse steps, not a spread).
- **Good for:** comparing the spread and center of a measure across groups (three or more especially); flagging outliers and skew; robust summaries of many points.
- **Weak for / avoid:** **small samples** — below ~20 per group the quartiles and outliers "may not be meaningful", so show the raw points with a **strip plot** (or overlay points on the box); a measure with **little spread or few distinct values**; revealing the actual shape/modality of a distribution (a histogram shows more); audiences unfamiliar with box-plot conventions.

## Strip plot
- **X axis:** a **nominal/ordinal** category to split by (optional — a single strip needs no X).
- **Y axis:** a **quantitative** measure shown as **raw** ticks — one per observation, no aggregation.
- **Good for:** seeing **every data point** — the true sample size, clusters, gaps, and outliers; **small samples** where a box plot's quartiles aren't reliable (~<20 per group); pairing with a box plot (raw points over the summary).
- **Weak for / avoid:** **large N** (ticks overlap into a solid band — a box plot summarises, a histogram shows the shape); reading precise per-point values; comparing many groups' centres precisely (a box or dot plot is cleaner).

## Heatmap
- **X axis:** a **nominal/ordinal** category (or binned field).
- **Y axis:** a second **nominal/ordinal** category (or binned field).
- **Color:** a **quantitative** value — a count or an aggregated measure at each (x, y) cell.
- **Good for:** magnitude/patterns across the intersection of two categorical dimensions (a matrix); correlation matrices; category × time grids; spotting hotspots.
- **Weak for / avoid:** reading precise values (color is approximate); too many rows or columns (cells shrink); color scales that aren't perceptually uniform.

## Map (choropleth)
Sources: Datawrapper Academy, Axis Maps, Data-to-Viz.
- **Location:** a **geographic** dimension — **country names** or **US state names** (nominal). Region-based (no lat/long point "poles"; point data is rolled up to its region).
- **Color / height:** a **quantitative** measure (aggregated per region) or a **count**; regions are shaded by value, and extruded by value in 3D.
- **Normalize:** a choropleth colors **area**, so it should map **relative** values — rates, per-capita, density, percentages — **not raw totals** (big/populous regions otherwise dominate regardless of the real rate). For an absolute total, a proportional-**symbol/bubble** map is the honest choice.
- **Color scale:** **sequential** (light→dark) for ordered values; **diverging** (light middle, dark extremes) for values around a meaningful midpoint (above/below average, +/−). Few colors, colorblind-safe, lightness-ordered.
- **Good for:** values that vary by **place** — regional rates/metrics, geographic patterns and clusters; when *where* matters as much as *how much*.
- **Weak for / avoid:** **raw totals of unequal-area regions** (normalize first, or use a bubble map); precise value comparison and subtle differences (area/color are approximate — a bar chart ranks more precisely); correlations between two variables (use a scatter); data with no geographic column; very few regions (a bar chart is simpler).

---

## Hard requirements & edge cases (must hold, or the chart is wrong)
- **Bar:** Y is a **numeric** measure (or a count); X is categorical/temporal. Bars must start at zero.
- **Line / Area:** X must be **ordered** — temporal or ordinal (a continuous numeric X is also fine); **never nominal/unordered**. Y is numeric.
- **Scatter:** **both X and Y must be numeric** (continuous). A categorical axis makes it a strip/dot plot, not a true scatter.
- **Bubble:** X and Y should be numeric; **SIZE must be a number** (quantitative — integer or float). A **nominal/ordinal category can NOT be the size** — size encodes magnitude by area, which is meaningless for categories (use color for a category instead). Color may be categorical.
- **Pie:** the slice category must be a **discrete** field with **few** values (never a continuous number); the angle must be a **numeric measure or a count**; values must be **non-negative**; slices should sum to a meaningful whole.
- **Histogram:** the binned field must be **continuous numeric**; a field with few distinct values should be a bar of counts instead. Y is a count/frequency.
- **Box plot:** Y must be **numeric**; the optional grouping X must be **categorical**. Needs **enough data per box** — ~20+ observations per group and real spread (non-trivial IQR); below that, prefer a strip plot of the raw points.
- **Dot plot:** X must be a **numeric** measure that is **aggregated** (mean/median/sum); Y must be a **categorical** dimension (one dot per category). What separates it from a scatter is the categorical axis + the aggregate.
- **Strip plot:** the value axis must be **numeric** and **raw** — no aggregate (it plots every observation); the optional split axis must be **categorical**.
- **Heatmap:** X and Y must both be **categorical** (or binned); color must be **numeric** (a count or aggregated measure).
- **Map:** there must be a **geographic** column — country names or US state names; the shading value must be a **numeric measure or a count**, and ideally a **normalized rate** (not a raw total) since color maps area. Without a geographic column a map cannot be drawn.

When a request violates one of these (e.g. "bubble sized by <category>", "pie of a continuous field", "line over regions"), the chart is drawn as asked but is wrong — say exactly which rule is broken and which column/channel violates it.

## "Consider instead" rules (for recommending a better fit)
- Pie with a continuous field, negative values, or many categories → **histogram** (distribution) or **bar** (comparison).
- Bar over a temporal axis with many periods → **line** (shows the trend).
- Line/area over a **nominal** (unordered) X → **bar**.
- Scatter/line with a categorical axis → **bar** or **box plot**.
- One numeric variable's distribution → **histogram**; comparing that distribution across groups → **box plot** (with ~20+ points per group).
- A **box plot** whose measure has too few observations per group (~<20), near-zero spread, or few distinct values → a **strip plot** (show every raw point) — the quartiles aren't reliable.
- A **bar chart** with many categories, or values that don't need a zero baseline (means, rates, indices) → a **dot plot** (compact, position-based).
- A **strip plot** that overlaps into a solid band at large N → a **box plot** (summary) or **histogram** (shape).
- More series than one chart can hold (6+ lines, many grouped bars) → **small multiples** (a grid of small panels, one per series) rather than many separate charts.
- Two categorical dimensions with a value → **heatmap** (or grouped **bar**).
- A scatter that also needs a third measure → **bubble**.
- Two numeric variables' relationship shown as a bar/pie → **scatter**.
- A measure broken down by a **geographic** column (countries, states) shown as a bar with many places → **map** (when the spatial pattern matters); conversely, a map with only a handful of regions or where precise ranking matters → **bar**.
