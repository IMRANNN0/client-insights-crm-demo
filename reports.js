function metricValue(value, metric) {
  if (value == null) return '—';
  const unit = metricDefinition(metric)?.unit;
  if (unit === 'percent') return display(value * 100) + '%';
  if (unit === 'ratio') return display(value) + '×';
  return display(value, unit === 'currency' ? 'spend' : metric);
}

function comparisonTooltip(metric, value, previous, compatible, notes = []) {
  const report = state.report;
  const definition = metricDefinition(metric);
  const lines = [definition?.definition || nameOf(metric), ...notes];
  if (!$('compare').checked) return MetricTooltip('Metric details', lines);
  lines.push(
    'Current period ' + periodLabel(report.dates) + ' · ' + metricValue(value, metric),
    'Previous period ' + periodLabel(report.previous_dates) + ' · ' + metricValue(previous, metric),
    'Change = (current − previous) ÷ previous × 100.',
  );
  const change = compatible && value != null && previous > 0 ? (value / previous - 1) * 100 : null;
  if (!Number.isFinite(change)) {
    lines.push('Comparison needs complete values for both equal-length periods, a matching source and reporting scope, and a positive previous value.');
    return MetricTooltip('No comparison', lines);
  }
  const rounded = Math.round(Math.abs(change) * 100) / 100;
  const sign = rounded ? (change > 0 ? '+' : '−') : '';
  return MetricTooltip(sign + display(rounded) + '% vs previous', lines);
}

function reportFilter(label, items, selected, onChange) {
  const select = el('select');
  options(select, items, selected);
  select.disabled = items.length < 2;
  select.addEventListener('change', () => onChange(select.value, select));
  return labeled(label, select);
}

function sameAdsProvenance(current, previous) {
  const first = current?.platform_provenance;
  const second = previous?.platform_provenance;
  return ['labelled', 'unspecified'].includes(first?.status)
    && first.status === second?.status
    && first.labels.join('\n') === second.labels.join('\n')
    && !current.money_issue && !previous.money_issue
    && JSON.stringify(current.money_scope) === JSON.stringify(previous.money_scope);
}

function fullMetric(group, metric) {
  const coverage = group?.coverage[metric];
  return coverage?.total_days > 0 && coverage.covered_days === coverage.total_days && !coverage.missing;
}

const campaignKey = group => JSON.stringify([group.dimensions.ad_platform, group.dimensions.campaign]);

function acquisitionKPI(metric, current, previous, label, primary) {
  const value = current?.totals[metric];
  const base = previous?.totals[metric];
  const complete = fullMetric(current, metric);
  const comparable = complete && fullMetric(previous, metric) && sameAdsProvenance(current, previous);
  const coverage = current?.coverage[metric];
  const moneyIssue = metric === 'spend' && current?.money_issue;
  const reason = moneyIssue || (value == null && metric === 'reach' ? 'Reach needs one deduplicated export row.'
    : !complete && coverage ? `${coverage.covered_days} of ${coverage.total_days} days have recorded values.` : '');
  const unavailable = value == null && (moneyIssue || coverage?.present > 0);
  return KPIStatCard(nameOf(metric), unavailable ? 'N/A' : metricValue(value, metric), label, primary ? 'featured' : '',
    comparisonTooltip(metric, value, base, comparable, [reason]), value != null && !complete ? 'partial' : undefined);
}

function selectAcquisition(ads, filters) {
  const platforms = ads.platforms;
  const platform = platforms.find(group => group.dimensions.ad_platform === filters.platform);
  const campaigns = ads.campaigns.filter(group => !platform || group.dimensions.ad_platform === filters.platform);
  const selectedCampaign = campaigns.find(group => campaignKey(group) === filters.campaign);
  return {platforms, platform, campaigns, selectedCampaign, group: selectedCampaign || platform || ads};
}

