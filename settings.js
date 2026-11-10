function settingsSelect(name, choices, selected) {
  const field = el('select');
  field.name = name;
  options(field, choices, selected);
  return field;
}

function businessSettings(data) {
  const {config, currency_locked, reporting_windows} = data;
  const form = el('form', null, 'settings-form');
  const currentScope = scope();
  const business = configInput('business_name', client().name, 'Business name', 80);
  business.required = true;
  const currency = configInput('currency', site().currency, 'MAD', 3);
  currency.required = true;
  currency.pattern = '[A-Za-z]{3}';
  currency.readOnly = currency_locked;
  const comparison = check('settings-compare', 'Compare with the previous period by default');
  comparison.querySelector('input').checked = config.compare_by_default;
  const primary = settingsSelect('outcome', state.profiles[client().profile].map(key => [key, nameOf(key)]), site().outcome);
  const fields = el('div', null, 'settings-fields');
  fields.append(
    labeled('Business name', business),
    labeled('Website domain', configInput('domain', config.domain, 'example.com', 253)),
    labeled('Reporting currency', currency),
    labeled('Export reporting timezone', configInput('timezone', config.timezone, 'Africa/Casablanca', 80)),
    labeled('Default reporting period', settingsSelect('default_period_days',
      reporting_windows.map(days => [String(days), `Last ${days} calendar days`]), String(config.default_period_days))),
    labeled('Primary KPI', primary),
  );
  for (const [key, label] of [['ads', 'Ad export label'], ['web', 'Website export label'], ['outcomes', 'Outcomes export label']]) {
    fields.append(labeled(label, configInput('source_' + key, config.source_labels[key], names[key], 80)));
  }
  const help = MetricTooltip('About reporting settings', [
    'The business name applies to every site under this client.',
    'The default period ends on the latest recorded date. The timezone describes source dates as exported.',
  ]);
  const lock = el('p', 'Imported monetary totals lock the site currency to preserve their original meaning.', 'help');
  lock.hidden = !currency_locked;
  const status = el('p', '', 'error');
  status.setAttribute('role', 'alert');
  status.hidden = true;
  const submit = el('button', 'Save settings', 'primary');
  submit.type = 'submit';
  const actions = el('div', null, 'settings-actions');
  actions.append(submit);
  form.append(fields, comparison, help, lock, status, actions);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = new FormData(form);
    const source_labels = Object.fromEntries(['ads', 'web', 'outcomes'].map(key => [key, values.get('source_' + key)]));
    submit.disabled = true;
    status.hidden = true;
    try {
      await request('/api/config', {...currentScope, business_name: values.get('business_name'),
        currency: values.get('currency'), outcome: values.get('outcome'),
        config: {domain: values.get('domain'), timezone: values.get('timezone'), source_labels,
          default_period_days: Number(values.get('default_period_days')),
          compare_by_default: comparison.querySelector('input').checked}});
      await refresh();
      if (state.view === 'settings' && currentScope.site_id === state.siteId) {
        applyComparisonPreference();
        await loadReport(...state.appliedDates);
        notice('notice', 'Reporting settings saved.');
      }
    } catch (error) {
      status.textContent = error.message;
      status.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  return ChartPanel('Business configuration', client().name + ' / ' + site().name, form);
}

const settingsSourceNames = {
  ads: 'Ad platform CSV', web: 'Website analytics CSV', outcomes: 'Business outcomes CSV',
  leads: 'CRM lead records', events: 'Event exports',
};

function importDate(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

function sourceInventory(data) {
  const rows = Object.entries(data.sources).map(([key, source]) => {
    const configured = data.config.source_labels[key];
    const metrics = source.metrics.map(nameOf).join(', ');
    const provenance = source.labels.join(', ') || (configured !== names[key] ? configured : '');
    return [settingsSourceNames[key], el('span', source.rows ? 'CSV available' : 'Awaiting CSV', source.rows ? 'badge' : 'badge warning'),
      importDate(source.last_import), source.dates.length ? periodLabel(source.dates) : '—',
      [provenance, metrics].filter(Boolean).join(' · ') || '—', display(source.rows)];
  });
  const panel = ChartPanel('Data sources', 'See which CSV sources are ready to use',
    DataTable('Data sources', ['Source', 'Status', 'Last import', 'Recorded dates', 'Available fields', 'Rows'], rows));
  panel.append(MetricTooltip('About source labels', [
    'Ad platform labels come from mapped rows. Website labels are configured in Business configuration.',
  ]));
  return panel;
}

function metricRegistry(data) {
  const priority = ['leads', 'qualified_leads', 'bookings', 'confirmed_sales', 'confirmed_enrollments'];
  const keys = [...new Set([...priority, ...Object.keys(data.metric_definitions)])];
  const metricRow = (label, source, formula, definition, dateBasis) => [label, source,
    MetricTooltip('View definition', [definition, 'Formula · ' + formula, 'Date basis · ' + dateBasis])];
  const rows = keys.map(key => {
    const metric = data.metric_definitions[key];
    return metricRow(metric.label, sourceOf(metric.source), metric.formula, metric.definition, metric.date_basis);
  });
  for (const [key, [label, definition]] of Object.entries(leadMetrics)) {
    rows.push(metricRow(label, 'CRM lead records', definition, 'Computed from distinct lead records.',
      ['customers', 'confirmed_revenue'].includes(key) ? 'Lead creation date or recorded close date' : 'Lead creation date'));
  }
  for (const key of ['cpql', 'cac']) {
    const metric = data.financial_definitions[key];
    rows.push(metricRow(metric.label, financeSourceName(metric.source), metric.formula, metric.definition, metric.date_basis));
  }
  return ChartPanel('KPI definitions', 'Find the source, formula, and dates used for each metric',
    DataTable('KPI definitions', ['Metric', 'Source', 'Calculation details'], rows));
}

function importLedger(imports) {
  const rows = imports.map(item => {
    const warnings = item.warnings || [];
    const details = el('div', null, 'import-validation');
    const status = {passed: 'Passed', warnings: 'Warnings'}[item.validation] || 'Legacy import';
    details.append(el('span', status, item.validation === 'passed' ? 'badge' : 'badge warning'));
    const evidence = Object.entries(item.provenance || {}).map(([field, values]) => `${nameOf(field)} · ${values.join(', ')}`);
    if (item.attribution_verified) evidence.push('Attribution verified by the import operator.');
    const summary = [];
    if (item.invalid != null) summary.push(`${item.invalid} errors · ${item.duplicates} duplicates · ${item.missing} missing`);
    if (item.changes) summary.push(`${item.changes.added} added · ${item.changes.updated} updated · ${item.changes.preserved} kept`);
    if (summary.length || evidence.length) details.append(MetricTooltip('Import details', [...summary, ...evidence]));
    if (warnings.length) details.append(MetricTooltip('View warnings', warnings));
    return [item.filename || 'Filename unavailable', importDate(item.at), settingsSourceNames[item.source], details, display(item.rows)];
  });
  return ChartPanel('Import history', 'Saved files and their validation results',
    rows.length ? DataTable('Import history', ['File', 'Imported at', 'Source', 'Validation', 'Rows saved'], rows)
      : el('p', 'No files have been imported for this site.', 'help'));
}

function importQuality(imports) {
  const total = key => display(imports.reduce((count, item) => count + (item[key] || 0), 0));
  const checks = [
    ['Duplicates removed', total('duplicates'), 'Conflicting keys are blocked in the import preview.'],
    ['Missing mapped values', total('missing'), 'Missing required fields block a save.'],
    ['Dates and currency', 'Checked at import', 'Preview checks dates and CRM currency codes. Aggregate monetary CSVs require site currency confirmation.'],
    ['Source separation', 'Reported separately', 'Ads conversions, website events, and CRM outcomes can describe the same activity. Each feed keeps its own measures.'],
  ];
  const list = el('dl', null, 'quality');
  for (const [label, value, explanation] of checks) {
    const row = el('div', null, 'quality-row settings-quality-row');
    const detail = el('dd');
    detail.append(MetricTooltip(value, [explanation]));
    row.append(el('dt', label), detail);
    list.append(row);
  }
  return ChartPanel('Data quality', 'Validation rules and cumulative counts from saved batches.', list);
}

function renderSettings() {
  const data = state.report;
  $('settings-report').replaceChildren(businessSettings(data), sourceInventory(data),
    importQuality(data.imports), importLedger(data.imports), metricRegistry(data));
}
