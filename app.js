/* ═══════════════════════════════════════════
   Pampanga Transit Directory — Application
   ═══════════════════════════════════════════ */

const SHEET_ID = '1i4Amj5y3EL8uFA8SUrt8nB_i1XmI1BpN1_TovxZ2C6I';
const SHEET_GID = '1222594349';
const RAW_CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

const DEFAULT_FALLBACK_IMG =
  'https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80';

let masterlist = [];

// Geocode cache so we don't re-query Nominatim for the same place
const geocodeCache = {};

/* ══════════════════
   Utilities
   ══════════════════ */

function formatDriveImageUrl(url) {
  if (!url || typeof url !== 'string') return DEFAULT_FALLBACK_IMG;
  const clean = url.trim();
  if (!clean) return DEFAULT_FALLBACK_IMG;
  const idMatch = clean.match(/\/file\/d\/([^/]+)/) || clean.match(/id=([^&]+)/);
  if (idMatch && idMatch[1]) {
    return `https://lh3.googleusercontent.com/d/${idMatch[1]}`;
  }
  return clean;
}

function handleImageError(imgElem) {
  imgElem.onerror = null;
  imgElem.src = DEFAULT_FALLBACK_IMG;
}

function parseCurrencyNumber(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

function buildEmbedMapUrl(link, start, dest) {
  const query = `${start} to ${dest}, Pampanga`;
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&t=&z=13&ie=UTF8&iwloc=&output=embed`;
}

function buildDirectionsEmbedUrl(start, dest) {
  const saddr = (start || '').toLowerCase().includes('pampanga') ? start : `${start}, Pampanga`;
  const daddr = (dest || '').toLowerCase().includes('pampanga') ? dest : `${dest}, Pampanga`;
  return `https://maps.google.com/maps?saddr=${encodeURIComponent(saddr)}&daddr=${encodeURIComponent(daddr)}&output=embed`;
}

function buildDirectionsExternalUrl(start, dest) {
  const saddr = (start || '').toLowerCase().includes('pampanga') ? start : `${start}, Pampanga`;
  const daddr = (dest || '').toLowerCase().includes('pampanga') ? dest : `${dest}, Pampanga`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(saddr)}&destination=${encodeURIComponent(daddr)}`;
}

/* ══════════════════
   Haversine Distance
   ══════════════════ */

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Geocode a place name via OpenStreetMap Nominatim (free, no key).
 * Caches results to avoid duplicate lookups.
 */
async function geocode(place) {
  const key = place.trim().toLowerCase();
  if (geocodeCache[key]) return geocodeCache[key];

  try {
    const q = encodeURIComponent(place + ', Pampanga, Philippines');
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`, {
      headers: { 'Accept': 'application/json' }
    });
    const data = await res.json();
    if (data && data.length > 0) {
      const result = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      geocodeCache[key] = result;
      return result;
    }
  } catch (e) {
    console.warn('[Geocode] Failed for', place, e.message);
  }
  return null;
}

/**
 * Estimate distance and travel time between two place names.
 * Returns { km, roadKm, minutes } or null.
 */
async function estimateDistance(originName, destName) {
  const [originCoord, destCoord] = await Promise.all([
    geocode(originName),
    geocode(destName),
  ]);

  if (!originCoord || !destCoord) return null;

  const straightKm = haversineKm(originCoord.lat, originCoord.lon, destCoord.lat, destCoord.lon);
  // Road factor: roads in Pampanga are roughly 1.3x straight-line distance
  const roadKm = straightKm * 1.3;
  // Average jeepney speed ~25 km/h in mixed traffic
  const minutes = Math.round((roadKm / 25) * 60);

  return {
    km: straightKm,
    roadKm: Math.round(roadKm * 10) / 10,
    minutes,
  };
}

/* ══════════════════
   Google Maps API Integration
   ══════════════════ */

let googleMapsLoaded = false;
let distanceMatrixService = null;
const GMAP_STORAGE_KEY = 'pampanga_transit_gmap_api_key';

function getStoredApiKey() {
  const urlParams = new URLSearchParams(window.location.search);
  const fromUrl = urlParams.get('gmap_key') || urlParams.get('key');
  if (fromUrl) {
    try { localStorage.setItem(GMAP_STORAGE_KEY, fromUrl.trim()); } catch (e) {}
    return fromUrl.trim();
  }
  try {
    return (localStorage.getItem(GMAP_STORAGE_KEY) || '').trim();
  } catch (e) {
    return '';
  }
}

