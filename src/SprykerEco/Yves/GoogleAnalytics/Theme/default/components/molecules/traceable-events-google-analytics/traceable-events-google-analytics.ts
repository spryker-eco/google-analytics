/* eslint-disable max-lines -- an adapter keeps all handlers of its provider as overridable methods, like the Algolia adapter */
import {
    BaseTraceableEventAdapter,
    TraceableEventHandlers,
} from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/base-traceable-event-adapter';
import { EventsHandlerData, EventName } from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/traceable-events-orchestrator';

declare global {
    interface SPRYKER_EVENTS {
        SEARCH_EVENT: undefined;
        ADD_TO_CART: undefined;
        REMOVE_FROM_CART: undefined;
        CHANGE_CART_QUANTITY: undefined;
        CART_ITEMS_CHANGE: undefined;
    }

    interface Window {
        dataLayer: unknown[];
        gtag: GtagFunction;
    }
}

interface GtagFunction {
    (command: 'js', date: Date): void;
    (command: 'config', targetId: string, config?: Record<string, unknown>): void;
    (command: 'event', eventName: string, params?: Record<string, unknown>): void;
}

// Event name mapped to its on/off state, e.g. `search` for the `search_event_ebabled` Back Office setting.
type EnabledEvents = Record<string, boolean>;

interface InitialData {
    appId: string;
    store: string;
    locale: string;
    events: EnabledEvents;
}

interface SearchEventData extends EventsHandlerData<EventName> {
    eventDetail: {
        searchTerm: string;
        eventCategory: string;
        eventLabel: string;
        resultsCount: number;
        eventName: string;
    }
}

// A product as the storefront triggers send it; `price` is in cents, `newQuantity` is set when a cart line quantity changes.
interface ProductDetails {
    sku: string;
    name?: string;
    brand?: string;
    variant?: string;
    // Only the PDP sends it: its schema.org category list, root to leaf. Cart lines carry no category.
    categories?: ProductCategory[];
    price?: number;
    quantity?: number;
    newQuantity?: number;
}

interface ProductCategory {
    name?: string;
}

interface CartEventData extends EventsHandlerData<EventName> {
    currency: string;
    products?: ProductDetails[];
}

// Cart lines whose quantity the cart confirmed as changed; `quantity` is the changed amount.
interface CartItemsChangeData extends EventsHandlerData<EventName> {
    currency: string;
    eventDetail: {
        increased: ProductDetails[];
        decreased: ProductDetails[];
    };
}

// A GA4 ecommerce `items[]` entry.
interface GtagItem {
    item_id: string;
    item_name: string;
    item_brand?: string;
    item_category?: string;
    item_variant?: string;
    price?: number;
    quantity: number;
}

type CartEventName = 'add_to_cart' | 'remove_from_cart';

const CENTS_IN_CURRENCY_UNIT = 100;
const PRICE_DECIMALS = 2;

export default class TraceableEventsGoogleAnalytics extends BaseTraceableEventAdapter {
    protected currentStore = '';
    protected currentLocale = '';

    override init(): void {
        const { appId, store, locale } = this.initialData;

        this.currentStore = store;
        this.currentLocale = locale;

        window.dataLayer = window.dataLayer || [];
        window.gtag = function gtag(): void {
            // eslint-disable-next-line prefer-rest-params
            window.dataLayer.push(arguments);
        };
        window.gtag('js', new Date());
        window.gtag('config', appId);

        super.init();
    }

    override getHandlers(): Partial<TraceableEventHandlers> {
        const handlers: Partial<TraceableEventHandlers> = {};

        if (this.isEventEnabled('search')) {
            handlers.SEARCH_EVENT = [this.searchEventHandler];
        }

        if (this.isEventEnabled('add_to_cart')) {
            handlers.ADD_TO_CART = [this.addToCartHandler];
        }

        if (this.isEventEnabled('remove_from_cart')) {
            handlers.REMOVE_FROM_CART = [this.removeFromCartHandler];
        }

        // Raising a quantity is an add_to_cart, lowering it a remove_from_cart; each is checked against its own setting.
        handlers.CHANGE_CART_QUANTITY = [this.cartQuantityChangeHandler];
        handlers.CART_ITEMS_CHANGE = [this.cartItemsChangeHandler];

        return handlers;
    }

    protected addToCartHandler(data: CartEventData): void {
        this.sendCartEvent('add_to_cart', data.currency, data.products ?? []);
    }

    protected removeFromCartHandler(data: CartEventData): void {
        this.sendCartEvent('remove_from_cart', data.currency, data.products ?? []);
    }

