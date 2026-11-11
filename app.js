const names = {
  ads: 'Ad platform', web: 'Website analytics', outcomes: 'Business outcomes',
  events: 'Event exports', event_source: 'Event source', event_name: 'Event name',
  event_category: 'Event category', event_description: 'Event description', event_count: 'Event count',
  unique_users: 'Unique users', ad_platform: 'Ad platform', campaign: 'Campaign', landing_page: 'Landing page',
  traffic_source: 'Traffic source', traffic_medium: 'Traffic medium', link_clicks: 'Link clicks',
  landing_page_views: 'Landing page views', reach: 'Reach', confirmed_enrollments: 'Confirmed enrollments',
  confirmed_sales: 'Confirmed sales',
  spend: 'Ad spend', impressions: 'Impressions', clicks: 'Clicks', reported_conversions: 'Ad-attributed conversions',
  reported_revenue: 'Ad-attributed revenue', sessions: 'Sessions', engaged_sessions: 'Engaged sessions',
  site_conversions: 'Website conversions', leads: 'Leads', qualified_leads: 'Qualified leads', bookings: 'Bookings',
  orders: 'Orders', returns: 'Returns', net_revenue: 'Net revenue', commission: 'Commission',
  lead_id: 'Lead ID', lead_created_at: 'Lead creation date', created_at: 'Lead creation date',
  lead_source: 'Lead source', campaign_id: 'Stable campaign ID', campaign_name: 'Campaign name',
  original_status: 'CRM status', status: 'CRM status', qualified_at: 'Qualification date',
  closed_at: 'Closing date', observed_at: 'Status observation date', outcome: 'Outcome',
  customers: 'Confirmed customers',
  confirmed_revenue: 'Confirmed sale value', currency: 'Currency',
  'lead-gen': 'Lead generation / services', ecommerce: 'E-commerce', affiliate: 'Affiliate',
  'digital-product': 'Digital product', custom: 'Custom profile', date: 'Date', date_end: 'Reporting end date', key: 'Stable row key',
  account_id: 'Ad account ID', timezone: 'Export timezone', report_level: 'Reporting level',
  attribution_window: 'Attribution window', conversion_action: 'Conversion action', action_date_basis: 'Action reporting date basis',
};
const monetary = new Set(['spend', 'reported_revenue', 'net_revenue', 'commission', 'confirmed_revenue']);
const views = {
  overview: ['Overview', 'BUSINESS PERFORMANCE', 'Your key results and trends for the selected period.'],
  acquisition: ['Acquisition', 'ADS & TRAFFIC', 'See where traffic comes from and how your ads perform.'],
  funnel: ['Funnel & Events', 'CONVERSIONS', 'See how volumes change across stages and explore recorded events.'],
  leads: ['Leads / Sales', 'CRM OUTCOMES', 'Track lead quality, pipeline outcomes, and confirmed sales.'],
  financials: ['Financials', 'REVENUE & EFFICIENCY', 'Review ad spend, revenue, and acquisition costs.'],
  settings: ['Data & Settings', 'WORKSPACE MANAGEMENT', 'Manage your workspace, data sources, and imports.'],
};
const withoutComparison = new Set(['funnel', 'settings', 'financials']);
const state = {clients: [], profiles: {}, metrics: {}, clientId: '', siteId: '', report: null,
  view: Object.hasOwn(views, location.hash.slice(1)) ? location.hash.slice(1) : 'overview',
  acquisition: {}, events: {}, leads: {}, appliedDates: []};
let setupKind, upload, reportVersion = 0, uploadVersion = 0;
const client = () => state.clients.find(item => item.id === state.clientId);
const site = () => client()?.sites.find(item => item.id === state.siteId);
const scope = () => ({client_id: state.clientId, site_id: state.siteId});
const metricDefinition = key => state.report?.metric_definitions?.[key] || state.metric_definitions?.[key];
const nameOf = key => metricDefinition(key)?.label || names[key] || key;
const sourceOf = key => state.report?.config?.source_labels?.[key] || names[key] || key;

function notice(id, message = '') {
  $(id).textContent = message;
  $(id).hidden = !message;
}

async function request(path, data) {
  const response = await demoFetch(path, data ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)} : {});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Something went wrong.');
  return result;
}

async function refresh() {
  Object.assign(state, await request('/api/state'));
  if (state.environment === 'staging') {
    document.title = 'Client Insights | STAGING';
    $('workspace-mode').textContent = 'STAGING · LOCAL ONLY';
    $('data-mode').textContent = 'Staging CSV data';
  }
  if (!client()) state.clientId = state.clients[0]?.id || '';
  if (!site()) state.siteId = client()?.sites[0]?.id || '';
  renderSelectors();
}

