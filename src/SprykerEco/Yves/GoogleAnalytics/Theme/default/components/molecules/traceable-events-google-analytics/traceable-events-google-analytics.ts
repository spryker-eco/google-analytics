/* eslint-disable max-lines -- an adapter keeps all handlers of its provider as overridable methods, like the Algolia adapter */
/* eslint-disable camelcase -- GA4 defines its event and item parameters in snake_case, e.g. item_id, and gtag only accepts these names */
import {
    BaseTraceableEventAdapter,
    TraceableEventHandlers,
} from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/base-traceable-event-adapter';
import {
    CONSENT_PURPOSE_STATISTICS,
    ConsentPurpose,
} from 'TraceableEventWidget/components/molecules/traceable-events-consent/consent-purposes';
import {
    EventsHandlerData,
    EventName,
} from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/traceable-events-orchestrator';

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
    (command: 'set', params: Record<string, unknown>): void;
    (command: 'event', eventName: string, params?: Record<string, unknown>): void;
}

// Event name mapped to its on/off state, e.g. `search` for the `search_event_enabled` Back Office setting.
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
    };
}

// A product as the storefront triggers send it; `price` is in cents, `newQuantity` is set when a cart line quantity changes.
interface ProductDetails {
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
}

interface ProductCategory {
    name: string;
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
}

type ItemsEventName = 'add_to_cart' | 'remove_from_cart';

type SearchEventName = 'search_results' | 'zero_search_results';

// Every event name the adapter sends to GA4, by which a project's consent component may group single events.
type GtagEventName = ItemsEventName | SearchEventName;

// The GA4 events a Back Office setting can switch off, in the order their handlers run when several listen to one storefront event.
const GOOGLE_ANALYTICS_EVENT_NAMES = ['search', 'add_to_cart', 'remove_from_cart'] as const;

type GoogleAnalyticsEventName = (typeof GOOGLE_ANALYTICS_EVENT_NAMES)[number];

// The query parameters Google Analytics reads for campaign attribution. Every other query parameter, and the fragment, is left out of
// the page URLs sent with every hit, as they may carry personal data, e.g. the token of a password reset link.
const CAMPAIGN_QUERY_PARAMETERS: ReadonlySet<string> = new Set([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'utm_id',
    'utm_source_platform',
    'utm_creative_format',
    'utm_marketing_tactic',
    'gclid',
    'gbraid',
    'wbraid',
    'dclid',
    '_gl',
]);
// A quote request page has the quote request reference in its path, e.g. /quote-request/details/DE--21-8, and in its title. The
// reference contains the customer reference, so it is left out of the page URLs and the title, for the agent's pages as well.
const QUOTE_REQUEST_REFERENCE_PATH_PATTERN = /(\/quote-request\/[\w-]+\/)([^/]+)/;
// GA4 reports a variant as one string, e.g. "Red / 64 GB".
const VARIANT_VALUE_SEPARATOR = ' / ';
// GA4 item category levels, from the top-level category down.
const CATEGORY_LEVEL_KEYS = [
    'item_category',
    'item_category2',
    'item_category3',
    'item_category4',
    'item_category5',
] as const;

export default class TraceableEventsGoogleAnalytics extends BaseTraceableEventAdapter {
    protected currentStore = '';
    protected currentLocale = '';
    // Settlers of events still waiting for Google Analytics; all run at once when the gtag script fails to load.
    protected pendingEventSettlers = new Set<() => void>();
    protected isGtagScriptLoaded = false;
    protected isGtagScriptFailed = false;

    override init(): void {
        const { store, locale } = this.initialData;

        this.currentStore = store;
        this.currentLocale = locale;

        super.init();
    }

    // GA4 measures how the shop is used; a project that links it to advertising, e.g. Google Ads remarketing, declares marketing as well.
    override get consentPurposes(): ConsentPurpose[] {
        return [CONSENT_PURPOSE_STATISTICS];
    }

    // The purposes a GA4 event serves, by its GA4 name; a project groups single events differently in its consent component.
    protected getGtagEventConsentPurposes(_gtagEventName: GtagEventName): ConsentPurpose[] {
        return this.consentPurposes;
    }

    protected isGtagEventAllowed(gtagEventName: GtagEventName): boolean {
        return this.isProviderEventAllowed(gtagEventName, this.getGtagEventConsentPurposes(gtagEventName));
    }

