const CONFIG = {
  apiBase: 'https://web.api.digitalshift.ca',
  statsOrigin: 'https://www.statewarshockey.com',
  clientServiceId: '96e8984e-8187-4798-a562-b3f08dbae794',
  leagueId: 584,
  tournamentId: 3620,
  teamId: null,
  pdfLookupPath: './data/pdf_lookup.json',
};

const OVERRIDE_STORAGE_KEY = 'statewars-rha-status-overrides-v1';

const state = {
  ticket: null,
  seasons: [],
  tournaments: [],
  events: [],
  teamsByDivision: [],
  currentTournamentName: '',
  pdfRows: [],
  pdfByName: new Map(),
  pdfByLast: new Map(),
  pdfMeta: null,
  roster: [],
  activeStatusFilter: 'all',
  statusOverrides: loadStatusOverrides(),
};

const els = {
  season: document.querySelector('#seasonSelect'),
  tournament: document.querySelector('#tournamentSelect'),
  division: document.querySelector('#divisionSelect'),
  team: document.querySelector('#teamSelect'),
  tournamentUrl: document.querySelector('#tournamentUrlInput'),
  search: document.querySelector('#searchInput'),
  refresh: document.querySelector('#refreshBtn'),
  lookup: document.querySelector('#lookupBtn'),
  export: document.querySelector('#exportBtn'),
  applyUrl: document.querySelector('#applyUrlBtn'),
  menuToggle: document.querySelector('#utilityMenuBtn'),
  menuPanel: document.querySelector('#utilityMenuPanel'),
  status: document.querySelector('#status'),
  counts: document.querySelector('#counts'),
  body: document.querySelector('#resultsBody'),
  pdfMeta: document.querySelector('#pdfMeta'),
  opsOverview: document.querySelector('#opsOverview'),
};

const STATS_SITES = {
  'www.statewarshockey.com': '96e8984e-8187-4798-a562-b3f08dbae794',
  'statewarshockey.com': '96e8984e-8187-4798-a562-b3f08dbae794',
};

function setBusy(isBusy) {
  els.season.disabled = isBusy;
  els.tournament.disabled = isBusy;
  els.division.disabled = isBusy;
  els.team.disabled = isBusy;
  els.refresh.disabled = isBusy;
  els.lookup.disabled = isBusy;
  els.applyUrl.disabled = isBusy;
  if (els.menuToggle) els.menuToggle.disabled = isBusy;
}

function setUtilityMenu(open) {
  if (!els.menuToggle || !els.menuPanel) return;
  els.menuPanel.hidden = !open;
  els.menuToggle.setAttribute('aria-expanded', String(open));
}

function closeUtilityMenu() {
  setUtilityMenu(false);
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}

function configureStatsSite(url) {
  const serviceId = STATS_SITES[url.hostname.toLowerCase()];
  if (!serviceId) {
    throw new Error(`Unsupported stats site: ${url.hostname}. Paste a State Wars stats URL.`);
  }
  CONFIG.statsOrigin = url.origin;
  if (CONFIG.clientServiceId !== serviceId) {
    CONFIG.clientServiceId = serviceId;
    state.ticket = null;
  }
}

function currentYearSeason(seasons) {
  const year = String(new Date().getFullYear());
  return seasons.find(season => String(season.name) === year || String(season.short_name) === year);
}

