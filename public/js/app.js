
// App Configuration
const APP_CONFIG = {
    dataPath: 'data/daily/2026-01-26', // Dynamic date in prod, hardcoded for demo
    defaultTab: 'world'
};

// State
let appState = {
    currentTab: APP_CONFIG.defaultTab,
    feedData: [],
    summaries: {
        world: '',
        regional: ''
    }
};

// Utils
function formatDate(dateStr) {
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

async function loadData() {
    try {
        // Load Feed
        const feedRes = await fetch(`${APP_CONFIG.dataPath}/feed.json`);
        const feedJson = await feedRes.json();
        appState.feedData = feedJson.articles;

        // Update header date if available
        if (feedJson.date) {
            document.getElementById('current-date').textContent = formatDate(feedJson.date);
        }

        // Load Summaries
        const worldRes = await fetch(`${APP_CONFIG.dataPath}/summary_world.md`);
        appState.summaries.world = await worldRes.text();

        const regionalRes = await fetch(`${APP_CONFIG.dataPath}/summary_regional.md`);
        appState.summaries.regional = await regionalRes.text();

        renderSummary();
        renderFeedList();

        // Stats
        document.getElementById('total-articles').textContent = appState.feedData.length;

    } catch (e) {
        console.error("Failed to load data", e);
        document.getElementById('summary-container').innerHTML = `<p class="error">Failed to load data. Please check console.</p>`;
    }
}

function renderSummary() {
    const container = document.getElementById('summary-container');
    const content = appState.currentTab === 'world' ? appState.summaries.world : appState.summaries.regional;

    // Use marked to parse markdown
    container.innerHTML = marked.parse(content);
}

function renderFeedList() {
    const list = document.getElementById('feed-list');
    list.innerHTML = '';

    // Sort by Date (newest first)
    const sorted = [...appState.feedData].sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    sorted.slice(0, 50).forEach(item => {
        const li = document.createElement('li');
        li.className = 'feed-item';

        // Format date: "1/26 14:00"
        const dateObj = new Date(item.pubDate);
        const dateStr = dateObj.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        const titleHtml = item.titleJa
            ? `<div class="title-ja">${item.titleJa}</div><div class="title-sub">${item.title}</div>`
            : `<div class="title-ja">${item.title}</div>`; // Fallback to raw title if no translation

        li.innerHTML = `
            <div class="meta">
                <span class="source">${item.source}</span>
                <span class="date">${dateStr}</span>
                <span class="country badge">${item.country || 'Global'}</span>
            </div>
            <a href="${item.link}" target="_blank" class="title-link">
                ${titleHtml}
            </a>
        `;

        // Interaction: Hover to highlight map
        if (item.country && item.country !== 'XX') {
            li.addEventListener('mouseenter', () => {
                if (window.highlightCountry) window.highlightCountry(item.country);
            });
            li.addEventListener('mouseleave', () => {
                if (window.resetHighlightCountry) window.resetHighlightCountry(item.country);
            });
        }

        list.appendChild(li);
    });
}

function switchTab(tab) {
    appState.currentTab = tab;

    // Update buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab === tab) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    renderSummary();
}

// Resizer Logic
function initResizer() {
    const resizer = document.getElementById('drag-handle');
    const topSection = document.querySelector('.top-section');
    const bottomSection = document.getElementById('bottom-panel');
    let isDragging = false;

    resizer.addEventListener('mousedown', (e) => {
        isDragging = true;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'ns-resize';
        e.preventDefault(); // Prevent text selection
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        // Calculate new height for top section
        // Constrain between 20vh and 80vh
        const containerHeight = window.innerHeight;
        const newHeight = e.clientY;

        if (newHeight > 100 && newHeight < containerHeight - 100) {
            topSection.style.height = `${newHeight}px`;

            // Invalidate map size on drag (throttle this if performance issues occur)
            if (window.initMap && map) map.invalidateSize();
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            // Final resize check
            if (map) map.invalidateSize();
        }
    });
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    // Initialize Map (from map-renderer.js)
    if (window.initMap) window.initMap(APP_CONFIG.dataPath);

    // Initialize Resizer
    initResizer();
});
