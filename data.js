/* ==========================================================================
   Astera Studio mockup: sample data
   --------------------------------------------------------------------------
   Everything here is made up. The fictional company is "Brightline Supply Co.",
   a US distributor of office furniture and workspace gear.
   Plain global (no ES modules) so index.html works from file:// with no server.
   ========================================================================== */

(function () {
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const now = Date.now();

  /* ---------- Time ----------
     Monthly data runs Apr–Oct 2026. April only exists so "Q3" and
     "last 90 days" have a prior period to compare against. */
  const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

  // Each range is a list of buckets; a bucket is a set of {month index, weight}.
  // "Last 30 days" is shown as 4 weeks of October.
  const RANGES = {
    last30: {
      id: 'last30', label: 'Last 30 days', short: 'Last 30 days',
      buckets: [
        { label: 'Oct 5', parts: [[6, 0.23]] },
        { label: 'Oct 12', parts: [[6, 0.25]] },
        { label: 'Oct 19', parts: [[6, 0.24]] },
        { label: 'Oct 26', parts: [[6, 0.28]] },
      ],
      prior: [[5, 1]],
      priorLabel: 'vs Sep',
    },
    last90: {
      id: 'last90', label: 'Last 90 days', short: 'Last 90 days',
      buckets: [4, 5, 6].map((m) => ({ label: MONTHS[m], parts: [[m, 1]] })),
      prior: [[1, 1], [2, 1], [3, 1]],
      priorLabel: 'vs prior 90 days',
    },
    q3: {
      id: 'q3', label: 'Q3 2026 (Jul–Sep)', short: 'Q3 2026',
      buckets: [3, 4, 5].map((m) => ({ label: MONTHS[m], parts: [[m, 1]] })),
      prior: [[0, 1], [1, 1], [2, 1]],
      priorLabel: 'vs Q2',
    },
    last6: {
      id: 'last6', label: 'Last 6 months', short: 'Last 6 months',
      buckets: [1, 2, 3, 4, 5, 6].map((m) => ({ label: MONTHS[m], parts: [[m, 1]] })),
      prior: null, // no earlier data in the sample, so no delta
      priorLabel: '',
    },
  };

  /* ---------- Regions and metros ----------
     Southwest is a new territory that only started selling in October 2026.
     That is what makes "Southwest + Q3" an honest empty-data case. */
  const REGIONS = [
    { id: 'west', name: 'West', margin: 38.5, aov: 1840, returnsMult: 0.9,
      metros: [['Seattle', 0.24, 1.07], ['San Francisco', 0.31, 1.06], ['Los Angeles', 0.33, 1.01], ['Denver', 0.12, 0.98]] },
    { id: 'southwest', name: 'Southwest', margin: 31.0, aov: 1420, returnsMult: 1.3,
      metros: [['Phoenix', 0.38, 0.93], ['Dallas', 0.41, 0.88], ['Austin', 0.21, 0.86]] },
    { id: 'midwest', name: 'Midwest', margin: 36.2, aov: 1610, returnsMult: 1.0,
      metros: [['Chicago', 0.52, 1.03], ['Minneapolis', 0.27, 0.99], ['Columbus', 0.21, 0.97]] },
    { id: 'southeast', name: 'Southeast', margin: 33.8, aov: 1530, returnsMult: 1.15,
      metros: [['Atlanta', 0.46, 0.91], ['Miami', 0.31, 0.79], ['Charlotte', 0.23, 0.88]] },
    { id: 'northeast', name: 'Northeast', margin: 37.1, aov: 1760, returnsMult: 0.95,
      metros: [['New York', 0.49, 0.95], ['Boston', 0.30, 1.01], ['Philadelphia', 0.21, 0.95]] },
  ];
  // metros: [name, share of region revenue, attainment multiplier vs region]

  // Net revenue in $K per month (Apr..Oct). null = region not selling yet.
  const REVENUE = {
    west:      [590, 610, 640, 655, 690, 720, 745],
    southwest: [null, null, null, null, null, null, 180],
    midwest:   [415, 420, 410, 435, 440, 452, 470],
    southeast: [385, 380, 395, 372, 360, 355, 368],
    northeast: [525, 540, 560, 548, 575, 590, 612],
  };
  const TARGET = {
    west:      [590, 600, 620, 640, 660, 690, 720],
    southwest: [null, null, null, null, null, null, 200],
    midwest:   [400, 410, 420, 430, 440, 450, 460],
    southeast: [380, 390, 400, 410, 420, 430, 440],
    northeast: [520, 530, 550, 570, 590, 610, 630],
  };

  /* ---------- Products ---------- */
  const CATEGORIES = [
    { id: 'seating', name: 'Ergonomic Seating', share: 0.31, returnRate: 4.2 },
    { id: 'desks', name: 'Standing Desks', share: 0.24, returnRate: 6.8 },
    { id: 'arms', name: 'Monitor Arms & Mounts', share: 0.14, returnRate: 2.1 },
    { id: 'storage', name: 'Storage & Filing', share: 0.12, returnRate: 1.6 },
    { id: 'conference', name: 'Conference Tech', share: 0.10, returnRate: 7.9 },
    { id: 'lighting', name: 'Task Lighting', share: 0.09, returnRate: 3.0 },
  ];
  // Small month-to-month wobble for return rates (Apr..Oct)
  const RETURNS_MONTH_MULT = [1.02, 0.98, 1.0, 1.05, 1.08, 0.97, 0.95];

  /* ---------- Open sales pipeline (CRM snapshot, $K) ---------- */
  const STAGES = ['Prospecting', 'Qualified', 'Proposal', 'Negotiation', 'Verbal commit'];
  const OPPORTUNITIES = {
    west:      [820, 610, 430, 260, 140],
    southwest: [540, 310, 160, 70, 30],
    midwest:   [560, 420, 300, 190, 95],
    southeast: [610, 380, 240, 120, 60],
    northeast: [700, 530, 390, 240, 130],
  };

  /* ---------- Pipelines ----------
     Every pipeline here has the same shape so the canvas layout can be shared:
       source file ─► filter ─┐
                               ├─► join ─► transform ─► output
       database table ────────┘
     `inputs` lists upstream step ids, which is how the join branch is modelled. */
  function step(id, type, name, inputs, extra) {
    return Object.assign({
      id, type, name, inputs,
      enabled: true,
      status: 'succeeded',
      rowsIn: null, rowsOut: null,
      durationSec: null,
      lastRunAt: null,
      error: null,
      config: {},
    }, extra);
  }

  const salesDailyRun = now - 18 * HOUR;

  const PIPELINES = [
    {
      id: 'sales-daily',
      name: 'Daily Sales Rollup',
      description: 'Combines the daily order export with CRM customer data to compute revenue vs target by region.',
      status: 'failed',
      schedule: 'Daily at 6:00 AM ET',
      owner: 'Revenue Ops',
      lastRunAt: now - 2 * HOUR - 14 * MIN,   // the failed attempt this morning
      dataUpdatedAt: salesDailyRun,          // last successful load, so data is 18h old
      feeds: ['rev-vs-target'],
      steps: [
        step('read-orders', 'excel', 'Read Excel file', [], {
          rowsOut: 48212, durationSec: 4.2, lastRunAt: now - 2 * HOUR - 14 * MIN,
          config: { file: 'us_sales_orders_FY26.xlsx', sheet: 'Orders', headerRow: 1 },
        }),
        step('filter-orders', 'filter', 'Filter rows', ['read-orders'], {
          rowsIn: 48212, rowsOut: 41906, durationSec: 1.1, lastRunAt: now - 2 * HOUR - 13 * MIN,
          config: { condition: "status != 'Cancelled'", dateFrom: '2026-04-01' },
        }),
        step('read-customers', 'database', 'Read customers table', [], {
          rowsOut: 9384, durationSec: 2.6, lastRunAt: now - 2 * HOUR - 14 * MIN,
          config: { connection: 'prod-crm-replica (PostgreSQL)', table: 'crm.customers', columns: 'customer_id, segment, state' },
        }),
        step('join-customers', 'join', 'Join with database', ['filter-orders', 'read-customers'], {
          status: 'failed', rowsIn: 41906, rowsOut: 0, durationSec: 30.0, lastRunAt: now - 2 * HOUR - 13 * MIN,
          error: 'Connection timed out after 30s while reading crm.customers from prod-crm-replica.',
          hint: 'The CRM replica is slow during its nightly backup window. A longer timeout (60–120s) or the pooled read-only credential usually fixes this.',
          config: { joinType: 'Left join', joinKey: 'customer_id', timeoutSec: 30, credentials: 'vault://crm-readonly' },
        }),
        step('transform-revenue', 'transform', 'Transformations', ['join-customers'], {
          status: 'skipped', lastRunAt: salesDailyRun,
          config: { expressions: 'net_revenue = gross - discount - returns\nregion = map_state_to_region(state)' },
        }),
        step('output-dashboard', 'output', 'Output to dashboard', ['transform-revenue'], {
          status: 'skipped', lastRunAt: salesDailyRun,
          config: { dashboard: 'Sales Overview', chart: 'Revenue vs target by region', writeMode: 'Replace' },
        }),
      ],
    },
    {
      id: 'revenue-monthly',
      name: 'Monthly Revenue History',
      description: 'Finance-closed monthly revenue, margin and order counts for all US regions.',
      status: 'succeeded',
      schedule: 'Hourly',
      owner: 'Finance',
      lastRunAt: now - 12 * MIN,
      dataUpdatedAt: now - 12 * MIN,
      feeds: ['kpis', 'revenue-trend'],
      steps: [
        step('read-close', 'excel', 'Read Excel file', [], {
          rowsOut: 15640, durationSec: 3.1, lastRunAt: now - 13 * MIN,
          config: { file: 'monthly_close_FY26.xlsx', sheet: 'Ledger', headerRow: 2 },
        }),
        step('filter-posted', 'filter', 'Filter rows', ['read-close'], {
          rowsIn: 15640, rowsOut: 15102, durationSec: 0.6, lastRunAt: now - 13 * MIN,
          config: { condition: "entry_status = 'Posted'", dateFrom: '2026-04-01' },
        }),
        step('read-gl', 'database', 'Read GL accounts', [], {
          rowsOut: 412, durationSec: 0.9, lastRunAt: now - 13 * MIN,
          config: { connection: 'finance-warehouse (Snowflake)', table: 'finance.gl_accounts', columns: 'account_id, account_type, region_code' },
        }),
        step('join-gl', 'join', 'Join with database', ['filter-posted', 'read-gl'], {
          rowsIn: 15102, rowsOut: 15102, durationSec: 2.4, lastRunAt: now - 12 * MIN,
          config: { joinType: 'Inner join', joinKey: 'account_id', timeoutSec: 60, credentials: 'vault://finance-readonly' },
        }),
        step('transform-month', 'transform', 'Transformations', ['join-gl'], {
          rowsIn: 15102, rowsOut: 35, durationSec: 1.3, lastRunAt: now - 12 * MIN,
          config: { expressions: 'month = date_trunc(posted_at, month)\nnet_revenue = sum(amount) by region, month' },
        }),
        step('output-kpis', 'output', 'Output to dashboard', ['transform-month'], {
          rowsIn: 35, rowsOut: 35, durationSec: 0.4, lastRunAt: now - 12 * MIN,
          config: { dashboard: 'Sales Overview', chart: 'KPIs, Monthly net revenue', writeMode: 'Replace' },
        }),
      ],
    },
    {
      id: 'opportunity-sync',
      name: 'CRM Opportunity Sync',
      description: 'Pulls open opportunities from the CRM export and sums them by stage and region.',
      status: 'running',
      schedule: 'Every 4 hours',
      owner: 'Sales Ops',
      lastRunAt: now - 3 * MIN,
      runningStep: 3, // shown as "step 3 of 5"
      dataUpdatedAt: now - 4 * HOUR - 3 * MIN,
      feeds: ['open-pipeline'],
      steps: [
        step('read-opps', 'excel', 'Read Excel file', [], {
          rowsOut: 6218, durationSec: 5.8, lastRunAt: now - 3 * MIN,
          config: { file: 'crm_opportunities_export.xlsx', sheet: 'Open', headerRow: 1 },
        }),
        step('filter-open', 'filter', 'Filter rows', ['read-opps'], {
          rowsIn: 6218, rowsOut: 4977, durationSec: 0.8, lastRunAt: now - 3 * MIN,
          config: { condition: "stage != 'Closed lost'", dateFrom: '2026-01-01' },
        }),
        step('read-accounts', 'database', 'Read accounts table', [], {
          rowsOut: 3120, durationSec: 1.7, lastRunAt: now - 3 * MIN,
          config: { connection: 'prod-crm-replica (PostgreSQL)', table: 'crm.accounts', columns: 'account_id, owner, region_code' },
        }),
        step('join-accounts', 'join', 'Join with database', ['filter-open', 'read-accounts'], {
          status: 'running', rowsIn: 4977, rowsOut: null, durationSec: null, lastRunAt: now - 2 * MIN,
          config: { joinType: 'Left join', joinKey: 'account_id', timeoutSec: 120, credentials: 'vault://crm-readonly-pool' },
        }),
        step('transform-stage', 'transform', 'Transformations', ['join-accounts'], {
          status: 'queued',
          config: { expressions: 'amount_k = amount / 1000\npipeline = sum(amount_k) by stage, region' },
        }),
        step('output-pipeline', 'output', 'Output to dashboard', ['transform-stage'], {
          status: 'queued',
          config: { dashboard: 'Sales Overview', chart: 'Open pipeline by stage', writeMode: 'Replace' },
        }),
      ],
    },
    {
      id: 'returns-weekly',
      name: 'Weekly Returns Report',
      description: 'Weekly return and refund log joined with the product catalog to compute return rate by category.',
      status: 'scheduled',
      schedule: 'Weekly, Wednesdays at 6:00 PM ET',
      nextRunLabel: 'Today 6:00 PM',
      owner: 'Customer Ops',
      lastRunAt: now - 6 * DAY - 2 * HOUR,
      dataUpdatedAt: now - 6 * DAY - 2 * HOUR,
      feeds: ['returns-rate'],
      steps: [
        step('read-returns', 'excel', 'Read Excel file', [], {
          rowsOut: 2304, durationSec: 1.9, lastRunAt: now - 6 * DAY - 2 * HOUR,
          config: { file: 'returns_log_2026_wk44.xlsx', sheet: 'Returns', headerRow: 1 },
        }),
        step('filter-returns', 'filter', 'Filter rows', ['read-returns'], {
          rowsIn: 2304, rowsOut: 2219, durationSec: 0.4, lastRunAt: now - 6 * DAY - 2 * HOUR,
          config: { condition: "reason != 'Test order'", dateFrom: '2026-04-01' },
        }),
        step('read-products', 'database', 'Read product catalog', [], {
          rowsOut: 1186, durationSec: 0.7, lastRunAt: now - 6 * DAY - 2 * HOUR,
          config: { connection: 'erp-prod (SQL Server)', table: 'erp.products', columns: 'sku, category, list_price' },
        }),
        step('join-products', 'join', 'Join with database', ['filter-returns', 'read-products'], {
          rowsIn: 2219, rowsOut: 2219, durationSec: 1.2, lastRunAt: now - 6 * DAY - 2 * HOUR,
          config: { joinType: 'Left join', joinKey: 'sku', timeoutSec: 60, credentials: 'vault://erp-readonly' },
        }),
        step('transform-rate', 'transform', 'Transformations', ['join-products'], {
          rowsIn: 2219, rowsOut: 30, durationSec: 0.6, lastRunAt: now - 6 * DAY - 2 * HOUR,
          config: { expressions: 'return_rate = returned_units / sold_units by category, region' },
        }),
        step('output-returns', 'output', 'Output to dashboard', ['transform-rate'], {
          rowsIn: 30, rowsOut: 30, durationSec: 0.3, lastRunAt: now - 6 * DAY - 2 * HOUR,
          config: { dashboard: 'Sales Overview', chart: 'Return rate by category', writeMode: 'Replace' },
        }),
      ],
    },
  ];

  // Options offered when editing parameters from a phone or tablet
  const STEP_OPTIONS = {
    files: ['us_sales_orders_FY26.xlsx', 'us_sales_orders_FY26_v2.xlsx', 'us_sales_orders_FY26_corrected_final.xlsx',
            'monthly_close_FY26.xlsx', 'crm_opportunities_export.xlsx', 'returns_log_2026_wk44.xlsx', 'returns_log_2026_wk45.xlsx'],
    credentials: ['vault://crm-readonly', 'vault://crm-readonly-pool', 'vault://finance-readonly', 'vault://erp-readonly'],
    joinTypes: ['Left join', 'Inner join'],
    writeModes: ['Replace', 'Append'],
  };

  /* ---------- Dashboards ---------- */
  const DASHBOARDS = [
    { id: 'sales-overview', name: 'Sales Overview', description: 'US revenue, targets, pipeline and returns', core: true },
    { id: 'leadership-review', name: 'Regional Leadership Review', description: 'Charts pinned for the Monday leadership sync', core: false },
  ];

  /* ---------- Chat vocabulary ----------
     NOTE: There's no real AI here. In production an LLM would read the question
     and return the same kind of chart spec ({ metric, dimension, chartType,
     range, region }). The mockup finds keywords in this vocabulary instead, so
     the rest of the UI (charts, pinning, duplicate detection) works the same way. */
  const VOCAB = {
    // Order matters: more specific metrics are checked first ("sales target" is
    // attainment, not revenue).
    metrics: [
      { id: 'attainment', label: 'Revenue vs target', synonyms: ['target', 'quota', 'attainment', 'missed', 'beat', 'goal', 'on track', 'behind plan', 'plan'],
        dimensions: ['region', 'month', 'metro'], defaultDimension: 'region', format: 'currency' },
      { id: 'returns', label: 'Return rate', synonyms: ['return rate', 'returns', 'returned', 'refund', 'refunds'],
        dimensions: ['category', 'region'], defaultDimension: 'category', format: 'percent' },
      { id: 'pipeline', label: 'Open pipeline', synonyms: ['open pipeline', 'sales pipeline', 'opportunities', 'opportunity', 'deals', 'forecast', 'funnel'],
        dimensions: ['stage', 'region'], defaultDimension: 'stage', format: 'currency' },
      { id: 'aov', label: 'Average order value', synonyms: ['average order value', 'aov', 'order value', 'basket size', 'order size'],
        dimensions: ['region', 'month'], defaultDimension: 'region', format: 'dollars' },
      { id: 'orders', label: 'Orders', synonyms: ['orders', 'order count', 'number of orders', 'transactions'],
        dimensions: ['region', 'month'], defaultDimension: 'month', format: 'number' },
      { id: 'margin', label: 'Gross margin', synonyms: ['gross margin', 'margin', 'profitability', 'profit'],
        dimensions: ['region', 'month'], defaultDimension: 'region', format: 'percent' },
      { id: 'revenue', label: 'Net revenue', synonyms: ['net revenue', 'revenue', 'sales', 'income', 'turnover', 'top line', 'earnings', 'selling', 'sold'],
        dimensions: ['month', 'region', 'category', 'metro'], defaultDimension: 'month', format: 'currency' },
    ],
    dimensions: [
      { id: 'metro', synonyms: ['metro', 'metros', 'city', 'cities', 'branch', 'branches'] },
      { id: 'region', synonyms: ['region', 'regions', 'regional', 'territory', 'territories', 'where'] },
      { id: 'category', synonyms: ['category', 'categories', 'product', 'products', 'product line', 'sku'] },
      { id: 'stage', synonyms: ['stage', 'stages', 'funnel'] },
      { id: 'month', synonyms: ['month', 'monthly', 'trend', 'trended', 'over time', 'per month', 'weekly', 'week'] },
    ],
    ranges: [
      { id: 'q3', synonyms: ['last quarter', 'q3', 'third quarter', 'previous quarter', 'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september'] },
      { id: 'last6', synonyms: ['last 6 months', 'last six months', '6 months', 'six months', 'half year', 'since may', 'this year', 'ytd', 'year to date'] },
      { id: 'last90', synonyms: ['last 90 days', '90 days', 'last 3 months', 'last three months'] },
      { id: 'last30', synonyms: ['last 30 days', '30 days', 'this month', 'last month', 'october', 'oct', 'recent'] },
    ],
    // Things people may ask about that are NOT in the sample data → partial answer
    outOfData: [
      { pattern: /\b(canada|mexico|europe|emea|apac|uk|international|global|asia|latam)\b/, kind: 'region',
        available: 'I only have US regions: West, Southwest, Midwest, Southeast and Northeast.' },
      { pattern: /\b(jan|january|feb|february|mar|march|nov|november|dec|december|2025|2024|last year|q1|q2|q4)\b/, kind: 'time',
        available: 'My data covers April to October 2026. Try Q3 2026, the last 90 days or the last 6 months.' },
      { pattern: /\b(laptops?|printers?|paper|software|phones?|monitors?)\b/, kind: 'product',
        available: 'Brightline sells Ergonomic Seating, Standing Desks, Monitor Arms & Mounts, Storage & Filing, Conference Tech and Task Lighting.' },
    ],
  };

  /* ---------- Scripted chat answers ----------
     Each one is a question plus the chart spec Studio would get back. */
  const SCRIPTED = [
    { id: 'q-target', question: 'Which regions missed their sales target last quarter?',
      spec: { metric: 'attainment', dimension: 'region', chartType: 'bar', range: 'q3', region: 'all' },
      keywords: ['missed', 'target', 'region', 'quarter'] },
    { id: 'q-trend', question: 'How has monthly revenue trended over the last 6 months?',
      spec: { metric: 'revenue', dimension: 'month', chartType: 'line', range: 'last6', region: 'all' },
      keywords: ['trend', 'monthly', 'revenue'] },
    { id: 'q-category', question: 'What are our top product categories by revenue?',
      spec: { metric: 'revenue', dimension: 'category', chartType: 'hbar', range: 'q3', region: 'all' },
      keywords: ['top', 'category', 'product', 'revenue'] },
    { id: 'q-returns', question: "What's our return rate by product category?",
      spec: { metric: 'returns', dimension: 'category', chartType: 'hbar', range: 'last90', region: 'all' },
      keywords: ['return', 'rate', 'category'] },
  ];

  // Which pipeline feeds which metric/dimension (used for the "Source" chip)
  function sourceFor(metric, dimension) {
    if (metric === 'attainment') return 'sales-daily';
    if (metric === 'revenue' && (dimension === 'region' || dimension === 'metro')) return 'sales-daily';
    if (metric === 'returns') return 'returns-weekly';
    if (metric === 'pipeline') return 'opportunity-sync';
    return 'revenue-monthly';
  }

  window.STUDIO_DATA = {
    MONTHS, RANGES, REGIONS, REVENUE, TARGET, CATEGORIES, RETURNS_MONTH_MULT,
    STAGES, OPPORTUNITIES, PIPELINES, STEP_OPTIONS, DASHBOARDS, VOCAB, SCRIPTED,
    sourceFor, company: 'Brightline Supply Co.',
  };
})();
