const leadMetrics = {
  leads: ['Total leads', 'Distinct eligible CRM leads created in the selected period.'],
  qualified_leads: ['Qualified leads', 'Cohort leads with qualification evidence by the reporting cutoff.'],
  qualification_rate: ['Qualification rate', 'Qualified leads divided by all eligible leads in the creation cohort.'],
  customers: ['Confirmed customers', 'Distinct leads with a confirmed outcome and a recorded closing date.'],
  lead_to_customer_rate: ['Lead-to-customer rate', 'Confirmed customers divided by all eligible leads in the creation cohort. Open leads remain pending.'],
  confirmed_revenue: ['Confirmed revenue', 'Sum of recorded values for confirmed customers in the site reporting currency.'],
  qualified_to_customer_rate: ['Qualified-to-customer rate', 'Confirmed customers with qualification evidence divided by qualified leads in the creation cohort.'],
};

function leadQuery() {
  const {basis = 'cohort', source = '', status = '', campaign_id = '',
    sort = '', direction = '', page = 1} = state.leads;
  return {basis, source, status, campaign_id, ...(sort ? {sort} : {}), ...(direction ? {direction} : {}),
    page, page_size: 15};
}

function leadValue(metric, value) {
  if (value == null) return '—';
  if (metric.endsWith('_rate')) return display(value * 100) + '%';
  return display(value, metric);
}

function leadStatusName(status) {
  return state.lead_statuses?.[status] || status || 'Unknown';
}

function leadBasisLabel(basis) {
  return basis === 'sales' ? 'Close date' : 'Lead creation date';
}

function leadMetricCard(metric, report) {
  const [label, definition] = leadMetrics[metric];
  const value = report.kpis[metric];
  const prior = report.prior?.kpis?.[metric];
  const cohortOnly = !['customers', 'confirmed_revenue'].includes(metric);
  const basis = leadBasisLabel(cohortOnly ? 'cohort' : report.basis);
  const lines = [definition, 'Source · CRM lead records', 'Date basis · ' + basis];
  if (report.basis === 'cohort') lines.push('Outcomes use the end date as the cutoff.');
  else if (cohortOnly) lines.push('Available in Acquisition cohort.');
  else lines.push('Sales use the latest corrected CRM outcome and its recorded closing date.');
  if (metric === 'confirmed_revenue' && report.kpis.confirmed_revenue_note) lines.push(report.kpis.confirmed_revenue_note);
  let summary = 'Metric details';
  if ($('compare').checked && report.previous_dates?.length) {
    lines.push('Current · ' + periodLabel(report.dates) + ' · ' + leadValue(metric, value),
      'Previous · ' + periodLabel(report.previous_dates) + ' · ' + leadValue(metric, prior));
    const comparable = report.prior?.comparable && value != null && prior != null
      && !report.kpis[metric + '_partial'] && !report.prior.kpis[metric + '_partial']
      && (metric !== 'confirmed_revenue' || report.prior.revenue_comparable);
    const rate = metric.endsWith('_rate');
    if (comparable && (rate || prior > 0)) {
      const difference = (value - prior) * 100 / (rate ? 1 : prior);
      const magnitude = Math.round(Math.abs(difference) * 100) / 100;
      const sign = magnitude === 0 ? '' : difference > 0 ? '+' : '−';
      summary = sign + display(magnitude) + (rate ? ' pp vs previous' : '% vs previous');
      lines.push(rate ? 'Change is measured in percentage points. Current rate minus previous rate.'
        : 'Change is current minus previous, divided by previous.');
    } else {
      summary = 'No comparison';
      lines.push('Changes require comparable outcomes in both periods and a positive prior value for relative change.');
    }
  }
  const partial = report.kpis[metric + '_partial']
    || (metric === 'qualification_rate' && report.kpis.qualified_leads_partial)
    || (metric === 'lead_to_customer_rate' && report.kpis.customers_partial);
  const unavailable = value == null && (metric.endsWith('_rate') || report.basis === 'sales');
  if (partial) lines.push(value == null ? 'Coverage is too incomplete to calculate this metric.'
    : 'Coverage is incomplete. The value uses the records available.');
  return KPIStatCard(label, unavailable ? 'N/A' : leadValue(metric, value), '',
    metric === 'customers' ? 'featured' : '', MetricTooltip(summary, lines), partial ? 'partial' : undefined);
}

