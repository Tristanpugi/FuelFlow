// ── Auth ─────────────────────────────────────────────────────────────────────
const ffToken = localStorage.getItem("ff-token");
const ffUserName = localStorage.getItem("ff-user-name");
const ffUserEmail = localStorage.getItem("ff-user-email");

const favoriteOwnerKey = (ffUserEmail || ffUserName || "guest").trim().toLowerCase();
const favoritesStorageKey = `fuel-favorites:${favoriteOwnerKey}`;
const alertTargetsStorageKey = `fuel-alert-targets:${favoriteOwnerKey}`;

function loadFavoritesFromStorage() {
  try {
    const scopedRaw = localStorage.getItem(favoritesStorageKey);
    const scoped = JSON.parse(scopedRaw ?? "[]");
    const scopedIds = Array.isArray(scoped) ? scoped : [];
    return [...new Set(scopedIds)]
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);
  } catch {
    return [];
  }
}

function normalizeAlertTargets(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const read = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  return {
    diesel: read(source.diesel),
    premium95: read(source.premium95),
    premium98: read(source.premium98),
  };
}

function loadAlertTargetsFromStorage() {
  try {
    const scopedRaw = localStorage.getItem(alertTargetsStorageKey);
    const scoped = normalizeAlertTargets(JSON.parse(scopedRaw ?? "{}"));
    return {
      diesel: scoped.diesel,
      premium95: scoped.premium95,
      premium98: scoped.premium98,
    };
  } catch {
    return { diesel: null, premium95: null, premium98: null };
  }
}

function clearLegacySharedStorage() {
  localStorage.removeItem("fuel-favorites");
  localStorage.removeItem("fuel-alert-targets");
}

function hasAnyAlertTarget(targets) {
  return Boolean(targets.diesel || targets.premium95 || targets.premium98);
}

function alertTargetsChanged(a, b) {
  return a.diesel !== b.diesel || a.premium95 !== b.premium95 || a.premium98 !== b.premium98;
}

function authHeaders() {
  return ffToken ? { Authorization: `Bearer ${ffToken}` } : {};
}

// Handle Google OAuth redirect token param
(function handleOAuthRedirect() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("token")) {
    localStorage.setItem("ff-token", params.get("token"));
    localStorage.setItem("ff-user-name", params.get("name") || "");
    localStorage.setItem("ff-user-email", params.get("email") || "");
    window.history.replaceState({}, "", "/");
    window.location.reload();
  }
})();

// Show user info in nav
const userMenu = document.getElementById("userMenu");
const userNameLabel = document.getElementById("userNameLabel");
const loginLink = document.getElementById("loginLink");
const logoutBtn = document.getElementById("logoutBtn");
const favoritesFilterBtn = document.getElementById("favoritesFilterBtn");
const alertFilterBtn = document.getElementById("alertFilterBtn");

if (ffToken && ffUserName) {
  userMenu.classList.remove("hidden");
  loginLink.classList.add("hidden");
  userNameLabel.textContent = ffUserName;
} else {
  userMenu.classList.add("hidden");
  loginLink.classList.remove("hidden");
}

logoutBtn.addEventListener("click", () => {
  const confirmLogout = window.confirm("Kas soovid kindlasti välja logida?");
  if (!confirmLogout) {
    return;
  }
  localStorage.removeItem("ff-token");
  localStorage.removeItem("ff-user-name");
  localStorage.removeItem("ff-user-email");
  window.location.href = "/login";
});

// ── State ─────────────────────────────────────────────────────────────────────
let user = {
  id: 1,
  lat: 59.437,
  lng: 24.7536,
};

const map = L.map("map").setView([user.lat, user.lng], 7);
L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, style: Humanitarian OpenStreetMap Team',
  maxZoom: 20,
}).addTo(map);

const systemMessage = document.getElementById("systemMessage");
const favoritesList = document.getElementById("favoritesList");
const alertsFeed = document.getElementById("alertsFeed");
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");

const checkAlertsBtn = document.getElementById("checkAlertsBtn");
const alertModal = document.getElementById("alertModal");
const closeAlertModalBtn = document.getElementById("closeAlertModalBtn");
const alertTargetsForm = document.getElementById("alertTargetsForm");
const targetDieselInput = document.getElementById("targetDiesel");
const target95Input = document.getElementById("target95");
const target98Input = document.getElementById("target98");
const alertModalResult = document.getElementById("alertModalResult");