    // Started once the orchestrator allows the adapter, e.g. after the shopper's consent: before, gtag.js is not requested, no Google
    // Analytics cookie is written and no page view is sent.
    override activate(): void {
        const { appId } = this.initialData;

        window.dataLayer = window.dataLayer || [];
        window.gtag = function gtag(): void {
            // eslint-disable-next-line prefer-rest-params
            window.dataLayer.push(arguments);
        };
        window.gtag('js', new Date());
        // Set before the config, so the automatic page_view and every event of the page carry the URLs and title without personal data.
        window.gtag('set', {
            page_location: this.getUrlWithoutPersonalData(window.location.href),
            page_referrer: this.getUrlWithoutPersonalData(document.referrer),
            page_title: this.getTitleWithoutPersonalData(document.title),
        });
        window.gtag('config', appId);

        this.loadGtagScript();
    }

    // Events sent while the script loads wait for it; a script that fails to load, e.g. for a content blocker, settles them at once.
    protected loadGtagScript(): void {
        const gtagScript = document.createElement('script');

        gtagScript.async = true;
        gtagScript.src = this.gtagScriptSrc;
        gtagScript.addEventListener(
            'load',
            () => {
                this.isGtagScriptLoaded = true;
            },
            { once: true },
        );
        gtagScript.addEventListener(
            'error',
            () => {
                this.isGtagScriptFailed = true;

                for (const settle of this.pendingEventSettlers) {
                    settle();
                }
            },
            { once: true },
        );

        document.head.appendChild(gtagScript);
    }

    // Origin and path, and only the campaign query parameters; an empty or invalid URL, e.g. no referrer, stays empty.
    protected getUrlWithoutPersonalData(url: string): string {
        let parsedUrl: URL;

        try {
            parsedUrl = new URL(url);
        } catch {
            return '';
        }

        const campaignQuery = new URLSearchParams();

        for (const [name, value] of parsedUrl.searchParams) {
            if (CAMPAIGN_QUERY_PARAMETERS.has(name)) {
                campaignQuery.append(name, value);
            }
        }

        const query = campaignQuery.toString();
        const path = this.getPathWithoutQuoteRequestReference(parsedUrl.pathname);

        return query ? `${parsedUrl.origin}${path}?${query}` : `${parsedUrl.origin}${path}`;
    }

    protected getPathWithoutQuoteRequestReference(path: string): string {
        return path.replace(QUOTE_REQUEST_REFERENCE_PATH_PATTERN, '$1');
    }

    // The title of a quote request page shows its reference, which the path of the page names.
    protected getTitleWithoutPersonalData(title: string): string {
        const quoteRequestReferenceMatch = window.location.pathname.match(QUOTE_REQUEST_REFERENCE_PATH_PATTERN);

        if (!quoteRequestReferenceMatch) {
            return title;
        }

        const quoteRequestReference = decodeURIComponent(quoteRequestReferenceMatch[2]);

        return title.split(quoteRequestReference).join('').trim();
    }

    // Only the storefront events of the GA4 events switched on in the Back Office are listened to.
    override getHandlers(): Partial<TraceableEventHandlers> {
        const handlersByGoogleAnalyticsEvent = this.getHandlersByGoogleAnalyticsEvent();
        const handlers: Partial<TraceableEventHandlers> = {};

        for (const googleAnalyticsEventName of GOOGLE_ANALYTICS_EVENT_NAMES) {
            if (!this.isEventEnabled(googleAnalyticsEventName)) {
                continue;
            }

            this.addHandlers(handlers, handlersByGoogleAnalyticsEvent[googleAnalyticsEventName]);
        }

        return handlers;
    }

    // The storefront events each GA4 event listens to. The entries are plain method references, so a handler that several GA4 events need is recognised and registered once.
    protected getHandlersByGoogleAnalyticsEvent(): Record<GoogleAnalyticsEventName, Partial<TraceableEventHandlers>> {
        return {
            search: {
                SEARCH_EVENT: [this.searchEventHandler],
            },
            // Raising a quantity is an add_to_cart, lowering it a remove_from_cart, so the quantity handlers check each setting themselves.
            add_to_cart: {
                ADD_TO_CART: [this.addToCartHandler],
                CHANGE_CART_QUANTITY: [this.cartQuantityChangeHandler],
                CART_ITEMS_CHANGE: [this.cartItemsChangeHandler],
            },
            remove_from_cart: {
                REMOVE_FROM_CART: [this.removeFromCartHandler],
                CHANGE_CART_QUANTITY: [this.cartQuantityChangeHandler],
                CART_ITEMS_CHANGE: [this.cartItemsChangeHandler],
            },
        };
    }

