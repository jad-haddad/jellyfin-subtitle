(function () {
    'use strict';

    // --- Configuration ---
    const PLUGIN_GUID = 'd6c7b3a1-4e2f-4a8b-9c5d-8e1f2a3b4c5d';
    const API_BASE = '/SubtitleGenerator';

    let dialogOverlay = null;
    let currentItemId = null;
    let currentJobId = null;
    let pollTimer = null;
    let pluginConfig = null;
    let currentAudioStreams = [];

    // --- Dialog HTML ---
    const DIALOG_HTML = `
        <div class="subtitle-generator-dialog-overlay" id="sg-dialog-overlay">
            <div class="subtitle-generator-dialog">
                <h2>Generate Subtitle</h2>
                <div class="subtitle-generator-content">
                    <div class="inputContainer">
                        <label class="inputLabel">Language</label>
                        <select id="sg-language-select"></select>
                    </div>
                    <div id="sg-progress" class="subtitle-generator-progress" style="display:none;">
                        <div class="progress-container">
                            <div class="progress-bar" id="sg-progress-bar"></div>
                        </div>
                        <div class="progress-text" id="sg-progress-text">Submitting...</div>
                    </div>
                    <div id="sg-error" class="subtitle-generator-error" style="display:none;"></div>
                </div>
                <div class="subtitle-generator-actions">
                    <button class="button-cancel" id="sg-cancel-btn">Cancel</button>
                    <button class="button-submit" id="sg-generate-btn">Generate</button>
                </div>
            </div>
        </div>
    `;

    // --- Initialization ---
    function init() {
        loadConfig();
        observePageChanges();
    }

    async function loadConfig() {
        try {
            const res = await fetch(`${API_BASE}/Config`);
            if (res.ok) {
                pluginConfig = await res.json();
            }
        } catch (e) {
            console.warn('[SubtitleGenerator] Failed to load config:', e);
        }
    }

    // --- Page observation ---
    function observePageChanges() {
        let lastPath = location.hash;

        function check() {
            const currentPath = location.hash;
            if (currentPath !== lastPath) {
                lastPath = currentPath;
                setTimeout(processCurrentPage, 500);
            }
        }

        setInterval(check, 300);

        // Also check on initial load
        setTimeout(processCurrentPage, 1000);
    }

    async function processCurrentPage() {
        const hash = location.hash;
        const match = hash.match(/\/details\?id=([a-f0-9\-]+)/i);

        if (!match) {
            return;
        }

        const itemId = match[1];
        currentItemId = itemId;

        // Wait for detail page to render
        await waitForElement('.detailPageContent');

        // Check if button already injected
        if (document.querySelector('.subtitle-generator-btn')) {
            return;
        }

        // Try to get media info from the page or API
        const mediaInfo = await getMediaInfo(itemId);
        if (!mediaInfo) {
            console.log('[SubtitleGenerator] No media info available, skipping');
            return;
        }

        const subtitleCount = (mediaInfo.MediaStreams || []).filter(function (s) { return s.Type === 'Subtitle'; }).length;
        const audioStreams = (mediaInfo.MediaStreams || []).filter(function (s) { return s.Type === 'Audio'; });

        if (subtitleCount === 0 && audioStreams.length > 0) {
            currentAudioStreams = audioStreams;
            injectButton(audioStreams);
        }
    }

    async function getMediaInfo(itemId) {
        // First try to extract from page
        const pageInfo = extractMediaInfoFromPage();
        if (pageInfo && pageInfo.MediaStreams) {
            return pageInfo;
        }

        // Fallback: try API call
        return await fetchMediaSources(itemId);
    }

    function extractMediaInfoFromPage() {
        try {
            // Try to find media info in the global Jellyfin state
            if (window.ApiClient && window.ApiClient._item) {
                return window.ApiClient._item;
            }

            // Look for any exposed item data
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const text = script.textContent || '';
                const match = text.match(/MediaStreams["']?\s*:\s*(\[[^\]]+\])/);
                if (match) {
                    try {
                        return { MediaStreams: JSON.parse(match[1]) };
                    } catch (e) {}
                }
            }
        } catch (e) {
            console.warn('[SubtitleGenerator] Failed to extract from page:', e);
        }
        return null;
    }

    function waitForElement(selector) {
        return new Promise(function (resolve) {
            const el = document.querySelector(selector);
            if (el) {
                resolve(el);
                return;
            }

            const observer = new MutationObserver(function () {
                const el = document.querySelector(selector);
                if (el) {
                    observer.disconnect();
                    resolve(el);
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(function () {
                observer.disconnect();
                resolve(null);
            }, 5000);
        });
    }

    async function fetchMediaSources(itemId) {
        try {
            // Try using the public items endpoint first
            const url = `/Items/${itemId}`;
            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                console.warn('[SubtitleGenerator] Failed to fetch media sources:', response.status);
                return null;
            }

            const data = await response.json();
            return data;
        } catch (e) {
            console.error('[SubtitleGenerator] Error fetching media sources:', e);
            return null;
        }
    }

    // --- Button Injection ---
    function injectButton(audioStreams) {
        // Find the subtitle section or a good injection point
        const subtitleSection = findSubtitleSection();
        if (!subtitleSection) {
            console.warn('[SubtitleGenerator] No injection point found');
            return;
        }

        const btn = document.createElement('button');
        btn.className = 'raised subtitle-generator-btn';
        btn.innerHTML = '<span class="material-icons">closed_caption</span><span>Generate Subtitle</span>';
        btn.style.marginTop = '0.5em';
        btn.addEventListener('click', function () {
            openDialog(audioStreams);
        });

        subtitleSection.appendChild(btn);
        console.log('[SubtitleGenerator] Button injected successfully');
    }

    function findSubtitleSection() {
        // Look for subtitle-related elements or fallback to a common content area
        // Try multiple possible locations
        const selectors = [
            '.itemDetailsGroup',      // Detail group container
            '.detailsGroup',          // Another common class
            '.detail-section',        // Generic detail section
            '.childrenItemsContainer', // Container for media info
            '.itemDetailPage',        // Main detail page container
            '.detailPageContent'      // Fallback
        ];

        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
                return el;
            }
        }

        return null;
    }

    // --- Dialog ---
    function openDialog(audioStreams) {
        if (!document.getElementById('sg-dialog-overlay')) {
            const div = document.createElement('div');
            div.innerHTML = DIALOG_HTML;
            document.body.appendChild(div.firstElementChild);
            bindDialogEvents();
        }

        dialogOverlay = document.getElementById('sg-dialog-overlay');
        const select = document.getElementById('sg-language-select');
        select.innerHTML = '';

        const uniqueLangs = new Map();
        audioStreams.forEach(function (stream) {
            const code = stream.Language || 'und';
            const name = stream.Language || 'Unknown';
            if (!uniqueLangs.has(code)) {
                uniqueLangs.set(code, name);
            }
        });

        if (uniqueLangs.size === 0) {
            uniqueLangs.set('und', 'Unknown');
        }

        uniqueLangs.forEach(function (name, code) {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = name.toUpperCase();
            select.appendChild(opt);
        });

        resetDialog();
        dialogOverlay.style.display = 'flex';
    }

    function bindDialogEvents() {
        document.getElementById('sg-cancel-btn').addEventListener('click', closeDialog);
        document.getElementById('sg-generate-btn').addEventListener('click', onGenerate);

        dialogOverlay = document.getElementById('sg-dialog-overlay');
        dialogOverlay.addEventListener('click', function (e) {
            if (e.target === dialogOverlay) {
                closeDialog();
            }
        });
    }

    function closeDialog() {
        stopPolling();
        if (dialogOverlay) {
            dialogOverlay.style.display = 'none';
        }
    }

    function resetDialog() {
        document.getElementById('sg-progress').style.display = 'none';
        document.getElementById('sg-error').style.display = 'none';
        document.getElementById('sg-generate-btn').disabled = false;
        document.getElementById('sg-generate-btn').textContent = 'Generate';
        document.getElementById('sg-language-select').disabled = false;
        stopPolling();
    }

    function showError(message) {
        const el = document.getElementById('sg-error');
        el.style.display = 'block';
        el.textContent = message;
        document.getElementById('sg-generate-btn').disabled = false;
        document.getElementById('sg-generate-btn').textContent = 'Retry';
        document.getElementById('sg-language-select').disabled = false;
        document.getElementById('sg-progress').style.display = 'none';
    }

    function showProgress(text, pct) {
        const progressEl = document.getElementById('sg-progress');
        const bar = document.getElementById('sg-progress-bar');
        const textEl = document.getElementById('sg-progress-text');

        progressEl.style.display = 'block';
        bar.style.width = (pct || 0) + '%';
        textEl.textContent = text;
    }

    // --- Generation Logic ---
    async function onGenerate() {
        if (!currentItemId) {
            showError('No item selected');
            return;
        }

        const language = document.getElementById('sg-language-select').value;
        if (!language) {
            showError('Please select a language.');
            return;
        }

        document.getElementById('sg-generate-btn').disabled = true;
        document.getElementById('sg-language-select').disabled = true;
        document.getElementById('sg-error').style.display = 'none';
        showProgress('Submitting job...', 0);

        try {
            const res = await fetch(`${API_BASE}/Jobs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemId: currentItemId, language: language })
            });

            if (res.status === 409) {
                showProgress('Subtitle already exists.', 100);
                setTimeout(function () {
                    closeDialog();
                    location.reload();
                }, 1500);
                return;
            }

            if (res.status === 202) {
                const data = await res.json();
                currentJobId = data.jobId;
                showProgress('Job queued, starting...', 5);
                startPolling();
                return;
            }

            const errorData = await res.json().catch(function () { return { message: 'Unknown error' }; });
            showError(errorData.message || `Request failed (${res.status})`);
        } catch (e) {
            console.error('[SubtitleGenerator] Submit failed:', e);
            showError('Failed to connect to subtitle generation service.');
        }
    }

    // --- Polling ---
    function startPolling() {
        stopPolling();
        const interval = (pluginConfig && pluginConfig.pollingIntervalSeconds) ? pluginConfig.pollingIntervalSeconds * 1000 : 5000;

        async function tick() {
            if (!currentJobId) {
                return;
            }

            try {
                const res = await fetch(`${API_BASE}/Jobs/${encodeURIComponent(currentJobId)}`);
                if (!res.ok) {
                    showError('Failed to check job status.');
                    stopPolling();
                    return;
                }

                const data = await res.json();
                const status = data.status;
                const pct = data.progress_pct || 0;

                if (status === 'completed') {
                    showProgress('Completed! Scanning library...', 100);
                    stopPolling();
                    await triggerScan();
                    setTimeout(function () {
                        closeDialog();
                        location.reload();
                    }, 1500);
                    return;
                }

                if (status === 'failed') {
                    showError(data.error || 'Subtitle generation failed.');
                    stopPolling();
                    return;
                }

                showProgress(`Processing... ${pct}%`, pct);
            } catch (e) {
                console.error('[SubtitleGenerator] Poll failed:', e);
            }
        }

        tick();
        pollTimer = setInterval(tick, interval);
    }

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    async function triggerScan() {
        if (!currentItemId) {
            return;
        }

        try {
            await fetch(`${API_BASE}/Scan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemId: currentItemId })
            });
        } catch (e) {
            console.warn('[SubtitleGenerator] Scan trigger failed:', e);
        }
    }

    // --- Start ---
    // Wait for Jellyfin's ApiClient to be ready
    function waitForApiClient() {
        if (window.ApiClient && window.ApiClient.serverId) {
            init();
        } else {
            setTimeout(waitForApiClient, 500);
        }
    }

    waitForApiClient();
})();