function renderSelectors() {
  options($('client'), state.clients.length ? state.clients.map(item => [item.id, item.name]) : [['', 'Choose a client']], state.clientId);
  const sites = client()?.sites || [];
  options($('site'), sites.length ? sites.map(item => [item.id, item.name]) : [['', 'Choose a site']], state.siteId);
  $('client').disabled = !state.clients.length;
  $('site').disabled = !sites.length;
  $('add-site').disabled = !client();
  for (const id of ['import-button', 'import-nav', 'start', 'end']) $(id).disabled = !site();
  $('date-form').querySelector('button').disabled = !site();
  AppSidebar(state.view, client(), site());
  $('compare').disabled = !site();
  $('config-button').disabled = !site();
  $('lead-status-button').disabled = !site();
  const links = state.clients.map(item => {
    const node = button('', 'client-link', () => chooseClient(item.id));
    node.append(el('b', item.name.slice(0, 2).toUpperCase(), 'avatar'), el('span', item.name));
    if (item.id === state.clientId) node.setAttribute('aria-current', 'true');
    return node;
  });
  $('client-list').replaceChildren(...(links.length ? links : [el('p', 'No clients yet', 'nav-empty')]));
}

function chooseClient(id) {
  state.clientId = id;
  chooseSite(client()?.sites[0]?.id || '');
}

function chooseSite(id) {
  state.siteId = id;
  state.acquisition = {};
  state.overviewTrend = '';
  state.events = {};
  state.leads = {};
  state.revenueBasis = '';
  state.appliedDates = [];
  applyComparisonPreference();
  $('leads-report').replaceChildren();
  DateRangeFilter();
  renderSelectors();
  loadReport();
}

function applyComparisonPreference() {
  $('compare').checked = site()?.config?.compare_by_default ?? true;
}

async function loadReport(start = '', end = '', focusId = '') {
  const version = ++reportVersion;
  notice('notice');
  state.report = null;
  $('report').hidden = true;
  $('report-period').hidden = true;
  $('report').setAttribute('aria-busy', 'true');
  $('lead-status-button').disabled = true;
  if (!site()) {
    DateRangeFilter();
    renderReport();
    return;
  }
  $('report-status').replaceChildren(LoadingState());
  try {
    const endpoint = reportEndpoint(state.view);
    const query = new URLSearchParams({...scope(), start, end, ...(endpoint === 'leads' ? leadQuery() : {})});
    const result = await request(`/api/${endpoint}?${query}`);
    if (version !== reportVersion) return;
    state.report = result;
    state.appliedDates = start && end ? [start, end] : [];
    if (endpoint !== 'settings') DateRangeFilter(result.dates);
    renderReport();
    if (focusId) $(focusId)?.focus();
  } catch (error) {
    if (version === reportVersion) {
      $('report').setAttribute('aria-busy', 'false');
      $('report-status').replaceChildren(ErrorState(error.message, () => loadReport(start, end, focusId)));
    }
  }
}

function openSetup(kind) {
  setupKind = kind;
  $('setup-title').textContent = kind === 'client' ? 'New client' : 'New site / property';
  const input = el('input');
  input.name = 'name'; input.required = true; input.maxLength = 80;
  input.placeholder = kind === 'client' ? 'Client name' : 'e.g. Summer tours landing page';
  const select = el('select');
  const fields = [labeled(kind === 'client' ? 'Client name' : 'Site name', input)];
  if (kind === 'client') {
    select.name = 'profile';
    options(select, Object.keys(state.profiles).map(key => [key, nameOf(key)]));
    fields.push(labeled('Business profile', select));
  } else {
    select.name = 'outcome';
    options(select, state.profiles[client().profile].map(key => [key, nameOf(key)]));
    const currency = el('input');
    currency.name = 'currency'; currency.value = 'MAD'; currency.maxLength = 3;
    currency.pattern = '[A-Za-z]{3}'; currency.required = true;
    fields.push(labeled('Primary metric', select), labeled('Currency', currency));
  }
  $('setup-fields').replaceChildren(...fields);
  notice('setup-error');
  $('setup-dialog').showModal();
  input.focus();
}

$('setup-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (setupKind === 'client') {
      const item = await request('/api/clients', data);
      state.clientId = item.id;
      state.siteId = '';
    } else {
      const item = await request('/api/sites', {...data, client_id: state.clientId});
      state.siteId = item.id;
    }
    state.leads = {};
    $('setup-dialog').close();
    await refresh();
    applyComparisonPreference();
    await loadReport();
  } catch (error) {
    notice('setup-error', error.message);
  } finally { submit.disabled = false; }
});

