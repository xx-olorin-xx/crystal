import { PluginBase, AgentContext } from '@maiar-ai/core';
import { RSSService } from './services/RSSService';
import { AddFeed, AddFeedSchema, AddTopicSchema } from './types';
import { getFeedTemplate, getTopicTemplate } from './templates';

export class PluginRSS extends PluginBase {
  private service: RSSService;

  constructor() {
    super({
      id: 'plugin-rss-monitor',
      name: 'RSS Monitor',
      description: 'Monitor RSS feeds for specific topics and notify through Chrome extension'
    });

    this.service = RSSService.getInstance();

    // Add executors for managing feeds and topics
    this.addExecutor({
      name: 'add_feed',
      description: 'Add a new RSS feed to monitor',
      execute: async (context: AgentContext) => {
        try {
          const feedData = await this.runtime.operations.getObject(
            AddFeedSchema,
            getFeedTemplate(context.contextChain),
            { temperature: 0.1 }
          );

          const feed = await this.service.addFeed(feedData as AddFeed);

          return { success: true, data: feed };
        } catch (error) {
          console.error('Error in add_feed:', error);
          return { 
            success: false, 
            error: error instanceof Error ? error.message : 'Failed to add feed' 
          };
        }
      }
    });

    this.addExecutor({
      name: 'add_topic',
      description: 'Add a new search topic to monitor across all RSS feeds',
      execute: async (context: AgentContext) => {
        try {
          const topicData = await this.runtime.operations.getObject(
            AddTopicSchema,
            getTopicTemplate(context.contextChain),
            { temperature: 0.1 }
          );

          const topicObj = {
            query: topicData.query,
            id: crypto.randomUUID(),
          }

          const topic = await this.service.addTopic(topicObj);
          return { success: true, data: topic };
        } catch (error) {
          console.error('Error in add_topic:', error);
          return { 
            success: false, 
            error: error instanceof Error ? error.message : 'Failed to add topic' 
          };
        }
      }
    });

    this.addExecutor({
      name: 'check_feeds',
      description: 'Checks all the feeds and their topics for news items. When someone asks to get the news or something you should run this. Also go ahead and run this after you add a new feed or topic.',
      execute: async () => {
        try {
          const matches = await this.service.checkFeeds();
          return { 
            success: true, 
            data: { 
              matchesFound: matches.length,
              message: matches.length > 0 
                ? `Found ${matches.length} new matches and added them to RSS state` 
                : 'No new matches found',
              matches: matches.map(match => ({
                title: match.title,
                description: match.description,
                link: match.link,
                pubDate: match.pubDate,
                matchedTopics: match.matchedTopics
              }))
            }
          };
        } catch (error) {
          console.error('Error checking feeds:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to check feeds'
          };
        }
      }
    });
  }
} 