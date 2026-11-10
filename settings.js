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
  const help = el('p', 'The business name applies to every site under this client. The default period ends on the latest recorded date. The timezone describes source dates as exported.', 'help');
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
  return ChartPanel('Data sources', 'Manual CSV uploads for sources such as Meta Ads and GA4. Ad platform labels come from mapped rows. Website labels are configured here.',
    DataTable('Data sources', ['Source', 'Status', 'Last import', 'Recorded dates', 'Available fields', 'Rows'], rows));
}

function metricRegistry(data) {
  const priority = ['leads', 'qualified_leads', 'bookings', 'confirmed_sales', 'confirmed_enrollments'];
  const keys = [...new Set([...priority, ...Object.keys(data.metric_definitions)])];
  const rows = keys.map(key => {
    const metric = data.metric_definitions[key];
    return [metric.label, sourceOf(metric.source), metric.formula, metric.definition, metric.date_basis];
  });
  for (const [key, [label, definition]] of Object.entries(leadMetrics)) {
    rows.push([label, 'CRM lead records', definition, 'Computed from distinct lead records.',
      ['customers', 'confirmed_revenue'].includes(key) ? 'Lead creation date or recorded close date' : 'Lead creation date']);
  }
  for (const key of ['cpql', 'cac']) {
    const metric = data.financial_definitions[key];
    rows.push([metric.label, financeSourceName(metric.source), metric.formula, metric.definition, metric.date_basis]);
  }
  return ChartPanel('KPI definitions', 'Bookings count appointments. Qualified leads meet the CRM rules. Confirmed sales require a recorded outcome. Each definition keeps its own source.',
    DataTable('KPI definitions', ['Metric', 'Source', 'Formula or rule', 'Definition', 'Date basis'], rows));
}

function importLedger(imports) {
  const rows = imports.map(item => {
    const warnings = item.warnings || [];
    const details = el('div', null, 'import-validation');
    const status = {passed: 'Passed', warnings: 'Warnings'}[item.validation] || 'Legacy import';
    details.append(el('span', status, item.validation === 'passed' ? 'badge' : 'badge warning'));
    if (item.invalid != null) details.append(el('small', `${item.invalid} errors · ${item.duplicates} duplicates · ${item.missing} missing`));
    if (item.changes) details.append(el('small', `${item.changes.added} added · ${item.changes.updated} updated · ${item.changes.preserved} kept`));
    const evidence = Object.entries(item.provenance || {}).map(([field, values]) => `${nameOf(field)} · ${values.join(', ')}`);
    if (item.attribution_verified) evidence.push('Attribution verified by the import operator.');
    if (evidence.length) details.append(MetricTooltip('Export scope', evidence));
    if (warnings.length) details.append(MetricTooltip('View warnings', warnings));
    return [item.filename || 'Filename unavailable', importDate(item.at), settingsSourceNames[item.source], details, display(item.rows)];
  });
  return ChartPanel('Import history', 'Saved batches for this site. Files with blocking validation errors stay in the import preview.',
    rows.length ? DataTable('Import history', ['File', 'Imported at', 'Source', 'Validation', 'Rows saved'], rows)
      : el('p', 'No files have been imported for this site.', 'help'));
}

function importQuality(imports) {
  const total = key => display(imports.reduce((count, item) => count + (item[key] || 0), 0));
  const checks = [
    ['Duplicate records', `${total('duplicates')} duplicates removed from saved imports. Conflicting keys are blocked in preview.`],
    ['Missing values', `${total('missing')} missing mapped values across saved imports. Required fields block a save.`],
    ['Dates and currency', 'Preview checks the selected date format and CRM currency codes. Aggregate monetary CSVs require site currency confirmation.'],
    ['Source separation', 'Each feed keeps its own measures. Ads conversions, website events, and CRM outcomes can describe the same activity and are reported separately.'],
  ];
  const list = el('dl', null, 'quality');
  for (const [label, description] of checks) {
    const row = el('div', null, 'quality-row settings-quality-row');
    row.append(el('dt', label), el('dd', description));
    list.append(row);
  }
  return ChartPanel('Data quality', 'Validation rules and cumulative counts from saved batches.', list);
}

function renderSettings() {
  const data = state.report;
  $('settings-report').replaceChildren(businessSettings(data), sourceInventory(data),
    importQuality(data.imports), importLedger(data.imports), metricRegistry(data));
}