const stationModal = document.getElementById("stationModal");
const closeStationModalBtn = document.getElementById("closeStationModalBtn");
const stationModalTitle = document.getElementById("stationModalTitle");
const stationModalAddress = document.getElementById("stationModalAddress");
const stationPriceDiesel = document.getElementById("stationPriceDiesel");
const stationPrice95 = document.getElementById("stationPrice95");
const stationPrice98 = document.getElementById("stationPrice98");
const stationUpdateBtn = document.getElementById("stationUpdateBtn");
const stationSaveBtn = document.getElementById("stationSaveBtn");
const stationFavoriteBtn = document.getElementById("stationFavoriteBtn");
const stationModalResult = document.getElementById("stationModalResult");
const favoritesPanel = document.getElementById("lemmikud");

const markers = new Map();
const stationCache = new Map();
let selectedStationDetails = null;
let activeMapFilter = "all";

const favorites = new Set(loadFavoritesFromStorage());
let alertTargets = loadAlertTargetsFromStorage();

const userMarker = L.circleMarker([user.lat, user.lng], {
  radius: 8,
  color: "#0f6fff",
  weight: 3,
  fillColor: "#69a6ff",
  fillOpacity: 0.9,
}).addTo(map);

const userRadius = L.circle([user.lat, user.lng], {
  radius: 120,
  color: "#0f6fff",
  fillColor: "#69a6ff",
  fillOpacity: 0.15,
  weight: 1,
}).addTo(map);

function brandStyle(brandName) {
  const value = (brandName || "").toLowerCase();
  if (value.includes("circle")) {
    return { cls: "brand-circlek", label: "CK" };
  }
  if (value.includes("alexela")) {
    return { cls: "brand-alexela", label: "A" };
  }
  if (value.includes("olerex")) {
    return { cls: "brand-olerex", label: "O" };
  }
  if (value.includes("neste")) {
    return { cls: "brand-neste", label: "N" };
  }
  return { cls: "brand-default", label: "T" };
}

function parseTargetValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function hasPriceHit(station) {
  if (!station?.prices) {
    return false;
  }
  return (
    (alertTargets.diesel && station.prices.diesel != null && station.prices.diesel <= alertTargets.diesel) ||
    (alertTargets.premium95 && station.prices.premium95 != null && station.prices.premium95 <= alertTargets.premium95) ||
    (alertTargets.premium98 && station.prices.premium98 != null && station.prices.premium98 <= alertTargets.premium98)
  );
}

function stationMatchesActiveFilter(station) {
  if (activeMapFilter === "favorites") {
    return favorites.has(station.id);
  }
  if (activeMapFilter === "alerts") {
    return hasPriceHit(station);
  }
  return true;
}

function updateFilterButtonsState() {
  favoritesFilterBtn.classList.toggle("is-active", activeMapFilter === "favorites");
  alertFilterBtn.classList.toggle("is-active", activeMapFilter === "alerts");
  if (activeMapFilter === "favorites") {
    systemMessage.textContent = "Kuvatakse ainult lemmiktanklaid.";
  } else if (activeMapFilter === "alerts") {
    systemMessage.textContent = "Kuvatakse ainult hinnateavituse tingimustele vastavaid tanklaid.";
  } else {
    systemMessage.textContent = "";
  }
}

function toggleMapFilter(nextFilter) {
  activeMapFilter = activeMapFilter === nextFilter ? "all" : nextFilter;
  updateFilterButtonsState();
  fetchStations();
}

function createStationIcon(station) {
  const style = brandStyle(station.brand_name);
  const badges = [];
  if (favorites.has(station.id)) {
    badges.push('<span class="pin-badge favorite">★</span>');
  }
  if (hasPriceHit(station)) {
    badges.push('<span class="pin-badge alert-hit">✓</span>');
  }
  const html = `<div class="pin-wrap"><div class="brand-pin ${style.cls}"><span>${style.label}</span></div>${badges.join("")}</div>`;
  return L.divIcon({
    className: "station-div-icon",
    html,
    iconSize: [32, 42],
    iconAnchor: [16, 41],
  });
}

function saveFavorites() {
  const serialized = JSON.stringify([...favorites]);
  localStorage.setItem(favoritesStorageKey, serialized);
}

async function syncFavoriteAdd(stationId) {
  if (!ffToken) return;
  const res = await fetch("/api/me/favorites", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ station_id: stationId }),
  });
  if (!res.ok) {
    throw new Error("favorite-add-failed");
  }
}

