import { ExtensionMessage, RSSFeed, SearchTopic, FeedItem } from '../../plugins/rss-monitor/types';

interface ExtensionState {
  feeds: RSSFeed[];
  topics: SearchTopic[];
  recentMatches: FeedItem[];
}

let state: ExtensionState = {
  feeds: [],
  topics: [],
  recentMatches: []
};

let currentTab = 'recent'; // 'recent' or 'archived'

// UI Elements
const addFeedButton = document.getElementById('addFeed')!;
const addTopicButton = document.getElementById('addTopic')!;
const refreshFeedsButton = document.getElementById('refreshFeeds')!;
const toggleDockButton = document.getElementById('toggleDock')!;
const addFeedModal = document.getElementById('addFeedModal')!;
const addFeedForm = document.getElementById('addFeedForm')! as HTMLFormElement;
const addTopicModal = document.getElementById('addTopicModal')!;
const addTopicForm = document.getElementById('addTopicForm')! as HTMLFormElement;
const feedsList = document.getElementById('feedsList')!;
const topicsList = document.getElementById('topicsList')!;
const matchesList = document.getElementById('matchesList')!;

// Add these type definitions near the top with other interfaces
interface ChromeWindow {
  id?: number;
  type: string;
  width?: number;
  height?: number;
  screen?: {
    width: number;
    height: number;
  };
  left?: number;
  top?: number;
  focused?: boolean;
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Force hide modals initially with display: none
  addFeedModal.style.display = 'none';
  addTopicModal.style.display = 'none';
  addFeedModal.classList.add('hidden');
  addTopicModal.classList.add('hidden');

  // First, determine if we're in a side panel
  const isSidePanel = location.search.includes('side-panel');
  
  if (isSidePanel) {
    // We're in the side panel, update UI accordingly
    document.body.classList.add('docked');
    updateDockIcon(true);
    chrome.storage.local.set({ isDocked: true });
  }

  // Handle dock toggle
  toggleDockButton.addEventListener('click', async () => {
    const { isDocked } = await chrome.storage.local.get(['isDocked']);
    
    try {
      if (!isDocked) {
        // Get current window ID first
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const windowId = tabs[0]?.windowId;
        
        if (!windowId) {
          console.error('No active window found');
          return;
        }

        // Update state before opening side panel
        await chrome.storage.local.set({ isDocked: true });
        await chrome.sidePanel.setOptions({ enabled: true });
        
        // Open side panel in direct response to user click
        await chrome.sidePanel.open({ windowId });
        
        window.close(); // Close popup
      } else {
        // Switch back to popup mode
        await chrome.storage.local.set({ isDocked: false });
        await chrome.sidePanel.setOptions({ enabled: false });
        window.close(); // Close side panel
      }
    } catch (error) {
      console.error('Error toggling side panel:', error);
      // Reset state if there was an error
      await chrome.storage.local.set({ isDocked: false });
      await chrome.sidePanel.setOptions({ enabled: false });
    }
  });