    protected addHandlers(
        handlers: Partial<TraceableEventHandlers>,
        eventHandlers: Partial<TraceableEventHandlers>,
    ): void {
        // The keys come from an object typed with storefront event names.
        const eventNames = Object.keys(eventHandlers) as EventName[];

        for (const eventName of eventNames) {
            const registeredHandlers = handlers[eventName] ?? [];

            for (const handler of eventHandlers[eventName] ?? []) {
                const isHandlerRegistered = registeredHandlers.includes(handler);

                if (isHandlerRegistered) {
                    continue;
                }

                registeredHandlers.push(handler);
            }

            handlers[eventName] = registeredHandlers;
        }
    }

    protected addToCartHandler(data: CartEventData): Promise<void> {
        return this.sendItemsEvent('add_to_cart', data.currency, data.products ?? []);
    }

    protected removeFromCartHandler(data: CartEventData): Promise<void> {
        return this.sendItemsEvent('remove_from_cart', data.currency, data.products ?? []);
    }

    protected cartQuantityChangeHandler(data: CartEventData): Promise<void> | void {
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

        let eventName: ItemsEventName = 'remove_from_cart';

        if (quantityDifference > 0) {
            eventName = 'add_to_cart';
        }

        if (!this.isEventEnabled(eventName)) {
            return;
        }

        const differenceProduct = { ...changedProduct, quantity: Math.abs(quantityDifference) };

        return this.sendItemsEvent(eventName, data.currency, [differenceProduct]);
    }

    protected cartItemsChangeHandler(data: CartItemsChangeData): void {
        // The cart tracker sends both arrays; a custom dispatcher may send only one, which must not break the other.
        const increased = data.eventDetail?.increased ?? [];
        const decreased = data.eventDetail?.decreased ?? [];

        if (this.isEventEnabled('add_to_cart')) {
            this.sendItemsEvent('add_to_cart', data.currency, increased);
        }

        if (this.isEventEnabled('remove_from_cart')) {
            this.sendItemsEvent('remove_from_cart', data.currency, decreased);
        }
    }

    protected sendItemsEvent(
        eventName: ItemsEventName,
        currency: string,
        products: ProductDetails[],
        additionalParams: Record<string, unknown> = {},
    ): Promise<void> {
        const items = this.getItems(products);

        if (!items.length) {
            return Promise.resolve();
        }

        const eventParams: Record<string, unknown> = { ...additionalParams, currency, items };
        const value = this.getItemsValue(items);

        // Without a price for every item (e.g. a guest who may not see prices) the value is left out, the event is still sent.
        if (value !== undefined) {
            eventParams.value = value;
        }

        return this.sendEvent(eventName, eventParams);
    }

    protected sendEvent(eventName: ItemsEventName, eventParams: Record<string, unknown>): Promise<void> {
        if (!this.isGtagEventAllowed(eventName)) {
            return Promise.resolve();
        }

        // Settles at once when nothing is gained by waiting: a loaded script sends the event with a keepalive request,
        // which outlives a navigation, and a script that failed to load (e.g. a content blocker) can never send it.
        // Only an event raised while the script is still loading sits in the data layer, which a navigation drops, so
        // that one resolves once Google Analytics has handled it, so a page that is about to navigate can wait for it.
        return new Promise((resolve) => {
            if (this.isGtagScriptLoaded || this.isGtagScriptFailed) {
                window.gtag('event', eventName, eventParams);
                resolve();

                return;
            }

            const settle = (): void => {
                window.clearTimeout(fallbackTimer);
                this.pendingEventSettlers.delete(settle);
                resolve();
            };
            const fallbackTimer = window.setTimeout(settle, this.gtagEventTimeout);

            this.pendingEventSettlers.add(settle);

            window.gtag('event', eventName, {
                ...eventParams,
                event_callback: settle,
                event_timeout: this.gtagEventTimeout,
            });
        });
    }

