
// State
let appState = {
    currentTab: 'world',
    feedData: [],
    summaries: {
        world: '',
        regional: ''
    },
    availableDates: [],
    currentIndex: -1
};

// Utils
function formatDate(dateStr) {
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

// Data Loading
async function loadData(dateStr) {
    const dataPath = `data/daily/${dateStr}`;

    // Update Loading State (Optional, but good for UX)
    document.getElementById('current-date').style.opacity = '0.5';

    try {
        // Load Feed
        const feedRes = await fetch(`${dataPath}/feed.json`);
        if (!feedRes.ok) throw new Error("Feed not found");
        const feedJson = await feedRes.json();
        appState.feedData = feedJson.articles;

        // Update Date Display
        // Prioritize Date in feed, fallback to folder name
        const displayDate = feedJson.date || dateStr;
        document.getElementById('current-date').textContent = formatDate(displayDate).replace(/\//g, '.');

        // Load Summaries
        try {
            const worldRes = await fetch(`${dataPath}/summary_world.md`);
            appState.summaries.world = worldRes.ok ? await worldRes.text() : "# No Summary";

            const regionalRes = await fetch(`${dataPath}/summary_regional.md`);
            appState.summaries.regional = regionalRes.ok ? await regionalRes.text() : "# No Summary";
        } catch (e) {
            console.warn("Summary load partial fail", e);
        }

        renderSummary();
        renderFeedList();

        // Update Stats
        document.getElementById('total-articles').textContent = appState.feedData.length;

        // Update Map
        if (window.initMap) {
            window.initMap(dataPath);
        }

    } catch (e) {
        console.error("Failed to load data", e);
        document.getElementById('summary-container').innerHTML = `<p class="error">Data not available for ${dateStr}</p>`;
        appState.feedData = [];
        renderFeedList();
        if (window.initMap) window.initMap(dataPath); // Clears map or try empty
    } finally {
        document.getElementById('current-date').style.opacity = '1';
        updateNavControls();
    }
}

// Rendering
function renderSummary() {
    const container = document.getElementById('summary-container');
    const content = appState.currentTab === 'world' ? appState.summaries.world : appState.summaries.regional;
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

        const dateObj = new Date(item.pubDate);
        const dateStr = dateObj.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        const titleHtml = item.titleJa
            ? `<div class="title-ja">${item.titleJa}</div><div class="title-sub">${item.title}</div>`
            : `<div class="title-ja">${item.title}</div>`;

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

// Navigation Logic
function updateNavControls() {
    const prevBtn = document.getElementById('nav-prev');
    const nextBtn = document.getElementById('nav-next');

    // If no index context, disable all
    if (appState.currentIndex === -1 || appState.availableDates.length === 0) {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
    }

    prevBtn.disabled = appState.currentIndex <= 0;
    nextBtn.disabled = appState.currentIndex >= appState.availableDates.length - 1;
}

function changeDate(offset) {
    const newIndex = appState.currentIndex + offset;
    if (newIndex >= 0 && newIndex < appState.availableDates.length) {
        appState.currentIndex = newIndex;
        loadData(appState.availableDates[newIndex]);
    }
}

// Global Tab Switcher (called by HTML onclick)
window.switchTab = function (tab) {
    appState.currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab === tab) btn.classList.add('active');
        else btn.classList.remove('active');
    });
    renderSummary();
};

// Resizer Logic
function initResizer() {
    const resizer = document.getElementById('drag-handle');
    const topSection = document.querySelector('.top-section');
    let isDragging = false;

    if (!resizer) return;

    resizer.addEventListener('mousedown', (e) => {
        isDragging = true;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'ns-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const containerHeight = window.innerHeight;
        const newHeight = e.clientY;
        if (newHeight > 100 && newHeight < containerHeight - 100) {
            topSection.style.height = `${newHeight}px`;
            if (map) map.invalidateSize();
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            if (map) map.invalidateSize();
        }
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    initResizer();

    // Setup Nav Listeners
    document.getElementById('nav-prev').addEventListener('click', () => changeDate(-1));
    document.getElementById('nav-next').addEventListener('click', () => changeDate(1));

    try {
        const res = await fetch('data/daily/available-dates.json');
        if (res.ok) {
            appState.availableDates = await res.json();
            if (appState.availableDates.length > 0) {
                appState.currentIndex = appState.availableDates.length - 1;
                loadData(appState.availableDates[appState.currentIndex]);
            } else {
                loadData(new Date().toISOString().split('T')[0]);
            }
        } else {
            console.warn("Date index not found, defaulting to hardcoded date.");
            loadData('2026-01-26');
        }
    } catch (e) {
        console.error("Init failed", e);
        loadData('2026-01-26');
    }
});