function display(value, metric = '') {
  if (value == null || !Number.isFinite(value)) return '—';
  const format = monetary.has(metric) && site()?.currency
    ? {style: 'currency', currency: site().currency, currencyDisplay: 'code', maximumFractionDigits: 2}
    : {maximumFractionDigits: 2};
  return new Intl.NumberFormat('en', format).format(value);
}

const metricSource = metric => Object.keys(state.metrics).find(source => state.metrics[source].includes(metric));
const daysBetween = ([a, b]) => a && b ? (Date.parse(b) - Date.parse(a)) / 86400000 + 1 : 0;
function coveredDays(source, dates) {
  if (!dates?.length) return 0;
  return (state.report.feed_days[source] || []).filter(day => day >= dates[0] && day <= dates[1]).length;
}

function metricCard(metric, primary = false) {
  const {current, previous, dates, previous_dates} = state.report;
  const value = current.totals[metric];
  const base = previous?.totals[metric];
  const source = metricSource(metric);
  const sameCoverage = coveredDays(source, dates) === daysBetween(dates)
    && coveredDays(source, previous_dates) === daysBetween(previous_dates)
    && (source !== 'ads' || sameAdsProvenance(state.report.acquisition.ads, state.report.previous_acquisition?.ads));
  const group = state.report.acquisition?.[source];
  const issue = monetary.has(metric) && group?.money_issue;
  const coverage = group?.coverage[metric];
  const partial = value != null && (coverage
    ? coverage.covered_days < coverage.total_days || coverage.missing
    : current.coverage[metric]?.missing);
  const detail = issue || (coverage && (partial || value == null)
    ? `${coverage.covered_days} of ${coverage.total_days} days have recorded values.` : '');
  return KPIStatCard(nameOf(metric), issue ? 'N/A' : display(value, metric), sourceOf(source), primary ? 'featured' : '',
    comparisonTooltip(metric, value, base, sameCoverage, [detail]), partial ? 'partial' : undefined);
}

function renderReport() {
  const data = state.report;
  const selected = site();
  $('report').hidden = !data?.bounds?.length;
  $('report').setAttribute('aria-busy', 'false');
  $('report-period').hidden = !data?.dates?.length;
  if (['funnel', 'leads', 'settings', 'financials'].includes(state.view) && selected && data) $('report').hidden = false;
  $('report-status').replaceChildren();
  ComparisonControl(data || {}, $('compare').checked, !withoutComparison.has(state.view));
  if ($('report').hidden) {
    const config = selected
      ? ['Import your first CSV', 'Map your columns, check the cleaned rows, and save them to this site.', 'Import CSV', openImport]
      : client() ? ['Add a site for this client', 'A site can be a website, campaign property, or funnel you want to report on separately.', '+ Add site', () => openSetup('site')]
        : ['Set up your first client', 'Add a client and a site, then bring in the CSV exports you already use for reporting.', '+ New client', () => openSetup('client')];
    $('report-status').append(EmptyState(...config));
    return;
  }
  for (const name of Object.keys(views)) $(name + '-report').hidden = state.view !== name;
  if (state.view === 'settings') return renderSettings();
  $('period').textContent = readablePeriod(data.dates) + (data.config?.timezone ? ' · ' + data.config.timezone : '');
  $('date-range-label').textContent = readablePeriod(data.dates);
  if (state.view === 'acquisition') return renderAcquisition();
  if (state.view === 'funnel') return renderFunnel();
  if (state.view === 'leads') return renderLeads();
  if (state.view === 'financials') return renderFinancials();
  const totals = data.current.totals;
  const ads = data.acquisition?.ads;
  const roas = ads?.ratios.roas;
  const headline = [selected.outcome, 'spend', 'sessions'].find(metric => Number.isFinite(totals[metric]));
  $('cards').replaceChildren(...[selected.outcome, 'spend', 'sessions'].map(metric => metricCard(metric, metric === headline)),
    KPIStatCard('Ad return (ROAS)', roas == null ? 'N/A' : `${display(roas)}×`, sourceOf('ads'), '',
      MetricTooltip('Metric details', [metricDefinition('roas')?.definition,
        ads?.money_issue || ads?.attribution_issue || (roas == null
          ? 'Requires complete ad values and positive spend.' : 'Uses verified ad-attributed revenue.')])));
  const trend = $('trend-metric');
  const choices = [...new Set([selected.outcome, 'spend', 'sessions', ...Object.keys(totals).filter(key => data.current.coverage[key]?.present)])];
  options(trend, choices.map(key => [key, nameOf(key)]), overviewTrendMetric(choices, data.current.daily, state.overviewTrend));
  renderChart();
  renderQuality();
  renderDetails();
}

