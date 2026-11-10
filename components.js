const $ = id => document.getElementById(id);

const themeKey = 'client-insights-theme';
const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
let savedTheme;
try {
  savedTheme = window.localStorage?.getItem(themeKey);
} catch {
  // Storage can be disabled by the browser.
}
if (savedTheme !== 'light' && savedTheme !== 'dark') savedTheme = undefined;
const themeRoot = document.documentElement;
if (themeRoot) themeRoot.dataset.theme = savedTheme || (systemTheme?.matches ? 'dark' : 'light');

function initializeTheme() {
  if (!themeRoot) return;
  const control = $('theme-toggle');
  const apply = theme => {
    themeRoot.dataset.theme = theme;
    const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    control.setAttribute('aria-label', label);
    control.title = label;
  };
  apply(themeRoot.dataset.theme);
  control.addEventListener('click', () => {
    savedTheme = themeRoot.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(savedTheme);
    try {
      window.localStorage.setItem(themeKey, savedTheme);
    } catch {
      // The theme still applies for the current page.
    }
  });
  systemTheme?.addEventListener?.('change', event => {
    if (!savedTheme) apply(event.matches ? 'dark' : 'light');
  });
}

function el(tag, content, cls) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = content;
  if (cls) node.className = cls;
  return node;
}

function button(label, cls, click) {
  const node = el('button', label, cls);
  node.type = 'button';
  node.addEventListener('click', click);
  return node;
}

function options(select, items, selected) {
  select.replaceChildren(...items.map(([value, label]) => new Option(label, value)));
  if (items.some(([value]) => value === selected)) select.value = selected;
}

function labeled(label, field) {
  const wrapper = el('label', label);
  wrapper.append(field);
  return wrapper;
}

function AppSidebar(view, business, property) {
  document.querySelectorAll('[data-view]').forEach(control => {
    if (control.dataset.view === view) control.setAttribute('aria-current', 'page');
    else control.removeAttribute('aria-current');
  });
  $('workspace-identity').hidden = !business;
  $('workspace-business').textContent = business?.name || '';
  $('workspace-site').textContent = property ? `${property.name} · ${property.currency}` : 'Choose a site';
}

function ComingSoonNavigationItem(control) {
  control.append(el('span', 'Soon', 'soon'));
}

function WorkspaceHeader(title) {
  $('breadcrumb').textContent = title;
}

function PageHeader(title, eyebrow, description) {
  $('page-title').textContent = title;
  $('page-eyebrow').textContent = eyebrow;
  $('page-description').textContent = description;
}

function DateRangeFilter(dates = []) {
  [$('start').value = '', $('end').value = ''] = dates;
}

function periodLabel(dates) {
  return dates?.length === 2 ? dates.join(' → ') : 'Unavailable';
}

function ComparisonControl(report, enabled, visible) {
  $('compare-control').hidden = !visible;
  $('period-comparison').textContent = visible && enabled
    ? `Previous period ${periodLabel(report.previous_dates)}`
    : '';
}

function MetricTooltip(summary, lines) {
  const tooltip = el('details', null, 'metric-tooltip');
  tooltip.append(el('summary', summary));
  const description = el('div', null, 'metric-tooltip-body');
  lines.filter(Boolean).forEach(line => description.append(el('p', line)));
  tooltip.append(description);
  return tooltip;
}

function KPIStatCard(title, value, foot, cls = '', explanation, status) {
  const item = el('article', null, `panel stat ${cls}`);
  const readableValue = value.replace(/^([A-Z]{3})\u00a0/, '$1 ');
  const label = el('span', title, 'stat-label');
  const amount = el('strong', readableValue, 'stat-value');
  status ||= value === '—' ? 'missing' : value === 'N/A' ? 'unavailable'
    : /^(?:[A-Z]{3} )?0(?:\.0+)?[%×]?$/.test(readableValue) ? 'zero' : '';
  const states = {missing: 'No data', unavailable: 'Unavailable', partial: 'Partial data', zero: 'Recorded zero'};
  if (status) item.dataset.status = status;
  item.append(label, amount);
  if (status) item.append(el('span', states[status], 'stat-state'));
  if (typeof foot === 'string') item.append(el('small', foot));
  else if (foot) item.append(foot);
  if (explanation) item.append(explanation);
  return item;
}

function ChartPanel(title, description, content, action) {
  const panel = el('section', null, 'panel report-panel');
  const head = el('div', null, 'panel-head');
  const copy = el('div');
  copy.append(el('h2', title));
  if (description) copy.append(el('p', description));
  head.append(copy);
  if (action) head.append(action);
  panel.append(head, content);
  return panel;
}

function DataTable(title, headers, rows) {
  const wrapper = el('div', null, 'table-scroll');
  wrapper.tabIndex = 0;
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', title);
  const table = el('table', null, 'data-table');
  const heading = el('tr');
  headers.forEach(label => {
    const cell = el('th', label);
    cell.scope = 'col';
    heading.append(cell);
  });
  const head = el('thead'); head.append(heading);
  const body = el('tbody');
  rows.forEach(items => {
    const row = el('tr');
    items.forEach((item, index) => {
      const cell = el(index ? 'td' : 'th');
      if (!index) cell.scope = 'row';
      if (item instanceof Node) cell.append(item);
      else {
        cell.textContent = item ?? '—';
        if (cell.textContent === '—' || cell.textContent === 'N/A') cell.className = 'cell-unavailable';
        else if (index && /^(?:[A-Z]{3}\s+)?[+−-]?[\d,.]+(?:[%×]| \/ [\d,.]+)?$/.test(cell.textContent)) {
          cell.className = 'cell-number';
          heading.children[index].className = 'cell-number';
        }
      }
      row.append(cell);
    });
    body.append(row);
  });
  table.append(head, body);
  wrapper.append(table);
  return wrapper;
}

function FilterBar(label, fields) {
  const filters = el('div', null, 'filter-bar');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', label);
  filters.append(...fields);
  return filters;
}

function SourceIndicator(source) {
  return el('span', source, 'source-indicator');
}

function EmptyState(title, description, action, callback) {
  const panel = el('section', null, 'panel empty');
  panel.append(el('h2', title), el('p', description));
  if (action) panel.append(button(action, 'primary', callback));
  return panel;
}

function LoadingState() {
  return EmptyState('Loading report', 'Reading the saved data for this selection.');
}

function ErrorState(message, retry) {
  const panel = EmptyState('Report unavailable', message, 'Retry', retry);
  panel.setAttribute('role', 'alert');
  return panel;
}

function DataQualityIndicator(label, description, complete, missing = false) {
  const row = el('div', null, 'quality-row');
  const status = el('span', missing ? 'No data' : complete ? 'Complete' : 'Incomplete',
    missing ? 'badge neutral' : complete ? 'badge' : 'badge warning');
  const copy = el('div');
  copy.append(el('strong', label), el('small', description));
  row.append(copy, status);
  return row;
}