function renderAcquisition() {
  const {acquisition, previous_acquisition: previous, dates} = state.report;
  const target = $('acquisition-report');
  if (!acquisition || !Object.values(acquisition).some(source => source.covered_days)) {
    target.replaceChildren(EmptyState('No acquisition data for this period',
      'Choose dates with an import, or add an ad, website analytics, or business outcomes export.', 'Import CSV', openImport));
    return;
  }
  const {ads, web, outcomes} = acquisition;
  const filters = state.acquisition;
  const selection = selectAcquisition(ads, filters);
  const {platforms, platform, campaigns, selectedCampaign, group} = selection;
  filters.platform = platform?.dimensions.ad_platform || '';
  filters.campaign = selectedCampaign ? campaignKey(selectedCampaign) : '';
  const priorSelection = previous && selectAcquisition(previous.ads, filters);
  const prior = selectedCampaign ? priorSelection?.selectedCampaign : platform ? priorSelection?.platform : priorSelection?.group;
  const provenance = group.platform_provenance;
  const label = provenance?.status === 'labelled' ? provenance.labels[0]
    : provenance?.status === 'mixed' ? 'Multiple ad platforms' : sourceOf('ads');

  const filterChange = (key, value, field) => {
    filters[key] = value;
    if (key === 'platform') filters.campaign = '';
    renderAcquisition();
    target.querySelector('[data-filter="' + field + '"]')?.focus();
  };
  const makeFilter = (title, key, items) => {
    const field = reportFilter(title, items, filters[key], value => filterChange(key, value, key));
    field.querySelector('select').dataset.filter = key;
    return field;
  };
  const filterBar = FilterBar('Advertising scope', [
    makeFilter('Ad platform', 'platform', [['', 'All platforms'],
      ...platforms.map(item => [item.dimensions.ad_platform, item.label])]),
    makeFilter('Campaign', 'campaign', [['', 'All campaigns'], ...campaigns.map(item => [campaignKey(item), item.label])]),
  ]);
  filterBar.append(MetricTooltip('How these filters work', [
    'Platform and campaign filters apply to ad metrics. Website and outcome totals use the selected site and dates.',
  ]));

  const cards = el('div', null, 'cards');
  ['spend', 'impressions', 'link_clicks', 'reach'].forEach(metric => {
    cards.append(acquisitionKPI(metric, group, prior, label, metric === 'spend'));
  });
  const efficiency = el('dl', null, 'panel efficiency');
  const linkBased = group.coverage.link_clicks.present > 0;
  const ctr = linkBased ? 'link_ctr' : 'ctr';
  const cpc = linkBased ? 'link_cpc' : 'cpc';
  const clickType = linkBased ? 'link clicks' : 'reported clicks';
  const rateLabels = [
    [ctr, 'Click-through rate'],
    [cpc, 'Cost per click'],
    ['cpm', 'Cost per 1,000 impressions'],
  ];
  for (const [metric, title] of rateLabels) {
    const pair = el('div');
    pair.append(el('dt', title), el('dd', group.ratios[metric] == null ? 'N/A' : metricValue(group.ratios[metric], metric)));
    efficiency.append(pair);
  }

  const series = [
    ['spend', group, label], ['link_clicks', group, label], ['clicks', group, label],
    ['sessions', web, sourceOf('web')], ['leads', outcomes, sourceOf('outcomes')],
  ];
  const metricSelect = el('select');
  metricSelect.setAttribute('aria-label', 'Daily trend metric');
  const plot = el('div', null, 'trend');
  const updateTrend = () => {
    const [metric, data, source] = series.find(item => item[0] === metricSelect.value);
    filters.trend = metric;
    renderSeries(plot, data.daily, dates, metric, undefined, source);
  };
  const defaultMetric = series.find(([metric, data]) => data.daily.some(row => row.values[metric] != null))?.[0] || 'spend';
  options(metricSelect, series.map(([metric]) => [metric, nameOf(metric)]), filters.trend || defaultMetric);
  metricSelect.addEventListener('change', updateTrend);
  updateTrend();
  const trend = ChartPanel('Acquisition over time', 'Daily results by metric', plot, metricSelect);

  const sourceMeasures = el('dl', null, 'metric-list');
  for (const [metric, data] of [
    ['clicks', group], ['landing_page_views', group], ['reported_conversions', group],
    ['sessions', web], ['leads', outcomes], ['confirmed_enrollments', outcomes], ['confirmed_sales', outcomes],
  ]) {
    const source = data === group ? label : sourceOf(data === web ? 'web' : 'outcomes');
    const title = el('dt', nameOf(metric));
    title.append(el('small', source));
    sourceMeasures.append(title, el('dd', metricValue(data.totals[metric], metric)));
  }
  const sources = ChartPanel('Results by source', 'Ad, website, and business totals', sourceMeasures);
  sources.append(MetricTooltip('About these totals', [
    'Business outcomes are site totals. The campaign table uses ad-source attribution only.',
    'The click-through rate and cost per click use ' + clickType + '.',
  ]));

  const grid = el('div', null, 'report-grid');
  grid.append(trend, sources);
  const campaignRows = selectedCampaign ? [selectedCampaign] : campaigns;
  const campaignContent = campaignRows.length
    ? DataTable('Campaign performance', ['Campaign', 'Ad source', 'Spend', linkBased ? 'Link clicks' : 'Clicks', 'CTR', 'CPC', 'Ad-attributed conversions', 'Dates'],
      campaignRows.map(row => [
        row.dimensions.campaign, row.dimensions.ad_platform || sourceOf('ads'),
        metricValue(row.totals.spend, 'spend'), metricValue(row.totals[linkBased ? 'link_clicks' : 'clicks'], linkBased ? 'link_clicks' : 'clicks'),
        metricValue(row.ratios[ctr], ctr), metricValue(row.ratios[cpc], cpc),
        metricValue(row.totals.reported_conversions, 'reported_conversions'),
        row.covered_days + ' / ' + row.total_days,
      ]))
    : el('p', 'Map the Campaign column in your ad export to see this breakdown.', 'panel-help help');
  const campaignPanel = ChartPanel('Campaign performance', 'Recorded ad delivery · CTR and CPC use ' + clickType, campaignContent);

  const trafficContent = web.traffic.length
    ? DataTable('Website traffic by source', ['Source', 'Medium', 'Sessions', 'Engaged sessions', 'Dates'],
      web.traffic.map(row => [
        row.dimensions.traffic_source || '—', row.dimensions.traffic_medium || '—',
        metricValue(row.totals.sessions, 'sessions'), metricValue(row.totals.engaged_sessions, 'engaged_sessions'),
        row.covered_days + ' / ' + row.total_days,
      ]))
    : el('p', 'Map Traffic source or Traffic medium in the website export to see this breakdown.', 'panel-help help');
  const trafficPanel = ChartPanel('Website traffic by source', sourceOf('web') + ' · grouped by imported source and medium', trafficContent);
  const platformsPanel = platforms.length ? ChartPanel('Ad delivery by platform', 'Platform totals come from the ad export',
    DataTable('Ad platforms', ['Platform', 'Spend', 'Impressions', 'Link clicks', 'Dates'],
      platforms.map(row => [row.label, metricValue(row.totals.spend, 'spend'), metricValue(row.totals.impressions, 'impressions'),
        metricValue(row.totals.link_clicks, 'link_clicks'), row.covered_days + ' / ' + row.total_days]))) : null;
  target.replaceChildren(filterBar, cards, efficiency, grid, campaignPanel,
    ReportDisclosure('Traffic & platform breakdowns', ReportGrid([trafficPanel, platformsPanel], true)));
}