function formatDate(value) {
  if (!value) return '';
  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return `${Number(month)}/${Number(day)}/${year}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  }).format(date);
}

function formatUtcDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function eventDateLabel(event) {
  if (!event?.started_at) return '';
  const start = formatUtcDate(event.started_at);
  const end = formatUtcDate(event.ended_at);
  const dates = end && end !== start ? `${start}–${end}` : start;
  return [dates, event.venue?.name].filter(Boolean).join(' · ');
}

function normalizedTournamentName(value) {
  return normalizeName(value).replace(/^20\d{2}\s+/, '').replace(/\s+/g, ' ').trim();
}

function findMatchingEvent(tournament) {
  const tName = normalizedTournamentName(tournament?.name || tournament?.short_name || '');
  const tCompact = compact(tName);
  if (!tName) return null;
  return state.events.find(event => {
    const eName = normalizedTournamentName(event.name);
    const eCompact = compact(eName);
    return eName.includes(tName) || tName.includes(eName) || eCompact.includes(tCompact) || tCompact.includes(eCompact);
  });
}

function tournamentShortLabel(tournament) {
  return tournament?.shortName || tournament?.name || tournament?.short_name || `Tournament ${tournament?.id || ''}`.trim();
}

function tournamentDetailLabel(tournament) {
  const label = tournamentShortLabel(tournament);
  const event = findMatchingEvent(tournament);
  const eventText = eventDateLabel(event);
  return eventText ? `${label} — ${eventText}` : label;
}


function renderPdfMeta() {
  if (!els.pdfMeta) return;
  const meta = state.pdfMeta || {};
  if (meta.warning) {
    els.pdfMeta.textContent = meta.warning;
    els.pdfMeta.classList.add('error');
    return;
  }
  els.pdfMeta.classList.remove('error');
  const fetched = formatDate(meta.fetched_at || meta.generated_at);
  const pdfDated = formatDate(meta.pdf_dated || meta.pdf_date);
  const count = meta.count ? `${Number(meta.count).toLocaleString()} names` : `${state.pdfRows.length.toLocaleString()} names`;
  const pieces = [];
  if (fetched) pieces.push(`Fetched ${fetched}`);
  if (pdfDated) pieces.push(`RHA PDF dated ${pdfDated}`);
  pieces.push(count);
  els.pdfMeta.textContent = pieces.join(' · ');
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

function loadStatusOverrides() {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDE_STORAGE_KEY) || '{}');
  } catch (err) {
    console.warn('Could not read saved verification choices:', err);
    return {};
  }
}

function saveStatusOverrides() {
  try {
    localStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(state.statusOverrides));
  } catch (err) {
    console.warn('Could not save verification choices:', err);
  }
}

function overrideScopeKey() {
  const pdfStamp = state.pdfMeta?.pdf_dated || state.pdfMeta?.source || 'pdf';
  return [CONFIG.leagueId, CONFIG.tournamentId, els.division?.value || 'division', pdfStamp].join(':');
}

function playerOverrideKey(player) {
  return `${overrideScopeKey()}:${player.playerId || compact(player.name)}`;
}

function getSavedStatus(player) {
  return state.statusOverrides[playerOverrideKey(player)] || null;
}

function setSavedStatus(player, status) {
  const key = playerOverrideKey(player);
  if (status) state.statusOverrides[key] = status;
  else delete state.statusOverrides[key];
  saveStatusOverrides();
  renderResults();
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

async function loadEvents() {
  if (!CONFIG.statsOrigin.includes('statewarshockey.com')) {
    state.events = [];
    return;
  }
  const now = new Date();
  const startDate = `${now.getFullYear()}-01-01`;
  try {
    const data = await api('/events', {
      order: 'started_at',
      fieldset: 'public',
      type: 'event',
      limit: 50,
      status: 'published',
      start_date: startDate,
    });
    state.events = data.events || [];
  } catch (err) {
    console.warn('Event lookup not loaded:', err);
    state.events = [];
  }
}

async function loadTournament(options = {}) {
  const { keepTeam = false, preferredDivisionId = null, preferredTeamId = null } = options;
  setBusy(true);
  setStatus('Reloading tournament/division list…');
  try {
    await loadEvents();
    const data = await api('/partials/stats/filters', {
      type: 'tournament',
      id: CONFIG.tournamentId,
      league_id: CONFIG.leagueId,
      autoselect: false,
    });
    state.seasons = data.season?.options || state.seasons;
    state.tournaments = data.tournament?.options || [];
    const selectedSeasonId = data.season?.selected_id || state.tournaments.find(t => String(t.id) === String(CONFIG.tournamentId))?.season_id;
    const selectedTournament = state.tournaments.find(t => String(t.id) === String(CONFIG.tournamentId));
    state.currentTournamentName = selectedTournament?.name || `Tournament ${CONFIG.tournamentId}`;
    state.teamsByDivision = (data.division?.options || [])
      .filter(division => String(division.tournament_id) === String(CONFIG.tournamentId))
      .map(division => ({ ...division, teams: [] }));
    renderSeasonOptions(selectedSeasonId);
    renderTournamentOptions();
    renderDivisionOptions();
    els.division.value = preferredDivisionId ? String(preferredDivisionId) : '';
    if (els.division.value) await loadTeamsForDivision(els.division.value);
    else renderTeamOptions();
    els.team.value = preferredTeamId ? String(preferredTeamId) : (keepTeam ? els.team.value : '');
    state.roster = [];
    renderResults();
    const event = findMatchingEvent(selectedTournament);
    const source = event ? ` Matched event: ${event.name} (${eventDateLabel(event)}).` : '';
    setStatus(`Loaded ${state.teamsByDivision.length} divisions for ${state.currentTournamentName}.${source} Choose a division, then load players. You can still search the RHA PDF by last name.`);
    closeUtilityMenu();
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
    renderPdfMeta();
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
    renderPdfMeta();
  }
}

function renderSeasonOptions(selectedSeasonId) {
  els.season.innerHTML = '';
  for (const season of state.seasons) {
    const opt = document.createElement('option');
    opt.value = season.id;
    opt.textContent = season.name || season.short_name || `Year ${season.id}`;
    els.season.appendChild(opt);
  }
  const current = selectedSeasonId || currentYearSeason(state.seasons)?.id || state.seasons[0]?.id;
  if (current) els.season.value = String(current);
}

function renderTournamentOptions() {
  els.tournament.innerHTML = '';
  for (const tournament of state.tournaments) {
    const opt = document.createElement('option');
    opt.value = tournament.id;
    opt.textContent = tournamentShortLabel(tournament);
    opt.title = tournamentDetailLabel(tournament);
    els.tournament.appendChild(opt);
  }
  els.tournament.value = String(CONFIG.tournamentId);
}

function renderDivisionOptions() {
  els.division.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Select a Division...';
  els.division.appendChild(blank);
  for (const division of state.teamsByDivision) {
    const opt = document.createElement('option');
    opt.value = division.id;
    opt.textContent = `${division.name}${division.teams?.length ? ` (${division.teams.length})` : ''}`;
    els.division.appendChild(opt);
  }
}

function renderTeamOptions() {
  const division = state.teamsByDivision.find(d => String(d.id) === els.division.value);
  els.team.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = division ? 'Select a team…' : 'Select a division first…';
  els.team.appendChild(blank);
  for (const team of division?.teams || []) {
    const opt = document.createElement('option');
    opt.value = team.id;
    opt.textContent = team.name;
    els.team.appendChild(opt);
  }
}

async function loadSeason(seasonId) {
  if (!seasonId) return;
  setBusy(true);
  setStatus('Loading tournaments for year…');
  try {
    const data = await api('/partials/stats/filters', {
      type: 'season',
      id: seasonId,
      autoselect: false,
    });
    state.seasons = data.season?.options || state.seasons;
    state.tournaments = data.tournament?.options || [];
    const firstTournament = state.tournaments[0];
    CONFIG.tournamentId = data.tournament?.selected_id || firstTournament?.id || CONFIG.tournamentId;
    renderSeasonOptions(data.season?.selected_id || seasonId);
    renderTournamentOptions();
    await loadTournament();
  } catch (err) {
    console.error(err);
    setStatus(err.message, true);
  } finally {
    setBusy(false);
  }
}

async function loadTeamsForDivision(divisionId) {
  const division = state.teamsByDivision.find(d => String(d.id) === String(divisionId));
  if (!division) {
    renderTeamOptions();
    return;
  }
  if (division.teams?.length) {
    renderTeamOptions();
    return;
  }
  setStatus(`Loading teams for ${division.name}…`);
  const data = await api('/partials/stats/filters', {
    type: 'division',
    id: division.id,
    autoselect: false,
  });
  division.teams = (data.team?.options || []).filter(team => String(team.division_id) === String(division.id));
  renderDivisionOptions();
  els.division.value = String(division.id);
  renderTeamOptions();
}


function parsePlayerId(href) {
  return href?.match(/player\/(\d+)/)?.[1] || '';
}

function parseTeamId(href) {
  return href?.match(/team\/(\d+)/)?.[1] || '';
}

function parseTournamentUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) throw new Error('Paste a HockeyShift/State Wars stats URL first.');
  const url = new URL(value, CONFIG.statsOrigin);
  configureStatsSite(url);
  if (!url.hash.includes('/')) throw new Error('Paste a stats URL with a # route, e.g. /stats#/584/team/685597.');
  const [pathPart, queryPart = ''] = url.hash.slice(1).split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const params = new URLSearchParams(queryPart);
  for (const [key, val] of url.searchParams.entries()) {
    if (!params.has(key)) params.set(key, val);
  }
  const leagueId = Number(parts[0] || params.get('league_id'));
  const page = parts[1] || '';
  const id = Number(parts[2] || '');
  const seasonId = Number(params.get('season_id')) || null;
  const tournamentId = Number(params.get('tournament_id')) || (page === 'tournament' ? id : null);
  const divisionId = Number(params.get('division_id')) || (page === 'division' ? id : null);
  const teamId = page === 'team' ? id : Number(params.get('team_id')) || null;
  if (!leagueId) throw new Error('Could not find a league ID in that stats URL.');
  return { leagueId, seasonId, tournamentId, divisionId, teamId };
}

async function applyTournamentUrl() {
  setBusy(true);
  try {
    const parsed = parseTournamentUrl(els.tournamentUrl.value);
    CONFIG.leagueId = parsed.leagueId;
    if (parsed.tournamentId) CONFIG.tournamentId = parsed.tournamentId;
    if (parsed.teamId) {
      const data = await api('/partials/stats/filters', {
        type: 'team',
        id: parsed.teamId,
        league_id: CONFIG.leagueId,
        autoselect: false,
      });
      CONFIG.tournamentId = data.tournament?.selected_id || CONFIG.tournamentId;
      parsed.divisionId = data.division?.selected_id || parsed.divisionId;
    }
    if (!parsed.tournamentId && !parsed.teamId) {
      const data = await api('/partials/stats/filters', {
        type: parsed.seasonId ? 'season' : 'league',
        id: parsed.seasonId || CONFIG.leagueId,
      });
      state.seasons = data.season?.options || state.seasons;
      const season = parsed.seasonId
        ? state.seasons.find(s => String(s.id) === String(parsed.seasonId))
        : currentYearSeason(state.seasons);
      if (season && (!data.tournament?.options?.length || String(data.season?.selected_id) !== String(season.id))) {
        await loadSeason(season.id);
        return;
      }
      state.tournaments = data.tournament?.options || [];
      CONFIG.tournamentId = data.tournament?.selected_id || state.tournaments[0]?.id || CONFIG.tournamentId;
    }
    await loadTournament({ preferredDivisionId: parsed.divisionId, preferredTeamId: parsed.teamId });
    if (parsed.teamId || parsed.divisionId) {
      setStatus('Division selected. Load players to see Missing / Verify / Matched status by team.');
    }
    closeUtilityMenu();
  } catch (err) {
    console.error(err);
    setStatus(err.message, true);
  } finally {
    setBusy(false);
  }
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
      sourceUrl: playerStatsUrl(playerId),
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
      sourceUrl: playerStatsUrl(playerId),
    });
    seen.add(playerId);
  }
  return players;
}

async function lookupRoster() {
  const divisionId = els.division.value;
  if (!divisionId) {
    state.roster = [];
    renderResults();
    setStatus('No division selected. Choose a division, then load players. You can still search the RHA PDF by last name.');
    return;
  }
  setBusy(true);
  setStatus('Loading division players…');
  try {
    const data = await api('/partials/stats/leaders/table', {
      division_id: divisionId,
      game_type: 'Round Robin',
      player_type: 'players',
    });
    state.roster = parseDivisionPlayers(data.content);
    renderResults();
    const divisionName = els.division.selectedOptions[0]?.textContent || `division ${divisionId}`;
    setStatus(`Loaded ${state.roster.length} players for ${divisionName} in ${state.currentTournamentName}.`);
  } catch (err) {
    console.error(err);
    setStatus(err.message, true);
  } finally {
    setBusy(false);
  }
}

function parseDivisionPlayers(playersHtml) {
  const doc = new DOMParser().parseFromString(playersHtml, 'text/html');
  const players = [];
  const seen = new Set();

  for (const row of doc.querySelectorAll('table tbody tr')) {
    const cells = [...row.querySelectorAll('td')];
    const playerLink = row.querySelector('a.person-inline[href*="/player/"]');
    const teamLink = row.querySelector('a.team-inline[href*="/team/"]');
    const playerId = parsePlayerId(playerLink?.getAttribute('href'));
    if (!playerId || seen.has(playerId)) continue;

    const teamName = teamLink?.textContent?.trim() || cells[3]?.textContent?.trim() || '';
    players.push({
      rank: cells[0]?.textContent?.trim() || '',
      number: cells[2]?.textContent?.trim() || '',
      name: playerLink.textContent.trim() || cells[1]?.textContent?.trim() || '',
      team: teamName,
      teamId: parseTeamId(teamLink?.getAttribute('href')),
      position: cells[4]?.textContent?.trim() || '',
      gp: cells[5]?.textContent?.trim() || '',
      goals: cells[6]?.textContent?.trim() || '',
      assists: cells[7]?.textContent?.trim() || '',
      points: cells[8]?.textContent?.trim() || '',
      pim: cells[10]?.textContent?.trim() || '',
      playerId,
      sourceUrl: playerStatsUrl(playerId),
    });
    seen.add(playerId);
  }
  return players;
}

function getPdfMatch(player) {
  const parts = nameParts(player.name);
  const exact = state.pdfByName.get(compact(player.name)) || [];
  let result;
  if (exact.length) {
    result = { status: 'matched', baseStatus: 'matched', label: 'Matched', matches: exact, confidence: 'exact first + last' };
  } else {
    const sameLast = state.pdfByLast.get(compact(parts.last)) || [];
    const likely = sameLast.filter(row => compact(row.first).slice(0, 1) === compact(parts.first).slice(0, 1));
    if (likely.length) {
      result = { status: 'verify', baseStatus: 'verify', label: 'Verify', matches: likely, confidence: 'same last + same first initial' };
    } else {
      result = { status: 'missing', baseStatus: 'missing', label: 'Missing', matches: sameLast.slice(0, 10), confidence: sameLast.length ? 'same last only' : 'no first + last match' };
    }
  }
  const saved = getSavedStatus(player);
  if (saved === 'matched' || saved === 'missing') {
    return {
      ...result,
      status: saved,
      label: saved === 'matched' ? 'Matched' : 'Missing',
      overridden: true,
      overrideLabel: saved === 'matched' ? 'Confirmed on this phone' : 'Marked missing on this phone',
    };
  }
  return result;
}

function divisionUrl(divisionId = els.division.value) {
  return `${CONFIG.statsOrigin}/stats#/${CONFIG.leagueId}/division/${divisionId}?tournament_id=${CONFIG.tournamentId}`;
}

