import { RSSFeed, SearchTopic, FeedItem } from '../../../plugins/rss-monitor/types';

const API_BASE = 'http://localhost:3000';

interface ExtensionState {
  feeds: RSSFeed[];
  topics: SearchTopic[];
  recentMatches: FeedItem[];
  isDocked: boolean;
}

let state: ExtensionState = {
  feeds: [],
  topics: [],
  recentMatches: [],
  isDocked: false
};

const CHECK_INTERVAL = 1000; // Check every second

// Keep service worker alive
chrome.runtime.onConnect.addListener(function(port) {
  port.onDisconnect.addListener(function() {
    console.log('Port disconnected, keeping service worker alive');
  });
});

let lastStateUpdate = 0;

// Initialize state and start feed checking
async function initialize() {
  console.group('Initializing Extension');
  try {
    // Load initial state from API
    await refreshState();
  } catch (error) {
    console.error('Error during initialization:', error);
  }
  console.groupEnd();
}

// Refresh state from API
async function refreshState() {
  try {
    await refreshRSSData();
  } catch (error) {
    console.error('Error refreshing state:', error);
  }
}

// Handle message passing errors
function handleMessageError(error: any) {
  if (error.message.includes('Receiving end does not exist')) {
    console.log('Expected disconnect - popup window closed');
    return;
  }
  console.error('Message passing error:', error);
}

// Set up feed checking and alarms
function setupFeedChecking() {
  console.group('Feed Checking Setup');
  
  // Create alarm for periodic checking
  chrome.alarms.create('checkFeeds', {
    periodInMinutes: 0.167, // 10 seconds
    delayInMinutes: 0
  });

  // Listen for alarm events
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkFeeds') {
      checkFeeds();
    }
  });

  // Initial check
  checkFeeds();
  console.groupEnd();
}

// Check feeds via API
async function checkFeeds() {
  try {
    const response = await fetch(`${API_BASE}/rss/check`, {
      method: 'POST'
    });
    
    if (!response.ok) throw new Error('Failed to check feeds');
    
    const matches = await response.json();
    if (matches.length > 0) {
      notifyNewMatches(matches);
      await refreshState(); // Refresh state to get latest data
    }
  } catch (error) {
    console.error('Error checking feeds:', error);
  }
}

// Show notifications for new matches
function notifyNewMatches(matches: FeedItem[]) {
  matches.forEach(match => {
    // Find the actual topic objects for this match
    const matchedTopics = state.topics
      .filter(t => match.matchedTopics.includes(t.id))
      .map(t => t.query || 'Unknown Topic') // Use query field or fallback
      .join(', ');

    console.log('Matched topics for notification:', {
      matchIds: match.matchedTopics,
      foundTopics: matchedTopics,
      allTopics: state.topics
    });

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'New RSS Match Found!',
      message: `${match.title}\nMatched topics: ${matchedTopics}`,
      buttons: [{ title: 'Open Article' }]
    });
  });
}

// Handle notification clicks
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (buttonIndex === 0) {
    const match = state.recentMatches.find(m => m.id === notificationId);
    if (match) {
      chrome.tabs.create({ url: match.link });
    }
  }
});

