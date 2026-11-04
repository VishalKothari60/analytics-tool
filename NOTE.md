# Design note: Astera Studio mockup

*Vishal Kothari · FAST NUCES · Batch 2027*

## Main design ideas

**One idea runs through every screen: the chart and the pipeline behind it are never far apart.** Every chart, chat answer and pinned card shows its source pipeline, that pipeline's status (icon + text, never just colour) and how old the data is. When a pipeline fails, the chart says so in plain words ("Data is 18h old: pipeline failed") and links straight to the broken step. That's the connected story in the mockup: stale chart → failed join → change the timeout → re-run from that step → the chart says "Updated just now".

**Pipeline detail is one model drawn three ways.** A pipeline is a short chain with one branch (the join takes a second input from a database table), so I didn't think every screen needed a 2D graph.

- **Desktop:** a left-to-right node canvas with connector lines, so you can see the shape of the flow, including the join branch. Clicking a node opens a right-side inspector with its settings. The canvas scales to fit its column instead of scrolling sideways.
- **iPad:** a split view. The step list is on the left and the selected step's details and settings are on the right. Two panes fit an iPad well, and you never lose your place in the list while editing.
- **iPhone:** no canvas. The steps become a vertical timeline with status dots and connector lines, and the join's second input is an indented "+ joined with: crm.customers" row under the join instead of a second branch. Tapping a step opens a bottom sheet. The step is in the URL, so the back button closes the sheet.

All three use the same step-detail component (rows in/out, duration, last run, error message with a hint, settings form). The layouts change, but what you can see about a step doesn't.

**"Light edit" means parameters, not structure.** On iPad and iPhone you can change a step's settings (filter condition, date, source file, timeout, credentials), turn a step on or off, re-run from a step, or re-run the whole pipeline. You can't add, remove or rewire steps there, and a small hint says those are available on desktop. My reasoning: the mobile jobs are "something broke, can I fix it from here?" and "change this one value". Rewiring a graph with a thumb is slow and easy to get wrong, and a bad structural edit breaks every chart downstream. Parameter edits get inline validation, unsaved changes ask before they're thrown away, and the re-run buttons lock with "step 2 of 3" progress so nobody starts a run twice.

**Edge cases I cared about:**

- **Duplicate pins.** A chart is identified by `metric|dimension|chartType|range|region`, not by the question text. "Which regions missed target last quarter?" and "Did any regions fall behind plan in Q3?" are the same chart, so the second pin says "Already pinned to Sales Overview" with a link instead of adding a copy.
- **Honest chat fallback.** If Vega can't map a question to data it has, it says "I don't have data for that yet" and offers three questions that work. If only part of a question maps (e.g. Canada, when the data is US-only), it says what is available. It never draws a chart it can't back up.
- **Empty filters.** Southwest + Q3 returns nothing because that territory only opened in October. The chart explains why and offers "Reset filters".

## An idea I tried and dropped

On the phone dashboard, I first kept the same header as desktop: eyebrow, title, status badge and a freshness line, with the sticky status strip below it. On a 375px screen the KPIs were pushed below the fold. I removed the header on phone and moved the dashboard switcher into a small chip next to the filter chip. The top bar already names the dashboard, and the strip already answers the freshness question.

## AI tools used

- **Claude** (Claude Code) to plan the requirement checklist and data model, write the HTML/CSS/JS, and check the layouts at each breakpoint in a browser.
- **ChatGPT** for early brainstorming/prompting.

**Key prompts:**

**1. ChatGPT: turning the assessment into a build brief.** Before writing any code, I asked ChatGPT to help me work out what a complete brief should cover:

> I'm solving a take-home design assessment for a Software Developer Intern role. I'll attach the full assessment below. Assume you're the one solving it with an AI coding assistant. What prompt would you give that LLM so the result meets every requirement? Make it explicit about the screens, the iPhone / iPad / desktop layouts, touch and accessibility rules, sample data, edge cases, and the deliverables (mockup, readme, one-page note). Also include how the AI should work with me: confirm the requirements first, then build in steps.

**2. Claude: the main build prompt.** I reviewed the brief ChatGPT suggested, added what was missing (my personal touch, a US sales-analytics sample domain, the "light edit = parameters, not structure" decision, and the edge cases), removed things I didn't need, and gave Claude this prompt along with the assessment PDF:

<details>
<summary>Full prompt (click to expand)</summary>