function initGoogleMapsApi(apiKey) {
  if (!apiKey) {
    googleMapsLoaded = false;
    distanceMatrixService = null;
    return;
  }

  if (window.google && window.google.maps) {
    googleMapsLoaded = true;
    distanceMatrixService = new google.maps.DistanceMatrixService();
    return;
  }

  const existingScript = document.getElementById('google-maps-script');
  if (existingScript) existingScript.remove();

  const script = document.createElement('script');
  script.id = 'google-maps-script';
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places,routes`;
  script.async = true;
  script.defer = true;
  script.onload = () => {
    googleMapsLoaded = true;
    distanceMatrixService = new google.maps.DistanceMatrixService();

    const startVal = document.getElementById('start-select').value;
    const destVal = document.getElementById('dest-select').value;
    if (startVal && destVal) {
      estimateAndShowDistance(startVal, destVal);
    }
  };
  script.onerror = () => {
    console.warn('[Google Maps] Failed to load script. Using GPS estimation fallback.');
    googleMapsLoaded = false;
    distanceMatrixService = null;
  };
  document.head.appendChild(script);
}

function calculateGoogleDistance(origin, dest) {
  return new Promise((resolve, reject) => {
    if (!distanceMatrixService) return reject(new Error('DistanceMatrixService not ready'));

    const originQuery = `${origin}, Pampanga, Philippines`;
    const destQuery = `${dest}, Pampanga, Philippines`;

    distanceMatrixService.getDistanceMatrix(
      {
        origins: [originQuery],
        destinations: [destQuery],
        travelMode: google.maps.TravelMode.TRANSIT,
        unitSystem: google.maps.UnitSystem.METRIC,
      },
      (response, status) => {
        if (status === 'OK' && response.rows && response.rows[0].elements[0].status === 'OK') {
          const el = response.rows[0].elements[0];
          resolve({
            roadKm: Math.round((el.distance.value / 1000) * 10) / 10,
            minutes: Math.round(el.duration.value / 60),
            source: 'Google Maps'
          });
        } else {
          // Fallback to DRIVING mode with a public transit factor
          distanceMatrixService.getDistanceMatrix(
            {
              origins: [originQuery],
              destinations: [destQuery],
              travelMode: google.maps.TravelMode.DRIVING,
              unitSystem: google.maps.UnitSystem.METRIC,
            },
            (dRes, dStatus) => {
              if (dStatus === 'OK' && dRes.rows && dRes.rows[0].elements[0].status === 'OK') {
                const el = dRes.rows[0].elements[0];
                resolve({
                  roadKm: Math.round((el.distance.value / 1000) * 10) / 10,
                  minutes: Math.round((el.duration.value / 60) * 1.25),
                  source: 'Google Maps'
                });
              } else {
                reject(new Error('No Google route found'));
              }
            }
          );
        }
      }
    );
  });
}

/* ══════════════════
   Tab Switching
   ══════════════════ */

function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  btn.classList.add('active');
}

/* ══════════════════
   Local Preload Data
   ══════════════════ */

const LOCAL_PRELOAD = [
  {
    "id": 1,
    "start": "SM City Pampanga Terminal",
    "destination": "Bayanihan Terminal (Angeles)",
    "terminal": "San Fernando to Angeles",
    "type": "Traditional Jeepney",
    "signboard": "Yellow/Green",
    "tagClass": "tag-traditional",
    "regularFare": 30,
    "studentFare": 24,
    "dropoff": "Get off at Bayanihan Terminal near Astro Park. Use the pedestrian overpass to cross to SM Clark.",
    "gmapLink": "https://maps.app.goo.gl/to3xW9fTrEzbN4Vb6",
    "landmarkName": "UWU",
    "landmarkDesc": "OWO",
    "landmarkImg": "https://lh3.googleusercontent.com/d/1whedF5L8G7aI0-6Vv5IbshbIB5udn9xk"
  },
  {
    "id": 2,
    "start": "San Fernando Intersection",
    "destination": "PamSU Bacolor Gate",
    "terminal": "San Fernando to Bacolor",
    "type": "Traditional Jeepney",
    "signboard": "Yellow - Guagua/Bacolor",
    "tagClass": "tag-traditional",
    "regularFare": 15,
    "studentFare": 12,
    "dropoff": "Tell the driver 'PamSU Gate.' Alight at the highway intersection and walk toward the main campus arch.",
    "gmapLink": "https://maps.app.goo.gl/rJs9bMKJzeJNNAGm6?g_st=ac",
    "landmarkName": "PamSU Bacolor Gate Terminal",
    "landmarkDesc": "Tell the driver 'PamSU Gate.' Alight at the highway intersection and walk toward the main campus arch.",
    "landmarkImg": "https://lh3.googleusercontent.com/d/1uJ82O9mwrCr-YsDsP-pXDg6nqMYqp43l"
  },
  {
    "id": 3,
    "start": "Nepo Mart / HAU",
    "destination": "Dau Bus Terminal",
    "terminal": "Angeles to Mabalacat",
    "type": "Modern Jeepney",
    "signboard": "White",
    "tagClass": "tag-modern",
    "regularFare": 25,
    "studentFare": 20,
    "dropoff": "Ride from the Nepo Quad terminal. Get off exactly at the Dau Mabalacat bus terminal along MacArthur Highway.",
    "gmapLink": "https://maps.app.goo.gl/szkQG3tTgZucv2uGA?g_st=ac",
    "landmarkName": "Dau Bus Terminal Terminal",
    "landmarkDesc": "Ride from the Nepo Quad terminal. Get off exactly at the Dau Mabalacat bus terminal along MacArthur Highway.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 4,
    "start": "Guagua Public Market",
    "destination": "PamSU Bacolor Gate",
    "terminal": "Guagua to Bacolor",
    "type": "Traditional Jeepney",
    "signboard": "San Fernando via Bacolor",
    "tagClass": "tag-traditional",
    "regularFare": 14,
    "studentFare": 11.2,
    "dropoff": "This is a minimum fare route. Get off at the Bacolor Public Market intersection right outside the campus.",
    "gmapLink": "https://maps.app.goo.gl/sdvQQffjUQgrJFXv8",
    "landmarkName": "PamSU Bacolor Gate Terminal",
    "landmarkDesc": "This is a minimum fare route. Get off at the Bacolor Public Market intersection right outside the campus.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 5,
    "start": "SM City Clark",
    "destination": "SM City Pampanga",
    "terminal": "Clark to San Fernando",
    "type": "UV Express",
    "signboard": "Point-to-Point",
    "tagClass": "tag-express",
    "regularFare": 100,
    "studentFare": 80,
    "dropoff": "Direct route with no stops. The drop-off is exactly at the transport terminal annex of SM City Pampanga.",
    "gmapLink": "https://maps.app.goo.gl/aXVBESe1LYvLLkon6?g_st=ac",
    "landmarkName": "SM City Pampanga Terminal",
    "landmarkDesc": "Direct route with no stops. The drop-off is exactly at the transport terminal annex of SM City Pampanga.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 6,
    "start": "Laguna",
    "destination": "SM City Pampanga",
    "terminal": "Sf to laguna",
    "type": "Bus",
    "signboard": "sa puso mo",
    "tagClass": "tag-express",
    "regularFare": 300,
    "studentFare": 240,
    "dropoff": "cubao",
    "gmapLink": "https://maps.app.goo.gl/GTunEDjDDZg7PjGG6",
    "landmarkName": "SM City Pampanga Terminal",
    "landmarkDesc": "cubao",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 10,
    "start": "San Fernando Intersection",
    "destination": "Guagua Public Market",
    "terminal": "San Fernando to Guagua",
    "type": "Traditional Jeepney",
    "signboard": "Guagua - San Fernando / Yellow",
    "tagClass": "tag-traditional",
    "regularFare": 22,
    "studentFare": 17.6,
    "dropoff": "Alight at Guagua Public Market terminal near the plaza and church.",
    "gmapLink": "[link removed]",
    "landmarkName": "Guagua Town Plaza",
    "landmarkDesc": "Main town center plaza adjacent to the historic church and market.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 11,
    "start": "Robinsons Starmills Terminal",
    "destination": "Sta. Cruz, Lubao",
    "terminal": "San Fernando to Lubao",
    "type": "Traditional Jeepney",
    "signboard": "Lubao - San Fernando / Red",
    "tagClass": "tag-traditional",
    "regularFare": 35,
    "studentFare": 28,
    "dropoff": "Drop off at the Lubao highway crossing in Sta. Cruz proper.",
    "gmapLink": "[link removed]",
    "landmarkName": "San Agustin Church",
    "landmarkDesc": "Historical baroque church situated in Lubao town proper.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 12,
    "start": "Angeles City Public Market",
    "destination": "Porac Town Center",
    "terminal": "Angeles to Porac",
    "type": "Traditional Jeepney",
    "signboard": "Porac - Angeles / Green",
    "tagClass": "tag-traditional",
    "regularFare": 28,
    "studentFare": 22.4,
    "dropoff": "Get off at the Porac town hall junction along the main avenue.",
    "gmapLink": "[link removed]",
    "landmarkName": "Porac Municipal Hall",
    "landmarkDesc": "Government municipal hall complex located in the town square.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 13,
    "start": "Marquee Mall Terminal",
    "destination": "Magalang Plaza",
    "terminal": "Angeles to Magalang",
    "type": "Modern Jeepney",
    "signboard": "Magalang - Angeles / Blue",
    "tagClass": "tag-modern",
    "regularFare": 25,
    "studentFare": 20,
    "dropoff": "Alight at Magalang Plaza right across from the municipal hall.",
    "gmapLink": "[link removed]",
    "landmarkName": "San Bartolome Church",
    "landmarkDesc": "Spanish-era parish church overlooking Magalang town plaza.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 14,
    "start": "SM City Pampanga Terminal",
    "destination": "Mexico Municipal Hall",
    "terminal": "San Fernando to Mexico",
    "type": "Traditional Jeepney",
    "signboard": "Mexico - San Fernando / White",
    "tagClass": "tag-traditional",
    "regularFare": 18,
    "studentFare": 14.4,
    "dropoff": "Tell driver Mexico Municipal Hall and alight in front of the gate.",
    "gmapLink": "[link removed]",
    "landmarkName": "Mexico Municipal Hall",
    "landmarkDesc": "Main local government center in Mexico, Pampanga.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 15,
    "start": "San Fernando Public Market",
    "destination": "Arayat Poblacion",
    "terminal": "San Fernando to Arayat",
    "type": "Traditional Jeepney",
    "signboard": "Arayat - San Fernando / Orange",
    "tagClass": "tag-traditional",
    "regularFare": 38,
    "studentFare": 30.4,
    "dropoff": "Alight at Arayat town proper near the foot of Mt. Arayat.",
    "gmapLink": "[link removed]",
    "landmarkName": "Mt. Arayat National Park",
    "landmarkDesc": "Renowned forested peak and national park landmark.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 16,
    "start": "Clark Main Gate Terminal",
    "destination": "Friendship Gate",
    "terminal": "Angeles to Clark (Main Gate to Friendship)",
    "type": "Traditional Jeepney",
    "signboard": "Friendship Highway / Gray",
    "tagClass": "tag-traditional",
    "regularFare": 15,
    "studentFare": 12,
    "dropoff": "Get off at Friendship Highway gate near the commercial district.",
    "gmapLink": "[link removed]",
    "landmarkName": "Friendship Highway Gate",
    "landmarkDesc": "Gateway hub connecting Angeles City and Clark Freeport.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 17,
    "start": "Dau Bus Terminal",
    "destination": "Magalang Town Plaza",
    "terminal": "Dau to Magalang",
    "type": "Traditional Jeepney",
    "signboard": "Dau - Magalang / Green",
    "tagClass": "tag-traditional",
    "regularFare": 25,
    "studentFare": 20,
    "dropoff": "Drop off at Magalang Town Plaza terminal next to the parish church.",
    "gmapLink": "[link removed]",
    "landmarkName": "Magalang Municipal Hall",
    "landmarkDesc": "Administrative government hub located by the main highway.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 18,
    "start": "San Fernando Intersection",
    "destination": "Apalit Public Market",
    "terminal": "San Fernando to Apalit",
    "type": "Traditional Jeepney",
    "signboard": "Apalit - San Fernando / Red",
    "tagClass": "tag-traditional",
    "regularFare": 32,
    "studentFare": 25.6,
    "dropoff": "Alight at Apalit Public Market along MacArthur Highway.",
    "gmapLink": "[link removed]",
    "landmarkName": "Apalit Public Market",
    "landmarkDesc": "Central commercial trading post for southern Pampanga.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 19,
    "start": "Guagua Public Market",
    "destination": "Floridablanca Town Center",
    "terminal": "Guagua to Floridablanca",
    "type": "Traditional Jeepney",
    "signboard": "Floridablanca - Guagua / Yellow",
    "tagClass": "tag-traditional",
    "regularFare": 20,
    "studentFare": 16,
    "dropoff": "Alight at Floridablanca Town Center near the municipal park.",
    "gmapLink": "[link removed]",
    "landmarkName": "Floridablanca Town Park",
    "landmarkDesc": "Recreational park beside the municipal administrative offices.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 20,
    "start": "San Fernando Public Market",
    "destination": "Santa Rita Eco-Park",
    "terminal": "San Fernando to Santa Rita",
    "type": "Traditional Jeepney",
    "signboard": "Santa Rita - San Fernando / White",
    "tagClass": "tag-traditional",
    "regularFare": 20,
    "studentFare": 16,
    "dropoff": "Drop off at Santa Rita Eco-Park along the provincial road.",
    "gmapLink": "[link removed]",
    "landmarkName": "Santa Rita Eco-Park",
    "landmarkDesc": "Community eco-park known for lush green scenery.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 21,
    "start": "Holy Rosary Parish (Angeles)",
    "destination": "SM City Telabastagan",
    "terminal": "Angeles to Telabastagan",
    "type": "Traditional Jeepney",
    "signboard": "Angeles - Telabastagan / Violet",
    "tagClass": "tag-traditional",
    "regularFare": 15,
    "studentFare": 12,
    "dropoff": "Alight directly at SM City Telabastagan passenger loading bay.",
    "gmapLink": "[link removed]",
    "landmarkName": "SM City Telabastagan",
    "landmarkDesc": "Major shopping mall located along MacArthur Highway.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 22,
    "start": "Mabalacat Bus Terminal",
    "destination": "Bamban Public Market",
    "terminal": "Mabalacat to Bamban",
    "type": "Traditional Jeepney",
    "signboard": "Mabalacat - Bamban / Blue",
    "tagClass": "tag-traditional",
    "regularFare": 22,
    "studentFare": 17.6,
    "dropoff": "Drop off at Bamban Public Market border terminal.",
    "gmapLink": "[link removed]",
    "landmarkName": "Bamban Town Center",
    "landmarkDesc": "Commercial strip bordering northern Pampanga and Tarlac.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 23,
    "start": "SM City Pampanga Terminal",
    "destination": "Macabebe Municipal Hall",
    "terminal": "San Fernando to Macabebe",
    "type": "UV Express",
    "signboard": "Macabebe - San Fernando / Blue",
    "tagClass": "tag-express",
    "regularFare": 45,
    "studentFare": 36,
    "dropoff": "Get off at Macabebe Municipal Hall near the town square.",
    "gmapLink": "[link removed]",
    "landmarkName": "San Nicolas de Tolentino Church",
    "landmarkDesc": "Historic heritage parish church in central Macabebe.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 24,
    "start": "Clark International Airport (CRK)",
    "destination": "Dau Bus Terminal",
    "terminal": "Clark Airport to Dau",
    "type": "Bus",
    "signboard": "Point-to-Point Shuttle / White",
    "tagClass": "tag-express",
    "regularFare": 50,
    "studentFare": 40,
    "dropoff": "Alight at Dau Bus Terminal passenger arrival bay.",
    "gmapLink": "[link removed]",
    "landmarkName": "Dau Bus Terminal",
    "landmarkDesc": "Primary intercity transit terminal for Central Luzon routes.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 25,
    "start": "Guagua Public Market",
    "destination": "Sasmuan Town Proper",
    "terminal": "Guagua to Sasmuan",
    "type": "Traditional Jeepney",
    "signboard": "Guagua - Sasmuan / Orange",
    "tagClass": "tag-traditional",
    "regularFare": 16,
    "studentFare": 12.8,
    "dropoff": "Alight at Sasmuan Town Proper near the municipal port.",
    "gmapLink": "[link removed]",
    "landmarkName": "Sasmuan Town Proper",
    "landmarkDesc": "Gateway dock to the coastal riverways and mangrove reserves.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 26,
    "start": "San Fernando Intersection",
    "destination": "San Simon Exit",
    "terminal": "San Fernando to San Simon",
    "type": "Traditional Jeepney",
    "signboard": "San Simon - San Fernando / Brown",
    "tagClass": "tag-traditional",
    "regularFare": 26,
    "studentFare": 20.8,
    "dropoff": "Tell driver San Simon Exit and alight by the toll gate intersection.",
    "gmapLink": "[link removed]",
    "landmarkName": "San Simon NLEX Exit",
    "landmarkDesc": "Major expressway interchange linking eastern Pampanga.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 27,
    "start": "SM City Clark",
    "destination": "Minalin Poblacion",
    "terminal": "Angeles to Minalin",
    "type": "UV Express",
    "signboard": "Angeles - Minalin / Yellow",
    "tagClass": "tag-express",
    "regularFare": 55,
    "studentFare": 44,
    "dropoff": "Alight at Minalin Poblacion near the municipal hall.",
    "gmapLink": "[link removed]",
    "landmarkName": "Santa Monica Parish Church",
    "landmarkDesc": "Iconic 400-year-old baroque church and tourist attraction.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 28,
    "start": "Robinsons Starmills Terminal",
    "destination": "Candaba Municipal Plaza",
    "terminal": "San Fernando to Candaba",
    "type": "UV Express",
    "signboard": "Candaba - San Fernando / Green",
    "tagClass": "tag-express",
    "regularFare": 60,
    "studentFare": 48,
    "dropoff": "Drop off at Candaba Municipal Plaza near the bird sanctuary road.",
    "gmapLink": "[link removed]",
    "landmarkName": "Candaba Swamp & Bird Sanctuary",
    "landmarkDesc": "Acclaimed freshwater marsh and migratory bird habitat.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  },
  {
    "id": 29,
    "start": "SM City Clark Terminal",
    "destination": "Subic Bay Freeport Zone",
    "terminal": "Clark to Subic",
    "type": "Bus",
    "signboard": "Clark - Subic Express / Red",
    "tagClass": "tag-express",
    "regularFare": 140,
    "studentFare": 112,
    "dropoff": "Alight at Subic Bay Freeport main transport terminal.",
    "gmapLink": "[link removed]",
    "landmarkName": "Subic Freeport Gate",
    "landmarkDesc": "Entry gateway to commercial duty-free zones and beach resorts.",
    "landmarkImg": "https://images.unsplash.com/photo-1541888946425-d0fbb186a5b3?auto=format&fit=crop&w=600&q=80"
  }
];

/* ══════════════════
   Fetch with Timeout & Proxies
   ══════════════════ */

async function fetchWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/* ══════════════════
   Google Sheets Real-Time Sync (JSONP & Direct Fallback)
   ══════════════════ */

function _gvizSyncCallback(json) {
  if (window._gvizTimeout) {
    clearTimeout(window._gvizTimeout);
    window._gvizTimeout = null;
  }
  const oldScript = document.getElementById('gviz-sync-script');
  if (oldScript) oldScript.remove();

  if (json && json.table && json.table.rows && json.table.rows.length > 0) {
    processGvizTable(json.table);
  } else {
    handleDirectFetchFallback();
  }
}
window._gvizSyncCallback = _gvizSyncCallback;

function processGvizTable(table) {
  const cols = (table.cols || []).map((c) => (c ? c.label || '' : '').trim().toLowerCase());

  const getColIndex = (...names) => {
    for (const name of names) {
      const idx = cols.findIndex((c) => c === name.toLowerCase());
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const startIdx = getColIndex('start', 'starting point', 'origin', 'from');
  const destIdx = getColIndex('destination', 'end point', 'to');
  const tripIdx = getColIndex('trip name', 'terminal', 'route');
  const typeIdx = getColIndex('vehicle type', 'type', 'vehicle');
  const signboardIdx = getColIndex('signboard / color', 'signboard');
  const regFareIdx = getColIndex('regular fare', 'regularfare', 'regular', 'fare');
  const studFareIdx = getColIndex('student fare', 'studentfare', 'student');
  const dropoffIdx = getColIndex('drop-off instructions', 'drop-off', 'instructions');
  const gmapLinkIdx = getColIndex('origin map link', 'google maps link', 'gmapurl', 'map link');
  const lmNameIdx = getColIndex('landmark name', 'landmarkname', 'landmark');
  const lmDescIdx = getColIndex('landmark description', 'landmarkdesc');
  const lmImgIdx = getColIndex('landmark image', 'landmarkimage', 'landmarkimg', 'image', 'photo');

  const getVal = (rowCells, idx) => {
    if (idx === -1 || !rowCells || !rowCells[idx]) return '';
    const cell = rowCells[idx];
    if (cell.v !== null && cell.v !== undefined) return cell.v;
    if (cell.f !== null && cell.f !== undefined) return cell.f;
    return '';
  };

  const parsedRoutes = table.rows
    .map((r, idx) => {
      const c = r.c || [];
      const start = String(getVal(c, startIdx) || '').trim();
      const dest = String(getVal(c, destIdx) || '').trim();
      const vehicleType = String(getVal(c, typeIdx) || 'Traditional Jeepney').trim();
      const regFare = parseCurrencyNumber(getVal(c, regFareIdx));
      const studFare = parseCurrencyNumber(getVal(c, studFareIdx));
      const landmarkImgRaw = String(getVal(c, lmImgIdx) || '').trim();

      let tagClass = 'tag-traditional';
      const vLower = vehicleType.toLowerCase();
      if (vLower.includes('modern')) tagClass = 'tag-modern';
      else if (vLower.includes('uv') || vLower.includes('bus')) tagClass = 'tag-express';

      const signboard = String(getVal(c, signboardIdx) || '').trim();
      const dropoff = String(getVal(c, dropoffIdx) || '').trim();
      const landmarkName = String(getVal(c, lmNameIdx) || '').trim() || dest;
      const landmarkDesc = String(getVal(c, lmDescIdx) || '').trim() || dropoff || 'Alight at the destination terminal.';

      return {
        id: idx + 1,
        start,
        destination: dest,
        terminal: String(getVal(c, tripIdx) || `${start} → ${dest}`).trim(),
        type: vehicleType,
        signboard,
        tagClass,
        regularFare: regFare,
        studentFare: studFare,
        dropoff,
        gmapLink: String(getVal(c, gmapLinkIdx) || '').trim(),
        gmapUrl: buildDirectionsEmbedUrl(start, dest),
        landmarkName,
        landmarkDesc,
        landmarkImg: formatDriveImageUrl(landmarkImgRaw),
      };
    })
    .filter((r) => r.start && r.destination && (r.regularFare > 0 || r.studentFare > 0));

  if (parsedRoutes.length > 0) {
    masterlist = parsedRoutes;

    const syncDot = document.getElementById('sync-dot');
    const syncLabel = document.getElementById('sync-label');
    const syncBtn = document.getElementById('sync-btn');

    syncDot.className = 'sync-dot live';
    syncLabel.textContent = 'Live';
    syncBtn.classList.remove('syncing');

    populateDropdownOptions();
    renderRouteCards(masterlist, 'all-routes-list');

    // Re-apply current selection if any
    const startVal = document.getElementById('start-select').value;
    const destVal = document.getElementById('dest-select').value;
    if (startVal && destVal) {
      handleRouteState(startVal, destVal);
    }
  } else {
    handleDirectFetchFallback();
  }
}

async function fetchBackendData() {
  const syncBtn = document.getElementById('sync-btn');
  const syncDot = document.getElementById('sync-dot');
  const syncLabel = document.getElementById('sync-label');

  syncBtn.classList.add('syncing');
  syncDot.className = 'sync-dot';
  syncLabel.textContent = 'Syncing…';

  // Strategy 1 (CORS-free JSONP via Google Visualization API)
  const oldScript = document.getElementById('gviz-sync-script');
  if (oldScript) oldScript.remove();

  const script = document.createElement('script');
  script.id = 'gviz-sync-script';
  const timestamp = Date.now();
  script.src = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=responseHandler:_gvizSyncCallback&gid=${SHEET_GID}&t=${timestamp}`;

  window._gvizTimeout = setTimeout(() => {
    if (script.parentNode) script.remove();
    console.warn('[Sync] JSONP timed out, trying direct fetch fallback...');
    handleDirectFetchFallback();
  }, 6000);

  script.onerror = (e) => {
    if (window._gvizTimeout) clearTimeout(window._gvizTimeout);
    if (script.parentNode) script.remove();
    console.warn('[Sync] JSONP script error, trying direct fetch fallback...');
    handleDirectFetchFallback();
  };

  document.head.appendChild(script);
}