    // One entry per product, concrete product and variant: lines of the same one are added up, so an item is never sent twice.
    protected getItems(products: ProductDetails[]): GtagItem[] {
        const itemsByKey = new Map<string, GtagItem>();

        for (const product of products) {
            const requestedQuantity = Number(product?.quantity ?? 1);
            const isTrackable = Boolean(product?.sku) && requestedQuantity > 0;
            // GA4 counts whole pieces; a quantity in a measurement unit, e.g. 1.5 m, is rounded and stays at least 1.
            const quantity = Math.max(1, Math.round(requestedQuantity));

            if (!isTrackable) {
                continue;
            }

            const abstractSku = String(product.abstractSku || '');
            const concreteSku = this.getConcreteSku(product, abstractSku);
            // A trigger without the abstract product SKU falls back to the SKU it has.
            const itemId = abstractSku || String(product.sku);
            const variant = this.getVariant(product.variant);
            const itemKey = `${itemId}|${concreteSku}|${variant}`;
            const sameItem = itemsByKey.get(itemKey);

            if (sameItem) {
                sameItem.quantity += quantity;

                continue;
            }

            const item: GtagItem = { item_id: itemId, item_name: this.getItemName(product, itemId), quantity };
            const price = this.getPrice(product.price);

            if (product.brand) {
                item.item_brand = String(product.brand);
            }

            if (variant) {
                item.item_variant = variant;
            }

            if (concreteSku) {
                item.concrete_sku = concreteSku;
            }

            this.addCategoryLevels(item, product.categories ?? []);

            if (price !== undefined) {
                item.price = price;
            }

            itemsByKey.set(itemKey, item);
        }

        return Array.from(itemsByKey.values());
    }

    protected getVariant(variantValues: string[] | undefined): string {
        return (variantValues ?? []).map(String).join(VARIANT_VALUE_SEPARATOR);
    }

    // The categories arrive top level first, e.g. Computer > Pc's/Workstations; GA4 has at most five levels.
    protected addCategoryLevels(item: GtagItem, categories: ProductCategory[]): void {
        const levelCount = Math.min(categories.length, CATEGORY_LEVEL_KEYS.length);

        for (let level = 0; level < levelCount; level++) {
            item[CATEGORY_LEVEL_KEYS[level]] = categories[level].name;
        }
    }

    protected getConcreteSku(product: ProductDetails, abstractSku: string): string {
        if (product.concreteSku !== undefined) {
            return String(product.concreteSku ?? '');
        }

        const sku = String(product.sku);

        // Without the abstract product SKU, e.g. from a custom trigger, it is unknown which kind the SKU is.
        if (!abstractSku) {
            return '';
        }

        return sku === abstractSku ? '' : sku;
    }

    // The abstract product name, like the item ID, so a product keeps one name across the funnel whichever variant is shown.
    // item_name is never empty: a trigger without a name sends the ID instead.
    protected getItemName(product: ProductDetails, itemId: string): string {
        return String(product.abstractName || product.name || itemId);
    }

    protected getItemsValue(items: GtagItem[]): number | undefined {
        let value = 0;

        for (const item of items) {
            if (item.price === undefined) {
                return undefined;
            }

            value += item.price * item.quantity;
        }

        return Number(value.toFixed(this.priceDecimals));
    }

    // Storefront emitters send prices in cents; the price-precision attribute holds the parts per currency unit.
    protected getPrice(price: unknown): number | undefined {
        if (typeof price !== 'number') {
            return undefined;
        }

        return Number((price / this.pricePrecision).toFixed(this.priceDecimals));
    }

    protected searchEventHandler(data: SearchEventData): void {
        const { searchTerm, resultsCount } = data.eventDetail;
        const hasNoResults = resultsCount === 0 && searchTerm;
        const eventName: SearchEventName = hasNoResults ? 'zero_search_results' : 'search_results';

        if (!searchTerm || !this.isGtagEventAllowed(eventName)) {
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
    protected isEventEnabled(eventName: GoogleAnalyticsEventName): boolean {
        const isEventDisabled = this.initialData.events[eventName] === false;

        return !isEventDisabled;
    }

    protected get pricePrecision(): number {
        return Number(this.getAttribute('price-precision'));
    }

    // The decimals a price in currency units has, e.g. 2 for a precision of 100.
    protected get priceDecimals(): number {
        return Math.round(Math.log10(this.pricePrecision));
    }

    protected get gtagEventTimeout(): number {
        return Number(this.getAttribute('gtag-event-timeout'));
    }

    protected get gtagScriptSrc(): string {
        return this.getAttribute('data-gtag-script-src');
    }

    protected get initialData(): InitialData {
        return JSON.parse(this.getAttribute('initial'));
    }
}