const funnelReasons = {
  scope_unconfirmed: 'Confirm comparable reporting scope in Configure reporting.',
  incomplete: 'Complete values are required for both stages on every date.',
  zero_prior: 'The previous stage has zero recorded volume.',
};

function stageSource(stage) {
  const adProvenance = state.report.acquisition?.ads.platform_provenance;
  if (stage.source === 'ads' && adProvenance?.status === 'labelled') return adProvenance.labels[0];
  return stage.event_source || sourceOf(stage.source);
}

function renderFunnel() {
  const {funnel, events} = state.report;
  const target = $('funnel-report');
  const filters = state.events;
  const stages = funnel.stages;
  const chosen = stages[Number(filters.stage) - 1];
  const stageEvent = chosen?.event_name ? chosen : null;
  const scopedEvents = stageEvent ? events.rows.filter(row =>
    row.event_source_key === stageEvent.event_source_key && row.event_name === stageEvent.event_name) : events.rows;
  const eventSources = [...new Set(scopedEvents.map(row => row.event_source))];
  if (!eventSources.includes(filters.source)) filters.source = '';
  const sourceRows = scopedEvents.filter(row => !filters.source || filters.source === row.event_source);
  const eventNames = [...new Set(sourceRows.map(row => row.event_name))].sort();
  if (!eventNames.includes(filters.name)) filters.name = '';

  const makeFilter = (label, key, items) => {
    const field = reportFilter(label, items, filters[key], value => {
      filters[key] = value;
      renderFunnel();
      target.querySelector('[data-filter="' + key + '"]')?.focus();
    });
    field.querySelector('select').dataset.filter = key;
    return field;
  };
  const bar = FilterBar('Funnel and event filters', [
    makeFilter('Funnel stage', 'stage', [['', 'All stages'], ...stages.map((stage, index) => [String(index + 1), stage.label])]),
    makeFilter('Event source', 'source', [['', 'All event sources'], ...eventSources.map(source => [source, source])]),
    makeFilter('Event name', 'name', [['', 'All events'], ...eventNames.map(name => [name, name])]),
  ]);
  bar.append(MetricTooltip('How these filters work', [
    'Event filters apply to the explorer. Selecting an event-based funnel stage also limits the explorer to its event.',
  ]));

  const volumes = el('div', null, 'funnel-body');
  const overall = funnel.overall_ratio;
  const volumeSummary = el('div', null, 'funnel-summary');
  volumeSummary.append(el('span', 'Last stage as a share of the first'),
    el('strong', overall == null ? 'N/A' : display(overall * 100) + '%'));
  volumes.append(volumeSummary, MetricTooltip('How funnel ratios work', [
    'The overall ratio divides the last stage volume by the first. Stage ratios compare volumes in the selected period.',
    'These imports contain aggregate counts. Individual conversion and drop-off are unavailable.',
  ]));
  const stageRows = el('ol', null, 'funnel-stages');
  const max = Math.max(1, ...stages.map(stage => stage.value || 0));
  stages.forEach((stage, index) => {
    if (chosen && stage !== chosen) return;
    const row = el('li', null, 'funnel-stage');
    const title = el('div', null, 'funnel-stage-heading');
    const identity = el('div');
    identity.append(el('span', String(index + 1), 'funnel-step'), el('h3', stage.label), SourceIndicator(stageSource(stage)));
    if (stage.event_name) identity.append(el('small', stage.event_name, 'help'));
    title.append(identity, el('strong', metricValue(stage.value, stage.metric)));
    row.append(title);
    if (stage.value != null) {
      const meter = el('meter');
      meter.max = max;
      meter.value = Math.max(0, stage.value);
      meter.setAttribute('aria-label', stage.label + ' volume relative to the largest stage');
      row.append(meter);
    }
    const details = el('div', null, 'funnel-stage-detail');
    const coverage = stage.total_days ? stage.covered_days + ' / ' + stage.total_days + ' days with values' : 'No reporting dates';
    const status = stage.value == null && !stage.covered_days ? 'No data'
      : stage.covered_days < stage.total_days ? 'Partial data' : '';
    const coverageText = el('span', coverage, 'help');
    if (status) coverageText.prepend(el('span', status, 'badge ' + (status === 'Partial data' ? 'warning' : 'neutral')));
    details.append(coverageText);
    if (index) {
      if (stage.ratio != null) details.append(el('span', display(stage.ratio * 100) + '% of ' + stages[index - 1].label, 'help'));
      if (stage.volume_difference != null) details.append(el('span',
        stage.volume_difference < 0 ? display(-stage.volume_difference) + ' more than the previous stage'
          : display(stage.volume_difference) + ' fewer than the previous stage · aggregate drop-off', 'help'));
      if (stage.reason) details.append(MetricTooltip('Comparison unavailable', [funnelReasons[stage.reason]]));
    }
    row.append(details);
    stageRows.append(row);
  });
  volumes.append(stageRows);
  if (!stages.length) volumes.append(EmptyState('No funnel stages configured', 'Choose which recorded metrics to use as stages.',
    'Configure reporting', openReportingConfig));
  const funnelPanel = ChartPanel('Conversion funnel', 'Recorded volumes by stage', volumes);

  const eventRows = sourceRows.filter(row => !filters.name || filters.name === row.event_name);
  const eventContent = eventRows.length
    ? DataTable('Events by source and name', ['Event', 'Source', 'Event count', 'Unique users', 'Category', 'Description', 'Dates with counts'],
      eventRows.map(row => [
        row.event_name, SourceIndicator(row.event_source), metricValue(row.event_count, 'event_count'),
        metricValue(row.unique_users, 'unique_users'), row.category, row.description,
        (row.covered_days - row.missing_count_rows) + ' / ' + row.total_days,
      ]))
    : EmptyState('No events for this selection', events.rows.length
      ? 'Choose a different source, event, or funnel stage.'
      : 'Choose dates with an event import or add an export with date, source, name, and count.', 'Import events', openImport);
  const eventPanel = ChartPanel('Event explorer', 'Events grouped by source and name', eventContent);
  eventPanel.append(MetricTooltip('About event counts and unique users', [
    'Counts cover recorded rows only. Unique users are available for a single date when provided by that source. Daily unique users cannot be added across dates.',
  ]));
  target.replaceChildren(bar, funnelPanel, eventPanel);
}