    protected cartQuantityChangeHandler(data: CartEventData): void {
        const changedProduct = data.products?.[0];
        // Without the new quantity (null when the trigger finds no quantity input) the change is unknown, not a removal.
        const isNewQuantityKnown = changedProduct?.newQuantity !== null && changedProduct?.newQuantity !== undefined;

        if (!changedProduct || !isNewQuantityKnown) {
            return;
        }

        const quantityDifference = Number(changedProduct.newQuantity) - Number(changedProduct.quantity);
        const isQuantityChanged = Number.isFinite(quantityDifference) && quantityDifference !== 0;

        if (!isQuantityChanged) {
            return;
        }

        let eventName: CartEventName = 'remove_from_cart';

        if (quantityDifference > 0) {
            eventName = 'add_to_cart';
        }

        if (!this.isEventEnabled(eventName)) {
            return;
        }

        const differenceProduct = { ...changedProduct, quantity: Math.abs(quantityDifference) };

        this.sendCartEvent(eventName, data.currency, [differenceProduct]);
    }

    protected cartItemsChangeHandler(data: CartItemsChangeData): void {
        const { increased, decreased } = data.eventDetail;

        if (this.isEventEnabled('add_to_cart')) {
            this.sendCartEvent('add_to_cart', data.currency, increased);
        }

        if (this.isEventEnabled('remove_from_cart')) {
            this.sendCartEvent('remove_from_cart', data.currency, decreased);
        }
    }

    protected sendCartEvent(eventName: CartEventName, currency: string, products: ProductDetails[]): void {
        const items = this.getItems(products);

        if (!items.length) {
            return;
        }

        const eventParams: Record<string, unknown> = { currency, items };
        const value = this.getItemsValue(items);

        // Without a price for every item (e.g. a guest who may not see prices) the value is left out, the event is still sent.
        if (value !== undefined) {
            eventParams.value = value;
        }

        window.gtag('event', eventName, eventParams);
    }

    // One entry per SKU: lines of the same SKU are added up, so an item_id is never sent twice.
    protected getItems(products: ProductDetails[]): GtagItem[] {
        const itemsBySku = new Map<string, GtagItem>();

        for (const product of products) {
            const quantity = Number(product?.quantity ?? 1);
            const isTrackable = Boolean(product?.sku) && quantity >= 1;

            if (!isTrackable) {
                continue;
            }

            const itemId = String(product.sku);
            const sameSkuItem = itemsBySku.get(itemId);

            if (sameSkuItem) {
                sameSkuItem.quantity += quantity;

                continue;
            }

            // item_name is never empty: a trigger without the product name (e.g. the quick-add form) sends the SKU instead.
            const item: GtagItem = { item_id: itemId, item_name: itemId, quantity };
            const price = this.getPrice(product.price);

            if (product.name) {
                item.item_name = String(product.name);
            }

            if (product.brand) {
                item.item_brand = String(product.brand);
            }

            if (product.variant) {
                item.item_variant = String(product.variant);
            }

            const category = this.findAssignedCategory(product);

            if (category) {
                item.item_category = category;
            }

            if (price !== undefined) {
                item.price = price;
            }

            itemsBySku.set(itemId, item);
        }

        return Array.from(itemsBySku.values());
    }

    // The last entry of the root-to-leaf list is a category the product is assigned to, e.g. "Tablets" under "Computer".
    protected findAssignedCategory(product: ProductDetails): string | undefined {
        const lastCategory = product.categories?.[product.categories.length - 1];

        if (!lastCategory?.name) {
            return undefined;
        }

        return String(lastCategory.name);
    }

    protected getItemsValue(items: GtagItem[]): number | undefined {
        let value = 0;

        for (const item of items) {
            if (item.price === undefined) {
                return undefined;
            }

            value += item.price * item.quantity;
        }

        return Number(value.toFixed(PRICE_DECIMALS));
    }

    // Storefront prices come in cents; a fractional price is already in currency units, as some triggers read it from the page.
    protected getPrice(price: unknown): number | undefined {
        if (typeof price !== 'number') {
            return undefined;
        }

        let currencyUnitPrice = price;

        if (Number.isInteger(price)) {
            currencyUnitPrice = price / CENTS_IN_CURRENCY_UNIT;
        }

        return Number(currencyUnitPrice.toFixed(PRICE_DECIMALS));
    }

    protected searchEventHandler(data: SearchEventData): void {
        const { searchTerm, resultsCount } = data.eventDetail;
        const hasNoResults = resultsCount === 0 && searchTerm;
        const eventName = hasNoResults ? 'zero_search_results' : 'search_results';

        if (!searchTerm) {
            return;
        }

        window.gtag('event', eventName, {
            search_term: searchTerm,
            event_category: 'Search results',
            event_label: hasNoResults ? 'No results' : 'Search results',
            results_count: resultsCount,
            store: this.currentStore,
            locale: this.currentLocale,
        });
    }

    // An event missing from the map stays on, so tracking keeps working while the configuration schema is not synced yet.
    protected isEventEnabled(eventName: string): boolean {
        const isEventDisabled = this.initialData.events[eventName] === false;

        return !isEventDisabled;
    }

    protected get initialData(): InitialData {
        return JSON.parse(this.getAttribute('initial'));
    }
}