  // Get initial state
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response: ExtensionState) => {
    console.log('Initial state:', response);
    state = response;
    renderUI();
  });

  // Listen for state updates
  chrome.runtime.onMessage.addListener((message: { type: string; payload: any }) => {
    if (message.type === 'STATE_UPDATED') {
      console.log('State updated:', message.payload);
      state = message.payload;
      renderUI();
    }
  });

  // Add click handler for matches list
  matchesList.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    
    // Handle tab switching
    const tabButton = target.closest('.tab-button');
    if (tabButton) {
      const tab = tabButton.getAttribute('data-tab') as 'recent' | 'archived';
      if (tab) {
        switchTab(tab);
      }
      return;
    }

    // Handle match actions (archive/restore)
    const actionButton = target.closest('.match-action-button');
    if (actionButton) {
      const matchId = actionButton.getAttribute('data-match-id');
      const action = actionButton.getAttribute('data-action');
      
      if (matchId && action === 'archive') {
        archiveMatch(matchId);
      } else if (matchId && action === 'restore') {
        restoreMatch(matchId);
      }
    }
  });

  // Setup other event listeners
  addFeedButton.addEventListener('click', () => {
    addFeedModal.style.display = 'flex';
    addFeedModal.classList.remove('hidden');
  });

  addTopicButton.addEventListener('click', () => {
    addTopicModal.style.display = 'flex';
    addTopicModal.classList.remove('hidden');
  });

  refreshFeedsButton.addEventListener('click', () => {
    console.log('Manually checking feeds...');
    chrome.runtime.sendMessage({ type: 'CHECK_FEEDS' }, (response: ExtensionState) => {
      if (chrome.runtime.lastError) {
        console.error('Error checking feeds:', chrome.runtime.lastError);
        return;
      }
      console.log('Feeds checked, updated state:', response);
      state = response;
      renderUI();
    });
  });

  // Add click handler for feed list
  feedsList.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const deleteButton = target.closest('[data-delete-feed]');
    if (deleteButton) {
      const feedId = deleteButton.getAttribute('data-delete-feed');
      if (feedId) {
        removeFeed(feedId);
      }
    }
  });

  // Add click handler for topic list
  topicsList.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const deleteButton = target.closest('[data-delete-topic]');
    if (deleteButton) {
      const topicId = deleteButton.getAttribute('data-delete-topic');
      if (topicId) {
        removeTopic(topicId);
      }
    }
  });

  // Add click handler for Cancel button in Add Feed modal
  const cancelAddFeedButton = document.getElementById('cancelAddFeed');
  if (cancelAddFeedButton) {
    cancelAddFeedButton.addEventListener('click', closeAddFeedModal);
  }

  // Add click handler for Cancel button in Add Topic modal
  const cancelAddTopicButton = document.getElementById('cancelAddTopic');
  if (cancelAddTopicButton) {
    cancelAddTopicButton.addEventListener('click', closeAddTopicModal);
  }

  // Close modals when clicking outside
  addFeedModal.addEventListener('click', (event) => {
    if (event.target === addFeedModal) {
      closeAddFeedModal();
    }
  });

  addTopicModal.addEventListener('click', (event) => {
    if (event.target === addTopicModal) {
      closeAddTopicModal();
    }
  });

  addFeedForm.addEventListener('submit', handleAddFeed);
  addTopicForm.addEventListener('submit', handleAddTopic);
});

// Render UI
function renderUI() {
  renderFeeds();
  renderTopics();
  renderMatches();
}

function renderFeeds() {
  if (state.feeds.length === 0) {
    feedsList.innerHTML = `
      <div class="empty-state">
        No feeds added yet. Click the + button to add an RSS feed.
      </div>
    `;
    return;
  }

  feedsList.innerHTML = state.feeds.map(feed => `
    <div class="card p-3">
      <div class="flex items-center justify-between">
        <div class="flex-grow">
          <h3 class="font-medium text-gray-200">${feed.name}</h3>
        </div>
        <button
          class="button w-4 h-4 flex items-center justify-center rounded-full ml-2"
          data-delete-feed="${feed.id}"
          title="Remove Feed"
        >
          <svg class="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      ${feed.lastChecked ? `
        <div class="mt-2 text-xs text-gray-500">
          Last checked: ${new Date(feed.lastChecked).toLocaleString()}
        </div>
      ` : ''}
    </div>
  `).join('');
}

