import { RSSFeed, SearchTopic, FeedItem } from '../../plugins/rss-monitor/types';
import { ChatClient } from './services/ChatClient';

const API_BASE = 'http://localhost:3000';

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
let currentView = 'rss-monitor'; // 'rss-monitor' or 'maiar-ai'

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
const chatMessages = document.getElementById('chatMessages')!;
const chatInput = document.getElementById('chatInput') as HTMLInputElement;
const sendChatButton = document.getElementById('sendChat') as HTMLButtonElement;

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
  // Initialize UI elements
  updateChatMessages();

  // Listen for storage changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.rss_feeds || changes.rss_topics) {
      // Reload state and update UI
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response: ExtensionState) => {
        console.log('State updated from storage:', response);
        state = response;
        renderUI();
      });
    }
  });

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

  // Initialize state and start feed checking
  await initialize();

  // Setup tab navigation
  const tabButtons = document.querySelectorAll('.tab-button');
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const view = button.getAttribute('data-view');
      if (view) {
        switchView(view);
      }
    });
  });

  // Setup chat functionality
  chatInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      await handleChatSubmit();
    }
  });

  sendChatButton.addEventListener('click', handleChatSubmit);

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

  topicsList.innerHTML = state.topics.map(topic => renderTopic(topic)).join('');
}

function renderTopic(topic: SearchTopic) {
  return `
    <div class="card p-3">
      <div class="flex items-center justify-between">
        <div class="flex-1">
          <div class="text-sm font-medium text-gray-200">${topic.query}</div>
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
  `;
}

function renderMatches() {
  // Always render the tab buttons (now just the Recent tab)
  const tabButtons = `
    <div class="flex items-center justify-between mb-4">
      <div class="flex space-x-2">
        <button 
          class="tab-button px-3 py-1 rounded-lg text-sm button"
          data-tab="recent"
        >
          Recent
        </button>
      </div>
    </div>
  `;

  if (state.recentMatches.length === 0) {
    matchesList.innerHTML = `
      ${tabButtons}
      <div class="empty-state">
        No matches found yet. Matches will appear here when found.
      </div>
    `;
    return;
  }

  const matches = state.recentMatches.filter(m => !m.archived);

  if (matches.length === 0) {
    matchesList.innerHTML = `
      ${tabButtons}
      <div class="empty-state">
        No matches found yet. Matches will appear here when found.
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
                  data-action="archive"
                  title="Archive Match"
                >
                  <svg class="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Add event listeners for match action buttons
  const actionButtons = matchesList.querySelectorAll('.match-action-button');
  actionButtons.forEach(button => {
    button.addEventListener('click', (event) => {
      const target = event.currentTarget as HTMLButtonElement;
      const matchId = target.dataset.matchId;
      const action = target.dataset.action;
      
      if (matchId && action === 'archive') {
        archiveMatch(matchId);
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

function showError(message: string) {
  // TODO: Implement error toast/notification
  console.error(message);
}

function showSuccess(message: string) {
  // TODO: Implement success toast/notification
  console.log(message);
}

async function handleAddFeed(event: Event) {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const formData = new FormData(form);
  const name = formData.get('name') as string;
  const url = formData.get('url') as string;

  try {
    const response = await fetch(`${API_BASE}/api/feeds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        url
      })
    });

    if (!response.ok) {
      throw new Error('Failed to add feed');
    }

    const feed = await response.json();
    state.feeds.push(feed);
    renderFeeds();
    form.reset();
    showSuccess('Feed added successfully');
  } catch (error) {
    console.error('Error adding feed:', error);
    showError('Failed to add feed');
  }
}

