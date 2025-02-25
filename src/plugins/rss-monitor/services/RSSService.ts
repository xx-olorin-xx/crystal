import { RSSFeed, SearchTopic, FeedItem, AddFeed, AddTopic } from '../types';
import Parser from 'rss-parser';
import { createLogger } from '@maiar-ai/core';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const log = createLogger('rss-service');
const STATE_FILE = path.join(process.cwd(), 'data', 'rss-state.json');
const MAX_RECENT_MATCHES = 100; // Keep last 100 matches

export class RSSService {
  private static instance: RSSService;
  private parser: Parser;
  private feeds: Map<string, RSSFeed>;
  private topics: Map<string, SearchTopic>;
  private recentMatches: FeedItem[] = [];
  private archivedMatches: FeedItem[] = [];

  private constructor() {
    this.parser = new Parser();
    this.feeds = new Map();
    this.topics = new Map();
    this.recentMatches = [];
    this.archivedMatches = [];
    this.loadState();
  }

  public static getInstance(): RSSService {
    if (!RSSService.instance) {
      RSSService.instance = new RSSService();
    }
    return RSSService.instance;
  }

  private addNewMatches(newMatches: FeedItem[]) {
    log.info(`Current recentMatches before adding: ${this.recentMatches.length}`);
    // Add new matches to the beginning of recentMatches
    this.recentMatches.unshift(...newMatches);
    
    // Keep only the most recent matches up to MAX_RECENT_MATCHES
    if (this.recentMatches.length > MAX_RECENT_MATCHES) {
      this.recentMatches = this.recentMatches.slice(0, MAX_RECENT_MATCHES);
    }
    log.info(`Updated recentMatches after adding: ${this.recentMatches.length}`);
  }

  public archiveMatch(matchId: string) {
    const matchIndex = this.recentMatches.findIndex(m => m.id === matchId);
    if (matchIndex !== -1) {
      const match = this.recentMatches[matchIndex];
      match.archived = true;
      this.archivedMatches.push(match);
      this.recentMatches.splice(matchIndex, 1);
      this.saveState();
    }
  }

  public restoreMatch(matchId: string) {
    const matchIndex = this.archivedMatches.findIndex(m => m.id === matchId);
    if (matchIndex !== -1) {
      const match = this.archivedMatches[matchIndex];
      match.archived = false;
      this.recentMatches.unshift(match);
      this.archivedMatches.splice(matchIndex, 1);
      this.saveState();
    }
  }

  private async loadState() {
    try {
      // Ensure data directory exists
      await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
      
      // Try to read state file
      try {
        const data = await fs.readFile(STATE_FILE, 'utf8');
        const state = JSON.parse(data);
        
        if (state.feeds) {
          this.feeds = new Map(Object.entries(state.feeds));
        }
        if (state.topics) {
          this.topics = new Map(Object.entries(state.topics));
        }
        if (state.recentMatches) {
          this.recentMatches = state.recentMatches;
        }
        if (state.archivedMatches) {
          this.archivedMatches = state.archivedMatches;
        }
        log.info('Loaded RSS state from file');
      } catch (e) {
        // File doesn't exist or is invalid, create it
        await this.saveState();
        log.info('Created new RSS state file');
      }
    } catch (error) {
      log.error('Failed to load RSS state:', error);
    }
  }

  private async saveState() {
    try {
      // Convert Maps to objects for storage
      const state = {
        feeds: Object.fromEntries(this.feeds),
        topics: Object.fromEntries(this.topics),
        recentMatches: this.recentMatches,
        archivedMatches: this.archivedMatches
      };
      
      await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
      log.info('Saved RSS state to file');
    } catch (error) {
      log.error('Failed to save RSS state:', error);
    }
  }

  async addFeed(data: AddFeed): Promise<RSSFeed> {
    try {
      const feed: RSSFeed = {
        id: crypto.randomUUID(),
        name: data.name,
        url: data.url
      };

      // Validate feed URL by attempting to fetch
      await this.parser.parseURL(feed.url);
      this.feeds.set(feed.id, feed);
      await this.saveState();
      log.info(`Added new feed: ${feed.name} (${feed.url})`);
      return feed;
    } catch (error) {
      log.error(`Failed to add feed: ${data.url}`, error);
      throw new Error(`Invalid RSS feed URL: ${data.url}`);
    }
  }

