chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-inspector') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'toggle_inspect' });
        }
    }
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'deactivated') {
        active = false;
    }
});