function overviewTrendMetric(choices, daily, preferred) {
  if (choices.includes(preferred)) return preferred;
  return choices.find(metric => daily.some(row => Number.isFinite(row.values[metric]))) || choices[0];
}

function svg(tag, attrs) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function renderChart() {
  const metric = $('trend-metric').value;
  renderSeries($('chart'), state.report.current.daily, state.report.dates, metric, undefined, sourceOf(metricSource(metric)));
}

function chartTicks(values, unit) {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  if (min === max) return [min];
  if (unit !== 'count' || !values.every(Number.isInteger)) {
    return [0, .25, .5, .75, 1].map(fraction => min + (max - min) * fraction);
  }
  const target = Math.max(1, (max - min) / 4);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const step = [1, 2, 5, 10].find(factor => factor >= target / magnitude) * magnitude;
  const first = Math.floor(min / step);
  const last = Math.ceil(max / step);
  return Array.from({length: last - first + 1}, (_, index) => (first + index) * step);
}

function renderSeries(chart, daily, dates, metric, unit = metricDefinition(metric)?.unit, source) {
  chart.replaceChildren();
  const points = daily.map(item => [item.date, item.values[metric]]).filter(([, value]) => Number.isFinite(value));
  if (!points.length) {
    chart.append(el('p', 'No daily data for this metric.', 'muted empty-chart'));
    return;
  }
  const metricName = nameOf(metric);
  const legend = el('div', null, 'chart-legend');
  legend.append(el('span', null, 'chart-key'), el('strong', metricName));
  if (source) legend.append(el('span', source));
  if (unit === 'currency' && site()?.currency) legend.append(el('span', site().currency));
  const plotWidth = window.innerWidth <= 767 ? 360 : window.innerWidth <= 1000 ? 560 : 760;
  const view = svg('svg', {viewBox: `0 0 ${plotWidth} 255`, role: 'img', tabindex: '0',
    'aria-label': `Daily ${metricName} trend. Use left and right arrow keys to inspect values. Daily values table available below.`});
  const ticks = chartTicks(points.map(([, value]) => value), unit);
  const min = ticks[0], max = ticks.at(-1);
  const y = value => 207 - 180 * (value - min) / (max - min || 1);
  const base = Date.parse(dates[0]);
  const dayCount = daysBetween(dates);
  const left = plotWidth === 360 ? 40 : 58, right = plotWidth - 18;
  const x = day => dayCount === 1 ? (left + right) / 2
    : left + ((Date.parse(day) - base) / 86400000) * (right - left) / Math.max(1, dayCount - 1);
  for (const value of ticks) {
    view.append(svg('line', {x1: left, x2: right, y1: y(value), y2: y(value), class: 'chart-grid'}));
    const label = svg('text', {x: left - 9, y: y(value) + 4, 'text-anchor': 'end', class: 'chart-label'});
    label.textContent = new Intl.NumberFormat('en', {notation: 'compact', maximumFractionDigits: 1}).format(value);
    view.append(label);
  }
  let line = '', last = null;
  for (const [day, value] of points) {
    line += `${last && Date.parse(day) - Date.parse(last) === 86400000 ? 'L' : 'M'} ${x(day)} ${y(value)} `;
    last = day;
  }
  view.append(svg('path', {d: line, class: 'chart-line'}));
  points.forEach(([day, value]) => {
    const dot = svg('circle', {cx: x(day), cy: y(value), r: points.length > 100 ? 1.6 : 3, class: 'chart-dot'});
    const title = svg('title', {}); title.textContent = `${day} · ${display(value, metric)}`;
    dot.append(title); view.append(dot);
  });
  const dateTicks = [...new Set(dates)];
  if (dayCount >= 5) dateTicks.splice(1, 0, new Date(base + Math.floor((dayCount - 1) / 2) * 86400000).toISOString().slice(0, 10));
  const shortDate = new Intl.DateTimeFormat('en', {month: 'short', day: 'numeric', timeZone: 'UTC'});
  dateTicks.forEach((day, index) => {
    const anchor = dayCount === 1 ? 'middle' : !index ? 'start' : index === dateTicks.length - 1 ? 'end' : 'middle';
    const label = svg('text', {x: x(day), y: 235, 'text-anchor': anchor, class: 'chart-label'});
    label.textContent = dayCount === 1 ? day : shortDate.format(new Date(day));
    view.append(label);
  });
  const frame = el('div', null, 'chart-frame');
  const readout = el('output', null, 'chart-readout');
  readout.hidden = true;
  const marker = svg('circle', {r: 5, class: 'chart-active-dot', visibility: 'hidden'});
  view.append(marker);
  let active = points.length - 1;
  const inspect = index => {
    active = Math.max(0, Math.min(points.length - 1, index));
    const [day, value] = points[active];
    readout.replaceChildren(el('span', reportDate.format(new Date(day))), el('strong', display(value, metric)));
    readout.hidden = false;
    marker.setAttribute('cx', x(day));
    marker.setAttribute('cy', y(value));
    marker.setAttribute('visibility', 'visible');
  };
  const dismiss = () => { readout.hidden = true; marker.setAttribute('visibility', 'hidden'); };
  view.addEventListener('pointermove', event => {
    const bounds = view.getBoundingClientRect();
    const position = (event.clientX - bounds.left) / bounds.width * plotWidth;
    inspect(points.reduce((best, point, index) => Math.abs(x(point[0]) - position) < Math.abs(x(points[best][0]) - position) ? index : best, 0));
  });
  view.addEventListener('pointerleave', dismiss);
  view.addEventListener('focus', () => inspect(active));
  view.addEventListener('blur', dismiss);
  view.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') return dismiss();
    inspect(event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : active + (event.key === 'ArrowRight' ? 1 : -1));
  });
  frame.append(view, readout);
  chart.append(legend, frame);
  const valuesTable = el('details', null, 'chart-values');
  valuesTable.append(el('summary', 'Daily values'));
  valuesTable.addEventListener('toggle', () => {
    if (!valuesTable.open || valuesTable.children.length > 1) return;
    valuesTable.append(DataTable('Daily ' + nameOf(metric), ['Date', nameOf(metric)],
      daily.map(item => [item.date, metricValue(item.values[metric], metric)])));
  });
  chart.append(valuesTable);
}