function leadFilter(label, key, choices, selected, defaultValue = '') {
  if (selected && !choices.some(([value]) => value === selected)) {
    choices.push([selected, key === 'status' ? leadStatusName(selected)
      : selected === '__unattributed__' ? 'Unattributed' : selected]);
  }
  const field = reportFilter(label, choices, selected ?? defaultValue, value => {
    state.leads[key] = value;
    if (key === 'basis') state.leads.status = '';
    state.leads.page = 1;
    loadReport(...leadReloadArgs('lead-filter-' + key));
  });
  field.querySelector('select').id = 'lead-filter-' + key;
  return field;
}

function leadReloadArgs(focusId) {
  const [start = '', end = ''] = state.appliedDates;
  return [start, end, focusId];
}

function leadFilters(report) {
  const filters = report.filters;
  const settings = state.leads;
  const fields = [
    leadFilter('Date basis', 'basis', [['cohort', 'Acquisition cohort'], ['sales', 'Sales activity']], report.basis),
    leadFilter('Status', 'status', [['', 'All statuses'],
      ...filters.statuses.map(status => [status, leadStatusName(status)])], settings.status),
    leadFilter('Lead source', 'source', [['', 'All sources'],
      ...filters.sources.map(source => [source, source === '__unattributed__' ? 'Unattributed' : source])], settings.source),
  ];
  if (filters.campaigns.length || settings.campaign_id) {
    fields.push(leadFilter('CRM campaign', 'campaign_id', [['', 'All campaigns'],
      ...filters.campaigns.map(campaign => [campaign.campaign_id, leadCampaignLabel(campaign)])], settings.campaign_id));
  }
  return FilterBar('Lead report filters', fields);
}

function leadCampaignLabel(row) {
  if (!row.campaign_id || row.campaign_id === '__unattributed__') return 'Unattributed';
  return row.campaign_name && row.campaign_name !== row.campaign_id
    ? row.campaign_name + ' · ' + row.campaign_id
    : row.campaign_id;
}

function leadLifecycle(report) {
  const content = el('div');
  const body = el('ul', null, 'lead-lifecycle');
  const total = Object.values(report.lifecycle).reduce((sum, count) => sum + count, 0);
  for (const [status, count] of Object.entries(report.lifecycle)) {
    if (report.basis === 'sales' && !count) continue;
    const row = el('li');
    const label = el('span', leadStatusName(status));
    const meter = el('meter');
    meter.max = Math.max(total, 1);
    meter.value = count;
    meter.setAttribute('aria-hidden', 'true');
    row.append(label, meter, el('strong', display(count)));
    body.append(row);
  }
  if (report.open_leads != null) content.append(el('p', display(report.open_leads) + ' leads still open', 'lead-open-count'));
  content.append(body);
  return ChartPanel('Lead lifecycle', 'Current mix by reporting status', content);
}

function leadTrend(report) {
  const chart = el('div', null, 'trend');
  const metric = report.basis === 'sales' ? 'customers' : 'leads';
  renderSeries(chart, report.daily, report.dates, metric, 'count', 'CRM');
  const title = report.basis === 'sales' ? 'Confirmed customers over time' : 'Leads over time';
  return ChartPanel(title, leadBasisLabel(report.basis), chart);
}

