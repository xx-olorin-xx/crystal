import { z } from 'zod';

// Zod Schemas
export const RSSFeedSchema = z.object({
  id: z.string().describe('Unique identifier for the feed'),
  name: z.string().describe('Display name for the feed'),
  url: z.string().url().describe('URL of the RSS feed')
});

export const SearchTopicSchema = z.object({
  id: z.string().describe('Unique identifier for this topic'),
  query: z.string().describe('The search query to match against RSS feed items')
});

export const FeedItemSchema = z.object({
  id: z.string(),
  feedId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  link: z.string().url(),
  pubDate: z.string(),
  matchedTopics: z.array(z.string()),
  archived: z.boolean().default(false),
  removedAt: z.number().optional()
});

export const AddFeedSchema = z.object({
  name: z.string().describe('Display name for the feed'),
  url: z.string().url().describe('URL of the RSS feed')
});

export const AddTopicSchema = z.object({
  query: z.string().describe('The search query')
});

// Type exports using Zod inference
export type RSSFeed = z.infer<typeof RSSFeedSchema>;
export type SearchTopic = z.infer<typeof SearchTopicSchema>;
export type FeedItem = z.infer<typeof FeedItemSchema>;
export type AddFeed = z.infer<typeof AddFeedSchema>;
export type AddTopic = z.infer<typeof AddTopicSchema>;
