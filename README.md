# GoogleAnalytics Module
[![Latest Stable Version](https://poser.pugx.org/spryker-eco/google-analytics/v/stable.svg)](https://packagist.org/packages/spryker-eco/google-analytics)
[![Minimum PHP Version](https://img.shields.io/badge/php-%3E%3D%208.3-8892BF.svg)](https://php.net/)

Provides Google Analytics 4 (GA4) integration for Spryker. Tracks storefront search events (searches with results and zero-result searches) via `gtag`, and surfaces the collected data as search statistics dashboards in the Back Office using the GA4 Data API.

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

## Features

- Storefront TypeScript component that pushes `search_results` and `zero_search_results` events to GA4 via `gtag`, including store and locale as custom parameters
- Back Office **Search Statistics** section with three views: overview, Search Terms, and Zero Results
- Date range presets (last 24 hours / 7 days / 30 days) with per-store and per-locale filtering
- Paginated, sortable tables with minimum-count and keyword filtering
- Reads data from GA4 using a service account — no manual CSV export required

## Products in ecommerce events

Every ecommerce event, from `view_item_list` to `purchase`, reports a product with the same item data, so GA4 joins the steps of the funnel and the item list attribution by item ID:

| GA4 item field | Value |
|---|---|
| `item_id` | The abstract product SKU |
| `item_name` | The abstract product name |
| `item_variant` | The values of the attributes the variants of the product differ in, e.g. `Red / 64 GB`, where a variant is known |
| `item_brand`, `item_category` … `item_category5` | The brand and the category path of the product, top level first |
| `concrete_sku` | Custom item parameter: the concrete product SKU, where the event knows the concrete product, e.g. in the cart. A product list card and a product detail page without a selected variant of a product with several variants have none. |

### Report by concrete product

GA4 keeps custom item parameters only for item-scoped custom dimensions. To report by concrete product SKU, register `concrete_sku` once per GA4 property:

1. In Google Analytics, open **Admin** > **Data display** > **Custom definitions**.
2. Click **Create custom dimension**.
3. Set **Dimension name** to `Concrete SKU`, **Scope** to `Item`, and **Item parameter** to `concrete_sku`.
4. Save.

A dimension reports data collected after it was created; earlier events are not filled in. A standard GA4 property allows 10 item-scoped custom dimensions.