  async removeFeed(feedId: string): Promise<void> {
    this.feeds.delete(feedId);
    await this.saveState();
    log.info(`Removed feed: ${feedId}`);
  }

  async addTopic(data: AddTopic): Promise<SearchTopic> {
    const topic: SearchTopic = {
      id: crypto.randomUUID(),
      query: String(data.query)
    };

    this.topics.set(topic.id, topic);
    await this.saveState();
    log.info(`Added new topic: ${topic.query}`);
    return topic;
  }

  async removeTopic(topicId: string): Promise<void> {
    this.topics.delete(topicId);
    await this.saveState();
    log.info(`Removed topic: ${topicId}`);
  }

  async checkFeeds(): Promise<FeedItem[]> {
    const matches: FeedItem[] = [];
    const allTopics = Array.from(this.topics.values());
    log.info(`Checking feeds with ${allTopics.length} topics: ${allTopics.map(t => t.query).join(', ')}`);
    log.info(`Current recentMatches at start: ${this.recentMatches.length}`);

    for (const feed of this.feeds.values()) {
      try {
        log.info(`Checking feed: ${feed.name} (${feed.url})`);
        const feedContent = await this.parser.parseURL(feed.url);
        log.info(`Found ${feedContent.items.length} items in feed ${feed.name}`);
        
        for (const item of feedContent.items) {
          const matchedTopics = this.findMatches(item, allTopics);
          if (matchedTopics.length > 0) {
            log.info(`Found match in "${item.title}" for topics: ${matchedTopics.map(t => t.query).join(', ')}`);
            const matchId = `${feed.id}-${item.guid || item.link || Date.now()}`;
            // Check if we already have this match
            const isDuplicate = this.recentMatches.some(m => m.id === matchId) || 
                              this.archivedMatches.some(m => m.id === matchId);
            
            log.info(`Match "${item.title}" isDuplicate: ${isDuplicate}`);
            
            if (!isDuplicate) {
              const newMatch = {
                id: matchId,
                feedId: feed.id,
                title: item.title || '',
                description: item.contentSnippet || '',
                link: item.link || '',
                pubDate: item.pubDate || new Date().toISOString(),
                matchedTopics: matchedTopics.map(topic => topic.id),
                archived: false
              };
              matches.push(newMatch);
              // Add directly to recentMatches
              this.addNewMatches([newMatch]);
              log.info(`Added new match: "${newMatch.title}"`);
            } else {
              log.info(`Skipping duplicate match: "${item.title}" (found in ${this.recentMatches.some(m => m.id === matchId) ? 'recentMatches' : 'archivedMatches'})`);
            }
          }
        }

        // Update feed metadata
        this.feeds.set(feed.id, {
          ...feed
        });
      } catch (error) {
        log.error(`Failed to check feed: ${feed.url}`, error);
      }
    }

    // Save state after all matches are processed
    if (matches.length > 0) {
      await this.saveState();
      log.info(`Saved ${matches.length} new matches to state`);
    } else {
      log.info('No new matches found');
    }
    
    log.info(`Final recentMatches count: ${this.recentMatches.length}`);
    return matches;
  }

  private findMatches(item: Parser.Item, topics: SearchTopic[]): SearchTopic[] {
    return topics.filter(topic => {
      const content = `${item.title} ${item.contentSnippet}`.toLowerCase();
      const query = topic.query.toLowerCase();
      return content.includes(query);
    });
  }

  getFeeds(): RSSFeed[] {
    return Array.from(this.feeds.values());
  }

  getTopics(): SearchTopic[] {
    return Array.from(this.topics.values());
  }

  getRecentMatches(): FeedItem[] {
    return this.recentMatches;
  }

  getArchivedMatches(): FeedItem[] {
    return this.archivedMatches;
  }
} 