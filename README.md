# GoogleAnalytics Module
[![Latest Stable Version](https://poser.pugx.org/spryker-eco/google-analytics/v/stable.svg)](https://packagist.org/packages/spryker-eco/google-analytics)
[![Minimum PHP Version](https://img.shields.io/badge/php-%3E%3D%208.3-8892BF.svg)](https://php.net/)

Provides Google Analytics 4 (GA4) integration for Spryker. Tracks storefront search events (searches with results and zero-result searches) and the GA4 ecommerce events from product views to the purchase (see [Ecommerce events](#ecommerce-events)) via `gtag`, and surfaces the collected data as search statistics dashboards in the Back Office using the GA4 Data API.

## Installation

```bash
composer require spryker-eco/google-analytics
```

### Project wiring

The ecommerce events report a product by its abstract product SKU and name, with its brand, variant and category path. The storefront reads them from the product storage, so no republishing is needed after the upgrade. The project registers the following; a missing line makes nothing fail, the events only lack the fields it provides.

`Pyz\Zed\Cart\CartDependencyProvider`, in both `getExpanderPlugins()` and `getExpanderPluginsForOrderAmendment()`, `CategoryPathItemExpanderPlugin` after `ProductCartPlugin`:

| Plugin | Module | Sets on cart items |
|---|---|---|
| `ProductCartPlugin` | `spryker/product-cart-connector` | the abstract product SKU, `abstractName`, `brand` and `selectedVariantAttributes` |
| `CategoryPathItemExpanderPlugin` | `spryker/product-category` | `categoryPath` |

`Pyz\Zed\Sales\SalesDependencyProvider::getOrderItemExpanderPlugins()`, for the order details page and reorder:

| Plugin | Module | Sets on order items |
|---|---|---|
| `ProductIdOrderItemExpanderPlugin` | `spryker/sales-product-connector` | the abstract product SKU |
| `SelectedVariantAttributesOrderItemExpanderPlugin` | `spryker/sales-product-connector` | `selectedVariantAttributes` |

`Pyz\Yves\ShopApplication\ShopApplicationDependencyProvider::getGlobalWidgets()`:

| Widget | Module | Provides |
|---|---|---|
| `TraceableEventWidget` | `spryker-shop/traceable-event-widget` | the traceable events |
| `ProductTrackingDetailsWidget` | `spryker-shop/traceable-event-widget` | the abstract product name, brand, variant and category path of products that lists and the order details page render without them, e.g. search results |
| `GoogleAnalyticsWidget` | `spryker-eco/google-analytics` | the project's `GoogleAnalyticsConfig`, see [Page URLs](#page-urls) |

`Pyz\Yves\CartPage\CartPageConfig`, for the changes made on the cart page in the cart async mode: `IS_CART_ACTIONS_ASYNC_MODE_ENABLED` set to `true`, see [Cart changes and the cart mode](#cart-changes-and-the-cart-mode).

## Upgrading from 1.4.0

Run `vendor/bin/console configuration:sync` after the update, so the Back Office shows the new event settings (Add to Cart, Remove from Cart) and the renamed Search setting. An event whose setting is not synced yet is not tracked, like the setting's default; switch the events you want on in the Back Office.

The Back Office setting key `search_event_ebabled` is renamed to `search_event_enabled`. A value stored under the old key is not read any more, so Search event tracking falls back to its default (disabled) after the upgrade.

If Search tracking was enabled before the upgrade:

1. Rename the stored rows:

   ```sql
   UPDATE spy_configuration_value
   SET setting_key = REPLACE(setting_key, ':search_event_ebabled', ':search_event_enabled')
   WHERE setting_key LIKE '%:search_event_ebabled';
   ```

2. Re-save any Google Analytics setting in the Back Office once for each scope that held the value (global, and each store with an override). Saving rebuilds the storefront configuration storage of that scope from the renamed rows.

The page URL and the referrer URL that gtag sends with every hit (`page_location`, `page_referrer`) keep only the campaign query parameters after the upgrade; before, gtag sent the URL as it was. Every other query parameter, e.g. `q`, `category` or `sort`, is left out, as it may carry personal data (see [Page URLs](#page-urls)).

If GA4 reports, explorations or audiences of the project filter on such a parameter:

- They receive no values for it after the upgrade. GA4 Enhanced Measurement site search, which reads the search term from `q`, reports nothing; the module reports searches with its own `search_results` and `zero_search_results` events instead.
- To keep a parameter, register `GoogleAnalyticsWidget` and return the parameter from `GoogleAnalyticsConfig::getAdditionalPageUrlQueryParameters()` in the project, see [Page URLs](#page-urls). Keep only parameters that never carry personal data. With `q` kept, Enhanced Measurement site search reports searches again, next to the module's search events.

## Features

- Storefront TypeScript component that pushes `search_results` and `zero_search_results` events to GA4 via `gtag`, including store and locale as custom parameters, and the GA4 ecommerce events
- Every event switched on or off per store in the Back Office, under **Configuration** > **Integrations** > **Google Analytics**; all are off by default
- Back Office **Search Statistics** section with three views: overview, Search Terms, and Zero Results
- Date range presets (last 24 hours / 7 days / 30 days) with per-store and per-locale filtering
- Paginated, sortable tables with minimum-count and keyword filtering
- Reads data from GA4 using a service account — no manual CSV export required

## Ecommerce events

| GA4 event | Sent when | Event parameters besides `currency`, `value` and `items` |
|---|---|---|
| `view_item` | A product detail page is opened | |
| `view_item_list` | Product cards are seen in a product list: each card once per list and page, once half of it is in view | `item_list_id`, `item_list_name`; no `value` |
| `select_item` | A product card in a product list is clicked | `item_list_id`, `item_list_name`; no `value` |
| `add_to_cart`, `remove_from_cart` | See [Cart changes and the cart mode](#cart-changes-and-the-cart-mode) | |
| `add_to_wishlist` | A product is added to a wishlist on the product detail page, or an alternative of a wishlist item on the wishlist page | |
| `view_cart` | The cart page is opened with at least one product from a link or the address bar; a reload, the Back button and the return to the cart after a cart change are not counted | |
| `begin_checkout` | The checkout button is clicked and a checkout step opens; a checkout the shop does not start, e.g. for an unavailable product, is not counted | `coupon` |
| `add_shipping_info` | The shipment step is accepted, once per chosen set of shipment methods in a checkout | `coupon`, `shipping_tier`: the shipment method names, comma separated for a split delivery |
| `add_payment_info` | The payment step is accepted, once per chosen payment method in a checkout | `coupon`, `payment_type`: the payment method names; never payment details |
| `purchase` | The order confirmation page is shown, once per order also after a reload | `transaction_id` (the order reference), `shipping`, `tax`, `coupon` |

The product lists are the catalog and search results, the similar products and cart up-selling carousels, product alternatives and replacements, the products of each discount promotion, and the CMS and content product lists; each item of a list event carries its position in the list, from 0, as `index`. In the cart, checkout and purchase events a product bundle is one item. The `purchase` item price is the price paid per unit without tax, as shipping and tax are sent on their own.

`begin_checkout`, `add_shipping_info` and `add_payment_info` pass the click or the submitted step to the next page in the session storage of the tab, and `purchase` keeps the 20 latest order references in the local storage. Where the storage is switched off, e.g. in a private window that blocks it, the checkout step events are not sent, and a reload of the confirmation page reports the order again.

### Products in ecommerce events

Every ecommerce event reports a product with the same item data, so GA4 joins the steps of the funnel by item ID:

| GA4 item field | Value |
|---|---|
| `item_id` | The abstract product SKU |
| `item_name` | The abstract product name |
| `item_variant` | The values of the attributes the variants of the product differ in, e.g. `Red / 64 GB`, where a variant is known |
| `item_brand`, `item_category` … `item_category5` | The brand and the category path of the product, top level first; a deeper path keeps its top five levels |
| `concrete_sku` | Custom item parameter: the concrete product SKU, where the event knows the concrete product, e.g. in the cart. A product card and a product detail page without a selected variant of a product with several variants have none. |
| `price`, `quantity` | The unit price in the currency, e.g. 19.99, and the quantity added or removed, in whole pieces: a quantity in a measurement unit, e.g. 1.5 m, is rounded and is at least 1 |

A product card on the catalog, search or new products page shows the search result data of the product, which has no product attributes, so its brand and category path are read for all cards of the page at once. A product card built from the product data, e.g. in a CMS widget, a product relation, the wishlist or a shopping list, reports both as well.

A cart line gets its abstract product name and brand when the cart expands its items. A cart converted from a quote request keeps the items stored with the quote request, as a converted cart is locked and not expanded again, so the lines of a quote request saved before this module version report no brand, and the product name in place of the abstract product name.

The lines of one action for the same concrete product and variant are sent as one item with their quantities added up. Without a price for every item, e.g. for a guest who may not see prices, the event is sent without `value`.

#### Report by concrete product

GA4 keeps custom item parameters only for item-scoped custom dimensions. To report by concrete product SKU, register `concrete_sku` once per GA4 property:

1. In Google Analytics, open **Admin** > **Data display** > **Custom definitions**.
2. Click **Create custom dimension**.
3. Set **Dimension name** to `Concrete SKU`, **Scope** to `Item`, and **Item parameter** to `concrete_sku`.
4. Save.

A dimension reports data collected after it was created; earlier events are not filled in. A standard GA4 property allows 10 item-scoped custom dimensions.

### Cart changes and the cart mode

With the cart async mode (`CartPageConfig::IS_CART_ACTIONS_ASYNC_MODE_ENABLED`), `add_to_cart` and `remove_from_cart` for changes made in the cart are sent after the cart confirmed the change, with the quantity that actually changed. The storefront compares the cart lines before and after the change in the browser, so nothing is kept in the session. Without the async mode, the page reloads after every change, so they are sent when the form is submitted, before the cart confirms it: a change the cart rejects, e.g. a quantity above the available stock, is reported too, and the cart quick-add form reports only the SKU.

Outside the cart page, `add_to_cart` is sent when the customer clicks, before the shop confirms the change, whatever the cart mode. This covers adding from the product detail page and from product cards, moving wishlist items to the cart, adding from a shopping list, reordering, converting a quote request, the quick order, configurable bundles and product sets. An addition the shop rejects, e.g. for missing stock, a quantity rule or a cart locked for approval, is counted too, with the quantity the customer submitted: add-to-cart counts measure the customer's intent and can be slightly higher than what reached carts.

A click that leaves the page is never delayed. The gtag script collects the events of a page for about five seconds before it sends them, so a page left sooner would lose them. `select_item`, raised by a click on a product card that usually opens the product in the same tab, is therefore kept in the session storage of the tab as the page starts to leave, and the product page sends it, with the URL and title of the list page; when the page is still shown two seconds after the click, e.g. after a Cmd+click that opens the product in a new tab, the list page sends it itself. `add_payment_info`, sent when the summary step opens, is handed to gtag at once; when the shopper places the order before gtag has sent it, a copy kept in the session storage of the tab is sent by the next page, with the URL and title of the summary page. An event raised while the script is still loading, e.g. on a slow connection, is kept in the session storage of the tab when the page is left and is sent by the next page, with the URL and title of the page it happened on; it is then recorded a moment later, after the page view of the next page. When the script fails to load, e.g. because a content blocker stopped it, the waiting events are dropped. The tab keeps at most the 50 newest waiting events, and drops an event it could not send within 30 minutes, as it would otherwise be recorded in another session. Where the session storage is switched off or full, the events waiting when the page is left are lost.

## Page URLs

gtag sends the page URL and the referrer URL with every hit, including the `page_view` it sends on every page by default. The module sends them with the origin, the path and only the campaign query parameters GA4 reads for attribution: `utm_*`, `gclid`, `gbraid`, `wbraid`, `dclid` and `_gl`. Every other query parameter and the fragment are left out, as they may carry personal data, e.g. the token of a password reset link. On quote request pages, of the customer and of the agent, the quote request reference is also left out of the path and of the page title, e.g. `/quote-request/details/DE--21-8` is sent as `/quote-request/details/`, as the reference contains the customer reference. GA4 Enhanced Measurement site search, which reads the search term from the URL, therefore reports nothing; the module sends its own `search_results` and `zero_search_results` events.

To keep more query parameters, register `\SprykerEco\Yves\GoogleAnalytics\Widget\GoogleAnalyticsWidget` in `ShopApplicationDependencyProvider::getGlobalWidgets()` and override `getAdditionalPageUrlQueryParameters()` in the project's `Pyz\Yves\GoogleAnalytics\GoogleAnalyticsConfig`, which extends `\SprykerEco\Yves\GoogleAnalytics\GoogleAnalyticsConfig`. Return only parameters that never carry personal data:

```php
namespace Pyz\Yves\GoogleAnalytics;

use SprykerEco\Yves\GoogleAnalytics\GoogleAnalyticsConfig as SprykerEcoGoogleAnalyticsConfig;

class GoogleAnalyticsConfig extends SprykerEcoGoogleAnalyticsConfig
{
    /**
     * @return list<string>
     */
    public function getAdditionalPageUrlQueryParameters(): array
    {
        return ['sort'];
    }
}
```

Without the widget, only the campaign parameters are kept.
