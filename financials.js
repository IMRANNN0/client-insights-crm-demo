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
  const revenueChoice = reportFilter('Business revenue basis',
    [['confirmed_revenue', 'CRM confirmed sales · close date'], ['net_revenue', 'Business outcomes · net revenue']],
    basis, value => {
      state.revenueBasis = value;
      renderFinancials();
      $('finance-revenue-basis').focus();
    });
  revenueChoice.querySelector('select').id = 'finance-revenue-basis';
  const filters = FilterBar('Financial filters', [revenueChoice,
    el('p', 'Choose one business revenue source. ROAS uses attributed revenue from the ad export.', 'help')]);
  const cards = el('div', null, 'cards financial-kpis');
  for (const key of ['spend', basis, 'roas', 'cpl', 'cpql', 'cac']) {
    const metric = metrics[key];
    const source = financeSourceName(metric.source);
    const foot = el('div', null, 'stat-source');
    foot.append(SourceIndicator(source), el('small', metric.detail));
    const formula = MetricTooltip('Metric definition', [metric.definition, 'Formula · ' + metric.formula,
      'Source · ' + source, 'Date basis · ' + metric.date_basis]);
    cards.append(KPIStatCard(key === basis ? 'Revenue' : metric.label, financeValue(metric), foot,
      key === basis ? 'featured' : '', formula));
  }
  const rows = ['spend', 'reported_revenue', 'confirmed_revenue', 'net_revenue'].map(key => {
    const metric = metrics[key];
    const source = financeSourceName(metric.source);
    const platforms = metric.source === 'ads' && ad_platforms.length ? ' · ' + ad_platforms.join(', ') : '';
    return [metric.label, source + platforms, metric.date_basis, metric.detail, financeValue(metric)];
  });
  const evidence = ChartPanel('Source reconciliation',
    'Use these totals to compare the selected dates against the original exports. Business and ad-attributed revenue remain separate.',
    DataTable('Financial source reconciliation', ['Input', 'Source', 'Date basis', 'Coverage', 'Recorded value'], rows));
  $('financials-report').replaceChildren(filters, cards, evidence);
}
