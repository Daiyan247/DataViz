# Sample data for the map feature

Drop any of these into DataViz Studio (drag onto the drop zone, or use the file
picker), then either type a request or click the **🗺 Map** chip. The app
auto-detects the geographic column, so you don't have to name the mode.

| File | Mode detected | Geographic column | Try asking… |
|------|---------------|-------------------|-------------|
| `world_revenue.csv` | World countries | `country` | "map of revenue by country" · "map of units by country" |
| `world_population.json` | World countries | `country` | "map of population_m by country" · "choropleth of gdp_trillion" |
| `us_states_sales.csv` | US states | `state` (names **and** abbreviations like `NY`, `CA`) | "map of sales by state" · "map of orders by state" |
| `city_points.csv` | World countries | `country` (cities are aggregated to their country) | "map of sales by country" · "map of visitors by country" |

## What to try once a map is showing
- **View in 3D** (top-right) → regions rise by value. Drag to tilt, scroll to
  zoom, click a region to select + focus it. **Reset view** recenters.
- **View in 2D** → the flat Vega-Lite choropleth; hover a region for its value.
- These files also work with every other chart — e.g. "bar of revenue by
  country", "pie of sales by region", "revenue vs units sized by customers".

## Notes
- Country/state names are matched leniently: `USA` = `United States`,
  `CA` = `California`, etc. If a name in your own data doesn't shade, it's likely
  a spelling the matcher doesn't know yet — say the word and it can be added.
- `world_revenue.csv` has a `region` column (continents) and `us_states_sales.csv`
  has numeric measures, so you can exercise the warnings/suggestions too.
- Maps are **region-based** — countries/states extrude by value (no point "poles").
  A dataset with lat/long is aggregated to its region column (e.g. `city_points.csv`
  rolls its cities up to `country`).
