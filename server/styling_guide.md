# Styling / "prettify" guide

Conventions for making every chart readable and aesthetically pleasing. These are
**applied automatically by the renderer** (`src/components/ChartView.tsx` +
`src/lib/vegaTheme.ts`), not by the model — visual polish depends on the rendered
layout (label counts, pixel widths, theme) that the model can't see. So when you
produce a spec, focus only on the data mapping (mark + encoding + fields); the app
handles presentation using the rules below.

## Axis labels
- **Slant a cramped categorical X axis.** When a nominal/ordinal X axis has many
  categories (> 6) or long labels (> 10 characters), rotate the tick labels to
  **-40°** so they don't overlap. Few short labels stay horizontal (0°).
- Cap label width (`labelLimit`) so a very long label truncates with an ellipsis
  rather than pushing the plot around.
- Keep axis titles present and readable; don't abbreviate column names.

## Color
- Use the validated, colorblind-safe categorical palette (see `src/lib/palette.ts`),
  assigned in a fixed order — never random colors.
- Single-series charts use one accent hue; multi-series use the categorical ramp.
- Everything is theme-aware: chrome (axes, gridlines, text) and series colors adapt
  to light/dark mode.

## Layout & chrome
- Charts are responsive: they fill their container and re-fit on resize
  (`autosize: fit`), leaving room for slanted labels and legends.
- Gridlines and axes are recessive (low-contrast) so the data marks stand out.
- Transparent plot background so it sits cleanly on the app surface.

## Marks
- **Bars / rects:** small corner radius for a softer look.
- **Line:** show points on the line so individual values are visible.
- **Box plot:** whiskers span the full range (`extent: "min-max"`) so extreme
  values read as whisker ends, not stray outlier circles.
- **Tooltips:** enabled on every mark so values are inspectable on hover.

## General principles
- Prefer clarity over decoration; no chartjunk.
- Never hide data to look tidy — rotate/limit labels instead of dropping them.
- Sort categorical bars/pies by value where it aids reading (handled in data prep).