function teamUrl(teamId) {
  return `${CONFIG.statsOrigin}/stats#/${CONFIG.leagueId}/team/${teamId}/roster?tournament_id=${CONFIG.tournamentId}`;
}

function statusLabel(status) {
  return status === 'verify' ? 'Verify' : status.charAt(0).toUpperCase() + status.slice(1);
}

function summarizeOutcomes(outcomes) {
  return {
    total: outcomes.length,
    matched: outcomes.filter(o => o.match.status === 'matched').length,
    verify: outcomes.filter(o => o.match.status === 'verify').length,
    missing: outcomes.filter(o => o.match.status === 'missing').length,
  };
}

function renderOpsOverview(allOutcomes) {
  if (!els.opsOverview) return;
  if (!state.roster.length) {
    els.opsOverview.hidden = true;
    return;
  }
  const summary = summarizeOutcomes(allOutcomes);
  const divisionName = els.division.selectedOptions[0]?.textContent || `Division ${els.division.value}`;
  const teamMap = new Map();
  for (const outcome of allOutcomes) {
    const key = outcome.player.teamId || outcome.player.team || 'unknown';
    if (!teamMap.has(key)) teamMap.set(key, { team: outcome.player.team || 'Unknown team', teamId: outcome.player.teamId, outcomes: [] });
    teamMap.get(key).outcomes.push(outcome);
  }
  const filterChip = (status, label, count) => `<button class="status-chip ${state.activeStatusFilter === status ? 'active' : ''}" type="button" data-status-filter="${status}"><span>${label}</span><strong>${count}</strong></button>`;
  const teamCards = [...teamMap.values()].sort((a, b) => a.team.localeCompare(b.team)).map(item => {
    const s = summarizeOutcomes(item.outcomes);
    const teamHref = item.teamId ? teamUrl(item.teamId) : '';
    return `
      <article class="team-card">
        <div class="team-card-title">
          <button class="link-button" type="button" data-team-filter="${escapeHtml(item.teamId || '')}">${escapeHtml(item.team)}</button>
          ${teamHref ? `<a href="${escapeHtml(teamHref)}" target="_blank" rel="noopener" aria-label="Open ${escapeHtml(item.team)} team page">↗</a>` : ''}
        </div>
        <div class="mini-counts"><span class="matched">${s.matched} matched</span><span class="verify">${s.verify} verify</span><span class="missing">${s.missing} missing</span></div>
      </article>`;
  }).join('');
  els.opsOverview.hidden = false;
  els.opsOverview.innerHTML = `
    <div class="ops-head">
      <div>
        <div class="eyebrow">Ops status overview</div>
        <h2>${escapeHtml(divisionName)}</h2>
        <a class="deep-link" href="${escapeHtml(divisionUrl())}" target="_blank" rel="noopener">Open division page ↗</a>
      </div>
      <div class="summary-pills" role="group" aria-label="Status filters">
        ${filterChip('all', 'All', summary.total)}
        ${filterChip('missing', 'Missing', summary.missing)}
        ${filterChip('verify', 'Verify', summary.verify)}
        ${filterChip('matched', 'Matched', summary.matched)}
      </div>
    </div>
    <div class="team-grid">${teamCards}</div>`;
}