function renderQuality() {
  const {dates, current} = state.report;
  const dayCount = daysBetween(dates);
  let completeCount = 0;
  const checks = Object.keys(state.metrics).map(source => {
    const days = coveredDays(source, dates);
    const missing = source === 'events'
      ? state.report.events.rows.reduce((count, row) => count + row.missing_count_rows, 0)
      : state.metrics[source].reduce((count, metric) => count + (current.coverage[metric]?.missing || 0), 0);
    const detail = days ? `${days} of ${dayCount} dates recorded${missing ? ` · ${missing} missing values` : ''}` : 'No rows in this period';
    const complete = days > 0 && days === dayCount && !missing;
    if (complete) completeCount++;
    return DataQualityIndicator(sourceOf(source), detail, complete, !days);
  });
  $('coverage-count').textContent = `${completeCount} of ${checks.length} sources complete`;
  $('quality').replaceChildren(...checks, MetricTooltip('How to read data coverage', [
    '0 is a recorded zero. A dash means no value was recorded. N/A means a metric could not be calculated for this selection.',
    'Partial data covers only part of the period or has missing values. Check coverage before comparing periods.',
  ]));
}

function renderDetails() {
  const {current, imports} = state.report;
  const totals = current.totals;
  const sections = Object.entries(state.metrics).map(([source, metrics]) => {
    const details = el('details');
    details.append(el('summary', sourceOf(source)));
    const rows = metrics.map(key => [nameOf(key), display(totals[key], key)]);
    if (source === 'ads') {
      const {cpc, ctr, cpm} = state.report.acquisition?.ads.ratios || {};
      rows.push(['Cost per click', display(cpc, 'spend')], ['Click-through rate', ctr == null ? '—' : `${display(ctr * 100)}%`],
        ['Cost per 1,000 impressions', display(cpm, 'spend')]);
    }
    const derived = state.report.acquisition?.[source]?.ratios || {};
    for (const [metric, value] of Object.entries(derived)) {
      if (!['cpc', 'ctr', 'cpm', 'roas'].includes(metric) && (value != null || metric === 'net_revenue_per_order')) {
        rows.push([nameOf(metric), metricValue(value, metric)]);
      }
    }
    const list = el('dl', null, 'metric-list');
    rows.forEach(([label, value]) => list.append(el('dt', label), el('dd', value)));
    details.append(list);
    return details;
  });
  $('breakdown').replaceChildren(...sections);
  const entries = imports.map(item => {
    const row = el('div', null, 'history-row');
    row.append(el('strong', nameOf(item.source)), el('small', `${item.dates.join(' → ')} · ${item.rows} rows`),
      el('small', `${new Date(item.at).toLocaleString()} · ${item.duplicates} duplicates removed · ${item.replaced_days} dates replaced`));
    if (item.event_sources?.length) row.append(el('small', item.event_sources.join(' · ')));
    return row;
  });
  $('import-count').textContent = `${entries.length} saved ${entries.length === 1 ? 'import' : 'imports'}`;
  $('history').replaceChildren(...(entries.length ? entries : [el('p', 'No saved imports yet.', 'help')]));
}

