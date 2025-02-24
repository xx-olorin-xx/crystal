import { z } from 'zod';

// Schema for RSS Feed configuration
export const RSSFeedSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  name: z.string(),
  lastChecked: z.number().optional(),
  lastUpdate: z.number().optional(),
});

// Schema for Search Topic configuration
export const SearchTopicSchema = z.object({
  id: z.string(),
  query: z.string(),
  caseSensitive: z.boolean().default(false),
  notifyEmail: z.boolean().default(false),
  notifyExtension: z.boolean().default(true),
});

// Schema for Feed Item
export const FeedItemSchema = z.object({
  id: z.string(),
  feedId: z.string(),
  title: z.string(),
  description: z.string(),
  link: z.string().url(),
  pubDate: z.string(),
  matchedTopics: z.array(z.string()),
  archived: z.boolean().default(false),
  removedAt: z.number().optional()
});

export type RSSFeed = z.infer<typeof RSSFeedSchema>;
export type SearchTopic = z.infer<typeof SearchTopicSchema>;
export type FeedItem = z.infer<typeof FeedItemSchema>;

// Event types for Chrome extension communication
export interface ExtensionMessage {
  type: 'NEW_FEED' | 'REMOVE_FEED' | 'NEW_TOPIC' | 'REMOVE_TOPIC' | 'NEW_MATCHES' | 'ARCHIVE_MATCH' | 'RESTORE_MATCH';
  payload: any;
} 