// frontend/js/api.js

async function apiGet(path) {
  const response = await fetch(`${CONFIG.API_BASE}/api${path}`);
  if (!response.ok) throw new Error('API error');
  return response.json();
}

async function apiPost(path, body) {
  const response = await fetch(`${CONFIG.API_BASE}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) throw new Error('API error');
  return response.json();
}

// ---- Endpoints específicos ----

async function createTrip(data) {
  return apiPost('/trips', data);
}

async function getRoutes() {
  return apiGet('/routes');
}

async function getMatches(email, date) {
  return apiGet(`/matches/grouped?email=${email}&date=${date}`);
}