function leadOutcomesTable(title, description, groups, name, report) {
  const cohort = report.basis === 'cohort';
  const headers = cohort
    ? [name, 'Leads', 'Qualified', 'Qualification rate', 'Confirmed', 'Closing rate']
    : [name, 'Confirmed', 'Confirmed revenue'];
  const rows = groups.map(group => {
    const label = name === 'Source'
      ? group.source === '__unattributed__' || !group.source ? 'Unattributed' : group.source
      : leadCampaignLabel(group);
    const keys = cohort
      ? ['leads', 'qualified_leads', 'qualification_rate', 'customers', 'lead_to_customer_rate']
      : ['customers', 'confirmed_revenue'];
    return [label, ...keys.map(key => {
      if (name === 'Campaign' && group.campaign_id === '__unattributed__' && key === 'lead_to_customer_rate') return '—';
      const value = leadValue(key, group.kpis[key]);
      return group.kpis[key + '_partial'] && value !== '—' ? value + ' (partial)' : value;
    })];
  });
  const body = rows.length ? DataTable(title, headers, rows)
    : el('p', 'No records for this breakdown.', 'help');
  return ChartPanel(title, description, body);
}

function leadAging(report) {
  const body = report.aging.length
    ? DataTable('Lead aging', ['Age', 'Unresolved', 'Resolved', 'Total'],
      report.aging.map(group => [group.label, display(group.open_count), display(group.resolved_count), display(group.count)]))
    : el('p', 'No aging data for these filters.', 'help');
  return ChartPanel('Lead aging', 'Days from creation to resolution or the reporting cutoff for open leads.', body);
}

function leadQuality(report) {
  const quality = report.quality;
  const body = el('div');
  const labels = {
    undated_records: 'Undated status snapshots', missing_source: 'Missing source',
    missing_campaign_id: 'Missing reliable campaign ID', unmapped_status: 'Unknown statuses',
    missing_qualification_date: 'Missing qualification date', missing_close_date: 'Missing close date',
    missing_outcome: 'Missing close outcome', conflicting_outcome: 'Conflicting status and outcome',
    unknown_qualification: 'Unknown qualification', unknown_outcome: 'Unknown outcome',
    missing_revenue: 'Missing confirmed revenue',
    missing_currency: 'Missing sale currency', mixed_currency: 'Currency mismatch',
    future_observations: 'First observed after cutoff',
    unresolved_sales: 'Sale records requiring review', reopened_sales: 'Earlier wins reopened',
  };
  let flagged = false;
  for (const [key, label] of Object.entries(labels)) {
    const count = quality[key];
    if (!count) continue;
    flagged = true;
    body.append(DataQualityIndicator(label, display(Number(count)) + ' records', false));
  }
  if (!flagged) body.append(el('p', 'No missing-field or source flags in this selection.', 'help'));
  if (quality.notes?.length) body.append(MetricTooltip('About these checks', quality.notes));
  return ChartPanel('Data quality', 'Coverage and missing fields in the reporting scope', body);
}

function recordedLeadValue(row) {
  return row.confirmed_revenue != null && row.currency
    ? row.currency + ' ' + display(row.confirmed_revenue)
    : '—';
}

function inspectLead(row) {
  $('lead-detail-title').textContent = 'Lead ' + row.lead_id;
  const fields = [
    ['Created date', row.lead_created_at], ['CRM source', row.lead_source || 'Unattributed'],
    ['CRM campaign', leadCampaignLabel(row)], ['Recorded campaign name', row.campaign_name], ['Original status', row.original_status],
    ['Reporting status', leadStatusName(row.status)], ['Qualified date', row.qualified_at || row.qualification_evidence_date],
    ['Closed date', row.closed_at], ['Outcome', row.outcome], ['Observation date', row.observed_at || 'Current-known'],
    ['Confirmed sale value', recordedLeadValue(row)], ['Import batch', row.import_batch_id],
  ];
  $('lead-detail-fields').replaceChildren(...fields.flatMap(([label, value]) => [
    el('dt', label), el('dd', value || '—'),
  ]));
  $('lead-detail-dialog').showModal();
}

