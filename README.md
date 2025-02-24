# Crystal - Your Crystal Ball for the Web

Crystal is a Chrome extension that acts as your crystal ball for the web, helping you monitor RSS feeds and discover insights across the internet. It provides real-time monitoring of RSS feeds with customizable search topics and notifications.

## Features

- 🔮 Monitor multiple RSS feeds in real-time
- 🔍 Create custom search topics with case-sensitive options
- 🔔 Get instant notifications for matching content
- 📌 Archive and restore matched items
- 🖥️ Flexible viewing options (popup or side panel)
- 💫 Beautiful, modern dark theme with glowing accents

## Development Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/crystal.git
cd crystal
```

2. Install dependencies:
```bash
pnpm install
```

3. Build the extension:
```bash
pnpm build:extension
```

4. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist/extension` directory

## Development Scripts

- `pnpm build:extension` - Build the extension
- `pnpm watch:extension` - Build and watch for changes
- `pnpm generate-icons` - Generate extension icons

## Tech Stack

- TypeScript
- Chrome Extension APIs
- Webpack
- Tailwind CSS
- Sharp (for icon generation)

## License

ISC License 