let configScope;

function configInput(name, value, placeholder, limit) {
  const input = el('input');
  input.name = name;
  input.value = value || '';
  input.placeholder = placeholder;
  input.maxLength = limit;
  return input;
}

function resetFunnelConfirmation() {
  $('confirm-funnel-scope').checked = false;
}

function configStage(stage = {}) {
  const row = el('div', null, 'stage-config-row');
  const label = configInput('stage_label', stage.label, 'Stage label', 80);
  label.required = true;
  const metric = el('select');
  metric.name = 'stage_metric';
  metric.required = true;
  const metrics = Object.entries(state.metric_definitions || {}).filter(([, spec]) =>
    spec.kind === 'input' && spec.unit === 'count');
  options(metric, [['', 'Choose a metric'], ...metrics.map(([id, spec]) =>
    [id, spec.label + ' · ' + sourceOf(spec.source)])], stage.metric || '');
  const eventSource = configInput('stage_event_source', stage.event_source, 'e.g. GA4', 120);
  const eventName = configInput('stage_event_name', stage.event_name, 'e.g. generate_lead', 120);
  const eventFields = el('div', null, 'stage-event-fields');
  eventFields.append(labeled('Event source', eventSource), labeled('Event name', eventName));
  const updateEventFields = () => {
    const isEvent = metricDefinition(metric.value)?.source === 'events';
    eventFields.hidden = !isEvent;
    eventSource.required = eventName.required = Boolean(isEvent);
  };
  metric.addEventListener('change', updateEventFields);
  updateEventFields();

  const actions = el('div', null, 'stage-actions');
  const move = direction => {
    const neighbor = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!neighbor) return;
    if (direction < 0) neighbor.before(row);
    else neighbor.after(row);
    resetFunnelConfirmation();
    row.querySelector('button').focus();
  };
  actions.append(button('Up', 'secondary', () => move(-1)), button('Down', 'secondary', () => move(1)),
    button('Remove', 'quiet', () => {
      row.remove();
      resetFunnelConfirmation();
      $('add-stage').disabled = false;
      $('add-stage').focus();
    }));
  row.append(labeled('Stage name', label), labeled('Count metric', metric), eventFields, actions);
  for (const field of [metric, eventSource, eventName]) field.addEventListener('input', resetFunnelConfirmation);
  return row;
}

