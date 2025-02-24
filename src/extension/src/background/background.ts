import { ExtensionMessage, RSSFeed, SearchTopic, FeedItem } from '../../../plugins/rss-monitor/types';

// Store state
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

// Keep service worker alive
chrome.runtime.onConnect.addListener(function(port) {
  port.onDisconnect.addListener(function() {
    // Reconnect logic if needed
    console.log('Port disconnected, keeping service worker alive');
  });
});

// Initialize state and start feed checking
async function initialize() {
  console.group('Initializing Extension');
  try {
    // Load initial state
    const result = await chrome.storage.local.get(['feeds', 'topics', 'recentMatches', 'isDocked']);
    state = {
      feeds: result.feeds || [],
      topics: result.topics || [],
      recentMatches: result.recentMatches || [],
      isDocked: result.isDocked || false
    };
    console.log('Initial state loaded:', state);

    // Start feed checking
    await setupFeedChecking();
    
    // Initial check
    await checkAllFeeds();
  } catch (error) {
    console.error('Error during initialization:', error);
  }
  console.groupEnd();
}

// Initialize on install or update
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated');
  initialize();
});

// Initialize on startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension starting up');
  initialize();
});

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
  console.log('Setting up feed checking...');

  // Clear any existing alarms
  chrome.alarms.clearAll(() => {
    console.log('Cleared existing alarms');
    
    // Create new alarm for periodic checking (0.167 minutes = 10 seconds)
    chrome.alarms.create('checkFeeds', {
      periodInMinutes: 0.167,
      delayInMinutes: 0 // Start immediately
    });
    console.log('Created new alarm for feed checking (10-second interval)');

    // Verify alarm was created
    chrome.alarms.get('checkFeeds', (alarm) => {
      if (alarm) {
        console.log('Verified alarm creation:', alarm);
      } else {
        console.error('Failed to create alarm!');
      }
    });
  });

  // Listen for alarm events
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkFeeds') {
      console.group('Alarm Triggered Feed Check');
      console.log('Alarm details:', alarm);
      checkAllFeeds()
        .then(matches => {
          console.log('Feed check complete, matches found:', matches.length);
          console.groupEnd();
        })
        .catch(error => {
          console.error('Error in scheduled feed check:', error);
          console.groupEnd();
        });
    }
  });

  // Initial check on startup
  console.log('Performing initial feed check...');
  checkAllFeeds()
    .then(matches => {
      console.log('Initial feed check complete, matches found:', matches.length);
      console.groupEnd();
    })
    .catch(error => {
      console.error('Error in initial feed check:', error);
      console.groupEnd();
    });
}

// Save state to storage
function saveState() {
  chrome.storage.local.set(state);
}

// Show notifications for new matches
function notifyNewMatches(matches: FeedItem[]) {
  matches.forEach(match => {
    const matchedTopics = state.topics
      .filter(t => match.matchedTopics.includes(t.id))
      .map(t => t.query)
      .join(', ');

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'New RSS Match Found!',
      message: `${match.title}\nMatched topics: ${matchedTopics}`,
      buttons: [
        { title: 'Open Article' }
      ]
    });
  });
}

