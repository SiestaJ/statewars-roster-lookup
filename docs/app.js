const CONFIG = {
  apiBase: 'https://web.api.digitalshift.ca',
  clientServiceId: '96e8984e-8187-4798-a562-b3f08dbae794',
  leagueId: 584,
  seedTeamId: 685594,
  pdfLookupPath: 'https://digitalshift-assets.sfo2.cdn.digitaloceanspaces.com/pw/8c33cce3-36e5-4b96-a105-0a2c33d3e36d/f-b3ac4698-d3f6-407b-bd95-10eb3f56fe48/RHA%2071626UPD.pdf',
};

const state = {
  ticket: null,
  teamsByDivision: [],
  pdfIndex: new Map(),
  pdfMeta: null,
  roster: [],
};

const els = {
  division: document.querySelector('#divisionSelect'),
  team: document.querySelector('#teamSelect'),
  search: document.querySelector('#searchInput'),
  refresh: document.querySelector('#refreshBtn'),
  lookup: document.querySelector('#lookupBtn'),
  status: document.querySelector('#status'),
  counts: document.querySelector('#counts'),
  body: document.querySelector('#resultsBody'),
};

function setBusy(isBusy) {
  els.refresh.disabled = isBusy;
  els.lookup.disabled = isBusy;
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}