function openImport() {
  if (!site()) return;
  upload = {scope: scope()};
  uploadVersion++;
  $('import-form').reset();
  if (state.view === 'funnel') $('source').value = 'events';
  if (state.view === 'leads') $('source').value = 'leads';
  updateImportGuide();
  $('import-scope').textContent = `${client().name} / ${site().name}`;
  $('mapping').hidden = true;
  $('preview-button').disabled = true;
  clearPreview();
  $('import-dialog').showModal();
}

function clearPreview() {
  upload.revision = null;
  $('preview').hidden = true;
  $('preview').replaceChildren();
  $('save-import').disabled = true;
  notice('import-error');
}

function invalidatePreview() {
  uploadVersion++;
  clearPreview();
  $('preview-button').disabled = !upload.inspect;
}

function renderMapping() {
  clearPreview();
  if (!upload.inspect) return;
  const {headers, suggestions} = upload.inspect;
  const source = $('source').value;
  const dimensions = state.import_dimensions?.[source] || [];
  const required = source === 'leads' ? state.lead_required
    : source === 'events' ? ['date', 'event_name', 'event_source', 'event_count'] : ['date'];
  const fields = source === 'leads' ? state.lead_fields
    : ['date', 'date_end', ...(source === 'events' ? [] : ['key']), ...dimensions, ...state.metrics[source]];
  const mapField = key => {
    const select = el('select');
    select.name = key;
    select.required = required.includes(key);
    options(select, [['', select.required ? 'Choose a column' : 'Skip column'], ...headers.map(header => [header, header])], suggestions[key]);
    select.addEventListener('change', invalidatePreview);
    return labeled(nameOf(key), select);
  };
  const nodes = fields.map(mapField);
  const metadata = state.import_provenance?.[source] || [];
  if (metadata.length) {
    const details = el('details', null, 'scope-confirmation');
    const fields = el('div', null, 'import-fields');
    fields.append(...metadata.map(mapField));
    details.append(el('summary', 'Export metadata'), el('p', 'Recognized export metadata columns are checked automatically. Review these mappings when the source uses different column names.', 'help'), fields);
    if (source === 'ads') {
      const verify = check('verify-attribution', 'I verified the ad account, currency, timezone, reporting level, conversion action, action date basis, and attribution window for this export.');
      verify.querySelector('input').addEventListener('change', invalidatePreview);
      details.append(verify);
    }
    nodes.push(details);
  }
  $('mapping-fields').replaceChildren(...nodes);
  $('mapping').hidden = false;
  $('preview-button').disabled = false;
}

function updateImportGuide() {
  const source = $('source').value;
  if (source === 'leads') {
    $('import-guide').textContent = 'Use a stable CRM lead ID and the lead creation date. Include the observation date for dated status history. An update replaces the complete snapshot for the same lead and observation date.';
    return;
  }
  $('import-guide').textContent = source === 'events'
    ? 'Use one row per date, source, and event name. Reimports update matching events and keep other events. Map explicit zeros only when reported.'
    : 'Use daily rows and one reporting grain. For multiple segments, map a stable ID such as campaign ID. Replacements must include all saved rows and recorded values for overlapping dates.';
}

function importPayload() {
  const mapping = Object.fromEntries([...$('mapping-fields').querySelectorAll('select')]
    .filter(input => input.value).map(input => [input.name, input.value]));
  return {...upload.scope, csv: upload.csv, filename: upload.filename, source: $('source').value, mapping,
    date_format: $('date-format').value, number_format: $('number-format').value,
    attribution_verified: $('verify-attribution')?.checked ?? false};
}

function check(id, label) {
  const box = el('input'); box.type = 'checkbox'; box.id = id;
  const wrapper = el('label', null, 'checkbox');
  wrapper.append(box, el('span', label));
  return wrapper;
}

