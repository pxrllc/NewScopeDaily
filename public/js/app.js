
// State
let appState = {
    currentTab: 'world',
    feedData: [],
    summaries: {
        world: '',
        regional: ''
    },
    availableDates: [],
    currentIndex: -1,
    currentFilter: 'all' // New: Filter state
};

// Utils
function formatDate(dateStr) {
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

// Data Loading
async function loadData(dateStr) {
    const dataPath = `data/daily/${dateStr}`;

    // Update Loading State
    document.getElementById('current-date').style.opacity = '0.5';

    try {
        // Load Feed
        const feedRes = await fetch(`${dataPath}/feed.json`);
        if (!feedRes.ok) throw new Error("Feed not found");
        const feedJson = await feedRes.json();
        appState.feedData = feedJson.articles;

        // Reset Filter on new day load
        appState.currentFilter = 'all';

        // Update Date Display
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

        renderFilterBar(); // New: Generate filter buttons
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
        renderFilterBar();
        if (window.initMap) window.initMap(dataPath);
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

const categoryMap = {
    'Politics': '政治',
    'Economy': '経済',
    'Society': '社会',
    'Conflict': '紛争',
    'Science': '科学',
    'Environment': '環境',
    'Disaster': '災害',
    'Sports': 'スポーツ',
    'Entertainment': 'エンタメ'
};

function renderFilterBar() {
    const container = document.getElementById('filter-container');
    if (!container) return;

    container.innerHTML = '';

    // Extract unique categories
    const categories = new Set();
    appState.feedData.forEach(item => {
        if (item.category) categories.add(item.category);
    });

    // Sort categories alphabetically
    const sortedCategories = Array.from(categories).sort();

    // Create "All" button
    const allBtn = document.createElement('button');
    allBtn.className = `filter-btn ${appState.currentFilter === 'all' ? 'active' : ''}`;
    allBtn.textContent = 'すべて';
    allBtn.onclick = () => setFilter('all');
    container.appendChild(allBtn);

    // Create Category buttons
    sortedCategories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = `filter-btn ${appState.currentFilter === cat ? 'active' : ''}`;

        // Translate category
        const label = categoryMap[cat] || cat;

        btn.textContent = label;
        btn.onclick = () => setFilter(cat);
        container.appendChild(btn);
    });
}

function setFilter(category) {
    appState.currentFilter = category;
    renderFilterBar(); // Re-render to update active state
    renderFeedList();
}

function renderFeedList() {
    const list = document.getElementById('feed-list');
    list.innerHTML = '';

    // Filter Data
    let filteredData = appState.feedData;
    if (appState.currentFilter !== 'all') {
        filteredData = filteredData.filter(item => item.category === appState.currentFilter);
    }

    // Sort by Date (newest first)
    const sorted = [...filteredData].sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

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
                ${item.category ? `<span class="category badge">${categoryMap[item.category] || item.category}</span>` : ''}
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