// Handle notification clicks
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (buttonIndex === 0) { // "Open Article" button
    const match = state.recentMatches.find(m => m.id === notificationId);
    if (match) {
      chrome.tabs.create({ url: match.link });
    }
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.type, message.payload);
  
  try {
    switch (message.type) {
      case 'GET_STATE':
        sendResponse(state);
        break;

      case 'CHECK_FEEDS':
        checkAllFeeds()
          .then(() => sendResponse(state))
          .catch((error) => {
            console.error('Error checking feeds:', error);
            sendResponse({ error: error.message });
          });
        break;

      case 'NEW_FEED':
        const feed = message.payload as RSSFeed;
        state.feeds = [...state.feeds, feed];
        saveState();
        sendResponse(state);
        // Notify other popup instances
        chrome.runtime.sendMessage({ type: 'STATE_UPDATED', payload: state })
          .catch(handleMessageError);
        break;

      case 'REMOVE_FEED':
        const feedId = message.payload as string;
        state.feeds = state.feeds.filter(f => f.id !== feedId);
        saveState();
        sendResponse(state);
        // Notify other popup instances
        chrome.runtime.sendMessage({ type: 'STATE_UPDATED', payload: state })
          .catch(handleMessageError);
        break;

      case 'NEW_TOPIC':
        const topic = message.payload as SearchTopic;
        state.topics = [...state.topics, topic];
        saveState();
        // Check feeds immediately when a new topic is added
        checkAllFeeds()
          .then(() => sendResponse(state))
          .catch((error) => {
            console.error('Error checking feeds after new topic:', error);
            sendResponse({ error: error.message });
          });
        // Notify other popup instances
        chrome.runtime.sendMessage({ type: 'STATE_UPDATED', payload: state })
          .catch(handleMessageError);
        break;

      case 'REMOVE_TOPIC':
        const topicId = message.payload as string;
        state.topics = state.topics.filter(t => t.id !== topicId);
        saveState();
        sendResponse(state);
        // Notify other popup instances
        chrome.runtime.sendMessage({ type: 'STATE_UPDATED', payload: state })
          .catch(handleMessageError);
        break;

      case 'ARCHIVE_MATCH':
        const matchId = message.payload as string;
        const matchToArchive = state.recentMatches.find(m => m.id === matchId);
        if (matchToArchive) {
          matchToArchive.archived = true;
          matchToArchive.removedAt = Date.now();
          saveState();
        }
        sendResponse(state);
        // Notify other popup instances
        chrome.runtime.sendMessage({ type: 'STATE_UPDATED', payload: state })
          .catch(handleMessageError);
        break;

      case 'RESTORE_MATCH':
        const restoreId = message.payload as string;
        const matchToRestore = state.recentMatches.find(m => m.id === restoreId);
        if (matchToRestore) {
          matchToRestore.archived = false;
          matchToRestore.removedAt = undefined;
          saveState();
        }
        sendResponse(state);
        // Notify other popup instances
        chrome.runtime.sendMessage({ type: 'STATE_UPDATED', payload: state })
          .catch(handleMessageError);
        break;
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ error: error instanceof Error ? error.message : 'Unknown error' });
  }

  // Return true if we're using sendResponse asynchronously
  return true;
});

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