function leadRecordTable(report) {
  const {rows, total, page, page_size: pageSize} = report.records;
  const sort = [
    ['lead_created_at', 'Created date'], ['closed_at', 'Closed date'], ['qualified_at', 'Qualification date'],
    ['confirmed_revenue', 'Confirmed sale value'], ['lead_id', 'Lead ID'],
  ];
  const body = el('div');
  body.append(FilterBar('Record ordering', [
    leadFilter('Sort by', 'sort', sort, state.leads.sort, report.basis === 'sales' ? 'closed_at' : 'lead_created_at'),
    leadFilter('Order', 'direction', [['desc', 'Descending'], ['asc', 'Ascending']], state.leads.direction, 'desc'),
  ]));
  if (!rows.length) {
    body.append(el('p', 'No lead records match these filters.', 'help'));
    return ChartPanel('Lead records', 'CRM IDs and reporting fields', body);
  }
  body.append(DataTable('Lead records', [
    'Lead ID', 'Created date', 'Source', 'CRM campaign', 'Reporting status', 'Qualification', 'Closed date', 'Confirmed sale value',
  ], rows.map(row => [
    button(row.lead_id, 'lead-id', () => inspectLead(row)), row.lead_created_at, row.lead_source || 'Unattributed',
    leadCampaignLabel(row), leadStatusName(row.status),
    row.qualified ? 'Qualified · ' + (row.qualified_at || row.qualification_evidence_date) : '—',
    row.closed_at, recordedLeadValue(row),
  ])));
  const pagination = el('div', null, 'lead-pagination');
  const go = (next, label, id, disabled) => {
    const control = button(label, 'secondary', () => {
      state.leads.page = next;
      const focus = next <= 1 ? 'lead-next' : next * pageSize >= total ? 'lead-prev' : id;
      loadReport(...leadReloadArgs(focus));
    });
    control.id = id;
    control.disabled = disabled;
    return control;
  };
  pagination.append(go(page - 1, 'Previous page', 'lead-prev', page <= 1),
    el('span', ((page - 1) * pageSize + 1) + '–' + Math.min(page * pageSize, total) + ' of ' + total, 'help'),
    go(page + 1, 'Next page', 'lead-next', page * pageSize >= total));
  body.append(pagination);
  return ChartPanel('Lead records', 'Select an ID to inspect the recorded snapshot.', body);
}

function leadImportHistory(imports) {
  const body = imports.length
    ? DataTable('CRM import history', ['Imported at', 'Batch', 'New', 'Updated', 'Unchanged', 'Duplicates'], imports.map(batch => [
      batch.at ? new Date(batch.at).toLocaleString() : '—', batch.batch_id, display(batch.new),
      display(batch.updated), display(batch.unchanged), display(batch.duplicates),
    ]))
    : el('p', 'No saved CRM record imports yet.', 'help');
  return ChartPanel('CRM import history', 'Accepted records and corrections for this site', body);
}

function renderLeads() {
  const report = state.report;
  const root = $('leads-report');
  $('lead-status-button').disabled = false;
  if (!report.bounds?.length) {
    root.replaceChildren(EmptyState('Import CRM lead records', 'Map a stable lead ID and creation date to start reporting.',
      'Import CRM CSV', openImport), leadImportHistory(report.imports || []));
    return;
  }
  const cohort = report.basis === 'cohort';
  const basisNote = MetricTooltip(cohort ? 'About lead creation dates' : 'About sales close dates', [cohort
    ? 'Groups by lead creation date. Outcomes are measured at the end of each period. Rates use the filtered cohort, including open leads.'
    : 'Groups confirmed customers by their recorded closing date. Compare with Financials using the same dates and no CRM filters. Cohort conversion rates are unavailable in this view.']);
  const currentKnown = report.quality.current_known || report.quality.undated_records > 0
    ? el('p', 'Current-known outcomes · This selection includes undated CRM snapshots. Historical status and attribution may differ.', 'notice lead-basis-note')
    : null;
  const cards = el('div', null, 'cards lead-kpis');
  for (const metric of Object.keys(leadMetrics).slice(0, 6)) cards.append(leadMetricCard(metric, report));
  const grid = el('div', null, 'report-grid');
  grid.append(leadTrend(report), leadLifecycle(report));
  const agingQuality = el('div', null, 'report-grid');
  agingQuality.append(leadAging(report), leadQuality(report));
  const sources = leadOutcomesTable('Lead outcomes by source', 'CRM source recorded on the lead', report.sources, 'Source', report);
  const campaigns = leadOutcomesTable('Lead outcomes by campaign', 'Campaign rates use stable CRM campaign IDs. Unattributed leads stay separate.',
    report.campaigns, 'Campaign', report);
  const breakdowns = [sources, campaigns];
  if (cohort) {
    const rate = el('p', null, 'lead-extra-rate');
    rate.append(el('strong', leadValue('qualified_to_customer_rate', report.kpis.qualified_to_customer_rate)),
      el('span', leadMetrics.qualified_to_customer_rate[1], 'help'));
    breakdowns.push(ChartPanel('Qualified-to-customer rate', 'Acquisition cohort · CRM lead records', rate));
  }
  root.replaceChildren(leadFilters(report), cards, basisNote, ...(currentKnown ? [currentKnown] : []), grid,
    leadRecordTable(report), ...breakdowns, agingQuality, leadImportHistory(report.imports || []));
}

