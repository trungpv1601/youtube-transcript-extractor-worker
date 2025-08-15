# 📺 YouTube Transcript Extractor Worker

A fast and reliable Cloudflare Worker that extracts transcripts from YouTube videos with intelligent caching and multi-language support.

## ✨ Features

- **Extract YouTube Transcripts**: Get full transcripts with timestamps from any YouTube video
- **Multi-language Support**: Automatically detect and extract transcripts in different languages
- **Smart Caching**: Uses Cloudflare KV storage to cache results for 1 hour, reducing API calls
- **Multiple Input Formats**: Accepts YouTube URLs or direct video IDs
- **CORS Enabled**: Ready for frontend integration
- **Error Handling**: Comprehensive error handling with specific error messages
- **Serverless**: Built on Cloudflare Workers for global edge deployment

## 🚀 Quick Start

### Prerequisites

- Node.js (v18 or later)
- A Cloudflare account
- Wrangler CLI installed globally: `npm install -g wrangler`

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd youtube-transcript-extractor-worker
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Setup Cloudflare KV**
   ```bash
   # Create a KV namespace
   wrangler kv:namespace create "MY_KV"
   # Update the KV namespace ID in wrangler.jsonc
   ```

4. **Login to Cloudflare**
   ```bash
   wrangler login
   ```

5. **Deploy to Cloudflare Workers**
   ```bash
   npm run deploy
   ```

## 📋 API Reference

### Base URL
After deployment: `https://your-worker-name.your-subdomain.workers.dev`

### Endpoints

#### 1. Health Check
```http
GET /
```
**Response:**
```json
{
  "success": true,
  "message": "📺 YouTube Transcript Extractor Worker is running!"
}
```

#### 2. Get Available Languages
```http
POST /languages
```
**Request Body:**
```json
{
  "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  // OR
  "videoId": "dQw4w9WgXcQ"
}
```
**Response:**
```json
{
  "success": true,
  "videoId": "dQw4w9WgXcQ",
  "data": [
    {
      "language": "English",
      "languageCode": "en",
      "kind": "asr"
    },
    {
      "language": "Spanish",
      "languageCode": "es",
      "kind": "manual"
    }
  ],
  "cache": "miss"
}
```

#### 3. Get Transcript
```http
POST /transcript
```
**Request Body:**
```json
{
  "videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "language": "en",  // Optional, defaults to "en"
  "kind": "asr"      // Optional, defaults to "asr"
}
```
**Response:**
```json
{
  "success": true,
  "videoId": "dQw4w9WgXcQ",
  "language": "en",
  "data": {
    "languageCode": "en",
    "kind": "asr",
    "language": "en",
    "transcript": "We're no strangers to love You know the rules and so do I...",
    "parts": [
      {
        "start": 0.0,
        "duration": 3.5,
        "text": "We're no strangers to love"
      },
      {
        "start": 3.5,
        "duration": 2.8,
        "text": "You know the rules and so do I"
      }
    ]
  },
  "cache": "hit"
}
```

## 💻 Usage Examples

### JavaScript/Fetch
```javascript
// Get available languages
const languagesResponse = await fetch('https://your-worker.workers.dev/languages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  })
});
const languages = await languagesResponse.json();

// Get transcript
const transcriptResponse = await fetch('https://your-worker.workers.dev/transcript', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    language: 'en'
  })
});
const transcript = await transcriptResponse.json();
```

### cURL
```bash
# Get available languages
curl -X POST https://your-worker.workers.dev/languages \
  -H "Content-Type: application/json" \
  -d '{"videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'

# Get transcript
curl -X POST https://your-worker.workers.dev/transcript \
  -H "Content-Type: application/json" \
  -d '{"videoUrl": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "language": "en"}'
```

## 🏗️ How It Works

1. **Video ID Extraction**: Supports various YouTube URL formats and direct video IDs
2. **YouTube API Integration**: Uses YouTube's internal transcript API with custom protobuf-like encoding
3. **Language Detection**: Fetches available caption tracks from YouTube's video page
4. **Smart Caching**: Caches both language options and transcripts in Cloudflare KV for 1 hour
5. **Error Handling**: Provides specific error messages for different failure scenarios

## 🛠️ Tech Stack

- **[Cloudflare Workers](https://workers.cloudflare.com/)**: Serverless platform
- **[Hono](https://hono.dev/)**: Lightweight web framework
- **[Cloudflare KV](https://developers.cloudflare.com/kv/)**: Key-value storage for caching
- **[Vitest](https://vitest.dev/)**: Testing framework
- **[Wrangler](https://developers.cloudflare.com/workers/wrangler/)**: Cloudflare Workers CLI

## 🧪 Development

### Run locally
```bash
npm run dev
```

### Run tests
```bash
npm test
```

### Deploy
```bash
npm run deploy
```

## 🔧 Configuration

The worker is configured via `wrangler.jsonc`:

- **KV Namespace**: Required for caching functionality
- **Compatibility Date**: Set to 2025-04-19
- **Node.js Compatibility**: Enabled for better performance

## 📝 Notes

- **Rate Limiting**: Be mindful of YouTube's rate limits when making many requests
- **Caching**: Transcripts are cached for 1 hour to improve performance and reduce API calls
- **CORS**: Currently set to allow all origins (`*`) - consider restricting in production
- **Error Handling**: The API provides specific error messages for different failure scenarios

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if needed
5. Submit a pull request

## 📄 License

This project is for educational and personal use. Please respect YouTube's Terms of Service when using this tool.

---

**Happy transcript extracting!** 🎉
