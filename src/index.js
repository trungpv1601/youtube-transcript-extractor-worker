import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Constants
const DEFAULT_TRANSCRIPT_LANGUAGE = 'en';
const DEFAULT_TRANSCRIPT_KIND = 'asr';
const CACHE_TTL_SECONDS = 3600; // Cache transcripts for 1 hour
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

// Common user agents for random selection
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:119.0) Gecko/20100101 Firefox/119.0'
];

// Custom Error for specific transcript issues
class TranscriptError extends Error {
    constructor(message, status = 404) {
        super(message);
        this.name = 'TranscriptError';
        this.status = status; // HTTP status code to return
    }
}

// Function to get a random user agent
const getRandomUserAgent = () => {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};

// Retry utility function with exponential backoff
const retryWithBackoff = async (fn, maxRetries = MAX_RETRIES, initialDelay = INITIAL_RETRY_DELAY) => {
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Don't retry on the last attempt
            if (attempt === maxRetries) {
                break;
            }

            // Calculate delay with exponential backoff (2^attempt * initialDelay)
            const delay = initialDelay * Math.pow(2, attempt);

            console.warn(`Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error.message);

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
};

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

// Enhanced protobuf-like encoding for YouTube transcript requests
export const buildTranscriptToken = (videoId, source, lang, lastFlag) => {
    // Encode raw binary string to Base64 and URL encode
    function b64urlEncodeBinary(binary) {
        return encodeURIComponent(btoa(binary));
    }

    // Build the inner protobuf-like blob
    const inner =
        String.fromCharCode(0x0A) + String.fromCharCode(source.length) + source +
        String.fromCharCode(0x12) + String.fromCharCode(lang.length) + lang +
        String.fromCharCode(0x1A) + String.fromCharCode(0x00);

    const innerB64 = btoa(inner);

    // Build the outer structure
    const panel = 'engagement-panel-searchable-transcript-search-panel';
    const outer =
        String.fromCharCode(0x0A) + String.fromCharCode(videoId.length) + videoId +
        String.fromCharCode(0x12) + String.fromCharCode(innerB64.length) + innerB64 +
        String.fromCharCode(0x18) + String.fromCharCode(0x01) +
        String.fromCharCode(0x2A) + String.fromCharCode(panel.length) + panel +
        String.fromCharCode(0x30) + String.fromCharCode(0x01) +
        String.fromCharCode(0x38) + String.fromCharCode(0x01) +
        String.fromCharCode(0x40) + String.fromCharCode(lastFlag ? 1 : 0);

    return b64urlEncodeBinary(outer);
};

// Enhanced function to fetch transcript from YouTube internal API with improved token generation
export const getTranscript = async (videoId, langOption) => {
    const { languageCode, kind, language } = langOption;
    let reqBodyToEncode = '';
    if (kind === 'asr') {
        reqBodyToEncode = buildTranscriptToken(videoId, kind, languageCode, true);
    } else {
        reqBodyToEncode = buildTranscriptToken(videoId, '', languageCode, true);
    }

    // Generate last 30 dates in YYYYMMDD format
    const dates = Array.from({ length: 30 }, (_, offset) => {
        const d = new Date();
        d.setDate(d.getDate() - offset);
        return d.toISOString().split("T")[0].replace(/-/g, "");
    });

    // Pick a random date and build the string
    const clientVersion = `2.${dates[~~(Math.random() * dates.length)]}.00.00`;

    const response = await fetch(
        "https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false",
        {
            headers: {
                "content-type": "application/json",
            },
            method: "POST",
            body: JSON.stringify({
                context: { client: { clientName: "WEB", clientVersion: clientVersion } },
                params: reqBodyToEncode,
            }),
        },
    );

    const responseData = await response.json();

    const initialSegments = responseData?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments;

    if (!initialSegments) {
        // Check if actions exist but don't contain the expected structure
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
        // This case handles when `initialSegments` exists but is empty or contains no valid text
        throw new TranscriptError(`Transcript was found but contained no text segments for language '${language}'.`);
    }

    const fullTranscript = parts.map(part => part.text).join(' ').trim();

    return {
        ...langOption,
        transcript: fullTranscript,
        parts: parts
    };
};

export const getLangOptionsWithLink = async (videoId) => {
    return await retryWithBackoff(async () => {
        const userAgent = getRandomUserAgent();
        const videoPageResponse = await fetch("https://www.youtube.com/watch?v=" + videoId, {
            headers: {
                'User-Agent': userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });

        if (!videoPageResponse.ok) {
            throw new Error(`Failed to fetch YouTube page: ${videoPageResponse.status} ${videoPageResponse.statusText}`);
        }

        const videoPageHtml = await videoPageResponse.text();
        const splittedHtml = videoPageHtml.split('"captions":');

        if (splittedHtml.length < 2) {
            return; // No Caption Available - this shouldn't be retried
        }

        let captions_json;
        try {
            captions_json = JSON.parse(splittedHtml[1].split(',"videoDetails')[0].replace('\n', ''));
        } catch (parseError) {
            throw new Error(`Failed to parse captions JSON: ${parseError.message}`);
        }

        if (!captions_json.playerCaptionsTracklistRenderer?.captionTracks) {
            throw new Error('Caption tracks not found in response');
        }

        const captionTracks = captions_json.playerCaptionsTracklistRenderer.captionTracks;
        const languageOptions = Array.from(captionTracks).map(i => { return i.name.simpleText; });

        const first = "English"; // Sort by English first
        languageOptions.sort(function (x, y) {
            return x.includes(first) ? -1 : y.includes(first) ? 1 : 0;
        });
        languageOptions.sort(function (x, y) {
            return x == first ? -1 : y == first ? 1 : 0;
        });

        return Array.from(languageOptions).map((langName, index) => {
            const captionTrack = captionTracks.find(i => i.name.simpleText === langName);
            const languageCode = captionTrack.languageCode;
            const kind = captionTrack?.kind || 'manual';
            return {
                language: langName,
                languageCode: languageCode,
                kind: kind
            };
        });
    });
};

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

// New endpoint for extracting YouTube languages
app.post('/languages', async (c) => {
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
        const cacheKey = `languages:${videoId}`;

        // 1. Check cache
        try {
            const cachedData = await c.env.MY_KV.get(cacheKey, 'json');
            if (cachedData) {
                console.log(`Cache hit for key: ${cacheKey}`);
                return c.json({
                    success: true,
                    videoId: videoId,
                    data: cachedData,
                    cache: 'hit'
                });
            }
            console.log(`Cache miss for key: ${cacheKey}`);
        } catch (kvError) {
            console.error(`KV get error for key ${cacheKey}:`, kvError);
            // Don't fail the request, just proceed without cache
        }

        // 2. Fetch from source if not in cache
        const languagesData = await getLangOptionsWithLink(videoId);

        // 3. Store in cache (fire and forget)
        c.executionCtx.waitUntil(
            c.env.MY_KV.put(cacheKey, JSON.stringify(languagesData), {
                expirationTtl: CACHE_TTL_SECONDS,
            })
                .then(() => console.log(`Cached data for key: ${cacheKey}`))
                .catch(err => console.error(`KV put error for key ${cacheKey}:`, err))
        );

        return c.json({
            success: true,
            videoId: videoId,
            data: languagesData,
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
        const kind = body?.kind || DEFAULT_TRANSCRIPT_KIND;

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
        const cacheKey = `transcript:${videoId}:${language}:${kind}`;

        // 1. Check cache
        try {
            const cachedData = await c.env.MY_KV.get(cacheKey, 'json');
            if (cachedData) {
                console.log(`Cache hit for key: ${cacheKey}`);
                return c.json({
                    success: true,
                    videoId: videoId,
                    language: language,
                    data: cachedData, // Spread the cached transcript data
                    cache: 'hit'
                });
            }
            console.log(`Cache miss for key: ${cacheKey}`);
        } catch (kvError) {
            console.error(`KV get error for key ${cacheKey}:`, kvError);
            // Don't fail the request, just proceed without cache
        }

        // 2. Fetch from source if not in cache
        const langOption = {
            languageCode: language,
            kind: kind,
            language: language // Display name for the language
        };
        const transcriptData = await getTranscript(videoId, langOption);

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
            data: transcriptData,
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
