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

    // --- Debug Mode ---
    const DEBUG = true;
    function log(...args) {
        if (DEBUG) console.log('[SubtitleGenerator]', ...args);
    }
    function warn(...args) {
        console.warn('[SubtitleGenerator]', ...args);
    }
    function error(...args) {
        console.error('[SubtitleGenerator]', ...args);
    }

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
        log('Initializing Subtitle Generator plugin');
        loadConfig();
        observePageChanges();
        // Also run immediately on current page
        setTimeout(processCurrentPage, 500);
    }

    async function loadConfig() {
        try {
            const res = await fetch(`${API_BASE}/Config`);
            if (res.ok) {
                pluginConfig = await res.json();
                log('Config loaded:', pluginConfig);
            }
        } catch (e) {
            warn('Failed to load config:', e);
        }
    }

    // --- Page observation ---
    function observePageChanges() {
        let lastPath = location.hash;
        log('Observing page changes, current hash:', lastPath);

        function check() {
            const currentPath = location.hash;
            if (currentPath !== lastPath) {
                log('Page changed from', lastPath, 'to', currentPath);
                lastPath = currentPath;
                setTimeout(processCurrentPage, 500);
            }
        }

        setInterval(check, 300);

        // Also listen to hashchange events
        window.addEventListener('hashchange', function() {
            log('Hash change event detected');
            setTimeout(processCurrentPage, 500);
        });
    }

    async function processCurrentPage() {
        const hash = location.hash;
        log('Processing page:', hash);

        // Match detail pages - support both formats
        const match = hash.match(/\/details\?id=([a-f0-9\-]+)/i) || 
                      hash.match(/[?&]id=([a-f0-9\-]+)/i);

        if (!match) {
            log('Not a detail page, skipping');
            return;
        }

        const itemId = match[1];
        log('Found item ID:', itemId);
        currentItemId = itemId;

        // Wait for detail page to render
        const content = await waitForElement('.detailPageContent, .itemDetailPage, .itemDetailsGroup');
        if (!content) {
            warn('Detail page content not found after waiting');
            return;
        }
        log('Detail page content found');

        // Check if button already injected
        if (document.querySelector('.subtitle-generator-btn')) {
            log('Button already exists, skipping');
            return;
        }

        // Try to get media streams from the page
        const mediaStreams = extractMediaStreamsFromPage();
        
        if (!mediaStreams || mediaStreams.length === 0) {
            log('No MediaStreams found on page, trying API fallback');
            // Try API fallback
            const apiStreams = await fetchMediaStreams(itemId);
            if (apiStreams && apiStreams.length > 0) {
                processStreams(apiStreams);
            } else {
                warn('Could not get media streams from page or API');
                // Debug: show what we found on the page
                debugPageContent();
            }
        } else {
            log('Found MediaStreams on page:', mediaStreams.length, 'streams');
            processStreams(mediaStreams);
        }
    }

    function processStreams(streams) {
        const subtitleStreams = streams.filter(s => s.Type === 'Subtitle' || s.type === 'Subtitle');
        const audioStreams = streams.filter(s => s.Type === 'Audio' || s.type === 'Audio');

        log('Subtitles:', subtitleStreams.length, 'Audio:', audioStreams.length);

        // Show button if no subtitles and has audio
        if (subtitleStreams.length === 0 && audioStreams.length > 0) {
            log('Conditions met! Injecting button');
            currentAudioStreams = audioStreams;
            injectButton(audioStreams);
        } else {
            log('Conditions not met. Subtitles:', subtitleStreams.length, 'Audio:', audioStreams.length);
        }
    }

    function extractMediaStreamsFromPage() {
        // Try multiple methods to find MediaStreams
        
        // Method 1: Look in global Jellyfin state
        if (window.ApiClient && window.ApiClient._currentItem && window.ApiClient._currentItem.MediaStreams) {
            log('Found streams in ApiClient._currentItem');
            return window.ApiClient._currentItem.MediaStreams;
        }

        // Method 2: Look in page data attributes or scripts
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
            const text = script.textContent || '';
            // Look for MediaStreams in JSON
            const match = text.match(/MediaStreams["']?\s*:\s*(\[[\s\S]*?\])/);
            if (match) {
                try {
                    const parsed = JSON.parse(match[1]);
                    log('Found streams in script tag');
                    return parsed;
                } catch (e) {}
            }
        }

        // Method 3: Look for item data in the DOM
        const itemDataEl = document.querySelector('[data-itemdata]');
        if (itemDataEl) {
            try {
                const data = JSON.parse(itemDataEl.getAttribute('data-itemdata') || '{}');
                if (data.MediaStreams) {
                    log('Found streams in data-itemdata');
                    return data.MediaStreams;
                }
            } catch (e) {}
        }

        // Method 4: Try to find in React props (hacky but sometimes works)
        const reactRoot = document.querySelector('#react-root, [data-reactroot]');
        if (reactRoot) {
            for (const key in reactRoot) {
                if (key.startsWith('__reactInternalInstance') || key.startsWith('__reactFiber')) {
                    const fiber = reactRoot[key];
                    if (fiber && fiber.memoizedProps && fiber.memoizedProps.item) {
                        const item = fiber.memoizedProps.item;
                        if (item.MediaSources && item.MediaSources[0] && item.MediaSources[0].MediaStreams) {
                            log('Found streams in React props');
                            return item.MediaSources[0].MediaStreams;
                        }
                    }
                }
            }
        }

        return null;
    }

    async function fetchMediaStreams(itemId) {
        try {
            log('Fetching media streams via API for item:', itemId);
            
            // Try using ApiClient.ajax which handles authentication
            if (window.ApiClient && window.ApiClient.ajax) {
                log('Using ApiClient.ajax for authenticated request');
                const url = window.ApiClient.getUrl(`Items/${itemId}`, {
                    Fields: 'MediaSources'
                });
                
                try {
                    const response = await window.ApiClient.ajax({
                        url: url,
                        type: 'GET',
                        dataType: 'json'
                    });
                    
                    log('ApiClient.ajax response:', response);
                    
                    // Response might be the item directly or wrapped
                    const item = response;
                    if (item.MediaSources && item.MediaSources[0] && item.MediaSources[0].MediaStreams) {
                        log('Got streams from ApiClient.ajax');
                        return item.MediaSources[0].MediaStreams;
                    }
                    // Try alternative location
                    if (item.MediaStreams) {
                        log('Got streams directly from item');
                        return item.MediaStreams;
                    }
                } catch (ajaxError) {
                    warn('ApiClient.ajax failed:', ajaxError);
                }
            }
            
            // Fallback: Try raw fetch with authentication token
            const accessToken = window.ApiClient ? window.ApiClient.accessToken() : null;
            const url = `/Items/${itemId}`;
            
            const headers = {
                'Accept': 'application/json'
            };
            if (accessToken) {
                headers['X-Emby-Authorization'] = `MediaBrowser Client="Jellyfin Web", Device="Browser", DeviceId="${window.ApiClient.deviceId()}", Version="10.11.0", Token="${accessToken}"`;
                headers['X-MediaBrowser-Token'] = accessToken;
                log('Using access token for authentication');
            } else {
                warn('No access token available');
            }
            
            const response = await fetch(url, { headers });

            if (!response.ok) {
                warn('Items API failed:', response.status);
                return null;
            }

            const data = await response.json();
            log('Items API response:', data);
            
            if (data.MediaSources && data.MediaSources[0] && data.MediaSources[0].MediaStreams) {
                log('Got streams from Items API');
                return data.MediaSources[0].MediaStreams;
            }
            if (data.MediaStreams) {
                log('Got streams directly from item');
                return data.MediaStreams;
            }
            return null;
        } catch (e) {
            error('Error fetching media streams:', e);
            return null;
        }
    }

    function debugPageContent() {
        log('=== DEBUG: Page Content ===');
        
        // Log all data attributes
        const elementsWithData = document.querySelectorAll('[data-*]');
        log('Elements with data attributes:', elementsWithData.length);
        
        // Log ApiClient state
        if (window.ApiClient) {
            log('ApiClient exists');
            log('ApiClient._currentItem:', window.ApiClient._currentItem);
            log('ApiClient.serverId:', window.ApiClient.serverId());
        } else {
            warn('ApiClient not found');
        }

        // Log all script data
        const scripts = document.querySelectorAll('script');
        log('Scripts found:', scripts.length);
        scripts.forEach((script, i) => {
            if (script.textContent && script.textContent.includes('MediaStream')) {
                log('Script', i, 'contains MediaStream');
            }
        });
        
        log('=== END DEBUG ===');
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

    // --- Button Injection ---
    function injectButton(audioStreams) {
        log('Injecting button with', audioStreams.length, 'audio streams');
        
        const subtitleSection = findSubtitleSection();
        if (!subtitleSection) {
            warn('No injection point found!');
            // Debug: show available elements
            const possible = document.querySelectorAll('.detailPageContent, .itemDetailsGroup, .detailsGroup, .itemDetailPage, [class*="detail"], [class*="media"]');
            log('Possible containers found:', possible.length);
            possible.forEach((el, i) => {
                log('  ', i, el.className);
            });
            return;
        }

        const btn = document.createElement('button');
        btn.className = 'raised subtitle-generator-btn';
        btn.innerHTML = '<span class="material-icons">closed_caption</span><span>Generate Subtitle</span>';
        btn.style.cssText = 'margin-top: 0.5em; display: inline-flex; align-items: center; gap: 0.4em;';
        btn.addEventListener('click', function () {
            openDialog(audioStreams);
        });

        subtitleSection.appendChild(btn);
        log('Button injected successfully!');
    }

    function findSubtitleSection() {
        // Expanded list of possible locations
        const selectors = [
            // Specific subtitle areas
            '.subtitleSection',
            '.subtitles-section',
            '[class*="subtitle"]',
            
            // General detail areas  
            '.itemDetailsGroup',
            '.detailsGroup',
            '.itemMediaInfo',
            '.mediaInfo',
            
            // Media stream lists
            '.mediaStreamList',
            '.streamList',
            
            // Detail containers
            '.detailPageContent',
            '.itemDetailPage',
            '.itemDetailContent',
            '.detailsPageContent',
            
            // Fallbacks
            '.mainDetailButtons',
            '.detailSection',
            '[class*="details"]'
        ];

        for (const selector of selectors) {
            try {
                const el = document.querySelector(selector);
                if (el) {
                    log('Found injection point:', selector);
                    return el;
                }
            } catch (e) {
                // Invalid selector, skip
            }
        }

        return null;
    }

    // --- Dialog ---
    function openDialog(audioStreams) {
        log('Opening dialog with', audioStreams.length, 'audio streams');
        
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
            const code = stream.Language || stream.language || 'und';
            const name = stream.Language || stream.language || stream.DisplayTitle || 'Unknown';
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
            error('Submit failed:', e);
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
                // API returns PascalCase, handle both cases
                const status = data.Status || data.status;
                const pct = data.ProgressPct || data.progress_pct || 0;

                log('Job status:', status, 'Progress:', pct + '%');

                if (status === 'completed' || status === 'Completed') {
                    showProgress('Completed! Scanning library...', 100);
                    stopPolling();
                    await triggerScan();
                    setTimeout(function () {
                        closeDialog();
                        location.reload();
                    }, 1500);
                    return;
                }

                if (status === 'failed' || status === 'Failed') {
                    showError(data.Error || data.error || 'Subtitle generation failed.');
                    stopPolling();
                    return;
                }

                showProgress(`Processing... ${pct}%`, pct);
            } catch (e) {
                error('Poll failed:', e);
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
            warn('Scan trigger failed:', e);
        }
    }

    // --- Start ---
    log('Subtitle Generator script loaded, waiting for ApiClient...');
    
    function waitForApiClient() {
        if (window.ApiClient && window.ApiClient.serverId) {
            log('ApiClient ready, starting initialization');
            init();
        } else {
            setTimeout(waitForApiClient, 500);
        }
    }

    waitForApiClient();
    
    // Also expose debug function
    window.SubtitleGeneratorDebug = debugPageContent;
})();