async function handleAddTopic(event: Event) {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const formData = new FormData(form);
  const query = formData.get('query') as string;

  try {
    const existingTopic = state.topics.find(t => t.query === query);
    if (existingTopic) {
      showError('A topic with this query already exists');
      return;
    }

    const response = await fetch(`${API_BASE}/api/topics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query
      })
    });

    if (!response.ok) {
      throw new Error('Failed to add topic');
    }

    const topic = await response.json();
    state.topics.push(topic);
    renderTopics();
    form.reset();
    showSuccess('Topic added successfully');
  } catch (error) {
    console.error('Error adding topic:', error);
    showError('Failed to add topic');
  }
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

// Handle chat submission
async function handleChatSubmit() {
  const content = chatInput.value.trim();
  if (!content) return;

  try {
    // Clear input and disable it during processing
    chatInput.value = '';
    chatInput.disabled = true;
    sendChatButton.disabled = true;

    // Add loading state
    const loadingMessage = document.createElement('div');
    loadingMessage.className = 'message system';
    loadingMessage.innerHTML = '<p>Processing your message...</p>';
    chatMessages.appendChild(loadingMessage);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Send message using ChatClient
    await ChatClient.getInstance().sendMessage(content);

    // Update messages display
    updateChatMessages();
  } catch (error) {
    console.error('Error sending message:', error);
    // Show error in UI
    const errorMessage = document.createElement('div');
    errorMessage.className = 'message system error';
    errorMessage.innerHTML = '<p>Failed to send message. Please try again.</p>';
    chatMessages.appendChild(errorMessage);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } finally {
    // Re-enable input
    chatInput.disabled = false;
    sendChatButton.disabled = false;
    chatInput.focus();
  }
}

// Update chat messages display
function updateChatMessages() {
  const messages = ChatClient.getInstance().getRecentMessages();
  
  if (messages.length === 0) {
    chatMessages.innerHTML = `
      <div class="message system">
        <p>Welcome! How can I help you today?</p>
      </div>
    `;
    return;
  }

  chatMessages.innerHTML = messages.map(message => {
    let html = `
      <div class="message ${message.role}">
        <div class="message-content">${message.content}</div>
        <div class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</div>
    `;

    if (message.data && Array.isArray(message.data)) {
      html += `
        <div class="chat-matches">
          ${message.data.map(item => `
            <div class="card p-3">
              <div class="match-title font-medium text-gray-200">${item.title}</div>
              <div class="match-feed mt-1">${item.feedName}</div>
              <div class="flex items-center justify-between mt-2">
                <a href="${item.link}" target="_blank" class="link-text text-sm inline-flex items-center group">
                  Read Article
                  <svg class="w-4 h-4 ml-1 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                  </svg>
                </a>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }

    html += '</div>';
    return html;
  }).join('');

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// View Functions
function switchView(view: string) {
  currentView = view;
  
  // Update tab buttons
  const tabButtons = document.querySelectorAll('.tab-button');
  tabButtons.forEach(button => {
    if (button.getAttribute('data-view') === view) {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
    }
  });

  // Update views
  const views = document.querySelectorAll('.view');
  views.forEach(viewElement => {
    if (viewElement.id === view) {
      viewElement.classList.add('active');
    } else {
      viewElement.classList.remove('active');
    }
  });

  // Update chat messages if switching to MAIAR AI view
  if (view === 'maiar-ai') {
    updateChatMessages();
  }
}

// Refresh all RSS data from API
async function refreshRSSData() {
  try {
    // Fetch feeds
    const feedsResponse = await fetch(`${API_BASE}/rss/feeds`);
    if (!feedsResponse.ok) throw new Error('Failed to fetch feeds');
    const feeds = await feedsResponse.json();
    state.feeds = Array.isArray(feeds) ? feeds : [];
    console.log('Fetched feeds:', state.feeds);

    // Fetch topics
    const topicsResponse = await fetch(`${API_BASE}/rss/topics`);
    if (!topicsResponse.ok) throw new Error('Failed to fetch topics');
    const topics = await topicsResponse.json();
    console.log('Raw topics from API:', topics);

    // Ensure topics are properly structured
    state.topics = Array.isArray(topics) ? topics.map(topic => {
      // Log each topic as we process it
      console.log('Processing topic:', topic);
      
      return {
        id: String(topic.id || ''),
        query: String(topic.query || ''),
        caseSensitive: Boolean(topic.caseSensitive),
        notifyEmail: Boolean(topic.notifyEmail ?? false),
        notifyExtension: Boolean(topic.notifyExtension ?? true)
      };
    }) : [];
    
    console.log('Processed topics:', state.topics);

    // Update UI
    renderUI();
  } catch (error) {
    console.error('Error refreshing RSS data:', error);
  }
}

// Initialize state and start feed checking
async function initialize() {
  console.group('Initializing Extension');
  try {
    // Load initial state from API
    await refreshRSSData();
  } catch (error) {
    console.error('Error during initialization:', error);
  }
  console.groupEnd();
}

// Get initial state
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response: ExtensionState) => {
  console.log('Initial state:', response);
  state = response;
  renderUI();
});

// Listen for state updates
chrome.runtime.onMessage.addListener((message: { type: string; payload: any }) => {
  if (message.type === 'STATE_UPDATED') {
    console.log('State update received:', message.payload);
    
    // Ensure topics are properly structured
    if (message.payload.topics) {
      state.topics = message.payload.topics.map((topic: any) => ({
        id: String(topic.id || ''),
        query: String(topic.query || ''),
        caseSensitive: Boolean(topic.caseSensitive),
        notifyEmail: Boolean(topic.notifyEmail ?? false),
        notifyExtension: Boolean(topic.notifyExtension ?? true)
      }));
      console.log('Processed topics after state update:', state.topics);
    }

    // Update other state properties
    state.feeds = message.payload.feeds || [];
    state.recentMatches = message.payload.recentMatches || [];
    
    renderUI();
  }
});

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