function renderPreview(result, data) {
  upload.revision = result.revision;
  const panel = $('preview');
  const stats = result.stats;
  const duplicates = stats.duplicates === 1 ? 'duplicate' : 'duplicates';
  panel.replaceChildren(el('h3', 'Cleaning preview'),
    el('p', `${stats.accepted} parsed · ${stats.duplicates} ${duplicates} removed · ${stats.invalid} invalid · ${stats.missing} missing values`, 'preview-stats'));
  if (result.dates.length) panel.append(el('p', `${result.dates.join(' → ')} · ${result.covered_days} ${result.covered_days === 1 ? 'date' : 'dates'} in this file`, 'help'));
  if (data.source === 'leads') renderLeadImportPreview(panel, result);
  if (result.changes) {
    const {added, updated, unchanged, preserved} = result.changes;
    const labels = {append: 'Append', replace: 'Replace matched rows', reject: 'Reject import', unchanged: 'Already imported'};
    panel.append(el('p', labels[result.operation], 'preview-stats'),
      el('p', result.operation === 'reject' ? 'The saved data will remain unchanged.'
        : `${added} to add · ${updated} to update · ${unchanged} already saved · ${preserved} other rows kept`, 'help'));
  }
  const evidence = Object.entries(result.provenance || {}).map(([field, values]) => `${nameOf(field)} · ${values.join(', ')}`);
  if (evidence.length) panel.append(MetricTooltip('Export scope', evidence));
  if (result.can_save && result.attribution_issue && data.mapping.reported_revenue) panel.append(el('p', result.attribution_issue, 'help'));
  if (result.funnel_scope_invalidated) panel.append(el('p', 'Saving this import requires a new funnel scope review.', 'help'));
  const entries = result.can_save ? Object.entries(result.totals || {})
    .filter(([key, value]) => key in data.mapping && (value != null || stats.missing)) : [];
  if (entries.length) {
    const list = el('dl', null, 'metric-list');
    entries.forEach(([key, value]) => list.append(el('dt', nameOf(key)), el('dd', display(value, key))));
    panel.append(list);
  }
  if (result.events?.rows.length) {
    panel.append(DataTable('Event import preview', ['Event', 'Source', 'Count', 'Unique users', 'Dates'],
      result.events.rows.slice(0, 12).map(row => [row.event_name, row.event_source, display(row.event_count),
        display(row.unique_users), row.covered_days + ' / ' + row.total_days])));
    if (result.events.rows.length > 12) {
      panel.append(el('p', 'Showing the first 12 event and source pairs.', 'help'));
    }
  }
  if (result.issues.length) {
    const list = el('ul', null, 'issue-list');
    result.issues.slice(0, 8).forEach(issue => list.append(el('li', issue)));
    panel.append(list);
  }
  if (result.can_save && data.source !== 'leads' && result.operation === 'replace') panel.append(check('confirm-replace',
    'Apply the listed additions and updates to the overlapping dates.'));
  if (result.can_save && result.operation !== 'unchanged' && data.source !== 'leads' && Object.keys(data.mapping).some(key => monetary.has(key))) {
    panel.append(check('confirm-currency', `All monetary values in this file are in ${result.currency}.`));
  }
  panel.hidden = false;
  $('save-import').disabled = !result.can_save || result.operation === 'unchanged';
}

$('csv-file').addEventListener('change', async event => {
  const version = ++uploadVersion;
  clearPreview();
  $('mapping').hidden = true;
  $('preview-button').disabled = true;
  upload.inspect = null;
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return notice('import-error', 'Split this file into CSV exports under 8 MB.');
  try {
    const csv = await file.text();
    const inspect = await request('/api/inspect', {csv});
    if (version !== uploadVersion) return;
    Object.assign(upload, {csv, inspect, filename: file.name});
    renderMapping();
  } catch (error) { if (version === uploadVersion) notice('import-error', error.message); }
});

$('preview-button').addEventListener('click', async () => {
  if (!$('import-form').reportValidity()) return;
  const version = ++uploadVersion;
  const data = importPayload();
  clearPreview();
  $('preview-button').disabled = true;
  try {
    const result = await request('/api/import/preview', data);
    if (version === uploadVersion) renderPreview(result, data);
  } catch (error) { if (version === uploadVersion) notice('import-error', error.message); }
  finally { if (version === uploadVersion && upload?.inspect) $('preview-button').disabled = false; }
});

$('import-form').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('save-import').disabled || upload?.saving) return;
  const data = {...importPayload(), revision: upload.revision, replace_confirmed: $('confirm-replace')?.checked ?? false,
    currency_confirmed: $('confirm-currency')?.checked ?? false};
  const session = upload;
  const fields = [...event.currentTarget.querySelectorAll('button, input, select')];
  const enabled = fields.filter(field => !field.disabled);
  session.saving = true;
  enabled.forEach(field => { field.disabled = true; });
  $('save-import').textContent = 'Saving…';
  const savedSite = site().name;
  let result;
  try {
    result = await request('/api/import', data);
  } catch (error) {
    notice('import-error', error.message);
    return;
  }
  finally {
    session.saving = false;
    if (session === upload) {
      enabled.forEach(field => { field.disabled = false; });
      $('save-import').textContent = 'Save import';
    }
  }
  $('import-dialog').close();
  const message = data.source === 'leads'
    ? `${result.stats.new} new, ${result.stats.updated} updated, and ${result.stats.unchanged} unchanged at ${savedSite}.`
    : `${result.changes ? result.changes.added + result.changes.updated : result.stats.accepted} cleaned rows saved to ${savedSite}.`;
  try {
    await refresh();
    await loadReport(...state.appliedDates);
    notice('notice', message + (result.funnel_scope_invalidated ? ' Review funnel scope again before using its ratios.' : ''));
  } catch (error) {
    notice('notice', `${message} Could not refresh the workspace. ${error.message}`);
  }
});