function playerStatsUrl(playerId) {
  return `${CONFIG.statsOrigin}/stats#/player/${encodeURIComponent(playerId)}/stats`;
}

function isUserVerified(player) {
  return getSavedStatus(player) === 'matched';
}

function renderResults() {
  if (!state.roster.length) {
    if (els.export) els.export.hidden = true;
    renderOpsOverview([]);
    renderPdfNameLookup(normalizeName(els.search.value));
    return;
  }
  const selectedTeam = els.team.value;
  const query = normalizeName(els.search.value);
  const allOutcomes = state.roster
    .filter(player => !selectedTeam || String(player.teamId || '') === String(selectedTeam))
    .filter(player => !query || normalizeName(`${player.number} ${player.name} ${player.team || ''}`).includes(query))
    .map(player => ({ player, match: getPdfMatch(player) }));
  const outcomes = allOutcomes.filter(({ match }) => state.activeStatusFilter === 'all' || match.status === state.activeStatusFilter);
  const summary = summarizeOutcomes(allOutcomes);
  const verified = allOutcomes.filter(o => isUserVerified(o.player)).length;
  const pdfCount = state.pdfMeta?.count || state.pdfRows.length;
  els.counts.textContent = `${outcomes.length} visible · ${summary.missing} missing · ${summary.verify} verify · ${summary.matched} matched · ${verified} verified · ${pdfCount.toLocaleString()} PDF rows`;
  if (els.export) els.export.hidden = !state.roster.length;
  renderOpsOverview(allOutcomes);
  els.body.innerHTML = '';
  if (!outcomes.length) {
    els.body.innerHTML = '<tr><td colspan="3" class="empty">No player rows match this filter.</td></tr>';
    return;
  }
  outcomes.forEach(({ player, match }, index) => {
    const detailId = `details-${escapeHtml(player.playerId || index)}`;
    const tr = document.createElement('tr');
    tr.className = 'player-row';
    tr.tabIndex = 0;
    tr.setAttribute('aria-expanded', 'false');
    tr.setAttribute('aria-controls', detailId);
    const teamHref = player.teamId ? teamUrl(player.teamId) : '';
    tr.innerHTML = `
      <td class="num">${escapeHtml(player.number)}</td>
      <td>
        <div class="player"><a href="${escapeHtml(player.sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(player.name)}</a></div>
        <div class="meta links-line">
          <a href="${escapeHtml(divisionUrl())}" target="_blank" rel="noopener">Division</a>
          ${teamHref ? `<span>·</span><span>${escapeHtml(player.team || 'Team')}</span>` : `<span>· ${escapeHtml(player.team || '')}</span>`}
          <span>·</span><a href="${escapeHtml(player.sourceUrl)}" target="_blank" rel="noopener">HockeyShift ID: ${escapeHtml(player.playerId)}</a>
        </div>
      </td>
      <td class="rha-cell">${formatRhaIcon(match)}</td>`;
    const detail = document.createElement('tr');
    detail.id = detailId;
    detail.className = 'detail-row';
    detail.hidden = true;
    const verifiedChecked = isUserVerified(player) ? ' checked' : '';
    const verifyCheckbox = match.baseStatus === 'verify'
      ? `<label class="verify-control"><input type="checkbox"${verifiedChecked} data-verify-action="${isUserVerified(player) ? 'reset' : 'matched'}" data-player-id="${escapeHtml(player.playerId)}"> User verified this RHA match</label>`
      : '';
    detail.innerHTML = `<td colspan="3"><div class="detail-panel"><strong>${escapeHtml(match.label)}</strong><div class="meta">${escapeHtml(match.overrideLabel || match.confidence)}</div>${match.matches.length ? match.matches.map(formatPdfMatch).join('<hr>') : '<div class="meta">No RHA PDF match.</div>'}<div class="verify-actions">${verifyCheckbox}<button type="button" class="button tiny-button button-white" data-verify-action="missing" data-player-id="${escapeHtml(player.playerId)}">Mark missing</button>${match.overridden ? `<button type="button" class="button tiny-button button-white" data-verify-action="reset" data-player-id="${escapeHtml(player.playerId)}">Reset</button>` : ''}</div></div></td>`;
    const toggle = () => {
      const isOpen = !detail.hidden;
      detail.hidden = isOpen;
      tr.setAttribute('aria-expanded', String(!isOpen));
    };
    tr.addEventListener('click', event => {
      if (event.target.closest('a, button, input, label')) return;
      toggle();
    });
    tr.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
    els.body.appendChild(tr);
    els.body.appendChild(detail);
  });
}