async function syncFavoriteRemove(stationId) {
  if (!ffToken) return;
  const res = await fetch(`/api/me/favorites/${stationId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error("favorite-remove-failed");
  }
}

async function loadServerFavorites() {
  if (!ffToken) return;
  try {
    const res = await fetch("/api/me/favorites", { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();

    const serverIds = new Set(
      data.map((station) => Number(station.id)).filter((id) => Number.isFinite(id) && id > 0)
    );

    favorites.clear();
    serverIds.forEach((id) => favorites.add(id));
    saveFavorites();
  } catch {}
}

async function saveAlertTargets() {
  const serialized = JSON.stringify(alertTargets);
  localStorage.setItem(alertTargetsStorageKey, serialized);
  if (ffToken) {
    const res = await fetch("/api/me/alert-targets", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        diesel: alertTargets.diesel || null,
        premium95: alertTargets.premium95 || null,
        premium98: alertTargets.premium98 || null,
      }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error("Alert targets sync failed:", res.status, errorText);
      return false;
    }
    return true;
  }
  return true;
}

function renderAlertSummary() {
  const rows = [];
  if (alertTargets.diesel) rows.push(`Diisel <= ${alertTargets.diesel.toFixed(3)}`);
  if (alertTargets.premium95) rows.push(`95 <= ${alertTargets.premium95.toFixed(3)}`);
  if (alertTargets.premium98) rows.push(`98 <= ${alertTargets.premium98.toFixed(3)}`);

  alertsFeed.innerHTML = rows.length
    ? rows.map((row) => `<div class="alert-pill">${row}</div>`).join("")
    : '<p class="hint">Sihthinnad puuduvad. Ava Hinnateavitus menüüst.</p>';
}

function openAlertModal() {
  targetDieselInput.value = alertTargets.diesel ? alertTargets.diesel.toFixed(3) : "";
  target95Input.value = alertTargets.premium95 ? alertTargets.premium95.toFixed(3) : "";
  target98Input.value = alertTargets.premium98 ? alertTargets.premium98.toFixed(3) : "";
  alertModalResult.textContent = "";
  alertModal.classList.remove("hidden");
}

function closeAlertModal() {
  alertModal.classList.add("hidden");
}

function getPrice(details, fuelType) {
  const row = details.prices.find((p) => p.fuel_type === fuelType);
  return row ? Number(row.price) : null;
}

function setStationEditMode(enabled) {
  stationPriceDiesel.disabled = !enabled;
  stationPrice95.disabled = !enabled;
  stationPrice98.disabled = !enabled;
  stationSaveBtn.disabled = !enabled;
}

function updateFavoriteButtonText(stationId) {
  stationFavoriteBtn.textContent = favorites.has(stationId) ? "Eemalda lemmikutest" : "Pane lemmikutesse";
}

function fillStationPrices(details) {
  const diesel = getPrice(details, "diesel");
  const p95 = getPrice(details, "premium95");
  const p98 = getPrice(details, "premium98");
  stationPriceDiesel.value = diesel != null ? diesel.toFixed(3) : "";
  stationPrice95.value = p95 != null ? p95.toFixed(3) : "";
  stationPrice98.value = p98 != null ? p98.toFixed(3) : "";
}

function openStationModal(details) {
  const station = details.station;
  stationModalTitle.textContent = `${station.brand_name} - ${station.station_name}`;
  stationModalAddress.textContent = station.address;
  fillStationPrices(details);
  updateFavoriteButtonText(station.id);
  stationModalResult.textContent = "";
  setStationEditMode(false);
  stationModal.classList.remove("hidden");
}

function closeStationModal() {
  stationModal.classList.add("hidden");
}

function renderFavorites() {
  const ids = [...favorites];
  favoritesPanel.classList.toggle("has-favorites", ids.length > 0);
  if (!ids.length) {
    favoritesList.innerHTML = '<p class="hint">Lemmikuid pole veel lisatud.</p>';
    return;
  }

  favoritesList.innerHTML = ids
    .map((id) => {
      const station = stationCache.get(id);
      if (!station) return "";
      return `<button class="favorite-item" type="button" data-station-id="${id}"><strong>${station.brand_name} - ${station.station_name}</strong><span>${station.address}</span></button>`;
    })
    .join("");

  favoritesList.querySelectorAll(".favorite-item").forEach((node) => {
    node.addEventListener("click", async () => {
      await openStationDetails(Number(node.dataset.stationId), { openModal: true, focusMap: true });
    });
  });
}

function stationPopupHtml(details) {
  const station = details.station;
  const diesel = getPrice(details, "diesel");
  const p95 = getPrice(details, "premium95");
  const p98 = getPrice(details, "premium98");
  const favText = favorites.has(station.id) ? "Eemalda lemmikutest" : "Lisa lemmikutesse";

  return `
    <div class="popup-card">
      <strong>${station.brand_name} - ${station.station_name}</strong>
      <div class="popup-prices">
        <div class="popup-row"><span>Diisel</span><strong>${diesel != null ? diesel.toFixed(3) : "-"}</strong></div>
        <div class="popup-row"><span>95</span><strong>${p95 != null ? p95.toFixed(3) : "-"}</strong></div>
        <div class="popup-row"><span>98</span><strong>${p98 != null ? p98.toFixed(3) : "-"}</strong></div>
      </div>
      <div class="popup-actions">
        <button class="btn popup-btn" type="button" data-action="open-edit" data-station-id="${station.id}">Muuda hinda</button>
        <button class="btn popup-btn secondary" type="button" data-action="toggle-favorite" data-station-id="${station.id}">${favText}</button>
      </div>
    </div>
  `;
}

async function openStationDetails(stationId, options = {}) {
  const { openModal = false, focusMap = false } = options;
  const details = await fetch(`/api/stations/${stationId}`).then((r) => r.json());
  selectedStationDetails = details;
  const marker = markers.get(stationId);
  if (marker) {
    marker.setPopupContent(stationPopupHtml(details));
    marker.openPopup();
  }
  if (openModal) {
    openStationModal(details);
  }
  if (focusMap) {
    map.setView([details.station.lat, details.station.lng], 14);
  }
}

let mapBoundsSet = false;

async function fetchStations() {
  const baseParams = { lat: String(user.lat), lng: String(user.lng), sort: "closest", radius_km: "500" };
  const [dieselStations, p95Stations, p98Stations] = await Promise.all([
    fetch(`/api/stations?${new URLSearchParams({ ...baseParams, fuel_type: "diesel" }).toString()}`).then((r) => r.json()),
    fetch(`/api/stations?${new URLSearchParams({ ...baseParams, fuel_type: "premium95" }).toString()}`).then((r) => r.json()),
    fetch(`/api/stations?${new URLSearchParams({ ...baseParams, fuel_type: "premium98" }).toString()}`).then((r) => r.json()),
  ]);

  const merged = new Map();
  const upsert = (list, fuelType) => {
    list.forEach((station) => {
      const current = merged.get(station.id) || { ...station, prices: {} };
      current.prices = current.prices || {};
      current.prices[fuelType] = station.price;
      merged.set(station.id, current);
    });
  };
  upsert(dieselStations, "diesel");
  upsert(p95Stations, "premium95");
  upsert(p98Stations, "premium98");

  const stations = [...merged.values()];
  const visibleStations = stations.filter(stationMatchesActiveFilter);

  markers.forEach((marker) => map.removeLayer(marker));
  markers.clear();
  stationCache.clear();

  stations.forEach((station) => {
    stationCache.set(station.id, station);
  });

  visibleStations.forEach((station) => {
    const marker = L.marker([station.lat, station.lng], { icon: createStationIcon(station) }).addTo(map);
    marker.bindPopup('<div class="hint">Laen hindu...</div>', { autoPan: false });
    marker.on("click", async () => {
      await openStationDetails(station.id, { openModal: false, focusMap: false });
    });
    markers.set(station.id, marker);
  });

  if (visibleStations.length && !mapBoundsSet) {
    const bounds = L.latLngBounds(visibleStations.map((station) => [station.lat, station.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
    mapBoundsSet = true;
  }

  if (!visibleStations.length && activeMapFilter !== "all") {
    systemMessage.textContent = activeMapFilter === "favorites"
      ? "Lemmikute filtris pole veel ühtegi tanklat."
      : "Hinnateavituse filtris pole ühtegi vastet.";
  }

  renderFavorites();
}

function locateUser() {
  if (!navigator.geolocation) {
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      user = { ...user, lat: position.coords.latitude, lng: position.coords.longitude };
      userMarker.setLatLng([user.lat, user.lng]);
      userRadius.setLatLng([user.lat, user.lng]);
      userRadius.setRadius(Math.max(position.coords.accuracy || 100, 80));
      fetchStations();
    },
    () => {
      systemMessage.textContent = "Asukohaluba puudub, kasutan vaikimisi asukohta.";
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 }
  );
}

async function handleAlertTargetsSubmit(event) {
  event.preventDefault();
  alertTargets = {
    diesel: parseTargetValue(targetDieselInput.value),
    premium95: parseTargetValue(target95Input.value),
    premium98: parseTargetValue(target98Input.value),
  };
  try {
    const synced = await saveAlertTargets();
    alertModalResult.textContent = synced
      ? "Sihthinnad salvestatud."
      : "Sihthinnad salvestatud lokaalselt (serveri sünk ebaõnnestus).";
    alertModalResult.style.color = "#0f6fff";
    renderAlertSummary();
    closeAlertModal();
    fetchStations();
  } catch (error) {
    console.error("Alert save error:", error);
    const message = error.message || "Sihthindade salvestamine ebaõnnestus.";
    alertModalResult.textContent = message;
    alertModalResult.style.color = "#dc2626";
  }
}

async function saveStationPrices() {
  if (!selectedStationDetails) {
    stationModalResult.textContent = "Vali enne tankla kaardilt.";
    return;
  }

  const stationId = selectedStationDetails.station.id;
  const updates = [
    { fuel: "diesel", value: Number(stationPriceDiesel.value) },
    { fuel: "premium95", value: Number(stationPrice95.value) },
    { fuel: "premium98", value: Number(stationPrice98.value) },
  ].filter((item) => Number.isFinite(item.value) && item.value > 0);

  if (!updates.length) {
    stationModalResult.textContent = "Sisesta vähemalt üks korrektne hind.";
    return;
  }

  await Promise.all(
    updates.map((item) =>
      fetch("/api/prices/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          station_id: stationId,
          fuel_type: item.fuel,
          price: item.value,
          source: "community",
          user_id: user.id,
        }),
      })
    )
  );

  stationModalResult.textContent = "Hinnad uuendatud.";
  setStationEditMode(false);
  await fetchStations();
  await openStationDetails(stationId, { openModal: false, focusMap: false });
}

async function toggleFavoriteFromModal() {
  if (!selectedStationDetails) {
    return;
  }
  const id = selectedStationDetails.station.id;
  const wasFavorite = favorites.has(id);
  if (wasFavorite) {
    favorites.delete(id);
    try {
      await syncFavoriteRemove(id);
    } catch {
      favorites.add(id);
      stationModalResult.textContent = "Lemmiku eemaldamine ebaõnnestus. Proovi uuesti.";
      return;
    }
  } else {
    favorites.add(id);
    saveFavorites();
    try {
      await syncFavoriteAdd(id);
    } catch {
      stationModalResult.textContent = "Lemmik salvestati kohalikult. Serverisse sünk proovitakse uuesti hiljem.";
      updateFavoriteButtonText(id);
      await fetchStations();
      return;
    }
  }
  saveFavorites();
  updateFavoriteButtonText(id);
  stationModalResult.textContent = "";
  await fetchStations();
}

async function handlePopupAction(event) {
  const button = event.target.closest(".popup-btn");
  if (!button) {
    return;
  }

  const stationId = Number(button.dataset.stationId);
  if (!stationId) {
    return;
  }

  const action = button.dataset.action;
  if (action === "open-edit") {
    await openStationDetails(stationId, { openModal: true, focusMap: true });
    return;
  }

  if (action === "toggle-favorite") {
    const wasFavorite = favorites.has(stationId);
    if (wasFavorite) {
      favorites.delete(stationId);
      try {
        await syncFavoriteRemove(stationId);
      } catch {
        favorites.add(stationId);
        return;
      }
    } else {
      favorites.add(stationId);
      saveFavorites();
      try {
        await syncFavoriteAdd(stationId);
      } catch {
        await fetchStations();
        await openStationDetails(stationId, { openModal: false, focusMap: false });
        return;
      }
    }
    saveFavorites();
    await fetchStations();
    await openStationDetails(stationId, { openModal: false, focusMap: false });
  }
}

document.getElementById("refreshBtn").addEventListener("click", fetchStations);
favoritesFilterBtn.addEventListener("click", () => toggleMapFilter("favorites"));
alertFilterBtn.addEventListener("click", () => toggleMapFilter("alerts"));
checkAlertsBtn.addEventListener("click", openAlertModal);
closeAlertModalBtn.addEventListener("click", closeAlertModal);
alertTargetsForm.addEventListener("submit", handleAlertTargetsSubmit);
alertModal.addEventListener("click", (event) => {
  if (event.target === alertModal) closeAlertModal();
});

closeStationModalBtn.addEventListener("click", closeStationModal);
stationModal.addEventListener("click", (event) => {
  if (event.target === stationModal) closeStationModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!stationModal.classList.contains("hidden")) closeStationModal();
    else if (!alertModal.classList.contains("hidden")) closeAlertModal();
  }
});
stationUpdateBtn.addEventListener("click", () => {
  setStationEditMode(true);
  stationModalResult.textContent = "Muuda hindu ja vajuta Salvesta muudatused.";
});
stationSaveBtn.addEventListener("click", saveStationPrices);
stationFavoriteBtn.addEventListener("click", toggleFavoriteFromModal);
document.addEventListener("click", handlePopupAction);

renderAlertSummary();
updateFilterButtonsState();
clearLegacySharedStorage();

// ── Search Functionality ────────────────────────────────────────────────────
function performSearch(query) {
  if (!query.trim()) {
    searchResults.classList.add("hidden");
    searchResults.innerHTML = "";
    return;
  }

  const lowerQuery = query.toLowerCase();
  const results = [];
  
  stationCache.forEach((station) => {
    const name = (station.brand_name || "").toLowerCase();
    const addr = (station.address || "").toLowerCase();
    
    if (name.includes(lowerQuery) || addr.includes(lowerQuery)) {
      results.push(station);
    }
  });

  if (results.length === 0) {
    searchResults.innerHTML = '<div class="search-result-item" style="color: var(--muted); text-align: center;">Tanklaid ei leitud</div>';
    searchResults.classList.remove("hidden");
    return;
  }

  // Sort by relevance: exact name match first, then address match
  results.sort((a, b) => {
    const aNameMatch = (a.brand_name || "").toLowerCase().includes(lowerQuery);
    const bNameMatch = (b.brand_name || "").toLowerCase().includes(lowerQuery);
    if (aNameMatch && !bNameMatch) return -1;
    if (!aNameMatch && bNameMatch) return 1;
    return 0;
  });

  searchResults.innerHTML = results
    .slice(0, 8)
    .map((station) => {
      const diesel = station.prices?.diesel != null ? station.prices.diesel.toFixed(3) : "-";
      const p95 = station.prices?.premium95 != null ? station.prices.premium95.toFixed(3) : "-";
      const p98 = station.prices?.premium98 != null ? station.prices.premium98.toFixed(3) : "-";

      return `
        <div class="search-result-item" data-station-id="${station.id}">
          <div class="search-result-name">${station.brand_name} - ${station.station_name}</div>
          <div class="search-result-address">${station.address}</div>
          <div class="search-result-prices">
            <span class="search-result-price">D: ${diesel}€</span>
            <span class="search-result-price">95: ${p95}€</span>
            <span class="search-result-price">98: ${p98}€</span>
          </div>
        </div>
      `;
    })
    .join("");

  searchResults.classList.remove("hidden");

  // Add click handlers to results
  searchResults.querySelectorAll(".search-result-item").forEach((item) => {
    item.addEventListener("click", async () => {
      const stationId = Number(item.dataset.stationId);
      await openStationDetails(stationId, { openModal: false, focusMap: true });
      searchInput.value = "";
      searchResults.classList.add("hidden");
      searchResults.innerHTML = "";
    });
  });
}

// Close search results when clicking outside
document.addEventListener("click", (event) => {
  if (!event.target.closest("#searchContainer")) {
    searchResults.classList.add("hidden");
  }
});

// Search input listener with debounce
let searchTimeout;
searchInput.addEventListener("input", (event) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    performSearch(event.target.value);
  }, 200);
});

// Allow clicking search container without closing
searchInput.addEventListener("focus", (event) => {
  if (event.target.value.trim()) {
    performSearch(event.target.value);
  }
});

// Load server favorites + alert targets if logged in, then start app
async function initApp() {
  if (ffToken) {
    await loadServerFavorites();
    try {
      const res = await fetch("/api/me/alert-targets", { headers: authHeaders() });
      if (res.ok) {
        const serverTargets = normalizeAlertTargets(await res.json());
        alertTargets = serverTargets;
        const serialized = JSON.stringify(alertTargets);
        localStorage.setItem(alertTargetsStorageKey, serialized);
        renderAlertSummary();
      }
    } catch {}
  }
  
  // Fetch stations immediately with default location
  await fetchStations();
  
  // Then try to get user's actual location and refresh
  locateUser();
}

// Initialize app when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  // DOM is already ready
  initApp();
}