async function handleDirectFetchFallback() {
  let csvText = null;
  try {
    csvText = await fetchWithTimeout(RAW_CSV_URL, 5000);
  } catch (e) {
    console.warn('[Sync] Direct CSV fetch failed:', e.message);
  }

  if (csvText) {
    processCSVString(csvText);
  } else {
    const syncDot = document.getElementById('sync-dot');
    const syncLabel = document.getElementById('sync-label');
    const syncBtn = document.getElementById('sync-btn');

    syncDot.className = 'sync-dot';
    syncLabel.textContent = 'Local';
    syncBtn.classList.remove('syncing');
  }
}

/* ══════════════════
   CSV Processing (Fallback)
   ══════════════════ */

function processCSVString(csvText) {
  Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    complete(results) {
      if (!results.data || results.data.length === 0) return;

      masterlist = results.data
        .map((row, idx) => {
          const get = (...keys) => {
            const rowKeys = Object.keys(row);
            for (const key of keys) {
              const found = rowKeys.find((k) => k.trim().toLowerCase() === key.toLowerCase());
              if (found && row[found] != null) return String(row[found]).trim();
            }
            return '';
          };

          const start = get('start', 'Starting Point', 'Origin', 'From') || '';
          const dest = get('Destination', 'End Point', 'To') || '';
          const vehicleType = get('Vehicle Type', 'Type', 'Vehicle') || 'Traditional Jeepney';

          const regFare = parseCurrencyNumber(get('Regular Fare', 'RegularFare', 'Regular', 'Fare'));
          const studFare = parseCurrencyNumber(get('Student Fare', 'StudentFare', 'Student'));
          const landmarkImgRaw = get('Landmark Image', 'LandmarkImage', 'LandmarkImg', 'Image', 'Photo');

          let tagClass = 'tag-traditional';
          if (vehicleType.toLowerCase().includes('modern')) tagClass = 'tag-modern';
          else if (vehicleType.toLowerCase().includes('uv') || vehicleType.toLowerCase().includes('bus')) tagClass = 'tag-express';

          return {
            id: idx + 1,
            start,
            destination: dest,
            terminal: get('Trip Name', 'Terminal', 'Route') || `${start} → ${dest}`,
            type: vehicleType,
            signboard: get('Signboard / Color', 'Signboard'),
            tagClass,
            regularFare: regFare,
            studentFare: studFare,
            dropoff: get('Drop-off Instructions', 'Drop-off', 'Instructions'),
            gmapLink: get('Origin Map Link', 'Google Maps Link', 'GMapUrl', 'Map Link'),
            gmapUrl: buildEmbedMapUrl(null, start, dest),
            landmarkName: get('Landmark Name', 'LandmarkName', 'Landmark') || `${dest} Terminal`,
            landmarkDesc: get('Landmark Description', 'LandmarkDesc') || get('Drop-off Instructions', 'Drop-off', 'Instructions') || 'Alight at the destination terminal.',
            landmarkImg: formatDriveImageUrl(landmarkImgRaw),
          };
        })
        .filter((r) => r.start && r.destination && (r.regularFare > 0 || r.studentFare > 0));

      const syncDot = document.getElementById('sync-dot');
      const syncLabel = document.getElementById('sync-label');
      const syncBtn = document.getElementById('sync-btn');

      syncDot.className = 'sync-dot live';
      syncLabel.textContent = 'Live';
      syncBtn.classList.remove('syncing');

      populateDropdownOptions();
      renderRouteCards(masterlist, 'all-routes-list');

      // Re-apply current selection if any
      const startVal = document.getElementById('start-select').value;
      const destVal = document.getElementById('dest-select').value;
      if (startVal && destVal) {
        onRouteSelectionChange();
      }
    },
  });
}

