import { UserInputContext } from "@maiar-ai/core";
import {
  ExpressPlatformContext,
  ExpressRequest
} from "@maiar-ai/plugin-express";
import { NextFunction, Response, Router } from "express";
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { RSSService } from './plugins/rss-monitor/services/RSSService';

const router = Router();
const STATE_FILE = path.join(process.cwd(), 'data', 'rss-state.json');

// Enable CORS for all routes
router.use(cors());

// Get full RSS state
router.get("/rss-state", async (_req, res) => {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf8');
    const state = JSON.parse(data);
    res.json({
      ...state,
      feeds: state.feeds ? Object.values(state.feeds) : [],
      topics: state.topics ? Object.values(state.topics) : [],
      recentMatches: state.recentMatches || [],
      archivedMatches: state.archivedMatches || []
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read RSS state' });
  }
});

// Get feeds
router.get("/rss/feeds", async (_req, res) => {
  try {
    const service = RSSService.getInstance();
    const feeds = service.getFeeds();
    res.json(feeds);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get feeds' });
  }
});

// Add feed
router.post("/rss/feeds", async (req, res) => {
  try {
    const service = RSSService.getInstance();
    await service.addFeed(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Remove feed
router.delete("/rss/feeds/:id", async (req, res) => {
  try {
    const service = RSSService.getInstance();
    await service.removeFeed(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove feed' });
  }
});

// Get topics
router.get("/rss/topics", async (_req, res) => {
  try {
    const service = RSSService.getInstance();
    const topics = service.getTopics();
    // Convert Map to array and ensure proper serialization with all required fields
    res.json(topics.map(topic => ({
      id: topic.id,
      query: topic.query,
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to get topics' });
  }
});

// Add topic
router.post("/rss/topics", async (req, res) => {
  try {
    const service = RSSService.getInstance();
    await service.addTopic(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Remove topic
router.delete("/rss/topics/:id", async (req, res) => {
  try {
    const service = RSSService.getInstance();
    await service.removeTopic(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove topic' });
  }
});

// Archive match
router.post("/rss/matches/:id/archive", async (req, res) => {
  try {
    const service = RSSService.getInstance();
    service.archiveMatch(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to archive match' });
  }
});

// Restore match
router.post("/rss/matches/:id/restore", async (req, res) => {
  try {
    const service = RSSService.getInstance();
    service.restoreMatch(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to restore match' });
  }
});

// Check feeds manually
router.post("/rss/check", async (_req, res) => {
  try {
    const service = RSSService.getInstance();
    const matches = await service.checkFeeds();
    res.json(matches);
  } catch (error) {
    console.error('Error checking feeds:', error);
    res.status(500).json({ error: 'Failed to check feeds' });
  }
});

router.get("/", (_req, res) => {
  res.json({ message: "Hello World!" });
});

// Generic message endpoint that creates a context
router.post(
  "/message",
  async (req: ExpressRequest, res: Response, next: NextFunction) => {
    if (!req.plugin) {
      console.error("[Express Plugin] Error: No plugin instance available");
      return next(new Error("No plugin instance available"));
    }
    const { message, user } = req.body;
    console.log(
      `[Express Plugin] Received message from user ${user || "anonymous"}:`,
      message
    );

    const pluginId = req.plugin.id;
    // Create new context chain with initial user input
    const initialContext: UserInputContext = {
      id: `${pluginId}-${Date.now()}`,
      pluginId: pluginId,
      type: "user_input",
      action: "receive_message",
      content: message,
      timestamp: Date.now(),
      rawMessage: message,
      user: user || "anonymous"
    };

    // Create event with initial context and response handler
    const platformContext: ExpressPlatformContext = {
      platform: pluginId,
      responseHandler: (result: unknown) => res.json({
        message: typeof result === 'string' ? result : JSON.stringify(result),
        data: typeof result === 'object' ? result : undefined
      }),
      metadata: {
        req,
        res
      }
    };

    await req.plugin.runtime.createEvent(initialContext, platformContext);
  }
);

router.get("/health", (req, res) => {
  console.log("[Express Plugin] Health check requested");
  res.json({ status: "ok" });
});

export default router;