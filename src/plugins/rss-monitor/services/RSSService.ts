import { RSSFeed, SearchTopic, FeedItem } from '../types';
import Parser from 'rss-parser';
import { createLogger } from '@maiar-ai/core';

const log = createLogger('rss-service');

export class RSSService {
  private parser: Parser;
  private feeds: Map<string, RSSFeed>;
  private topics: Map<string, SearchTopic>;

  constructor() {
    this.parser = new Parser();
    this.feeds = new Map();
    this.topics = new Map();
  }

  async addFeed(feed: RSSFeed): Promise<void> {
    try {
      // Validate feed URL by attempting to fetch
      await this.parser.parseURL(feed.url);
      this.feeds.set(feed.id, feed);
      log.info(`Added new feed: ${feed.name} (${feed.url})`);
    } catch (error) {
      log.error(`Failed to add feed: ${feed.url}`, error);
      throw new Error(`Invalid RSS feed URL: ${feed.url}`);
    }
  }

  async removeFeed(feedId: string): Promise<void> {
    this.feeds.delete(feedId);
    // Remove associated topics
    for (const [topicId, topic] of this.topics) {
      if (topic.id === feedId) {
        this.topics.delete(topicId);
      }
    }
    log.info(`Removed feed: ${feedId}`);
  }
  addTopic(topic: SearchTopic): void {
    if (!this.feeds.has(topic.id)) {
      throw new Error(`Feed ${topic.id} not found`);
    }
    this.topics.set(topic.id, topic);
    log.info(`Added new topic: ${topic.query} for feed ${topic.id}`);
  }

  removeTopic(topicId: string): void {
    this.topics.delete(topicId);
    log.info(`Removed topic: ${topicId}`);
  }

  async checkFeeds(): Promise<FeedItem[]> {
    const matches: FeedItem[] = [];

    for (const feed of this.feeds.values()) {
      try {
        const feedContent = await this.parser.parseURL(feed.url);
        const feedTopics = Array.from(this.topics.values())
          .filter(topic => topic.id === feed.id);

        for (const item of feedContent.items) {
          const matchedTopics = this.findMatches(item, feedTopics);
          if (matchedTopics.length > 0) {
            matches.push({
              id: `${feed.id}-${Date.now()}`,
              feedId: feed.id,
              title: item.title || '',
              description: item.contentSnippet || '',
              link: item.link || '',
              pubDate: item.pubDate || new Date().toISOString(),
              matchedTopics: matchedTopics.map(topic => topic.id),
              archived: false
            });
          }
        }

        // Update feed metadata
        this.feeds.set(feed.id, {
          ...feed,
          lastChecked: Date.now(),
          lastUpdate: feedContent.lastBuildDate ? new Date(feedContent.lastBuildDate).getTime() : Date.now()
        });
      } catch (error) {
        log.error(`Failed to check feed: ${feed.url}`, error);
      }
    }

    return matches;
  }

  private findMatches(item: Parser.Item, topics: SearchTopic[]): SearchTopic[] {
    return topics.filter(topic => {
      const content = `${item.title} ${item.contentSnippet}`.toLowerCase();
      const query = topic.caseSensitive ? topic.query : topic.query.toLowerCase();
      return content.includes(query);
    });
  }

  getFeeds(): RSSFeed[] {
    return Array.from(this.feeds.values());
  }

  getTopics(): SearchTopic[] {
    return Array.from(this.topics.values());
  }
} 