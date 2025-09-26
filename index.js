// WooCommerce cookie patterns that bypass cache
const WOOCOMMERCE_BYPASS_COOKIES = [
  'woocommerce_cart_hash',
  'woocommerce_items_in_cart',
  'wp_woocommerce_session_'
];

// Aelia currency/country cookies for cache key differentiation
const AELIA_CACHE_COOKIES = [
  'aelia_cs_selected_currency',
  'aelia_customer_country'
];

// Cache settings
const CACHE_TTL = 86400; // 24 hours

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      console.error('Worker error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const cookies = parseCookies(request.headers.get('Cookie') || '');

  // Only cache GET requests
  if (request.method !== 'GET') {
    console.log('Bypassing cache for non-GET request');
    return await fetchFromOrigin(request);
  }

  // Don't cache /my-account or any subpaths
  if (url.pathname.startsWith('/my-account')) {
    console.log('Bypassing cache for /my-account path');
    return await fetchFromOrigin(request);
  }

  // Check if we should bypass cache due to WooCommerce cookies
  if (shouldBypassCache(cookies)) {
    console.log('Bypassing cache due to WooCommerce cookies');
    return await fetchFromOrigin(request);
  }

  // Generate custom cache key for Aelia paths
  const cacheKey = generateCacheKey(url, cookies);
  console.log('Cache key:', cacheKey);

  // Use the Cache API with custom cache key
  const cache = caches.default;

  // Try to get from cache first using cache key
  let response = await cache.match(cacheKey);

  if (response) {
    console.log('Cache HIT for:', cacheKey);
    // Clone response to add custom headers
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('CF-Cache-Status', 'HIT');
    newResponse.headers.set('X-Cache-Key', cacheKey);
    return newResponse;
  }

  console.log('Cache MISS for:', cacheKey);

  // Fetch from origin using ORIGINAL request (not cache key)
  response = await fetch(request, {
    cf: {
      // Cache everything for specified TTL
      cacheEverything: true,
      cacheTtl: CACHE_TTL,
      // Cache by status
      cacheTtlByStatus: {
        '200-299': CACHE_TTL,
        '404': 300,
        '500-599': 0
      }
    }
  });

  // Clone the response before consuming it
  const responseToCache = response.clone();

  // Store in cache if response is successful
  if (response.ok) {
    // Add cache headers to the cached response
    const headers = new Headers(responseToCache.headers);
    headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`);

    const cachedResponse = new Response(responseToCache.body, {
      status: responseToCache.status,
      statusText: responseToCache.statusText,
      headers: headers
    });

    // Store in Workers cache using cache key (not original URL)
    ctx.waitUntil(cache.put(cacheKey, cachedResponse));
  }

  // Add debug headers to the response
  const newResponse = new Response(response.body, response);
  const cfCacheStatus = response.headers.get('cf-cache-status') || 'MISS';
  newResponse.headers.set('CF-Cache-Status', cfCacheStatus);
  newResponse.headers.set('X-Cache-Key', cacheKey);
  newResponse.headers.set('X-Worker-Cache', 'MISS');

  return newResponse;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
  });

  return cookies;
}

function shouldBypassCache(cookies) {
  const cookieNames = Object.keys(cookies);

  return WOOCOMMERCE_BYPASS_COOKIES.some(pattern => {
    return cookieNames.some(cookieName => {
      if (pattern.endsWith('_')) {
        return cookieName.startsWith(pattern);
      } else {
        return cookieName === pattern;
      }
    });
  });
}

function isShopOrProductPath(pathname) {
  return pathname.startsWith('/shop') || pathname.startsWith('/product/');
}

function generateCacheKey(url, cookies) {
  const baseKey = `${url.protocol}//${url.host}${url.pathname}${url.search}`;

  if (isShopOrProductPath(url.pathname)) {
    const aeliaCookieValues = AELIA_CACHE_COOKIES
      .map(cookieName => `${cookieName}=${cookies[cookieName] || 'default'}`)
      .join('&');

    // Create a proper cache key URL
    const cacheKeyUrl = new URL(baseKey);
    cacheKeyUrl.searchParams.set('aelia_cache', encodeURIComponent(aeliaCookieValues));
    return cacheKeyUrl.toString();
  }

  return baseKey;
}

async function fetchFromOrigin(request) {
  // Forward request to origin server (your actual site)
  return await fetch(request);
}