function formatRhaIcon(match) {
  const config = {
    matched: ['✓', 'rha-yes'],
    verify: ['▲', 'rha-verify'],
    missing: ['×', 'rha-no'],
  }[match.status] || ['▲', 'rha-verify'];
  const label = match.overridden ? `${match.label}: ${match.overrideLabel}` : `${match.label}: ${match.confidence}`;
  return `<span class="rha-icon ${config[1]}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${config[0]}</span>`;
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
    els.body.innerHTML = '<tr><td colspan="3" class="empty">Choose a division, then load players. Or search the RHA PDF by last name.</td></tr>';
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
    els.body.innerHTML = `<tr><td colspan="3" class="empty">No RHA PDF names match “${escapeHtml(query)}”.</td></tr>`;
    return;
  }
  matches.forEach((match, index) => {
    const detailId = `pdf-details-${index}`;
    const tr = document.createElement('tr');
    tr.className = 'player-row';
    tr.tabIndex = 0;
    tr.setAttribute('aria-expanded', 'false');
    tr.setAttribute('aria-controls', detailId);
    tr.innerHTML = `
      <td class="num">—</td>
      <td><div class="player">${escapeHtml(match.name || `${match.first || ''} ${match.last || ''}`)}</div><div class="meta">RHA PDF lookup</div></td>
      <td class="rha-cell"><span class="rha-icon rha-yes" aria-label="PDF row" title="PDF row">✓</span></td>`;
    const detail = document.createElement('tr');
    detail.id = detailId;
    detail.className = 'detail-row';
    detail.hidden = true;
    detail.innerHTML = `<td colspan="3"><div class="detail-panel">${formatPdfMatch(match)}</div></td>`;
    const toggle = () => {
      const isOpen = !detail.hidden;
      detail.hidden = isOpen;
      tr.setAttribute('aria-expanded', String(!isOpen));
    };
    tr.addEventListener('click', toggle);
    tr.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
    els.body.appendChild(tr);
    els.body.appendChild(detail);
  });
}