$('source').addEventListener('change', () => {
  updateImportGuide();
  if (upload?.inspect) { uploadVersion++; renderMapping(); }
});
for (const id of ['date-format', 'number-format']) $(id).addEventListener('change', () => {
  if (upload?.inspect) invalidatePreview();
});
$('import-dialog').addEventListener('cancel', event => { if (upload?.saving) event.preventDefault(); });
$('import-dialog').addEventListener('close', () => { uploadVersion++; });
document.querySelectorAll('[data-close]').forEach(node => node.addEventListener('click', () => $(node.dataset.close).close()));
for (const id of ['add-client', 'sidebar-add']) $(id).addEventListener('click', () => openSetup('client'));
for (const id of ['import-button', 'import-nav']) $(id).addEventListener('click', openImport);
$('add-site').addEventListener('click', () => openSetup('site'));
function reportEndpoint(view) {
  return ['leads', 'settings', 'financials'].includes(view) ? view : 'report';
}

function changeView(view, focus = false) {
  const changedReportType = reportEndpoint(state.view) !== reportEndpoint(view);
  state.view = view;
  AppSidebar(view, client(), site());
  WorkspaceHeader(views[view][0]);
  PageHeader(...views[view]);
  $('config-button').hidden = view !== 'funnel';
  $('lead-status-button').hidden = view !== 'leads';
  $('date-form').hidden = view === 'settings';
  $('date-picker').hidden = view === 'settings';
  $('compare-control').hidden = withoutComparison.has(view);
  if (changedReportType && site()) loadReport(...state.appliedDates);
  else if (state.report || !site()) renderReport();
  if (focus) {
    $('menu').setAttribute('aria-expanded', 'false');
    $('page-title').focus();
    window.scrollTo({top: 0});
  }
}

document.querySelectorAll('[data-view]').forEach(node => node.addEventListener('click', () => {
  if (state.view === node.dataset.view) changeView(state.view, true);
  else location.hash = node.dataset.view;
}));
window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  if (!next || Object.hasOwn(views, next)) changeView(next || 'overview', true);
});
$('menu').addEventListener('click', event => {
  const menu = event.currentTarget;
  menu.setAttribute('aria-expanded', String(menu.getAttribute('aria-expanded') !== 'true'));
});
$('report-filter-toggle').addEventListener('click', event => {
  const control = event.currentTarget;
  control.setAttribute('aria-expanded', String(control.getAttribute('aria-expanded') !== 'true'));
});
$('compare').addEventListener('change', () => { if (state.report) renderReport(); });
$('config-button').addEventListener('click', openReportingConfig);
$('add-stage').addEventListener('click', addConfigStage);
$('config-form').addEventListener('submit', saveReportingConfig);
$('lead-status-button').addEventListener('click', () => openLeadStatusMapping());
$('lead-status-add').addEventListener('click', () => addLeadStatusMapping());
$('lead-status-form').addEventListener('submit', event => saveLeadStatusMapping(event));
$('client').addEventListener('change', event => chooseClient(event.target.value));
$('site').addEventListener('change', event => chooseSite(event.target.value));
$('date-form').addEventListener('submit', event => {
  event.preventDefault();
  $('date-picker').open = false;
  if (state.view === 'leads') state.leads.page = 1;
  loadReport($('start').value, $('end').value);
});
$('trend-metric').addEventListener('change', event => {
  state.overviewTrend = event.currentTarget.value;
  renderChart();
});
function initialize() {
  $('report-status').replaceChildren(LoadingState());
  refresh().then(() => {
    applyComparisonPreference();
    return loadReport();
  }).catch(error => {
    $('report-status').replaceChildren(ErrorState(error.message, initialize));
  });
}
let chartLayout = window.innerWidth <= 767 ? 'mobile' : window.innerWidth <= 1000 ? 'tablet' : 'desktop';
window.addEventListener('resize', () => {
  const next = window.innerWidth <= 767 ? 'mobile' : window.innerWidth <= 1000 ? 'tablet' : 'desktop';
  if (next !== chartLayout) {
    chartLayout = next;
    if (state.report) renderReport();
  }
});
initializeTheme();
changeView(state.view);
document.querySelectorAll('[data-soon]').forEach(ComingSoonNavigationItem);
initialize();
