import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Buffer } from 'node:buffer'; // Required for Base64 encoding

// Constants
const YOUTUBE_CLIENT_NAME = 'WEB';
const YOUTUBE_CLIENT_VERSION = '2.20240701.01.00'; // Keep this relatively updated
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36';
const DEFAULT_TRANSCRIPT_LANGUAGE = 'en';
const YOUTUBE_INTERNAL_API_URL = 'https://www.youtube.com/youtubei/v1/get_transcript';
const CACHE_TTL_SECONDS = 3600; // Cache transcripts for 1 hour

// Custom Error for specific transcript issues
class TranscriptError extends Error {
    constructor(message, status = 404) {
        super(message);
        this.name = 'TranscriptError';
        this.status = status; // HTTP status code to return
    }
}

const app = new Hono();

// Consider restricting the origin in production environments for security.
app.use(cors({
    origin: '*',
}));

// Helper function to extract YouTube Video ID
function extractVideoId(url) {
    if (!url) return null;
    // Check if URL is already just the ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
        return url;
    }
    // Extract from standard YouTube URL patterns
    const patterns = [
        /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }
    return null;
}

// Simplified Protobuf encoding
// WARNING: This function manually encodes parameters assuming a specific,
// simple Protobuf structure. If YouTube changes the required structure for
// the internal API request, this function will need to be updated.
function getBase64Protobuf(message) {
    let parts = [];
    // Field 1: param1 (string) - tag 0A
    if (message.param1 !== undefined) {
        const param1Bytes = Buffer.from(message.param1, 'utf8');
        parts.push(Buffer.from([0x0A, param1Bytes.length]), param1Bytes);
    }
    // Field 2: param2 (string) - tag 12
    if (message.param2 !== undefined) {
        const param2Bytes = Buffer.from(message.param2, 'utf8');
        parts.push(Buffer.from([0x12, param2Bytes.length]), param2Bytes);
    }
    const buffer = Buffer.concat(parts);
    return buffer.toString('base64');
}