function findPlayerById(playerId) {
  return state.roster.find(player => String(player.playerId) === String(playerId));
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function exportMissingVerify() {
  const selectedTeam = els.team.value;
  const query = normalizeName(els.search.value);
  const rows = state.roster
    .filter(player => !selectedTeam || String(player.teamId || '') === String(selectedTeam))
    .filter(player => !query || normalizeName(`${player.number} ${player.name} ${player.team || ''}`).includes(query))
    .map(player => ({ player, match: getPdfMatch(player) }));
  if (!rows.length) return;
  const header = ['Status', 'Player', 'Team', 'Division', 'HockeyShift ID', 'Player URL', 'Team URL', 'Division URL', 'User Verified', 'RHA Candidates'];
  const divisionName = els.division.selectedOptions[0]?.textContent || '';
  const lines = [header.map(csvCell).join(',')];
  for (const { player, match } of rows) {
    lines.push([
      statusLabel(match.status),
      player.name,
      player.team,
      divisionName,
      player.playerId,
      player.sourceUrl,
      player.teamId ? teamUrl(player.teamId) : '',
      divisionUrl(),
      isUserVerified(player) ? 'yes' : 'no',
      match.matches.map(m => `${m.first || ''} ${m.last || ''} ${m.state || ''}`.trim()).join('; '),
    ].map(csvCell).join(','));
  }
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${compact(state.currentTournamentName || 'statewars')}-${compact(divisionName || 'division')}-rha-export.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  setStatus(`Exported ${rows.length} rows. User-verified matches are included.`);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]));
}

