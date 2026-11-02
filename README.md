# GoogleAnalytics Module
[![Latest Stable Version](https://poser.pugx.org/spryker-eco/google-analytics/v/stable.svg)](https://packagist.org/packages/spryker-eco/google-analytics)
[![Minimum PHP Version](https://img.shields.io/badge/php-%3E%3D%208.3-8892BF.svg)](https://php.net/)

Provides Google Analytics 4 (GA4) integration for Spryker. Tracks storefront search events (searches with results and zero-result searches) and cart changes (`add_to_cart`, `remove_from_cart`) via `gtag`, and surfaces the collected data as search statistics dashboards in the Back Office using the GA4 Data API.

## Installation

```bash
composer require spryker-eco/google-analytics
```

## Upgrading from 1.4.0

The Back Office setting key `search_event_ebabled` is renamed to `search_event_enabled`. A value stored under the old key is not read any more, so Search event tracking falls back to its default (disabled) after the upgrade.

If Search tracking was enabled before the upgrade:

1. Rename the stored rows:

   ```sql
   UPDATE spy_configuration_value
   SET setting_key = REPLACE(setting_key, ':search_event_ebabled', ':search_event_enabled')
   WHERE setting_key LIKE '%:search_event_ebabled';
   ```

2. Re-save any Google Analytics setting in the Back Office once for each scope that held the value (global, and each store with an override). Saving rebuilds the storefront configuration storage of that scope from the renamed rows.

The ecommerce events report a product by its abstract product SKU, which the product concrete storage data of `spryker/product-storage` carries as `abstractSku`. Products published before the upgrade do not have it until they are published again, and until then they are reported with their concrete product SKU as `item_id`. Republish them once after the upgrade:

```bash
vendor/bin/console publish:trigger-events -r product_concrete
```

## Features

- Storefront TypeScript component that pushes `search_results` and `zero_search_results` events to GA4 via `gtag`, including store and locale as custom parameters
- Back Office **Search Statistics** section with three views: overview, Search Terms, and Zero Results
- Date range presets (last 24 hours / 7 days / 30 days) with per-store and per-locale filtering
- Paginated, sortable tables with minimum-count and keyword filtering
- Reads data from GA4 using a service account — no manual CSV export required

## Products in ecommerce events

Every ecommerce event reports a product with the same item data, so GA4 joins the steps of the funnel by item ID:

| GA4 item field | Value |
|---|---|
| `item_id` | The abstract product SKU |
| `item_name` | The abstract product name |
| `item_variant` | The values of the attributes the variants of the product differ in, e.g. `Red / 64 GB`, where a variant is known |
| `item_brand`, `item_category` … `item_category5` | The brand and the category path of the product, top level first |
| `concrete_sku` | Custom item parameter: the concrete product SKU, where the event knows the concrete product, e.g. in the cart. A product card and a product detail page without a selected variant of a product with several variants have none. |
| `price`, `quantity` | The unit price in the currency, e.g. 19.99, and the quantity added or removed |

The lines of one action for the same concrete product and variant are sent as one item with their quantities added up. Without a price for every item, e.g. for a guest who may not see prices, the event is sent without `value`.

### Report by concrete product

GA4 keeps custom item parameters only for item-scoped custom dimensions. To report by concrete product SKU, register `concrete_sku` once per GA4 property:

1. In Google Analytics, open **Admin** > **Data display** > **Custom definitions**.
2. Click **Create custom dimension**.
3. Set **Dimension name** to `Concrete SKU`, **Scope** to `Item`, and **Item parameter** to `concrete_sku`.
4. Save.

A dimension reports data collected after it was created; earlier events are not filled in. A standard GA4 property allows 10 item-scoped custom dimensions.

### Cart changes and the cart mode

With the cart async mode (`CartPageConfig::IS_CART_ACTIONS_ASYNC_MODE_ENABLED`), `add_to_cart` and `remove_from_cart` for changes made in the cart are sent after the cart confirmed the change, with the quantity that actually changed. Without it, the page reloads after every change, so they are sent when the form is submitted, before the cart confirms it: a change the cart rejects, e.g. a quantity above the available stock, is reported too, and the cart quick-add form reports only the SKU.

Outside the cart page, `add_to_cart` is sent when the customer clicks, before the shop confirms the change, whatever the cart mode. This covers adding from the product detail page and from product cards, moving wishlist items to the cart, adding from a shopping list, reordering, converting a quote request, the quick order, configurable bundles and product sets. An addition the shop rejects, e.g. for missing stock, a quantity rule or a cart locked for approval, is counted too, with the quantity the customer submitted: add-to-cart counts measure the customer's intent and can be slightly higher than what reached carts.

A click that leaves the page waits until Google Analytics took the event, at most 0.5 s, and only while the gtag script is still loading.

## Page URLs

gtag sends the page URL and the referrer URL with every hit, including the `page_view` it sends on every page by default. The module sends them with the origin, the path and only the campaign query parameters GA4 reads for attribution: `utm_*`, `gclid`, `gbraid`, `wbraid`, `dclid` and `_gl`. Every other query parameter and the fragment are left out, as they may carry personal data, e.g. the token of a password reset link. On quote request pages, of the customer and of the agent, the quote request reference is also left out of the path and of the page title, e.g. `/quote-request/details/DE--21-8` is sent as `/quote-request/details/`, as the reference contains the customer reference. GA4 Enhanced Measurement site search, which reads the search term from the URL, therefore reports nothing; the module sends its own `search_results` and `zero_search_results` events.
