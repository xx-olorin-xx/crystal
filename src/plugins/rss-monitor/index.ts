import { PluginBase, AgentContext } from '@maiar-ai/core';
import { RSSService } from './services/RSSService';
import { RSSFeedSchema, SearchTopicSchema, ExtensionMessage } from './types';
import { z } from 'zod';

export class RSSMonitorPlugin extends PluginBase {
  private service: RSSService;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(config: { checkIntervalMs?: number }) {
    super({
      id: 'plugin-rss-monitor',
      name: 'RSS Monitor',
      description: 'Monitor RSS feeds for specific topics and notify through Chrome extension'
    });

    this.service = new RSSService();

    // Add executors for managing feeds and topics
    this.addExecutor({
      name: 'add_feed',
      description: 'Add a new RSS feed to monitor',
      execute: async (context: AgentContext) => {
        try {
          const feedData = await this.runtime.operations.getObject(
            RSSFeedSchema,
            context.contextChain.toString(),
            { temperature: 0.1 }
          );

          await this.service.addFeed(feedData);
          return { success: true, data: feedData };
        } catch (error) {
          return { 
            success: false, 
            error: error instanceof Error ? error.message : 'Failed to add feed' 
          };
        }
      }
    });

    this.addExecutor({
      name: 'add_topic',
      description: 'Add a new search topic to an RSS feed',
      execute: async (context: AgentContext) => {
        try {
          const topicData = await this.runtime.operations.getObject(
            SearchTopicSchema,
            context.contextChain.toString(),
            { temperature: 0.1 }
          );

          this.service.addTopic(topicData);
          return { success: true, data: topicData };
        } catch (error) {
          return { 
            success: false, 
            error: error instanceof Error ? error.message : 'Failed to add topic' 
          };
        }
      }
    });

    // Add trigger for Chrome extension communication
    this.addTrigger({
      id: 'extension-trigger',
      start: () => {
        // Start periodic feed checking
        const interval = config.checkIntervalMs || 5 * 60 * 1000; // Default: 5 minutes
        this.checkInterval = setInterval(async () => {
          const matches = await this.service.checkFeeds();
          if (matches.length > 0) {
            await this.runtime.createEvent({
              pluginId: this.id,
              action: 'new_matches',
              timestamp: Date.now(),
              rawMessage: JSON.stringify(matches),
              user: 'system',
              triggeredBy: 'feed-check'
            }, {
              responseHandler: (response) => {
                // Send to Chrome extension
                const message: ExtensionMessage = {
                  type: 'NEW_MATCHES',
                  payload: matches
                };
                // Extension communication would be handled here
                console.log('Sending to extension:', message);
              }
            });
          }
        }, interval);
      },
      cleanup: () => {
        if (this.checkInterval) {
          clearInterval(this.checkInterval);
          this.checkInterval = null;
        }
      }
    });
  }
} 