els.season.addEventListener('change', async () => { await loadSeason(els.season.value); });
els.tournament.addEventListener('change', async () => { CONFIG.tournamentId = Number(els.tournament.value); await loadTournament(); });
els.division.addEventListener('change', async () => {
  await loadTeamsForDivision(els.division.value);
  state.roster = [];
  state.activeStatusFilter = 'all';
  renderResults();
  if (els.division.value) setStatus('Division selected. Load players to see Missing / Verify / Matched status by team.');
});
els.team.addEventListener('change', () => { state.activeStatusFilter = 'all'; renderResults(); });
els.lookup.addEventListener('click', lookupRoster);
els.refresh.addEventListener('click', async () => { await loadTournament({ keepTeam: true }); });
els.menuToggle.addEventListener('click', event => {
  event.stopPropagation();
  setUtilityMenu(els.menuPanel.hidden);
});
els.applyUrl.addEventListener('click', applyTournamentUrl);
els.tournamentUrl.addEventListener('keydown', event => { if (event.key === 'Enter') applyTournamentUrl(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeUtilityMenu(); });
els.search.addEventListener('input', renderResults);
els.export.addEventListener('click', exportMissingVerify);
document.addEventListener('click', event => {
  if (els.menuPanel && !els.menuPanel.hidden && !event.target.closest('.utility-menu')) closeUtilityMenu();
  const statusButton = event.target.closest('[data-status-filter]');
  if (statusButton) {
    state.activeStatusFilter = statusButton.dataset.statusFilter || 'all';
    renderResults();
    return;
  }
  const teamButton = event.target.closest('button[data-team-filter]');
  if (teamButton) {
    els.team.value = teamButton.dataset.teamFilter || '';
    state.activeStatusFilter = 'all';
    renderResults();
    return;
  }
  const verifyButton = event.target.closest('[data-verify-action]');
  if (verifyButton) {
    const player = findPlayerById(verifyButton.dataset.playerId);
    if (!player) return;
    const action = verifyButton.dataset.verifyAction;
    setSavedStatus(player, action === 'reset' ? null : action);
  }
});

await loadPdfLookup();
els.search.value = '';
await loadTournament();
