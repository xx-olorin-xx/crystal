interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  data?: any;
}

interface ChatResponse {
  message: string;
  data?: any;
}

export class ChatClient {
  private static instance: ChatClient;
  private baseUrl: string;
  private messages: ChatMessage[] = [];

  private constructor() {
    // TODO: Make this configurable via environment/build process
    this.baseUrl = 'http://localhost:3000';
  }

  public static getInstance(): ChatClient {
    if (!ChatClient.instance) {
      ChatClient.instance = new ChatClient();
    }
    return ChatClient.instance;
  }

  public async sendMessage(content: string, user: string = 'anonymous'): Promise<void> {
    try {
      // Add user message to local state
      this.messages.push({
        role: 'user',
        content,
        timestamp: Date.now()
      });

      // Send message to server
      const response = await fetch(`${this.baseUrl}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: content,
          user
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result: ChatResponse = await response.json();

      // Add assistant response to local state
      this.messages.push({
        role: 'assistant',
        content: result.message,
        timestamp: Date.now(),
        data: result.data
      });
    } catch (error) {
      console.error('Error sending message:', error);
      // Add error message to local state
      this.messages.push({
        role: 'assistant',
        content: 'Sorry, I encountered an error while processing your message. Please try again.',
        timestamp: Date.now()
      });
      throw error;
    }
  }

  public getRecentMessages(limit: number = 50): ChatMessage[] {
    return this.messages.slice(-limit);
  }

  public async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      const data = await response.json();
      return data.status === 'ok';
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  }
} 