// Helper function to fetch transcript from YouTube internal API
// WARNING: This function uses an undocumented internal YouTube API (`youtubei`).
// This API can change at any time without notice, which may break this functionality.
// Use with caution and consider implementing robust monitoring and error handling.
async function getYoutubeTranscript(videoId, language = DEFAULT_TRANSCRIPT_LANGUAGE) {
    const message1 = {
        param1: 'asr', // Assumption: 'asr' might relate to Automatic Speech Recognition
        param2: language,
    };
    const protobufMessage1 = getBase64Protobuf(message1);

    const message2 = {
        param1: videoId,
        param2: protobufMessage1,
    };
    const params = getBase64Protobuf(message2);

    const url = YOUTUBE_INTERNAL_API_URL;

    const data = {
        context: {
            client: {
                clientName: YOUTUBE_CLIENT_NAME,
                clientVersion: YOUTUBE_CLIENT_VERSION,
            }
        },
        params: params
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            // It might be useful to mimic a browser user-agent
            'User-Agent': BROWSER_USER_AGENT
        },
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to fetch transcript: ${response.status} ${response.statusText}`, errorText);
        // Throw a generic error for network/API issues
        throw new Error(`Failed to fetch transcript. Status code: ${response.status}`);
    }

    const responseData = await response.json();

    // Accessing the transcript data using optional chaining for resilience
    // WARNING: The structure of this response is subject to change without notice.
    const initialSegments = responseData?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments;

    if (!initialSegments) {
        // Check if actions exist but don't contain the expected structure. This often means no transcript is available.
        const actions = responseData?.actions;
        if (actions && actions[0]?.updateEngagementPanelAction?.targetId === "engagement-panel-searchable-transcript") {
             // This specific targetId without initialSegments often indicates no captions for the language
             throw new TranscriptError(`No transcript found for this video in the specified language ('${language}').`);
        } else {
            // A more general structure mismatch error
            console.warn('Transcript data structure not found or unexpectedly changed in response:', JSON.stringify(responseData, null, 2));
            throw new TranscriptError(`Could not parse transcript data. The API structure might have changed.`, 500);
        }
    }

    const parts = [];
    for (const segment of initialSegments) {
        const renderer = segment?.transcriptSegmentRenderer;
        // Ensure all necessary fields are present
        if (!renderer || typeof renderer.startMs === 'undefined' || typeof renderer.endMs === 'undefined' || !renderer.snippet?.runs) {
            continue;
        }

        let text = '';
        for (const run of renderer.snippet.runs) {
            // Ensure text exists before appending
            if (typeof run?.text === 'string') {
               text += run.text;
            }
        }
        text = text.trim().replace(/\s+/g, ' '); // Normalize whitespace

        if (!text) {
            continue; // Skip segments with no actual text
        }

        const startMs = parseInt(renderer.startMs, 10);
        const endMs = parseInt(renderer.endMs, 10);

        // Basic validation for timing
        if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
            console.warn('Skipping segment with invalid timing:', renderer);
            continue;
        }

        parts.push({
            start: startMs / 1000,
            duration: (endMs - startMs) / 1000,
            text: text,
        });
    }

    if (parts.length === 0) {
        // This case handles when `initialSegments` exists but is empty or contains no valid text.
         throw new TranscriptError(`Transcript was found but contained no text segments for language '${language}'.`);
    }

    const fullTranscript = parts.map(part => part.text).join(' ').trim();

    return {
        transcript: fullTranscript,
        parts: parts
    };
}

app.get('/', async (c) => {
    try {
        return c.json({
            success: true,
            message: '📺 YouTube Transcript Extractor Worker is running!'
        });
    } catch (error) {
        console.error('Root endpoint error:', error);
        return c.json({
            success: false,
            error: error.message || 'An unexpected error occurred.'
        }, 500);
    }
});

// New endpoint for extracting YouTube transcripts
app.post('/transcript', async (c) => {
    // Ensure KV namespace is available
    if (!c.env.MY_KV) {
        console.error('MY_KV binding is not configured in wrangler.jsonc or environment.');
        return c.json({
            success: false,
            error: 'Server configuration error: Cache not available.'
        }, 500);
    }

    try {
        const body = await c.req.json();
        const videoUrl = body?.videoUrl || body?.videoId;
        const language = body?.language || DEFAULT_TRANSCRIPT_LANGUAGE;

        if (!videoUrl) {
            return c.json({
                success: false,
                error: 'Missing videoUrl or videoId in request body.'
            }, 400);
        }

        const videoId = extractVideoId(videoUrl);

        if (!videoId) {
            return c.json({
                success: false,
                error: 'Invalid YouTube URL or video ID provided.'
            }, 400);
        }

        // Generate cache key
        const cacheKey = `transcript:${videoId}:${language}`;

        // 1. Check cache
        try {
            const cachedData = await c.env.MY_KV.get(cacheKey, 'json');
            if (cachedData) {
                console.log(`Cache hit for key: ${cacheKey}`);
                return c.json({
                    success: true,
                    videoId: videoId,
                    language: language,
                    ...cachedData, // Spread the cached transcript data
                    cache: 'hit'
                });
            }
             console.log(`Cache miss for key: ${cacheKey}`);
        } catch (kvError) {
            console.error(`KV get error for key ${cacheKey}:`, kvError);
            // Don't fail the request, just proceed without cache
        }

        // 2. Fetch from source if not in cache
        const transcriptData = await getYoutubeTranscript(videoId, language);

        // 3. Store in cache (fire and forget)
        c.executionCtx.waitUntil(
            c.env.MY_KV.put(cacheKey, JSON.stringify(transcriptData), {
                expirationTtl: CACHE_TTL_SECONDS,
            })
            .then(() => console.log(`Cached data for key: ${cacheKey}`))
            .catch(err => console.error(`KV put error for key ${cacheKey}:`, err))
        );

        return c.json({
            success: true,
            videoId: videoId,
            language: language,
            ...transcriptData,
            cache: 'miss' // Indicate that this result was fetched, not from cache
        });

    } catch (error) {
        console.error('Transcript extraction error:', error);
        // Handle specific TranscriptError
        if (error instanceof TranscriptError) {
             return c.json({
                success: false,
                error: error.message
            }, error.status); // Use status from the custom error
        }
        // Handle generic errors
        return c.json({
            success: false,
            error: error.message || 'An unexpected error occurred.'
        }, 500);
    }
});

export default app;