/* ══════════════════
   Dropdowns
   ══════════════════ */

function updateDestinationOptions(selectedStart, keepDest = '') {
  const destSel = document.getElementById('dest-select');
  destSel.innerHTML = '<option value="">Select destination…</option>';

  if (selectedStart) {
    // Only show destinations reachable from this origin
    const reachable = [...new Set(masterlist.filter((r) => r.start === selectedStart).map((r) => r.destination))].filter(Boolean).sort();
    reachable.forEach((d) => {
      destSel.innerHTML += `<option value="${d}">${d}</option>`;
    });

    // If keepDest is valid for this origin, preserve it
    if (keepDest && reachable.includes(keepDest)) {
      destSel.value = keepDest;
    } else {
      destSel.value = '';
    }
  } else {
    // Show all destinations
    const uniqueDests = [...new Set(masterlist.map((r) => r.destination))].filter(Boolean).sort();
    uniqueDests.forEach((d) => {
      destSel.innerHTML += `<option value="${d}">${d}</option>`;
    });
    if (keepDest) destSel.value = keepDest;
  }
}

function populateDropdownOptions() {
  const startSel = document.getElementById('start-select');
  const uniqueStarts = [...new Set(masterlist.map((r) => r.start))].filter(Boolean).sort();

  const prevStart = startSel.value;
  const prevDest = document.getElementById('dest-select').value;

  startSel.innerHTML = '<option value="">Select origin…</option>';
  uniqueStarts.forEach((s) => {
    startSel.innerHTML += `<option value="${s}">${s}</option>`;
  });

  startSel.value = prevStart;
  updateDestinationOptions(prevStart, prevDest);
}

