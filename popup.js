document.addEventListener('DOMContentLoaded', async () => {
    const toggleBtn = document.getElementById('toggle-inspect-btn');
    const stashContainer = document.getElementById('stash-container');
    const emptyState = document.getElementById('empty-state');
    const stashCount = document.getElementById('stash-count');

    // Toggle Inspector
    toggleBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'toggle_inspect' });
            window.close(); // Close popup immediately
        }
    });

    // Load Stash
    const loadStash = async () => {
        const data = await chrome.storage.local.get('peekui_stash');
        const stash = data.peekui_stash || [];

        stashCount.textContent = stash.length;

        if (stash.length === 0) {
            emptyState.style.display = 'block';
            stashContainer.innerHTML = '';
            return;
        }

        emptyState.style.display = 'none';
        stashContainer.innerHTML = '';

        stash.forEach((item, index) => {
            const el = document.createElement('div');
            el.className = 'stash-item';

            // Format HTML safely
            el.innerHTML = `
                <button class="btn-delete" data-index="${index}" title="Remove">
                    <svg viewBox="0 0 24 24"><path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/></svg>
                </button>
                <div class="stash-item-header">
                    <div>
                        <div class="stash-element-name">
                            <span class="stash-preview" style="background-color: ${escapeHTML(item.bgColor)}"></span>
                            ${escapeHTML(item.elementName)}
                        </div>
                        <span class="stash-domain">${escapeHTML(item.domain)}</span>
                    </div>
                </div>
                <div class="stash-actions">
                    <button class="btn-action copy-css" data-index="${index}">Copy CSS</button>
                    ${item.tailwindCode ? `<button class="btn-action copy-tw" data-index="${index}">Copy Tailwind</button>` : ''}
                </div>
            `;
            stashContainer.appendChild(el);
        });

        // Event delegation for copy and delete buttons
        stashContainer.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                stash.splice(idx, 1);
                await chrome.storage.local.set({ peekui_stash: stash });
                loadStash(); // Re-render
            });
        });

        stashContainer.querySelectorAll('.copy-css').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                copyToClipboard(stash[idx].cssCode, e.currentTarget);
            });
        });

        stashContainer.querySelectorAll('.copy-tw').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.getAttribute('data-index'));
                copyToClipboard(stash[idx].tailwindCode, e.currentTarget);
            });
        });
    };

    function escapeHTML(str) {
        if (!str) return '';
        return str.replace(/[&<>'"]/g,
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }

    function copyToClipboard(text, btnElement) {
        navigator.clipboard.writeText(text).then(() => {
            const originalText = btnElement.textContent;
            btnElement.textContent = 'Copied!';
            btnElement.style.background = '#dcfce7'; /* green-100 */
            btnElement.style.color = '#166534'; /* green-800 */

            setTimeout(() => {
                btnElement.textContent = originalText;
                btnElement.style.background = '';
                btnElement.style.color = '';
            }, 2000);
        });
    }

    loadStash();
});
