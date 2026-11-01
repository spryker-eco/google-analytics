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

### Cart changes and the cart mode

With the cart async mode (`CartPageConfig::IS_CART_ACTIONS_ASYNC_MODE_ENABLED`), `add_to_cart` and `remove_from_cart` for changes made in the cart are sent after the cart confirmed the change, with the quantity that actually changed. Without it, the page reloads after every change, so they are sent when the form is submitted, before the cart confirms it: a change the cart rejects, e.g. a quantity above the available stock, is reported too, and the cart quick-add form reports only the SKU.

Outside the cart page, `add_to_cart` and `add_to_wishlist` are sent when the customer clicks, before the shop confirms the change, whatever the cart mode. This covers adding from the product detail page and from product cards, moving wishlist items to the cart, adding from a shopping list, reordering, converting a quote request, the quick order, configurable bundles and product sets. An addition the shop rejects, e.g. for missing stock, a quantity rule or a cart locked for approval, is counted too, with the quantity the customer submitted. These events measure the customer's intent: add-to-cart and add-to-wishlist counts can be slightly higher than what reached carts and wishlists. The `purchase` event is built from the placed order, so orders, revenue and items sold are exact.

### Cart view

`view_cart` is sent when the customer opens the cart page and the cart shown has at least one product, with every product of that cart; a product bundle is one item. Only a visit the customer chose counts: reloading the page, reopening it with the Back or Forward button, and returning to the cart at the end of a redirect, e.g. after adding to the cart from a product page or after a cart change without the async mode, send no `view_cart`. The browser tells these apart, from the navigation type and the redirect count of the page load.

### Begin checkout

`begin_checkout` is sent once per click on a checkout button, a link to the checkout, on the first checkout step it opens: the login step for a guest, the address step for a logged-in customer. It carries every product of the cart being checked out and its voucher codes as `coupon`. The click is only remembered in the browser tab; the next page decides: a checkout step reports it, any other page, e.g. the cart when the shop does not start the checkout for an unavailable product or a locked cart, discards it. Moving between checkout steps, reloading a step, reopening it with the Back button and logging in during checkout send no `begin_checkout`; clicking the checkout button again later sends a new one.

### Add shipping info

`add_shipping_info` is sent when the customer submits the shipment step and the shop accepts it, on the page the step leads to, usually the payment step. It carries every product being checked out, the voucher codes as `coupon`, and the chosen shipment method as `shipping_tier`, by the name the shopper sees. GA4 allows one `shipping_tier` per event, so a split delivery sends its methods together, e.g. "Standard, Express". The submit is only remembered in the browser tab; the next page decides: the shipment step shown again, e.g. with no method selected, discards it. Within a checkout, a method is reported once: going back to the shipment step and continuing with the same method sends nothing, choosing a different one sends a new event. A new checkout, started from the checkout button, reports the method again. Only the method name is sent, never the delivery address.

### Add payment info

`add_payment_info` is sent when the customer submits the payment step and the shop accepts it, on the page the step leads to, usually the summary step. It carries every product being checked out, the voucher codes as `coupon`, and the chosen payment method as `payment_type`, by the name the shopper sees; a split payment, e.g. with a gift card, sends its methods together. It means a payment method was chosen, not that a payment was made: the order is reported by `purchase`. It is reported like `add_shipping_info`: the payment step shown again, e.g. with missing details, sends nothing; within a checkout, a method is reported once, and choosing a different one sends a new event. Only the method name is sent, never card numbers, IBANs, account holders or any other detail the step asks for.

### Checkout steps in a project

The checkout layout, `page-layout-checkout.twig`, provides the data of every checkout event in its `eventTracker` block: the products, the voucher codes, the chosen shipment and payment methods, the `SHIPMENT_SUBMIT` and `PAYMENT_SUBMIT` events on the shipment and payment forms, and the step shown, found by the route names `checkout-shipment` and `checkout-payment`. A project keeps the events as long as its checkout pages extend the layout, its own step templates included, and keeps the form names `shipmentCollectionForm` and `paymentForm`. A project that renames these routes maps its own route names in that block.

### Voucher codes

The `begin_checkout`, `add_shipping_info`, `add_payment_info` and `purchase` events send the voucher codes of the cart or order as `coupon`, comma separated, so the merchant sees which codes bring orders and revenue. A code reaches Google Analytics as it is, so voucher codes must not contain personal data, e.g. a customer's name or email.

## Cookie consent

Google Analytics starts only once the shopper's consent allows it: until then, `gtag.js` is not requested, no `_ga` cookie is written and no page view or event is sent. The adapter needs the `statistics` consent purpose, for every event by default; it checks consent for each GA4 event by its GA4 name before sending it, so a project can require other consent for single events, e.g. `purchase`, in its consent component. A purchase not sent for lack of consent is not remembered, so the confirmation page reports it once consent allows it. Consent comes from the project's consent management platform through the `traceable-events-consent` component of TraceableEventWidget, see its orchestrator README; consent is required by default, and an environment without real shoppers can switch the requirement off in the Back Office: Configuration → Integrations → Tracking Consent → Require Consent. Consent given on a page reports that page's events, e.g. `view_item` on a product page, once; actions taken before consent are not reported. Spryker provides the consent hook, not the consent mechanism: a shop that installs Google Analytics, requires no consent and configures no CMP tracks without consent, which is the project's responsibility.

## Page URLs

gtag sends the page URL and the referrer URL with every hit, including the `page_view` it sends on every page by default. The module sends them with the origin, the path and only the campaign query parameters GA4 reads for attribution: `utm_*`, `gclid`, `gbraid`, `wbraid`, `dclid` and `_gl`. Every other query parameter and the fragment are left out, as they may carry personal data, e.g. the token of a password reset link. GA4 Enhanced Measurement site search, which reads the search term from the URL, therefore reports nothing; the module sends its own `search_results` and `zero_search_results` events.