function openReportingConfig() {
  const selected = site();
  if (!selected) return;
  const config = state.report?.config || selected.config;
  if (!config) return;
  configScope = scope();
  $('config-scope').textContent = client().name + ' / ' + selected.name;
  const fields = [
    labeled('Website domain', configInput('domain', config.domain, 'example.com', 253)),
    labeled('Export reporting timezone', configInput('timezone', config.timezone, 'Africa/Casablanca', 80)),
  ];
  for (const source of ['ads', 'web', 'outcomes']) {
    fields.push(labeled(names[source] + ' label',
      configInput('source_' + source, config.source_labels[source], names[source], 80)));
  }
  fields.forEach(label => label.querySelector('input').addEventListener('input', resetFunnelConfirmation));
  const primary = el('select');
  primary.name = 'outcome';
  options(primary, state.profiles[client().profile].map(metric => [metric, nameOf(metric)]), selected.outcome);
  fields.push(labeled('Primary KPI', primary));
  const confirmed = check('confirm-funnel-scope', 'These exports cover the same site, dates, reporting timezone, and comparable populations. Show aggregate stage ratios.');
  confirmed.classList.add('scope-confirmation');
  confirmed.querySelector('input').checked = config.funnel_scope_confirmed;
  $('config-fields').replaceChildren(...fields, confirmed);
  $('config-stages').replaceChildren(...config.funnel_stages.map(configStage));
  $('add-stage').disabled = config.funnel_stages.length >= 10;
  notice('config-error');
  $('config-dialog').showModal();
}