```text
I'm applying for a Software Developer Intern role. I've attached the take-home assessment PDF ("Software Developer Intern — Take-Home Design Assessment.pdf"). Please read it fully before doing anything. Every requirement in it is mandatory, and I'll list how I want to approach it below.

## Who I am (for the personal touch)
- Name / uni / batch: [Vishal Kothari], [FAST NUCES], [2027]. The final zip must be named [[YourName_UNI_Batch]].
- Personal touch I want built in:
  1. Sample data must be business/sales analytics. All KPIs, regions, product names and pipeline sources (Excel file names, database tables) should come from this world and feel realistic, not generic "Product A / Region 1". If needs to target any region then you can pick US.
  2. One small signature detail, e.g. a named assistant ("Ask Vega").
- Don't invent personal facts about me beyond what's listed here.

## What to build
A clickable, responsive, touch-friendly HTML mockup of "Astera Studio" with no backend and fake data.

Tech constraints:
- Plain HTML/CSS/JS: index.html + styles.css + app.js (one small data.js is fine). No build step. It must open by double-clicking index.html.
- Hash-based routing (#chat, #dashboard, #pipeline/sales-daily, etc.) so the browser back button works.
- Charts: Chart.js from a pinned CDN version, or hand-drawn SVG. Charts must resize properly.
- No hover-only interactions anywhere. Tap targets at least 44×44px. Status shown with icon + text label, never colour alone. Visible focus states.
- It must look *designed*, not like a template: a consistent spacing scale, 1–2 fonts, a restrained palette with CSS variables, and a light theme (dark mode optional, only if time allows).

Breakpoints. Each one must have a genuinely different layout, not a shrunk one:
- iPhone 375px: bottom tab bar (Chat / Dashboard / Pipelines), single column, bottom sheets for details and filters.
- iPad 768–1024px: collapsible sidebar, 2-column layouts, split view (list + detail) for pipelines. Handle both portrait (768) and landscape (1024).
- Desktop 1440px: persistent left sidebar, multi-column dashboard grid, pipeline node canvas with a right-side inspector panel.

## Screens

1. Chat
- Empty state with 3–4 suggested questions from my sample domain.
- The user asks a question (typing works; tapping a suggestion works too). Show a short "thinking" state, then an answer card with a chart, a 2–3 sentence plain-language summary, and a "Source: <pipeline name> · updated <time>" chip that links to that pipeline's detail.
- Actions on the answer card: Pin to dashboard (opens a sheet/popover to choose a dashboard, then shows a confirmation toast), and follow-up chips like "Show by region" / "Change to line chart" / "Last 6 months". Tapping one updates the chart in a new reply. Pre-script 3–4 question→answer pairs. It's fine to fall back to the closest match for typed input.

2. Dashboard
- 4 KPIs and 3–4 charts, with filters for date range and region that actually change the shown data.
- Each chart and the dashboard header show data freshness ("Updated 12 min ago") and the feeding pipeline's status: Running / Succeeded / Failed / Scheduled. All four states must appear somewhere in the sample data.
- One chart is fed by a FAILED pipeline and shows a clear stale-data warning ("Data is 18h old — pipeline failed") with a button to view or fix it.
- Phone solution: a sticky status/freshness strip at the top that answers "is my data OK?" first. KPIs in a horizontal swipe row with scroll-snap and a peek of the next card. Charts stacked by priority. Filters in a bottom sheet with an active-filter summary chip. Chart values revealed by tap, not hover.
- Pinned answers from Chat should appear on the dashboard (keep state in memory or localStorage).

3. Pipeline detail (the most important screen; get this right)
- A pipeline is a chain of steps, e.g. Read Excel file → Filter rows → Join with database → Transformations → Output to dashboard. Include at least one branch (the join takes two inputs).
- Each step has: type icon, name, status, row count in/out, duration, last run time, and an error message if it failed.
- Desktop: a node canvas (SVG or positioned divs with connector lines) showing the flow left-to-right, including the join branch. Clicking a node opens a right-side inspector with its configuration.
- iPad: split view. A step list or compact canvas on the left, the selected step's details on the right.
- iPhone: NO canvas. A vertical, timeline-style step list with connector lines and status dots. The join is shown as an indented "+ joined with: customers table" sub-row, not a 2D graph. Tapping a step opens a bottom sheet with its details.
- "Lightly edit" from mobile (the PDF says users want to check on and lightly edit pipelines from iPad/iPhone). Supported: edit a step's parameters (e.g. change the filter condition or date value, change the source file, or toggle a step on/off), "Re-run from this step", and "Re-run pipeline". Deliberately NOT supported on phone: adding, removing or rewiring steps. Show a small "Structural edits are available on desktop" hint. This is a design decision I'll explain in my note.

4. Graph actions. Implement these as one connected story:
- Dashboard: a chart with the stale-data warning → tap "View pipeline".
- Pipeline detail: the "Join with database" step is Failed (e.g. "Connection timed out after 30s").
- Open the step → adjust a setting (e.g. timeout or credentials reference) → "Re-run from this step".
- The status animates Running (steps progress one by one with a timer) → Succeeded. Row counts and freshness update.
- Back on the dashboard, the chart's warning is gone and it shows "Updated just now".
- Also: drill down. Tapping a bar/region in a dashboard chart shows a breakdown (e.g. region → branches) in a sheet or panel.
- Also: "Ask about this chart". From a dashboard chart, jump to Chat with the chart as context and a suggested follow-up.

## Navigation and polish
- Global "Studio" header with my personal touch where appropriate.
- Smooth but quick transitions (under 200ms). Respect prefers-reduced-motion.
- No horizontal page scrolling at any breakpoint, except intentional swipe rows.
- Empty, loading and error states for at least the chat answer and the pipeline run.

## Edge cases and states (handle these; keep it lightweight)
- Duplicate pins: a chart is identified by question + chart type + filters. Pinning the same one again shows "Already pinned to <dashboard>" with a link instead of creating a duplicate. After pinning, the button becomes "Pinned ✓".
- Undo: the pin toast has Undo. Pinned cards can be removed via a ⋯ menu.
- Unknown chat questions: an honest fallback ("I don't have data for that yet") plus 3 working suggestions. Never show a made-up chart.
- Filters with no matching data: an empty chart state with a "Reset filters" action.
- Re-run: disabled while running, showing progress ("step 2 of 5"). Prevent double-taps.
- Step editing: inline validation for invalid values. Ask for confirmation when closing the sheet with unsaved changes.
- Pinned charts from a failed/stale pipeline keep showing the stale-data warning.
- Empty dashboard state that points to Chat.
- Long names truncate with an ellipsis. Full text on tap, never hover-only.
In NOTE.md, mention 2–3 of these briefly under design ideas (duplicate-pin handling and the honest chat fallback are the best ones).

## How chat matching and duplicate detection work (no real AI)
- In data.js, define a vocabulary: metrics (with synonyms, e.g. "sales" → revenue), dimensions, and the valid values in the sample data (regions, months, products).
- Each scripted answer has a chart spec: { metric, dimension, chartType, filters, keywords }.
- Matching a typed question: lowercase it and detect metric/dimension/values.
  - Both found → the best-matching scripted answer.
  - Metric found but value not in the data → a partial answer naming what IS available.
  - No metric found → the honest fallback + 3 suggestions.
- Duplicate pins: the key is metric|dimension|chartType|range|region, so different wording gives the same key. Check it against the target dashboard's pinned keys (stored in localStorage).
- Add a short code comment explaining that in production an LLM would produce the spec.

## Deliverables (all in one folder, ready to zip)
1. The mockup files (index.html, styles.css, app.js, data.js, any assets).
2. README.md: what it is, how to open it (double-click index.html), a 60-second "demo path" walkthrough of the connected story above, and a list of which screens/actions to try at each screen size.
3. NOTE.md (about one page, as the PDF asks). Draft it in my voice, first person, plain and honest, no marketing tone:
   - Main design ideas and why, with the most space on the pipeline detail screen: canvas on desktop → split view on iPad → timeline + bottom sheet on phone, and the "light edit = parameters, not structure" decision.
   - One idea I tried and dropped, and why. Use this one if it's true by the end of our session.

## How I want you to work
1. First, reply with: (a) a checklist of every requirement you extracted from the PDF, (b) the sample data model (pipelines, steps, KPIs, charts) from my domain, and (c) the file structure. Wait for my OK.
2. Then build in this order: layout shell + navigation at all 3 breakpoints → Dashboard → Pipeline detail → Chat → the connected story/actions → polish.
3. After each major screen, tell me exactly what to check at 375 / 768 / 1024 / 1440px.
4. At the end, go back through your requirement checklist and mark each item as done, with where it lives in the code.
5. Keep the code readable and commented lightly. A reviewer may open it.
```

</details>

**3. Claude: fixing UI issues I found while testing.** After the first build, I went through every screen at phone and iPad sizes myself and sent fixes back as short, specific prompts. For example:

> Could you please fix the UI of the Sales Overview dropdown in iPhone and iPad mode? It's good in the desktop version, but on phone and iPad the dropdown is huge, so it needs CSS changes. Keep desktop as it is.

Claude replaced it with a compact "Sales Overview ▾" chip next to the filter chip on iPhone, and made the page title the switcher on iPad. Both open a "Switch dashboard" sheet. I then checked it again at 375, 768 and 1440px.

## What I changed or fixed by hand

- The "thinking" delay before Vega answers felt slow when I tested it, so I shortened it in `app.js` (2s → 1s for typed questions).