// Refresh all RSS data from API
async function refreshRSSData() {
  try {
    // Fetch state directly
    const stateResponse = await fetch(`${API_BASE}/rss-state`);
    if (!stateResponse.ok) throw new Error('Failed to fetch state');
    const stateData = await stateResponse.json();
    
    // Convert feeds object to array
    state.feeds = stateData.feeds ? Object.values(stateData.feeds) : [];
    console.log('Processed feeds:', state.feeds);

    // Convert topics object to array
    state.topics = stateData.topics ? Object.values(stateData.topics) : [];
    console.log('Processed topics:', state.topics);

    // Set recent matches
    state.recentMatches = stateData.recentMatches || [];
    console.log('Processed recent matches:', state.recentMatches);

    // Notify UI of state change
    const payload = {
      ...state,
      feeds: state.feeds,
      topics: state.topics,
      recentMatches: state.recentMatches
    };
    
    chrome.runtime.sendMessage({ type: 'STATE_UPDATED', payload })
      .catch(handleMessageError);

    console.log('Refreshed RSS data:', { 
      feeds: state.feeds.length, 
      topics: state.topics.length,
      recentMatches: state.recentMatches.length,
      feedDetails: state.feeds.map(f => ({ id: f.id, name: f.name })),
      topicDetails: state.topics.map(t => ({ id: t.id, query: t.query }))
    });
  } catch (error) {
    console.error('Error refreshing RSS data:', error);
  }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.type, message.payload);
  
  (async () => {
    try {
      switch (message.type) {
        case 'GET_STATE':
          await refreshRSSData();
          sendResponse(state);
          break;

        case 'CHECK_FEEDS':
          await checkFeeds();
          await refreshRSSData();
          sendResponse(state);
          break;

        case 'NEW_FEED':
          await fetch(`${API_BASE}/rss/feeds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message.payload)
          });
          await refreshRSSData();
          sendResponse(state);
          break;

        case 'REMOVE_FEED':
          await fetch(`${API_BASE}/rss/feeds/${message.payload}`, {
            method: 'DELETE'
          });
          await refreshRSSData();
          sendResponse(state);
          break;

        case 'NEW_TOPIC':
          await fetch(`${API_BASE}/rss/topics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message.payload)
          });
          await refreshRSSData();
          sendResponse(state);
          break;

        case 'REMOVE_TOPIC':
          await fetch(`${API_BASE}/rss/topics/${message.payload}`, {
            method: 'DELETE'
          });
          await refreshRSSData();
          sendResponse(state);
          break;

        case 'ARCHIVE_MATCH':
          const matchId = message.payload as string;
          const matchToArchive = state.recentMatches.find(m => m.id === matchId);
          if (matchToArchive) {
            matchToArchive.archived = true;
            matchToArchive.removedAt = Date.now();
            await refreshRSSData();
          }
          sendResponse(state);
          break;

        case 'RESTORE_MATCH':
          const restoreId = message.payload as string;
          const matchToRestore = state.recentMatches.find(m => m.id === restoreId);
          if (matchToRestore) {
            matchToRestore.archived = false;
            matchToRestore.removedAt = undefined;
            await refreshRSSData();
          }
          sendResponse(state);
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  })();

  return true; // Will respond asynchronously
});

// Initialize on install or update
chrome.runtime.onInstalled.addListener(initialize);

// Initialize on startup
chrome.runtime.onStartup.addListener(initialize);

// Replace refreshState with refreshRSSData in periodic checks
setInterval(refreshRSSData, CHECK_INTERVAL);

// Initial refresh
refreshRSSData();

// Initialize side panel
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch(console.error);

// Reset isDocked state on extension startup
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.set({ isDocked: false });
  chrome.action.setPopup({ popup: 'popup.html' });
});

// Also reset on extension install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ isDocked: false });
  chrome.action.setPopup({ popup: 'popup.html' });
});

// Listen for window focus changes to detect side panel closure
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    const { isDocked } = await chrome.storage.local.get(['isDocked']);
    if (isDocked) {
      // Check if side panel is still visible, if not reset to popup mode
      const windows = await chrome.windows.getAll();
      const sidePanelOpen = windows.some(w => w.type === 'panel');
      if (!sidePanelOpen) {
        state.isDocked = false;
        await chrome.storage.local.set({ isDocked: false });
        chrome.action.setPopup({ popup: 'popup.html' });
        // Notify other instances
        chrome.runtime.sendMessage({ type: 'STATE_UPDATED', payload: state });
      }
    }
  }
});

// Handle extension icon clicks - always show popup first
chrome.action.onClicked.addListener(() => {
  // Always ensure popup is set
  chrome.action.setPopup({ popup: 'popup.html' });
});

// Listen for side panel state changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.isDocked) {
    const isDocked = changes.isDocked.newValue;
    state.isDocked = isDocked;
    
    // Update popup behavior based on docked state
    if (isDocked) {
      chrome.action.setPopup({ popup: '' }); // Remove popup to allow side panel
    } else {
      chrome.action.setPopup({ popup: 'popup.html' }); // Restore popup
    }
  }
}); 