function addConfigStage() {
  const stages = $('config-stages');
  if (stages.children.length >= 10) return;
  const row = configStage();
  stages.append(row);
  $('add-stage').disabled = stages.children.length >= 10;
  resetFunnelConfirmation();
  row.querySelector('input').focus();
}

async function saveReportingConfig(event) {
  event.preventDefault();
  const fields = new FormData(event.currentTarget);
  const source_labels = Object.fromEntries(['ads', 'web', 'outcomes'].map(source =>
    [source, fields.get('source_' + source)]));
  const funnel_stages = [...$('config-stages').children].map(row => {
    const read = name => row.querySelector('[name="' + name + '"]').value;
    const metric = read('stage_metric');
    const stage = {label: read('stage_label'), metric};
    if (metricDefinition(metric)?.source === 'events') {
      stage.event_source = read('stage_event_source');
      stage.event_name = read('stage_event_name');
    }
    return stage;
  });
  const config = {domain: fields.get('domain'), timezone: fields.get('timezone'), source_labels, funnel_stages,
    funnel_scope_confirmed: $('confirm-funnel-scope').checked};
  const submit = event.submitter;
  submit.disabled = true;
  try {
    await request('/api/config', {...configScope, config, outcome: fields.get('outcome')});
    $('config-dialog').close();
    state.events = {};
    await refresh();
    await loadReport(...state.appliedDates);
  } catch (error) {
    notice('config-error', error.message);
  } finally {
    submit.disabled = false;
  }
}
