let active = false;

chrome.action.onClicked.addListener(async (tab) => {
    active = !active;

    if (active) {
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });
        chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['inject.css']
        });
        chrome.tabs.sendMessage(tab.id, { action: 'activate' });
    } else {
        chrome.tabs.sendMessage(tab.id, { action: 'deactivate' });
    }
});

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'deactivated') {
        active = false;
    }
});
