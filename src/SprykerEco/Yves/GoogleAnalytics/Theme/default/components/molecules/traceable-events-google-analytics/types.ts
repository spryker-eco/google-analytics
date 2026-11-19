/* eslint-disable camelcase -- GA4 defines its item parameters in snake_case, e.g. item_id, and gtag only accepts these names */
import {
    EventsHandlerData,
    EventName,
} from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/traceable-events-orchestrator';
import { ProductCategory } from './category-levels';

export interface GtagFunction {
    (command: 'js', date: Date): void;
    (command: 'config', targetId: string, config?: Record<string, unknown>): void;
    (command: 'set', params: Record<string, unknown>): void;
    (command: 'event', eventName: string, params?: Record<string, unknown>): void;
}

// Event name mapped to its on/off state, e.g. `search` for the `search_event_enabled` Back Office setting.
export type EnabledEvents = Record<string, boolean>;

export interface InitialData {
    appId: string;
    store: string;
    locale: string;
    events: EnabledEvents;
}

export interface SearchEventData extends EventsHandlerData<EventName> {
    eventDetail: {
        searchTerm: string;
        eventCategory: string;
        eventLabel: string;
        resultsCount: number;
        eventName: string;
    };
}

// A product as the storefront triggers send it; `price` is in cents, `newQuantity` is set when a cart line quantity changes.
export interface ProductDetails {
    sku: string;
    // The SKU of the abstract product, sent as item_id, so every step of the funnel reports a product under the same id; variants differ by item_variant.
    abstractSku?: string;
    // The SKU of the concrete product, sent by a trigger whose `sku` may stand for something else, e.g. a product card of a product
    // with several variants, which sends an empty one; without it, `sku` is concrete when it differs from the abstract product SKU.
    concreteSku?: string;
    // The product's own name, e.g. of a concrete product "Galaxy Tab A 32 GB", and the name of its abstract product; a variant may have a name of its own.
    name?: string;
    abstractName?: string;
    brand?: string;
    // The values of the attributes the variants of the product differ in, ordered by attribute key, e.g. ['Red', '64 GB'].
    variant?: string[];
    // One category path of the product, top level first, picked by the same rule on the product page and in the cart.
    categories?: ProductCategory[];
    price?: number;
    quantity?: number;
    newQuantity?: number;
    // A product card of a tracked list: the list it belongs to and its position in it, from 0; a clicked card sends the position as the
    // attribute text.
    itemListId?: string;
    itemListName?: string;
    index?: number | string;
}

export interface CartEventData extends EventsHandlerData<EventName> {
    currency: string;
    products?: ProductDetails[];
}

// The data every page passes with its page load; which keys a page sets depends on the page.
export interface PageLoadData extends EventsHandlerData<EventName> {
    currency: string;
    // On the product detail page: the product shown.
    products?: ProductDetails[];
    // On the cart page: the products of the cart shown.
    cartProducts?: ProductDetails[];
    // On a checkout step: the products of the cart being checked out, and its voucher codes, comma separated.
    checkoutProducts?: ProductDetails[];
    checkoutCoupon?: string;
    // The chosen shipment and payment methods, as the shopper sees them; a split delivery or payment joins them, e.g. "Standard, Express".
    checkoutShippingTier?: string;
    checkoutPaymentType?: string;
    // The checkout step shown, set for a step that reports its own accepted submit: SHIPMENT or PAYMENT.
    checkoutStep?: string;
    // On the order confirmation page: the placed order and its products.
    purchase?: Purchase;
    purchaseProducts?: ProductDetails[];
}

// Amounts in cents; the product prices are paid per unit without tax, so shipping and tax are sent on their own.
export interface Purchase {
    transactionId: string;
    shipping?: number;
    tax?: number;
    // The voucher codes of the order, comma separated.
    coupon?: string;
}

export interface ItemList {
    id: string;
    name: string;
    products: ProductDetails[];
}

// The product cards the shopper saw, per list, as the traceable-item-list-view-tracker reports them.
export interface ItemListViewData extends EventsHandlerData<EventName> {
    currency: string;
    eventDetail: {
        itemLists: ItemList[];
    };
}

// Cart lines whose quantity the cart confirmed as changed; `quantity` is the changed amount.
export interface CartItemsChangeData extends EventsHandlerData<EventName> {
    currency: string;
    eventDetail: {
        increased: ProductDetails[];
        decreased: ProductDetails[];
    };
}

// A GA4 ecommerce `items[]` entry.
export interface GtagItem {
    item_id: string;
    item_name: string;
    item_brand?: string;
    item_category?: string;
    item_category2?: string;
    item_category3?: string;
    item_category4?: string;
    item_category5?: string;
    item_variant?: string;
    // A custom item parameter: the SKU of the concrete product, where the event knows it, e.g. in the cart; a product list card of a product
    // with several variants has none. Merchants register it as an item-scoped custom dimension to report by concrete product.
    concrete_sku?: string;
    price?: number;
    quantity: number;
    // The position of the product in its list, from 0, for the item list events.
    index?: number;
}

// An event raised while the gtag script is loading; `params` are its gtag event parameters, `raisedAt` when it was raised.
export interface PendingEvent {
    name: string;
    params: Record<string, unknown>;
    raisedAt: number;
}

// An event handed to gtag, and when, as `performance.now()`: gtag holds its hit for a few seconds before it sends a request.
export interface EventAwaitingGtagRequest {
    event: PendingEvent;
    handedOverAt: number;
}