function renderLeadImportPreview(panel, result) {
  const {stats, sample} = result;
  panel.append(el('p', 'New snapshots ' + stats.new + ' · Updated ' + stats.updated + ' · Unchanged ' + stats.unchanged
    + ' · Conflicts ' + stats.conflicts, 'help'));
  if (sample?.length) {
    panel.append(DataTable('CRM cleaning preview', ['Lead ID', 'Created date', 'Original status', 'Reporting status', 'Outcome'],
      sample.map(row => [row.lead_id, row.lead_created_at, row.original_status, leadStatusName(row.status), row.outcome])));
  }
  if (result.can_save && result.replace_records) panel.append(check('confirm-replace',
    'Apply the previewed updates to ' + result.replace_records + ' existing lead records. Earlier dated snapshots are retained.'));
}

function addLeadStatusMapping(original = '', normalized = 'unknown', focus = true) {
  const row = el('div', null, 'lead-status-row');
  const input = configInput('original_status', original, 'e.g. Appointment booked', 120);
  input.required = true;
  input.setAttribute('list', 'lead-original-statuses');
  const select = el('select');
  options(select, Object.entries(state.lead_statuses), normalized);
  row.append(labeled('Original CRM status', input), labeled('Reporting category', select),
    button('Remove', 'quiet', () => {
      row.remove();
      $('lead-status-add').focus();
    }));
  $('lead-status-rows').append(row);
  if (focus) input.focus();
}

function openLeadStatusMapping() {
  if (!site() || !state.report) return;
  $('lead-status-scope').textContent = client().name + ' / ' + site().name;
  $('lead-original-statuses').replaceChildren(...(state.report.filters?.original_statuses || []).map(raw => new Option(raw, raw)));
  $('lead-status-rows').replaceChildren();
  for (const [original, normalized] of Object.entries(state.report.status_map || {})) {
    addLeadStatusMapping(original, normalized, false);
  }
  notice('lead-status-error');
  $('lead-status-dialog').showModal();
}

async function saveLeadStatusMapping(event) {
  event.preventDefault();
  const submit = event.submitter;
  if (submit.disabled) return;
  submit.disabled = true;
  notice('lead-status-error');
  try {
    const entries = [...$('lead-status-rows').children].map(row =>
      [row.querySelector('input').value.trim(), row.querySelector('select').value]);
    if (new Set(entries.map(([original]) => original.toLowerCase())).size !== entries.length) {
      throw new Error('Map each original CRM status once.');
    }
    await request('/api/leads/statuses', {...scope(), status_map: Object.fromEntries(entries)});
    $('lead-status-dialog').close();
    state.leads.page = 1;
    state.leads.status = '';
    await loadReport(...state.appliedDates);
    notice('notice', 'CRM status mapping saved.');
  } catch (error) {
    notice('lead-status-error', error.message);
  } finally {
    submit.disabled = false;
  }
}