// RSS Feed checking
async function checkFeed(feed: RSSFeed): Promise<FeedItem[]> {
  try {
    console.group(`Feed Check: ${feed.name}`);
    console.log('Feed URL:', feed.url);
    
    if (!feed.url) {
      console.error('Feed URL is missing');
      console.groupEnd();
      return [];
    }

    // Format URL
    let feedUrl = feed.url;
    if (feedUrl.startsWith('@')) {
      feedUrl = feedUrl.substring(1);
      console.log('Removed @ from URL:', feedUrl);
    }
    if (!feedUrl.startsWith('http://') && !feedUrl.startsWith('https://')) {
      feedUrl = 'https://' + feedUrl;
      console.log('Final URL:', feedUrl);
    }

    console.log('\nActive Topics:');
    state.topics.forEach(topic => {
      console.log(`- Topic: "${topic.query}" (case sensitive: ${topic.caseSensitive})`);
    });

    if (state.topics.length === 0) {
      console.warn('No search topics defined');
      console.groupEnd();
      return [];
    }

    console.log('\nFetching feed...');
    const response = await fetch(feedUrl, {
      headers: {
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) RSS Reader',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });

    if (!response.ok) {
      console.error('HTTP Error:', response.status, response.statusText);
      console.error('Response headers:', Object.fromEntries(response.headers.entries()));
      console.groupEnd();
      return [];
    }

    const text = await response.text();
    console.log('Feed content received, length:', text.length);

    // Simple XML parsing using string manipulation
    const items: Array<{title: string, link: string, description: string, pubDate: string}> = [];
    const itemMatches = text.match(/<item[\s\S]*?<\/item>/g) || [];
    
    console.log(`Found ${itemMatches.length} items in feed`);

    itemMatches.forEach(itemXml => {
      const title = (itemXml.match(/<title>(.*?)<\/title>/s)?.[1] || '')
        .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
        .trim();
      
      const link = (itemXml.match(/<link>(.*?)<\/link>/s)?.[1] || '')
        .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
        .trim();
      
      const description = (
        itemXml.match(/<description>(.*?)<\/description>/s)?.[1] ||
        itemXml.match(/<content:encoded>(.*?)<\/content:encoded>/s)?.[1] ||
        ''
      )
        .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      const pubDate = (itemXml.match(/<pubDate>(.*?)<\/pubDate>/s)?.[1] || '')
        .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
        .trim();

      if (title && link) {
        items.push({ title, link, description, pubDate });
      }
    });
    
    const matches: FeedItem[] = [];

    for (const [index, item] of items.entries()) {
      console.group(`Item ${index + 1}`);
      console.log('Title:', item.title);
      console.log('Link:', item.link);

      const searchContent = `${item.title} ${item.description}`.toLowerCase();
      console.log('Search content:', searchContent);
      
      const matchedTopics = state.topics.filter(topic => {
        const searchTerm = topic.caseSensitive ? topic.query : topic.query.toLowerCase();
        const contentToSearch = topic.caseSensitive ? `${item.title} ${item.description}` : searchContent;
        
        const isMatch = contentToSearch.includes(searchTerm);
        console.log(`Checking "${topic.query}" - Match:`, isMatch);
        return isMatch;
      });

      if (matchedTopics.length > 0) {
        console.log('*** MATCH FOUND ***');
        console.log('Matched topics:', matchedTopics.map(t => t.query));
        
        matches.push({
          id: `${feed.id}-${Date.now()}-${index}`,
          feedId: feed.id,
          title: item.title,
          description: item.description,
          link: item.link,
          pubDate: item.pubDate || new Date().toISOString(),
          matchedTopics: matchedTopics.map(t => t.id),
          archived: false
        });
      }
      
      console.groupEnd(); // Item group
    }

    console.log(`Found ${matches.length} matches in this feed`);
    console.groupEnd(); // Feed check group
    return matches;

  } catch (error) {
    console.error('Error checking feed:', error);
    console.groupEnd(); // Feed check group
    return [];
  }
}

// Modify checkAllFeeds to handle duplicates and respect archived status
async function checkAllFeeds() {
  console.group('RSS Monitor - Feed Check');
  console.log('=== Starting Feed Check ===');
  console.log(`Number of feeds: ${state.feeds.length}`);
  console.log(`Number of topics: ${state.topics.length}`);
  console.log('\nFeeds:', state.feeds);
  console.log('Topics:', state.topics);
  
  const allMatches: FeedItem[] = [];

  for (const feed of state.feeds) {
    console.group(`Checking feed: ${feed.name}`);
    try {
      const matches = await checkFeed(feed);
      if (matches.length > 0) {
        // Filter out duplicates and archived matches based on title and link
        const newMatches = matches.filter(match => {
          return !state.recentMatches.some(existing => 
            (existing.title === match.title && 
             existing.link === match.link) ||
            // Check if this match was previously archived
            (existing.archived && 
             existing.removedAt && 
             existing.title === match.title)
          );
        });

        if (newMatches.length > 0) {
          console.log(`Found ${newMatches.length} new matches in feed ${feed.name}`);
          allMatches.push(...newMatches);
        } else {
          console.log('No new matches found in this feed');
        }
      } else {
        console.log('No matches found in this feed');
      }
    } catch (error) {
      console.error(`Error checking feed ${feed.name}:`, error);
    }
    console.groupEnd();
  }

  console.log(`\nTotal new matches found: ${allMatches.length}`);

  if (allMatches.length > 0) {
    console.log('Updating state with new matches');
    state.recentMatches = [...allMatches, ...state.recentMatches].slice(0, 100);
    saveState();
    
    notifyNewMatches(allMatches);
    chrome.runtime.sendMessage({ type: 'STATE_UPDATED', payload: state });
  }

  console.groupEnd();
  return allMatches;
} 