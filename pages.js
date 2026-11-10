const demoData = fetch('./reports.json').then(response => {
  if (!response.ok) throw new Error('The demo reports could not be loaded.');
  return response.json();
});

if (!location.hash) history.replaceState(null, '', '#leads');

async function demoFetch(path, options) {
  if (options.method === 'POST') {
    return new Response(JSON.stringify({error: 'This public demo is read-only.'}), {status: 405});
  }
  const url = new URL(path, location.href);
  const data = await demoData;
  const view = url.pathname.slice('/api/'.length);
  if (view !== 'leads') {
    const report = Object.hasOwn(data, view) ? data[view] : null;
    return new Response(JSON.stringify(report ?? {error: 'Demo report not available.'}), {status: report ? 200 : 404});
  }
  const params = url.searchParams;
  const key = ['basis', 'source', 'status', 'campaign_id'].map(name => params.get(name) || '');
  key[0] ||= 'cohort';
  const report = structuredClone(data.leads[JSON.stringify(key)]);
  if (!report) return new Response(JSON.stringify({error: 'Demo filter not available.'}), {status: 404});
  const directionName = params.get('direction');
  const field = params.get('sort') || (key[0] === 'sales' ? 'closed_at' : 'lead_created_at');
  if (params.has('sort') || directionName) {
    const value = row => field === 'qualified_at' ? row.qualified_at || row.qualification_evidence_date : row[field];
    const direction = directionName === 'asc' ? 1 : -1;
    report.records.rows.sort((left, right) => {
      const a = value(left);
      const b = value(right);
      const missingA = a == null || a === '';
      const missingB = b == null || b === '';
      if (missingA !== missingB) return Number(missingA) - Number(missingB);
      return (a < b ? -direction : a > b ? direction : 0) || left.lead_id.localeCompare(right.lead_id);
    });
  }
  return new Response(JSON.stringify(report));
}