function renderTopics() {
  if (state.topics.length === 0) {
    topicsList.innerHTML = `
      <div class="empty-state">
        No search topics added yet. Click the search icon to add a topic.
      </div>
    `;
    return;
  }

  topicsList.innerHTML = state.topics.map(topic => `
    <div class="card p-3">
      <div class="flex items-center justify-between">
        <div>
          <div class="flex items-center">
            <h3 class="font-medium text-gray-200">${topic.query}</h3>
            ${topic.caseSensitive ? `
              <span class="ml-2 text-xs badge px-2 py-0.5 rounded">Case Sensitive</span>
            ` : ''}
          </div>
        </div>
        <button
          class="button w-4 h-4 flex items-center justify-center rounded-full ml-2"
          data-delete-topic="${topic.id}"
          title="Remove Topic"
        >
          <svg class="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

function renderMatches() {
  // Always render the tab buttons
  const tabButtons = `
    <div class="flex items-center justify-between mb-4">
      <div class="flex space-x-2">
        <button 
          class="tab-button px-3 py-1 rounded-lg text-sm ${currentTab === 'recent' ? 'button' : 'text-gray-400 hover:text-gray-300'}"
          data-tab="recent"
        >
          Recent
        </button>
        <button 
          class="tab-button px-3 py-1 rounded-lg text-sm ${currentTab === 'archived' ? 'button' : 'text-gray-400 hover:text-gray-300'}"
          data-tab="archived"
        >
          Archived
        </button>
      </div>
    </div>
  `;

  if (state.recentMatches.length === 0) {
    matchesList.innerHTML = `
      ${tabButtons}
      <div class="empty-state">
        No ${currentTab === 'recent' ? '' : 'archived '}matches found yet.
        ${currentTab === 'recent' ? 'Matches will appear here when found.' : ''}
      </div>
    `;
    return;
  }

  const matches = state.recentMatches.filter(m => 
    currentTab === 'archived' ? m.archived : !m.archived
  );

  if (matches.length === 0) {
    matchesList.innerHTML = `
      ${tabButtons}
      <div class="empty-state">
        No ${currentTab === 'recent' ? '' : 'archived '}matches found yet.
        ${currentTab === 'recent' ? 'Matches will appear here when found.' : ''}
      </div>
    `;
    return;
  }

  matchesList.innerHTML = `
    ${tabButtons}
    <div class="space-y-2">
      ${matches.map(match => {
        const feed = state.feeds.find(f => f.id === match.feedId);

        return `
          <div class="card p-3">
            <div class="flex flex-col space-y-2">
              <h3 class="match-title font-medium text-gray-200">${match.title}</h3>
              <p class="match-feed">${feed?.name || 'Unknown Feed'}</p>
              <div class="flex items-center justify-between">
                <a
                  href="${match.link}"
                  target="_blank"
                  class="link-text text-sm inline-flex items-center group"
                >
                  Read Article
                  <svg class="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                  </svg>
                </a>
                <button
                  class="button w-4 h-4 flex items-center justify-center rounded-full match-action-button"
                  data-match-id="${match.id}"
                  data-action="${currentTab === 'recent' ? 'archive' : 'restore'}"
                  title="${currentTab === 'recent' ? 'Archive' : 'Restore'} Match"
                >
                  <svg class="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    ${currentTab === 'recent' 
                      ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>'
                      : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>'
                    }
                  </svg>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Add event listeners for tab buttons
  const tabButtonElements = matchesList.querySelectorAll('.tab-button');
  tabButtonElements.forEach(button => {
    button.addEventListener('click', (event) => {
      const tab = (event.currentTarget as HTMLButtonElement).dataset.tab as 'recent' | 'archived';
      switchTab(tab);
    });
  });

  // Add event listeners for match action buttons
  const actionButtons = matchesList.querySelectorAll('.match-action-button');
  actionButtons.forEach(button => {
    button.addEventListener('click', (event) => {
      const target = event.currentTarget as HTMLButtonElement;
      const matchId = target.dataset.matchId;
      const action = target.dataset.action;
      
      if (matchId && action === 'archive') {
        archiveMatch(matchId);
      } else if (matchId && action === 'restore') {
        restoreMatch(matchId);
      }
    });
  });
}

function switchTab(tab: 'recent' | 'archived') {
  currentTab = tab;
  renderMatches();
}

function archiveMatch(matchId: string) {
  const match = state.recentMatches.find(m => m.id === matchId);
  if (match) {
    match.archived = true;
    match.removedAt = Date.now();
    chrome.runtime.sendMessage({
      type: 'ARCHIVE_MATCH',
      payload: matchId
    }, (updatedState: ExtensionState) => {
      if (chrome.runtime.lastError) {
        console.error('Error archiving match:', chrome.runtime.lastError);
        return;
      }
      state = updatedState;
      renderUI();
    });
  }
}

function restoreMatch(matchId: string) {
  const match = state.recentMatches.find(m => m.id === matchId);
  if (match) {
    match.archived = false;
    match.removedAt = undefined;
    chrome.runtime.sendMessage({
      type: 'RESTORE_MATCH',
      payload: matchId
    }, (updatedState: ExtensionState) => {
      if (chrome.runtime.lastError) {
        console.error('Error restoring match:', chrome.runtime.lastError);
        return;
      }
      state = updatedState;
      renderUI();
    });
  }
}

// Event Handlers
let currentClearErrorFunction: (() => void) | null = null;
let currentTopicClearErrorFunction: (() => void) | null = null;

async function handleAddFeed(event: Event) {
  event.preventDefault();
  const formData = new FormData(event.target as HTMLFormElement);
  
  const url = formData.get('url') as string;
  const name = formData.get('name') as string;

  // Check if URL already exists
  const existingFeed = state.feeds.find(f => f.url === url);
  if (existingFeed) {
    const urlInput = addFeedForm.querySelector('input[name="url"]') as HTMLInputElement;
    urlInput.setCustomValidity('This RSS URL is already being monitored.');
    urlInput.reportValidity();

    // Add error styling
    urlInput.classList.add('border-red-500');
    
    // Add error message
    const errorDiv = document.createElement('div');
    errorDiv.className = 'text-red-500 text-sm mt-1';
    errorDiv.textContent = 'This RSS URL is already being monitored.';
    
    // Remove any existing error message
    const existingError = urlInput.parentElement?.querySelector('.text-red-500');
    if (existingError) {
      existingError.remove();
    }
    
    urlInput.parentElement?.appendChild(errorDiv);

    // Clear error when input changes
    const clearError = () => {
      urlInput.setCustomValidity('');
      urlInput.classList.remove('border-red-500');
      const errorMessage = urlInput.parentElement?.querySelector('.text-red-500');
      if (errorMessage) {
        errorMessage.remove();
      }
    };

    // Store the current clear error function
    if (currentClearErrorFunction) {
      urlInput.removeEventListener('input', currentClearErrorFunction);
    }
    currentClearErrorFunction = clearError;
    urlInput.addEventListener('input', clearError);
    return;
  }

  const feed: RSSFeed = {
    id: crypto.randomUUID(),
    name,
    url
  };

  chrome.runtime.sendMessage({
    type: 'NEW_FEED',
    payload: feed
  }, (updatedState: ExtensionState) => {
    if (chrome.runtime.lastError) {
      console.error('Error adding feed:', chrome.runtime.lastError);
      return;
    }
    console.log('Feed added, updated state:', updatedState);
    state = updatedState;
    renderUI();
    addFeedModal.style.display = 'none';
    addFeedModal.classList.add('hidden');
    addFeedForm.reset();
  });
}

async function handleAddTopic(event: Event) {
  event.preventDefault();
  const formData = new FormData(event.target as HTMLFormElement);
  
  const query = formData.get('query') as string;
  const caseSensitive = formData.get('caseSensitive') === 'on';

  // Check if topic already exists
  const existingTopic = state.topics.find(t => 
    t.query.toLowerCase() === query.toLowerCase() && 
    t.caseSensitive === caseSensitive
  );

  if (existingTopic) {
    const queryInput = addTopicForm.querySelector('input[name="query"]') as HTMLInputElement;
    queryInput.setCustomValidity('This search topic already exists.');
    queryInput.reportValidity();

    // Add error styling
    queryInput.classList.add('border-red-500');
    
    // Add error message
    const errorDiv = document.createElement('div');
    errorDiv.className = 'text-red-500 text-sm mt-1';
    errorDiv.textContent = 'This search topic already exists.';
    
    // Remove any existing error message
    const existingError = queryInput.parentElement?.querySelector('.text-red-500');
    if (existingError) {
      existingError.remove();
    }
    
    queryInput.parentElement?.appendChild(errorDiv);

    // Clear error when input changes
    const clearError = () => {
      queryInput.setCustomValidity('');
      queryInput.classList.remove('border-red-500');
      const errorMessage = queryInput.parentElement?.querySelector('.text-red-500');
      if (errorMessage) {
        errorMessage.remove();
      }
    };

    // Store the current clear error function
    if (currentTopicClearErrorFunction) {
      queryInput.removeEventListener('input', currentTopicClearErrorFunction);
    }
    currentTopicClearErrorFunction = clearError;
    queryInput.addEventListener('input', clearError);
    return;
  }

  const topic: SearchTopic = {
    id: crypto.randomUUID(),
    query,
    caseSensitive,
    notifyEmail: false,
    notifyExtension: true
  };

  chrome.runtime.sendMessage({
    type: 'NEW_TOPIC',
    payload: topic
  }, (updatedState: ExtensionState) => {
    if (chrome.runtime.lastError) {
      console.error('Error adding topic:', chrome.runtime.lastError);
      return;
    }
    console.log('Topic added, updated state:', updatedState);
    state = updatedState;
    renderUI();
    addTopicModal.style.display = 'none';
    addTopicModal.classList.add('hidden');
    addTopicForm.reset();
  });
}

// Helper Functions
function closeAddFeedModal() {
  // Clear any error states
  const urlInput = addFeedForm.querySelector('input[name="url"]') as HTMLInputElement;
  urlInput.setCustomValidity('');
  urlInput.classList.remove('border-red-500');
  
  // Remove any error messages
  const errorMessage = urlInput.parentElement?.querySelector('.text-red-500');
  if (errorMessage) {
    errorMessage.remove();
  }

  // Remove the input event listener if it exists
  if (currentClearErrorFunction) {
    urlInput.removeEventListener('input', currentClearErrorFunction);
    currentClearErrorFunction = null;
  }

  // Reset the form and clear all inputs
  addFeedForm.reset();
  
  // Hide the modal
  addFeedModal.style.display = 'none';
  addFeedModal.classList.add('hidden');
}

function closeAddTopicModal() {
  // Clear any error states
  const queryInput = addTopicForm.querySelector('input[name="query"]') as HTMLInputElement;
  queryInput.setCustomValidity('');
  queryInput.classList.remove('border-red-500');
  
  // Remove any error messages
  const errorMessage = queryInput.parentElement?.querySelector('.text-red-500');
  if (errorMessage) {
    errorMessage.remove();
  }

  // Remove the input event listener if it exists
  if (currentTopicClearErrorFunction) {
    queryInput.removeEventListener('input', currentTopicClearErrorFunction);
    currentTopicClearErrorFunction = null;
  }

  // Reset the form and clear all inputs
  addTopicForm.reset();
  
  // Hide the modal
  addTopicModal.style.display = 'none';
  addTopicModal.classList.add('hidden');
}

function removeFeed(feedId: string) {
  console.log('Removing feed:', feedId);
  chrome.runtime.sendMessage({
    type: 'REMOVE_FEED',
    payload: feedId
  }, (updatedState: ExtensionState) => {
    if (chrome.runtime.lastError) {
      console.error('Error removing feed:', chrome.runtime.lastError);
      return;
    }
    console.log('Feed removed, updated state:', updatedState);
    state = updatedState;
    renderUI();
  });
}

function removeTopic(topicId: string) {
  console.log('Removing topic:', topicId);
  chrome.runtime.sendMessage({
    type: 'REMOVE_TOPIC',
    payload: topicId
  }, (updatedState: ExtensionState) => {
    if (chrome.runtime.lastError) {
      console.error('Error removing topic:', chrome.runtime.lastError);
      return;
    }
    console.log('Topic removed, updated state:', updatedState);
    state = updatedState;
    renderUI();
  });
}

function updateDockIcon(isDocked: boolean) {
  const icon = toggleDockButton.querySelector('svg')!;
  if (isDocked) {
    icon.innerHTML = `
      <path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v16a1 1 0 01-1 1h-16a1 1 0 01-1-1V4z" stroke="currentColor" stroke-width="2" fill="none"/>
      <path d="M15 4v16" stroke="currentColor" stroke-width="2"/>
    `;
    toggleDockButton.title = "Switch to Popup";
  } else {
    icon.innerHTML = `
      <path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v16a1 1 0 01-1 1h-16a1 1 0 01-1-1V4z" stroke="currentColor" stroke-width="2" fill="none"/>
      <path d="M15 4v16" stroke="currentColor" stroke-width="2" stroke-dasharray="4 4"/>
    `;
    toggleDockButton.title = "Open as Side Panel";
  }
}

declare global {
  interface Window {
    closeAddFeedModal: typeof closeAddFeedModal;
    closeAddTopicModal: typeof closeAddTopicModal;
    removeFeed: typeof removeFeed;
    removeTopic: typeof removeTopic;
    switchTab: typeof switchTab;
    archiveMatch: typeof archiveMatch;
    restoreMatch: typeof restoreMatch;
  }
}

window.closeAddFeedModal = closeAddFeedModal;
window.closeAddTopicModal = closeAddTopicModal;
window.removeFeed = removeFeed;
window.removeTopic = removeTopic;
window.switchTab = switchTab;
window.archiveMatch = archiveMatch;
window.restoreMatch = restoreMatch; 