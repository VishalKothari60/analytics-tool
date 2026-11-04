# Astera Studio — clickable mockup

A responsive, touch-friendly HTML mockup of **Astera Studio**, a chat-first analytics tool. Users ask questions in plain language, get a chart and a short explanation, pin it to a dashboard, and check on or lightly edit the data pipelines behind those charts from desktop, iPad or iPhone.

All data is made up. The sample workspace is **Brightline Supply Co.**, a fictional US distributor of office furniture and workspace gear, with five US regions (West, Southwest, Midwest, Southeast, Northeast), April–October 2026. The assistant is called **Vega**.

There's no backend and no build step.

## How to open

- **Double-click `index.html`.** It runs straight from the file system in any modern browser (Chrome, Edge, Safari, Firefox).
- From the GitHub repo: clone it or download the ZIP, then open `index.html`. (GitHub's file viewer doesn't run HTML. If you want a link instead, turn on GitHub Pages for the repo and it will serve these same files unchanged.)
- The only network request is the Inter web font. Offline, it falls back to the system font and everything else still works.
- Charts are hand-drawn SVG (no chart library), so nothing else needs to load.
- Pinned charts are saved in `localStorage`. Pipeline state resets on reload. **Reset demo** (bottom of the sidebar) clears pins so you can run the story again.

To try the breakpoints, open DevTools → device toolbar and use 375 × 812, 768 × 1024, 1024 × 768 and 1440 × 900.

## 60-second demo path (the connected story)

1. **Dashboard** (`#dashboard`). The header and the phone's sticky strip say *1 pipeline failed*. The **Revenue vs target by region** chart shows *"Data is 18h old: pipeline failed."*
2. Tap a bar (e.g. **Southeast**). Its values appear in the readout under the chart. Tap **Break down Southeast** to open the metro drill-down.
3. Close it and tap **View & fix pipeline** on that chart. This opens **Daily Sales Rollup** (`#pipeline/sales-daily`).
4. The **Join with database** step is *Failed: "Connection timed out after 30s"*. Open it (click the node on desktop, the list row on iPad, or the timeline row on iPhone, which opens a bottom sheet).
5. Change **Connection timeout** from `30` to `90` (try `2` first to see the inline validation). Or switch **Credentials** to `vault://crm-readonly-pool`.
6. Tap **Save & re-run from this step**. The steps run one at a time with a timer and "step 1 of 3" progress, and the re-run buttons are disabled until the run ends.
7. It finishes as **Succeeded**. Row counts update and the banner says the dashboard has fresh data. Tap **View dashboard**: the warning is gone and the chart says **Updated just now**.
8. Tap **Ask Vega about this** on the chart. Chat opens with the chart as context and suggested follow-ups (e.g. *"Why did Southeast miss target?"*).

If you re-run *without* fixing the timeout, the join fails again. That's the pipeline-run error state.

## What to try at each screen size

| Screen | Size | Try this |
|---|---|---|
| **iPhone** | 375 px | Bottom tab bar (Chat / Dashboard / Pipelines; the badge shows 1 failed pipeline). Swipe the KPI row (it snaps, and the next card peeks in). **Filters** chip opens a bottom sheet. Tap chart bars to reveal values. Pipelines show as a **vertical timeline** with the join's second input as an indented *"+ joined with: crm.customers"* sub-row. Tapping a step opens a **bottom sheet** you can edit; the browser back button closes it. |
| **iPad portrait** | 768 px | Sidebar collapses to an icon rail (toggle at top-left). Dashboard is 2 columns with the priority chart full width. Pipeline detail is a **split view**: step list on the left, selected step's details and edit form on the right. |
| **iPad landscape** | 1024 px | Sidebar opens by default. KPIs sit in one row of 4. Same split view, with more room. |
| **Desktop** | 1440 px | Persistent sidebar with every pipeline's status. Inline filters (date range + region). Multi-column chart grid. Pipeline detail is a **left-to-right node canvas** with the join branch and connector lines; clicking a node opens the **right-side inspector**. |

### Other things to poke at

- **Chat**: tap a suggested question, or type one (Enter sends).
  - Follow-up chips (*Show by region*, *Change to line chart*, *Last 6 months*, *Break down … by metro*) each produce a new reply.
  - *"What is our employee headcount?"* gets the honest fallback with 3 working suggestions.
  - *"Revenue in Canada"* gets a partial answer that names what *is* available.
- **Duplicate pins**: pin *"Which regions missed their sales target last quarter?"*, then ask *"Did any regions fall behind plan in Q3?"* and tap Pin again. The sheet says **Already pinned to Sales Overview** with a link. The answer's button already reads **Pinned ✓**.
- **Undo / remove**: the pin toast has **Undo**. Pinned cards on the dashboard have a **⋯** menu with *Remove from dashboard*, which also has Undo.
- **Empty states**: set the region to **Southwest** with **Q3 2026**. Southwest only started selling in October, so the charts show an empty state with **Reset filters**. **Regional Leadership Review** (dashboard switcher) starts empty and points you to Chat.
- **Unsaved changes**: edit a step setting, then close the sheet, pick another step or press Back. You'll be asked to confirm.
- **Long names**: tap a pipeline's title or a pinned chart's title to expand truncated text.
- **Statuses**: all four (Running, Succeeded, Failed, Scheduled) are visible at once in the sidebar and the dashboard's pipeline row. Each always shows an icon and a text label.

## Files

```
index.html   app shell: sidebar, top bar, bottom tabs, icon sprite, overlay roots
styles.css   design tokens (CSS variables), spacing scale, the three breakpoint layouts
data.js      sample data: regions, revenue/targets, pipelines and steps, chat vocabulary, scripted answers
app.js       router, state, SVG charts, views, sheets/toasts, chat matching, pipeline run simulation
assets/      logo.svg
NOTE.md      design note (ideas, what I dropped, AI tools used)
```

## How "chat" works without AI

`data.js` holds a small vocabulary: metrics with synonyms (*sales* → revenue, *quota* → target), dimensions, and the values that exist in the data. A question is lowercased and matched against it to build a chart spec `{ metric, dimension, chartType, range, region }`:

- metric and dimension found → an answer built from that spec
- metric found but the value isn't in the data (e.g. Canada, December) → a partial answer that says what is available
- no metric found → an honest fallback with 3 working suggestions, never a made-up chart

The dashboard charts use the same spec format, which is why *Ask Vega about this* and pinning work everywhere. Duplicate pins are detected with the key `metric|dimension|chartType|range|region`, so different wording of the same question gives the same key. In a real product, an LLM would produce the spec. That's noted in a code comment in `app.js` (`interpret()`) and in `data.js`.
