const CONFIG = {
  apiBase: 'https://web.api.digitalshift.ca',
  clientServiceId: '96e8984e-8187-4798-a562-b3f08dbae794',
  leagueId: 584,
  seedTeamId: 685597,
  pdfLookupPath: './data/pdf_lookup.json',
};

const state = {
  ticket: null,
  teamsByDivision: [],
  pdfRows: [],
  pdfByName: new Map(),
  pdfByLast: new Map(),
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

function compact(value) {
  return normalizeName(value).replace(/\s+/g, '');
}

function nameParts(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || '',
    last: parts.length > 1 ? parts[parts.length - 1] : '',
  };
}

async function api(path, params = {}, { auth = true } = {}) {
  const url = new URL(path, CONFIG.apiBase);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
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

function decodeHtml(htmlString) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = htmlString;
  return textarea.value || htmlString;
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

function parseTeamsByDivision(teamHtml) {
  const decoded = decodeHtml(teamHtml);
  const marker = 'ctrl.teams_by_division = ';
  const start = decoded.indexOf(marker);
  if (start === -1) throw new Error('Could not find teams_by_division in team response.');
  const jsonStart = decoded.indexOf('[', start + marker.length);
  if (jsonStart === -1) throw new Error('Could not find teams_by_division JSON array.');
  return JSON.parse(extractJsonArray(decoded, jsonStart));
}

async function loadTournament() {
  setBusy(true);
  setStatus('Refreshing tournament/division/team list…');
  try {
    const data = await api('/partials/stats/team', {
      league_id: CONFIG.leagueId,
      team_id: CONFIG.seedTeamId,
    });
    state.teamsByDivision = parseTeamsByDivision(data.content);
    renderDivisionOptions();
    const targetDivision = state.teamsByDivision.find(d => d.teams?.some(t => Number(t.id) === CONFIG.seedTeamId));
    if (targetDivision) els.division.value = String(targetDivision.id);
    renderTeamOptions();
    els.team.value = '';
    state.roster = [];
    renderResults();
    setStatus(`Loaded ${state.teamsByDivision.length} divisions from State Wars. Choose a team, or search the RHA PDF by last name.`);
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
    state.pdfRows = data.players || [];
    state.pdfByName = new Map();
    state.pdfByLast = new Map();
    for (const row of state.pdfRows) {
      const parts = {
        first: row.first || nameParts(row.name).first,
        last: row.last || nameParts(row.name).last,
      };
      const fullName = row.name || `${parts.first} ${parts.last}`.trim();
      const exactKey = compact(fullName);
      const lastKey = compact(parts.last);
      if (exactKey) {
        const existing = state.pdfByName.get(exactKey) || [];
        existing.push({ ...row, name: fullName, first: parts.first, last: parts.last });
        state.pdfByName.set(exactKey, existing);
      }
      if (lastKey) {
        const existing = state.pdfByLast.get(lastKey) || [];
        existing.push({ ...row, name: fullName, first: parts.first, last: parts.last });
        state.pdfByLast.set(lastKey, existing);
      }
    }
  } catch (err) {
    console.warn('PDF lookup not loaded:', err);
    state.pdfMeta = { warning: 'PDF lookup file not loaded yet.' };
    state.pdfRows = [];
    state.pdfByName = new Map();
    state.pdfByLast = new Map();
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
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Select a team…';
  els.team.appendChild(blank);
  for (const team of division?.teams || []) {
    const opt = document.createElement('option');
    opt.value = team.id;
    opt.textContent = team.name;
    els.team.appendChild(opt);
  }
}

function parsePlayerId(href) {
  return href?.match(/player\/(\d+)/)?.[1] || '';
}

function parseRoster(rosterHtml) {
  const doc = new DOMParser().parseFromString(rosterHtml, 'text/html');
  const players = [];
  const seen = new Set();

  // HockeyShift full roster cards, e.g. <a href="#/player/1088104/bio">Ajay Horowitz</a><div>#10 F/D</div>
  for (const link of doc.querySelectorAll('a[href*="/player/"]')) {
    const playerId = parsePlayerId(link.getAttribute('href'));
    const name = link.textContent.trim();
    if (!playerId || !name || seen.has(playerId)) continue;
    const metaText = link.nextElementSibling?.textContent?.trim() || '';
    const metaMatch = metaText.match(/^#?([0-9A-Za-z]+)\s*(.*)$/);
    players.push({
      number: metaMatch?.[1] || '',
      name,
      position: metaMatch?.[2] || '',
      playerId,
      sourceUrl: `https://www.statewarshockey.com/stats#/${CONFIG.leagueId}/player/${playerId}/bio`,
    });
    seen.add(playerId);
  }

  // Fallback for table-shaped roster partials.
  for (const row of doc.querySelectorAll('tbody tr')) {
    const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim());
    const link = row.querySelector('a[href*="/player/"]');
    const playerId = parsePlayerId(link?.getAttribute('href'));
    if (cells.length < 3 || !playerId || seen.has(playerId)) continue;
    players.push({
      number: cells[0],
      name: cells[1],
      position: cells[2],
      playerId,
      sourceUrl: `https://www.statewarshockey.com/stats#/${CONFIG.leagueId}/player/${playerId}/bio`,
    });
    seen.add(playerId);
  }
  return players;
}

async function lookupRoster() {
  const teamId = els.team.value;
  if (!teamId) {
    state.roster = [];
    renderResults();
    setStatus('No team selected. Choose a team, or search the RHA PDF by last name.');
    return;
  }
  setBusy(true);
  setStatus('Fetching live roster…');
  try {
    const data = await api('/partials/stats/team/roster', {
      league_id: CONFIG.leagueId,
      team_id: teamId,
    });
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

function getPdfMatch(player) {
  const parts = nameParts(player.name);
  const exact = state.pdfByName.get(compact(player.name)) || [];
  if (exact.length) {
    return { status: 'matched', label: 'Exact match', matches: exact, confidence: 'exact first + last' };
  }
  const sameLast = state.pdfByLast.get(compact(parts.last)) || [];
  const likely = sameLast.filter(row => compact(row.first).slice(0, 1) === compact(parts.first).slice(0, 1));
  if (likely.length) {
    return { status: 'review', label: 'Review', matches: likely, confidence: 'same last + same first initial' };
  }
  return { status: 'missing', label: 'No match', matches: sameLast.slice(0, 10), confidence: sameLast.length ? 'same last only' : 'no first + last match' };
}

function renderResults() {
  const query = normalizeName(els.search.value);
  if (!state.roster.length) {
    renderPdfNameLookup(query);
    return;
  }
  const rows = state.roster.filter(p => {
    if (!query) return true;
    return normalizeName(`${p.number} ${p.name} ${p.position}`).includes(query);
  });
  const outcomes = rows.map(player => ({ player, match: getPdfMatch(player) }));
  const matched = outcomes.filter(o => o.match.status === 'matched').length;
  const review = outcomes.filter(o => o.match.status === 'review').length;
  const missing = outcomes.filter(o => o.match.status === 'missing').length;
  const pdfCount = state.pdfMeta?.count || state.pdfRows.length;
  els.counts.textContent = `${rows.length} shown · ${matched} matched · ${review} review · ${missing} missing · ${pdfCount.toLocaleString()} PDF rows`;
  els.body.innerHTML = '';
  if (!rows.length) {
    els.body.innerHTML = '<tr><td colspan="5" class="empty">No roster rows match the filter.</td></tr>';
    return;
  }
  for (const { player, match } of outcomes) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="num">${escapeHtml(player.number)}</td>
      <td><div class="player">${escapeHtml(player.name)}</div><div class="meta">HockeyShift ID: ${escapeHtml(player.playerId)}</div></td>
      <td>${escapeHtml(player.position)}</td>
      <td><span class="badge ${escapeHtml(match.status)}">${escapeHtml(match.label)}</span><div class="meta">${escapeHtml(match.confidence)}</div></td>
      <td>${match.matches.length ? match.matches.map(formatPdfMatch).join('<hr>') : '<span class="meta">—</span>'}</td>`;
    els.body.appendChild(tr);
  }
}

function formatPdfMatch(match) {
  const stateText = match.state ? ` — ${match.state}` : '';
  const detail = match.detail || match.raw || '';
  return `<strong>${escapeHtml(match.last || '')}, ${escapeHtml(match.first || '')}${escapeHtml(stateText)}</strong>${detail ? `<div class="meta">${escapeHtml(detail)}</div>` : ''}`;
}

function renderPdfNameLookup(query) {
  const pdfCount = state.pdfMeta?.count || state.pdfRows.length;
  els.body.innerHTML = '';
  if (!query) {
    els.counts.textContent = `${pdfCount.toLocaleString()} PDF rows indexed`;
    els.body.innerHTML = '<tr><td colspan="5" class="empty">No team selected. Choose a team, or search the RHA PDF by last name.</td></tr>';
    return;
  }
  const qCompact = compact(query);
  const matches = state.pdfRows.filter(row => {
    const full = normalizeName(row.name || `${row.first || ''} ${row.last || ''}`);
    const last = normalizeName(row.last || nameParts(row.name).last);
    return compact(last) === qCompact || full.includes(query);
  }).slice(0, 100);
  els.counts.textContent = `${matches.length} PDF name matches · ${pdfCount.toLocaleString()} PDF rows indexed`;
  if (!matches.length) {
    els.body.innerHTML = `<tr><td colspan="5" class="empty">No RHA PDF names match “${escapeHtml(query)}”.</td></tr>`;
    return;
  }
  for (const match of matches) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="num">—</td>
      <td><div class="player">${escapeHtml(match.name || `${match.first || ''} ${match.last || ''}`)}</div><div class="meta">RHA PDF lookup</div></td>
      <td>${escapeHtml(match.state || '')}</td>
      <td><span class="badge matched">PDF row</span><div class="meta">name/last-name match</div></td>
      <td>${formatPdfMatch(match)}</td>`;
    els.body.appendChild(tr);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]));
}

els.division.addEventListener('change', () => { renderTeamOptions(); lookupRoster(); });
els.team.addEventListener('change', lookupRoster);
els.lookup.addEventListener('click', lookupRoster);
els.refresh.addEventListener('click', async () => { await loadTournament(); await lookupRoster(); });
els.search.addEventListener('input', renderResults);

await loadPdfLookup();
await loadTournament();