/* ══════════════════
   Selection Handlers (Show fares only after destination is picked)
   ══════════════════ */

function onOriginChange() {
  const startVal = document.getElementById('start-select').value;
  const prevDest = document.getElementById('dest-select').value;
  updateDestinationOptions(startVal, prevDest);

  const destVal = document.getElementById('dest-select').value;
  handleRouteState(startVal, destVal);
}

function onDestinationChange() {
  const startVal = document.getElementById('start-select').value;
  const destVal = document.getElementById('dest-select').value;
  handleRouteState(startVal, destVal);
}

function onRouteSelectionChange() {
  onDestinationChange();
}

function handleRouteState(startVal, destVal) {
  const resultsPanel = document.getElementById('results-panel');
  const emptyPrompt = document.getElementById('empty-prompt');
  const emptyIcon = document.getElementById('empty-prompt-icon');
  const emptyTitle = document.getElementById('empty-prompt-title');
  const emptyDesc = document.getElementById('empty-prompt-desc');

  // If neither is selected
  if (!startVal && !destVal) {
    resultsPanel.style.display = 'none';
    emptyPrompt.style.display = 'block';
    if (emptyIcon) emptyIcon.textContent = '⟵ ⟶';
    if (emptyTitle) emptyTitle.textContent = 'Select origin & destination';
    if (emptyDesc) emptyDesc.textContent = 'Pick an origin and destination above to see fares, distance, drop-off guides, and matching rides.';
    return;
  }

  // If only origin is selected: show guidance to pick destination (fares remain hidden)
  if (startVal && !destVal) {
    resultsPanel.style.display = 'none';
    emptyPrompt.style.display = 'block';
    if (emptyIcon) emptyIcon.textContent = '⟶';
    if (emptyTitle) emptyTitle.textContent = `Origin: ${startVal}`;
    if (emptyDesc) emptyDesc.textContent = 'Now choose your destination landmark above to reveal exact fares, journey itinerary, and live navigation.';
    return;
  }

  // If only destination is selected
  if (!startVal && destVal) {
    resultsPanel.style.display = 'none';
    emptyPrompt.style.display = 'block';
    if (emptyIcon) emptyIcon.textContent = '⟵';
    if (emptyTitle) emptyTitle.textContent = `Destination: ${destVal}`;
    if (emptyDesc) emptyDesc.textContent = 'Select an origin station above to calculate fares and view available rides.';
    return;
  }

  // Both are selected: REVEAL results panel!
  updateRouteResults(startVal, destVal);
}