function normalizeName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function api(path, params = {}, { auth = true } = {}) {
  const url = new URL(path, CONFIG.apiBase);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    if (!state.ticket) await login();
    headers.Authorization = `ticket="${state.ticket}"`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

async function login() {
  const res = await fetch(`${CONFIG.apiBase}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_service_id: CONFIG.clientServiceId }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  state.ticket = data?.ticket?.hash;
  if (!state.ticket) throw new Error('Login did not return a ticket hash.');
}

function parseTeamsByDivision(teamHtml) {
  const decoded = decodeHtml(teamHtml);
  const marker = 'ctrl.teams_by_division = ';
  const start = decoded.indexOf(marker);
  if (start === -1) throw new Error('Could not find teams_by_division in team response.');
  const jsonStart = decoded.indexOf('[', start + marker.length);
  if (jsonStart === -1) throw new Error('Could not find teams_by_division JSON array.');
  return JSON.parse(extractJsonArray(decoded, jsonStart));
}

function extractJsonArray(text, start) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('Could not find end of teams_by_division JSON array.');
}

function decodeHtml(html) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = html;
  return textarea.value || html;
}

async function loadTournament() {
  setBusy(true);
  setStatus('Refreshing tournament/division/team list…');
  try {
    const data = await api('/partials/stats/team', { team_id: CONFIG.seedTeamId });
    state.teamsByDivision = parseTeamsByDivision(data.content);
    renderDivisionOptions();
    const targetDivision = state.teamsByDivision.find(d => d.teams?.some(t => Number(t.id) === CONFIG.seedTeamId));
    if (targetDivision) els.division.value = String(targetDivision.id);
    renderTeamOptions();
    els.team.value = String(CONFIG.seedTeamId);
    setStatus(`Loaded ${state.teamsByDivision.length} divisions from State Wars.`);
  } catch (err) {
    console.error(err);
    setStatus(err.message, true);
  } finally {
    setBusy(false);
  }
}

async function loadPdfLookup() {
  try {
    const res = await fetch(`${CONFIG.pdfLookupPath}?v=${Date.now()}`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    state.pdfMeta = data.meta || null;
    state.pdfIndex = new Map();
    for (const row of data.players || []) {
      const key = normalizeName(row.name);
      if (!key) continue;
      const existing = state.pdfIndex.get(key) || [];
      existing.push(row);
      state.pdfIndex.set(key, existing);
    }
  } catch (err) {
    console.warn('PDF lookup not loaded:', err);
    state.pdfMeta = { warning: 'PDF lookup file not loaded yet.' };
    state.pdfIndex = new Map();
  }
}

function renderDivisionOptions() {
  els.division.innerHTML = '';
  for (const division of state.teamsByDivision) {
    const opt = document.createElement('option');
    opt.value = division.id;
    opt.textContent = `${division.name} (${division.teams?.length || 0})`;
    els.division.appendChild(opt);
  }
}

function renderTeamOptions() {
  const division = state.teamsByDivision.find(d => String(d.id) === els.division.value);
  els.team.innerHTML = '';
  for (const team of division?.teams || []) {
    const opt = document.createElement('option');
    opt.value = team.id;
    opt.textContent = team.name;
    els.team.appendChild(opt);
  }
}

function parseRoster(rosterHtml) {
  const doc = new DOMParser().parseFromString(rosterHtml, 'text/html');
  const rows = [...doc.querySelectorAll('tbody tr')];
  const players = [];
  const seen = new Set();
  for (const row of rows) {
    const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim());
    const link = row.querySelector('a[href*="/player/"]');
    if (cells.length < 3 || !link) continue;
    const idMatch = link.getAttribute('href').match(/player\/(\d+)/);
    const playerId = idMatch?.[1] || '';
    const key = `${playerId}:${cells[0]}:${cells[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    players.push({
      number: cells[0],
      name: cells[1],
      position: cells[2],
      playerId,
      sourceUrl: `https://www.statewarshockey.com/stats#/player/${playerId}/bio`,
    });
  }
  return players;
}

async function lookupRoster() {
  const teamId = els.team.value;
  if (!teamId) return;
  setBusy(true);
  setStatus('Fetching live roster…');
  try {
    const data = await api('/partials/stats/team/roster', { team_id: teamId });
    state.roster = parseRoster(data.content);
    renderResults();
    const teamName = els.team.selectedOptions[0]?.textContent || `team ${teamId}`;
    setStatus(`Loaded live roster for ${teamName}.`);
  } catch (err) {
    console.error(err);
    setStatus(err.message, true);
  } finally {
    setBusy(false);
  }
}

function renderResults() {
  const query = normalizeName(els.search.value);
  const rows = state.roster.filter(p => {
    if (!query) return true;
    return normalizeName(`${p.number} ${p.name} ${p.position}`).includes(query);
  });
  const hitCount = rows.filter(p => state.pdfIndex.has(normalizeName(p.name))).length;
  els.counts.textContent = `${rows.length} shown · ${hitCount} PDF matches · ${state.pdfIndex.size} PDF names indexed`;
  els.body.innerHTML = '';
  if (!rows.length) {
    els.body.innerHTML = '<tr><td colspan="5" class="empty">No roster rows match the filter.</td></tr>';
    return;
  }
  for (const player of rows) {
    const matches = state.pdfIndex.get(normalizeName(player.name)) || [];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="num">${escapeHtml(player.number)}</td>
      <td><div class="player">${escapeHtml(player.name)}</div><div class="meta">HockeyShift ID: ${escapeHtml(player.playerId)}</div></td>
      <td>${escapeHtml(player.position)}</td>
      <td>${matches.length ? '<span class="badge hit">Exact match</span>' : '<span class="badge miss">No match</span>'}</td>
      <td>${matches.length ? matches.map(formatPdfMatch).join('<hr>') : '<span class="meta">—</span>'}</td>`;
    els.body.appendChild(tr);
  }
}

function formatPdfMatch(match) {
  const detail = match.detail || match.team || match.division || match.note || '';
  return `<strong>${escapeHtml(match.name)}</strong>${detail ? `<div class="meta">${escapeHtml(detail)}</div>` : ''}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]));
}

els.division.addEventListener('change', renderTeamOptions);
els.lookup.addEventListener('click', lookupRoster);
els.refresh.addEventListener('click', async () => { await loadTournament(); await lookupRoster(); });
els.search.addEventListener('input', renderResults);

await loadPdfLookup();
await loadTournament();
await lookupRoster();
