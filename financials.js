function financeSourceName(source) {
  if (source === 'leads') return 'CRM lead records';
  if (source === 'ads + attributed leads') return 'Ad spend + verified lead attribution';
  if (source === 'ads + attributed customers') return 'Acquisition costs + verified customer attribution';
  return sourceOf(source);
}

function financeValue(metric) {
  if (metric.value == null) return 'N/A';
  return metric.unit === 'ratio' ? display(metric.value) + '×' : display(metric.value, 'spend');
}

function renderFinancials() {
  const {metrics, default_revenue, ad_platforms} = state.report;
  const basis = state.revenueBasis || default_revenue;
  const revenueChoice = reportFilter('Revenue source',
    [['confirmed_revenue', 'CRM confirmed sales · close date'], ['net_revenue', 'Business outcomes · net revenue']],
    basis, value => {
      state.revenueBasis = value;
      renderFinancials();
      $('finance-revenue-basis').focus();
    });
  revenueChoice.querySelector('select').id = 'finance-revenue-basis';
  const filters = FilterBar('Financial filters', [revenueChoice,
    MetricTooltip('About revenue and ad return', [
      'Business revenue uses the selected source. ROAS uses attributed revenue from the ad export.',
    ])]);
  const cards = el('div', null, 'cards financial-kpis');
  for (const key of ['spend', basis, 'roas', 'cpl', 'cpql', 'cac']) {
    const metric = metrics[key];
    const source = financeSourceName(metric.source);
    const formula = MetricTooltip('Metric details', [metric.detail, metric.definition, 'Formula · ' + metric.formula,
      'Source · ' + source, 'Date basis · ' + metric.date_basis]);
    const label = {roas: 'Ad return (ROAS)', cpl: 'Cost per lead', cac: 'Customer acquisition cost'}[key];
    cards.append(KPIStatCard(key === basis ? 'Revenue' : label || metric.label, financeValue(metric),
      '', key === basis ? 'featured' : '', formula,
      metric.detail?.startsWith('Incomplete coverage') ? 'partial' : undefined));
  }
  const rows = ['spend', 'reported_revenue', 'confirmed_revenue', 'net_revenue'].map(key => {
    const metric = metrics[key];
    const source = financeSourceName(metric.source);
    const platforms = metric.source === 'ads' && ad_platforms.length ? ' · ' + ad_platforms.join(', ') : '';
    const details = MetricTooltip(source + platforms, [metric.detail, metric.date_basis]);
    return [metric.label, details, financeValue(metric)];
  });
  const evidence = ChartPanel('Source reconciliation', 'Check each total against its original export',
    DataTable('Financial source reconciliation', ['Input', 'Source and coverage', 'Recorded value'], rows));
  $('financials-report').replaceChildren(filters, cards, evidence);
}