/* ══════════════════
   Swap Origin/Dest
   ══════════════════ */

function swapOriginDest() {
  const startSel = document.getElementById('start-select');
  const destSel = document.getElementById('dest-select');
  const prevStart = startSel.value;
  const prevDest = destSel.value;

  startSel.value = prevDest;
  updateDestinationOptions(prevDest, prevStart);
  destSel.value = prevStart;

  handleRouteState(startSel.value, destSel.value);
}

/* ══════════════════
   Render Route Results (Fares, Distance, Details)
   ══════════════════ */

function updateRouteResults(startVal, destVal) {
  const resultsPanel = document.getElementById('results-panel');
  const emptyPrompt = document.getElementById('empty-prompt');

  emptyPrompt.style.display = 'none';
  resultsPanel.style.display = 'block';

  // Filter matching rides
  const filtered = masterlist.filter((item) => item.start === startVal && item.destination === destVal);

  document.getElementById('route-count-value').textContent = filtered.length;

  if (filtered.length > 0) {
    const route = filtered[0]; // primary route

    // Fare comparison
    updateFareComparison(filtered);

    // Map & landmark
    updateRouteDetails(route);

    // Journey itinerary
    buildItinerary(route, filtered);

    // Matching rides list
    document.getElementById('matching-title').textContent = `Matching Rides (${filtered.length})`;
    renderRouteCards(filtered, 'matching-rides-list');
  } else {
    document.getElementById('matching-title').textContent = 'No Matching Rides';
    document.getElementById('matching-rides-list').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">—</div>
        <p>No direct routes found for this combination. Try different stops.</p>
      </div>`;

    // Clear fare cards
    document.getElementById('fare-regular').textContent = '—';
    document.getElementById('fare-student').textContent = '—';
    document.getElementById('fare-regular-breakdown').innerHTML = '';
    document.getElementById('fare-student-breakdown').innerHTML = '';
  }

  // Estimate distance (async — uses Google Maps if API key is active, or free GPS fallback)
  estimateAndShowDistance(startVal, destVal);
}

/* ══════════════════
   Fare Comparison
   ══════════════════ */

function updateFareComparison(routes) {
  // Use the cheapest route's fares
  const cheapest = routes.reduce((best, r) => r.regularFare < best.regularFare ? r : best, routes[0]);

  document.getElementById('fare-regular').textContent = `₱${cheapest.regularFare.toFixed(2)}`;
  document.getElementById('fare-student').textContent = `₱${cheapest.studentFare.toFixed(2)}`;

  const savings = cheapest.regularFare - cheapest.studentFare;

  // Breakdown - regular
  let regBreakdown = `
    <div class="fare-breakdown-row">
      <span class="label">Base fare (${cheapest.type})</span>
      <span class="value">₱${cheapest.regularFare.toFixed(2)}</span>
    </div>`;
  if (cheapest.signboard) {
    regBreakdown += `
    <div class="fare-breakdown-row">
      <span class="label">Signboard / Route color</span>
      <span class="value">${cheapest.signboard}</span>
    </div>`;
  }
  document.getElementById('fare-regular-breakdown').innerHTML = regBreakdown;

  // Breakdown - student
  let studBreakdown = `
    <div class="fare-breakdown-row">
      <span class="label">Discounted base fare</span>
      <span class="value">₱${cheapest.studentFare.toFixed(2)}</span>
    </div>
    <div class="fare-savings">
      <span class="label">You save</span>
      <span class="value">₱${savings.toFixed(2)}</span>
    </div>`;
  document.getElementById('fare-student-breakdown').innerHTML = studBreakdown;
}

/* ══════════════════
   Distance & Duration Calculation (Google Maps + Fallback)
   ══════════════════ */

async function estimateAndShowDistance(originName, destName) {
  const distEl = document.getElementById('dist-value');
  const timeEl = document.getElementById('time-value');

  distEl.textContent = '…';
  timeEl.textContent = '…';

  let result = null;

  // Strategy 1: Google Maps Distance Matrix API (if key configured)
  if (googleMapsLoaded && distanceMatrixService) {
    try {
      result = await calculateGoogleDistance(originName, destName);
    } catch (e) {
      console.warn('[Distance] Google Maps calculation failed, falling back to GPS:', e.message);
    }
  }

  // Strategy 2: Free OpenStreetMap + Haversine fallback
  if (!result) {
    result = await estimateDistance(originName, destName);
  }

  if (result) {
    distEl.textContent = `~${result.roadKm} km`;
    timeEl.textContent = `~${result.minutes} min`;
  } else {
    distEl.textContent = '—';
    timeEl.textContent = '—';
  }
}

/* ══════════════════
   Journey Itinerary
   ══════════════════ */

function buildItinerary(route, allRoutes) {
  const stepsEl = document.getElementById('itinerary-steps');
  const totalEl = document.getElementById('itinerary-total');

  const vehicleLower = route.type.toLowerCase();
  let badgeClass = 'jeep';
  if (vehicleLower.includes('modern')) badgeClass = 'modern';
  else if (vehicleLower.includes('uv')) badgeClass = 'uv';
  else if (vehicleLower.includes('bus')) badgeClass = 'bus';

  const steps = [];

  // Step 1: Walk to terminal
  steps.push({
    icon: 'walk',
    title: `Walk to ${route.start}`,
    desc: route.signboard ? `Look for the "${route.signboard}" signboard at the terminal.` : 'Head to the boarding terminal.',
    time: '~2 min',
  });

  // Step 2: Board vehicle
  steps.push({
    icon: 'board',
    title: `Board ${route.type}`,
    titleBadge: { text: route.signboard || route.type, class: badgeClass },
    desc: `Regular ₱${route.regularFare.toFixed(2)} · Student ₱${route.studentFare.toFixed(2)}`,
    time: '',
  });

  // Step 3: Drop-off
  if (route.dropoff) {
    steps.push({
      icon: 'arrive',
      title: `Drop-off: ${route.destination}`,
      desc: route.dropoff,
      time: '',
    });
  }

  // Step 4: Arrive
  steps.push({
    icon: 'arrive',
    title: `Arrive at ${route.landmarkName || route.destination}`,
    desc: route.landmarkDesc || 'You have reached your destination.',
    time: '',
  });

  totalEl.textContent = `${steps.length} steps`;

  stepsEl.innerHTML = steps.map((s) => {
    const badge = s.titleBadge
      ? `<span class="vehicle-badge ${s.titleBadge.class}">${s.titleBadge.text}</span>`
      : '';
    return `
      <div class="itinerary-step">
        <div class="step-icon ${s.icon}">${s.icon === 'walk' ? 'W' : s.icon === 'board' ? 'B' : 'A'}</div>
        <div class="step-content">
          <div class="step-title">${s.title} ${badge}</div>
          <div class="step-desc">${s.desc}</div>
        </div>
        ${s.time ? `<div class="step-time">${s.time}</div>` : ''}
      </div>`;
  }).join('');
}

/* ══════════════════
   Route Selection from List
   ══════════════════ */

function selectRouteFromList(route) {
  document.getElementById('start-select').value = route.start;
  updateDestinationOptions(route.start, route.destination);
  document.getElementById('dest-select').value = route.destination;

  const findBtn = document.getElementById('nav-btn-find');
  switchTab('tab-find', findBtn);

  handleRouteState(route.start, route.destination);
}

/* ══════════════════
   Render Route Cards
   ══════════════════ */

function renderRouteCards(data, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  if (data.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">—</div>
        <p>No matching routes found.</p>
      </div>`;
    return;
  }

  data.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'route-card';
    card.onclick = () => selectRouteFromList(item);

    const signboardHtml = item.signboard
      ? `<div class="route-signboard">${item.signboard}</div>`
      : '';

    card.innerHTML = `
      <div class="route-header">
        <div>
          <div class="route-title">${item.start} → ${item.destination}</div>
          <div class="route-sub">${item.terminal}</div>
          ${signboardHtml}
        </div>
        <span class="tag ${item.tagClass}">${item.type}</span>
      </div>
      <div class="route-meta">
        <span class="fare-regular">₱${item.regularFare.toFixed(2)}</span>
        <span class="fare-student">₱${item.studentFare.toFixed(2)}</span>
      </div>`;

    container.appendChild(card);
  });
}

