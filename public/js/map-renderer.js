// Map Renderer using Leaflet

let map;
let geoJsonLayer;

// Simple ISO-2 to ISO-3 mapping for major countries
const isoMapping = {
    'US': 'USA', 'JP': 'JPN', 'CN': 'CHN', 'RU': 'RUS', 'GB': 'GBR', 'FR': 'FRA', 'DE': 'DEU',
    'IN': 'IND', 'BR': 'BRA', 'ZA': 'ZAF', 'EG': 'EGY', 'NG': 'NGA', 'KE': 'KEN', 'AU': 'AUS',
    'CA': 'CAN', 'MX': 'MEX', 'KR': 'KOR', 'KP': 'PRK', 'ID': 'IDN', 'PH': 'PHL', 'VN': 'VNM',
    'TR': 'TUR', 'SA': 'SAU', 'IR': 'IRN', 'IL': 'ISR', 'UA': 'UKR', 'PL': 'POL', 'IT': 'ITA',
    'ES': 'ESP', 'NL': 'NLD', 'SE': 'SWE', 'NO': 'NOR', 'FI': 'FIN', 'MZ': 'MOZ', 'VE': 'VEN',
    'MM': 'MMR', 'TH': 'THA', 'MY': 'MYS', 'SG': 'SGP', 'PK': 'PAK', 'BD': 'BGD', 'LK': 'LKA'
};

window.initMap = async (dataPath) => {
    // Basic setup
    map = L.map('world-map', {
        center: [20, 0],
        zoom: 2,
        zoomControl: false,
        attributionControl: true
    });

    // Dark tiles (CartoDB Dark Matter) - Free & Nice
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    // Add Zoom Control
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Force resize calculation after init
    setTimeout(() => {
        map.invalidateSize();
    }, 100);

    // Handle window resize
    window.addEventListener('resize', () => {
        if (map) map.invalidateSize();
    });

    try {
        // Load Map Stats
        const statsRes = await fetch(`${dataPath}/map.json`);
        const stats = await statsRes.json();

        // Load GeoJSON
        const geoRes = await fetch('assets/world.geo.json');
        const geoData = await geoRes.json();

        // Simple ISO-2 to ISO-3 mapping (Moved to global scope)

        // Style function
        function style(feature) {
            let count = 0;
            const featureId = feature.id; // ISO-3 (e.g. USA)

            // Find corresponding ISO-2 key from stats
            // We look for a key in `stats` (which uses ISO-2 like 'US') that maps to this feature's ISO-3 ID
            const iso2Key = Object.keys(stats).find(key => isoMapping[key] === featureId);

            if (iso2Key && stats[iso2Key]) {
                count = stats[iso2Key].count;
            }
            // Fallback for direct match if backend starts sending ISO-3
            else if (stats[featureId]) {
                count = stats[featureId].count;
            }

            return {
                fillColor: getColor(count),
                weight: 1,
                opacity: 1,
                color: '#334155', // Border
                dashArray: '',
                fillOpacity: 0.7
            };
        }

        // Add Layer
        geoJsonLayer = L.geoJson(geoData, {
            style: style,
            onEachFeature: onEachFeature
        }).addTo(map);

        function onEachFeature(feature, layer) {
            // Interactive effects
            layer.on({
                mouseover: highlightFeature,
                mouseout: resetHighlight,
                click: zoomToFeature
            });

            // Tooltip Logic
            const featureId = feature.id; // ISO-3
            // Lookup stats using mapping
            const iso2Key = Object.keys(stats).find(key => isoMapping[key] === featureId);
            const stat = iso2Key ? stats[iso2Key] : (stats[featureId] || null);

            if (stat && stat.topArticle) {
                layer.bindPopup(`
                    <div style="min-width: 200px;">
                        <b style="font-size:1.1em; color:#fff">${feature.properties.name}</b><br>
                        <span style="color:#aaa; font-size:0.9em">${stat.count} Articles</span>
                        <hr style="border:0; border-top:1px solid #444; margin:8px 0;">
                        <span style="font-size:0.8em; color: #3b82f6; text-transform:uppercase; letter-spacing:0.5px">Top Story:</span><br>
                        <a href="${stat.topArticle.link}" target="_blank" style="color:#e0e6ed; text-decoration:none; display:block; margin-top:4px; font-weight:600; line-height:1.4">${stat.topArticle.title}</a>
                        <span style="display:block; margin-top:4px; color:#666; font-size:0.75em">${stat.topArticle.source}</span>
                    </div>
                `);
            }
        }

    } catch (e) {
        console.error("Failed to init map", e);
    }
};

// Colors based on intensity
function getColor(d) {
    return d > 10 ? '#3b82f6' :
        d > 5 ? '#60a5fa' :
            d > 2 ? '#93c5fd' :
                d > 0 ? '#1e3a8a' : // Low activity
                    '#1a1d23';  // None (transparent-ish)
}

// Expose Highlight Function for External Use (e.g. from Feed List)
window.highlightCountry = (iso2Code) => {
    if (!geoJsonLayer || !iso2Code) return;

    const iso3 = isoMapping[iso2Code];
    if (!iso3) return;

    geoJsonLayer.eachLayer(layer => {
        if (layer.feature.id === iso3) {
            // Programmatic highlight
            highlightFeature({ target: layer });

            // Optional: Pan to country if needed, but might be too jumpy
            // map.panTo(layer.getBounds().getCenter()); 

            // Show popup?
            // layer.openPopup();
        }
    });
};

window.resetHighlightCountry = (iso2Code) => {
    if (!geoJsonLayer) return;
    geoJsonLayer.eachLayer(layer => {
        geoJsonLayer.resetStyle(layer);
    });
};

function highlightFeature(e) {
    var layer = e.target;
    layer.setStyle({
        weight: 2,
        color: '#fff',
        dashArray: '',
        fillOpacity: 0.9
    });
    if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
        layer.bringToFront();
    }
}

function resetHighlight(e) {
    geoJsonLayer.resetStyle(e.target);
}

function zoomToFeature(e) {
    map.fitBounds(e.target.getBounds());
}

