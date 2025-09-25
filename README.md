# WooCommerce Cloudflare Worker with Aelia Multi-Currency Support

A Cloudflare Worker that provides intelligent caching for WooCommerce sites with support for Aelia Multi-Currency and country-specific caching.

## Features

- **Smart Cache Bypass**: Automatically bypasses cache for users with active shopping carts or sessions
- **Currency-Aware Caching**: Caches shop and product pages separately based on selected currency and country
- **Stale-While-Revalidate**: Serves stale content instantly while refreshing in background for optimal performance
- **Path-Based Caching**: Different cache key strategies for shop/product vs other pages
- **WooCommerce Integration**: Handles WooCommerce-specific cookies and session management
- **Long TTL Optimized**: 24-hour cache TTL ideal for mostly static content

## How It Works

### Cache Bypass Logic
The worker bypasses caching when any of these cookie patterns are present:
- `woocommerce_cart_hash` - User has items in cart
- `woocommerce_items_in_cart` - Cart item count cookie
- `wp_woocommerce_session_*` - Any WooCommerce session cookie

### Caching Strategy (Stale-While-Revalidate)

The worker uses a **Stale-While-Revalidate (SWR)** strategy for optimal performance:

- **Fresh Cache** (age < 24 hours): Served instantly from cache
- **Stale Cache** (age > 24 hours): Served instantly from cache + background refresh triggered
- **Cache Miss**: Fetched from origin server

#### Shop and Product Pages (`/shop/*`, `/product/*`)
- Cache key includes path + Aelia currency/country cookies
- Separate cached versions for different currencies and countries
- Cache TTL: 24 hours (same as other pages)
- Cookies used: `aelia_cs_selected_currency`, `aelia_customer_country`
- Includes shop subcategories like `/shop/spare-parts`

#### Other Pages
- Cache key based only on path and query parameters
- Cache TTL: 24 hours
- No currency/country differentiation

## Setup and Deployment

### Prerequisites
- Node.js and npm installed
- Cloudflare account
- Wrangler CLI installed globally: `npm install -g wrangler`

### Installation

1. Clone and setup:
```bash
cd cf-worker-aelia
npm install
```

2. Authenticate with Cloudflare:
```bash
wrangler login
```

3. Update `wrangler.toml`:
   - Replace the commented routes with your actual domain(s)
   - Configure any environment variables if needed

### Configuration

Edit `wrangler.toml` to match your setup:

```toml
[env.production]
routes = [
  "yourdomain.com/*",
  "www.yourdomain.com/*"
]
```

### Development

Test locally:
```bash
npm run dev
```

### Deployment

Deploy to production:
```bash
npm run deploy:production
```

Or deploy to development:
```bash
npm run deploy
```

## Monitoring

View real-time logs:
```bash
npm run tail
```

## Cache Headers

The worker adds helpful headers for debugging:
- `CF-Cache-Status`: HIT-FRESH, HIT-STALE, or MISS
- `CF-Cache-Age`: Age of cached content in seconds
- `CF-Cache-Key`: The cache key used (visible in development)

## Customization

### Cache TTL
Modify the cache duration in `index.js`:
```javascript
const CACHE_TTL = 86400; // 24 hours for all pages
```

### Additional Bypass Cookies
Add more cookie patterns to bypass cache:
```javascript
const WOOCOMMERCE_BYPASS_COOKIES = [
  'woocommerce_cart_hash',
  'woocommerce_items_in_cart',
  'wp_woocommerce_session_',
  'your_custom_cookie_pattern'
];
```

### Additional Cache Key Cookies
Include more cookies in the cache key for shop/product pages:
```javascript
const AELIA_CACHE_COOKIES = [
  'aelia_cs_selected_currency',
  'aelia_customer_country',
  'your_additional_cookie'
];
```

## License

MIT
Cloudflare worker for caching WooCommerce with the Aelia country and currency switcher