/* ══════════════════
   Route Detail View
   ══════════════════ */

function updateRouteDetails(route) {
  document.getElementById('active-route-name').textContent = `${route.start} → ${route.destination}`;
  const embedUrl = buildDirectionsEmbedUrl(route.start, route.destination);
  document.getElementById('gmap-frame').src = embedUrl;
  document.getElementById('landmark-name').textContent = route.landmarkName;
  document.getElementById('landmark-desc').textContent = route.landmarkDesc;

  const mapLinkBtn = document.getElementById('open-map-link');
  const extUrl = route.gmapLink || buildDirectionsExternalUrl(route.start, route.destination);
  mapLinkBtn.href = extUrl;
  mapLinkBtn.style.display = 'inline-flex';

  const img = document.getElementById('landmark-image');
  img.src = route.landmarkImg;
}

/* ══════════════════
   Route Map Modal (Option A)
   ══════════════════ */

function openRouteMapModal() {
  const startVal = document.getElementById('start-select').value;
  const destVal = document.getElementById('dest-select').value;
  if (!startVal || !destVal) return;

  const modal = document.getElementById('route-map-modal');
  const titleEl = document.getElementById('modal-route-title');
  const distEl = document.getElementById('modal-dist-val');
  const timeEl = document.getElementById('modal-time-val');
  const frameEl = document.getElementById('modal-gmap-frame');
  const gmapsLink = document.getElementById('modal-open-gmaps');
  const hintEl = document.getElementById('modal-landmark-hint');

  titleEl.textContent = `${startVal} → ${destVal}`;
  distEl.textContent = document.getElementById('dist-value').textContent || '—';
  timeEl.textContent = document.getElementById('time-value').textContent || '—';

  const activeRoute = masterlist.find((r) => r.start === startVal && r.destination === destVal);
  if (activeRoute && activeRoute.landmarkName) {
    hintEl.textContent = `Alight at: ${activeRoute.landmarkName}`;
  } else {
    hintEl.textContent = 'Alight at destination drop-off point';
  }

  frameEl.src = buildDirectionsEmbedUrl(startVal, destVal);
  gmapsLink.href = (activeRoute && activeRoute.gmapLink) || buildDirectionsExternalUrl(startVal, destVal);

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeRouteMapModal(e) {
  if (e && e.target) {
    const isCloseBtn = e.target.closest('.modal-close-btn') || e.target.closest('.modal-close-action') || e.target.getAttribute('data-action') === 'close';
    const isBackdrop = e.target.id === 'route-map-modal' || e.target.classList.contains('modal-backdrop');
    if (!isCloseBtn && !isBackdrop) {
      return;
    }
  }
  const modal = document.getElementById('route-map-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeRouteMapModal();
  }
});

/* ══════════════════
   Search (All Routes tab)
   ══════════════════ */

function searchAllRoutes() {
  const q = document.getElementById('search-input').value.toLowerCase();
  const filtered = masterlist.filter((item) =>
    item.start.toLowerCase().includes(q) ||
    item.destination.toLowerCase().includes(q) ||
    item.terminal.toLowerCase().includes(q) ||
    item.landmarkName.toLowerCase().includes(q) ||
    item.type.toLowerCase().includes(q) ||
    (item.signboard && item.signboard.toLowerCase().includes(q)) ||
    (item.dropoff && item.dropoff.toLowerCase().includes(q))
  );
  renderRouteCards(filtered, 'all-routes-list');
}

/* ══════════════════
   Bootstrap
   ══════════════════ */

function loadPreloadData() {
  masterlist = LOCAL_PRELOAD;
  populateDropdownOptions();
  renderRouteCards(masterlist, 'all-routes-list');

  document.getElementById('sync-dot').className = 'sync-dot';
  document.getElementById('sync-label').textContent = 'Local';
}

window.addEventListener('DOMContentLoaded', () => {
  loadPreloadData();
  fetchBackendData();
  const apiKey = getStoredApiKey();
  if (apiKey) {
    initGoogleMapsApi(apiKey);
  }
});
