/* eslint-disable max-lines -- an adapter keeps all handlers of its provider as overridable methods, like the Algolia adapter */
/* eslint-disable camelcase -- GA4 defines its event and item parameters in snake_case, e.g. item_id, and gtag only accepts these names */
import {
    BaseTraceableEventAdapter,
    TraceableEventHandlers,
} from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/base-traceable-event-adapter';
import {
    EventsHandlerData,
    EventName,
} from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/traceable-events-orchestrator';
import { debug } from 'ShopUi/app/logger';

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
    // The SKU of the abstract product, sent as item_id, so every step of the funnel reports a product under the same id.
    abstractSku?: string;
    // The SKU of the concrete product, sent by a trigger whose `sku` may stand for something else, e.g. a product card of a product
    // with several variants, which sends an empty one; without it, `sku` is concrete when it differs from the abstract product SKU.
    concreteSku?: string;
    // The product's own name, e.g. of a concrete product "Galaxy Tab A 32 GB", and the name of its abstract product; a variant may have a name of its own.
    name?: string;
    abstractName?: string;
    price?: number;
    quantity?: number;
    newQuantity?: number;
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
    // A custom item parameter: the SKU of the concrete product, where the event knows it, e.g. in the cart; a product list card of a product
    // with several variants has none. Merchants register it as an item-scoped custom dimension to report by concrete product.
    concrete_sku?: string;
    price?: number;
    quantity: number;
}

type ItemsEventName = 'add_to_cart' | 'remove_from_cart';

// The GA4 events a Back Office setting can switch off, in the order their handlers run when several listen to one storefront event.
const GOOGLE_ANALYTICS_EVENT_NAMES: readonly string[] = ['search', 'add_to_cart', 'remove_from_cart'];

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
// An event raised while the gtag script is loading; `params` are its gtag event parameters, `raisedAt` when it was raised.
interface PendingEvent {
    name: string;
    params: Record<string, unknown>;
    raisedAt: number;
}

// The events a page could not send before it was left, kept in the session storage of the tab for the next page.
const STORED_EVENTS_KEY = 'traceable-events-google-analytics:pending-events';
// A tab whose gtag script never loads passes the events on from page to page; only the newest ones are kept.
const MAX_STORED_EVENTS = 50;
// An event the tab could not send for this long is dropped: sent later, it would land in another session and at another time.
// 30 minutes.
const MAX_PENDING_EVENT_AGE_MILLISECONDS = 1800000;

// A quote request page has the quote request reference in its path, e.g. /quote-request/details/DE--21-8, and in its title. The
// reference contains the customer reference, so it is left out of the page URLs and the title, for the agent's pages as well.
const QUOTE_REQUEST_REFERENCE_PATH_PATTERN = /(\/quote-request\/[\w-]+\/)([^/]+)/;

export default class TraceableEventsGoogleAnalytics extends BaseTraceableEventAdapter {
    protected currentStore = '';
    protected currentLocale = '';
    // Events raised while the gtag script is loading, in the order they were raised.
    protected pendingEvents: PendingEvent[] = [];
    protected isGtagScriptLoading = true;
    protected listenersController = new AbortController();

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
        // Set before the config, so the automatic page_view and every event of the page carry the URLs and title without personal data.
        window.gtag('set', {
            page_location: this.getUrlWithoutPersonalData(window.location.href),
            page_referrer: this.getUrlWithoutPersonalData(document.referrer),
            page_title: this.getTitleWithoutPersonalData(document.title),
        });
        window.gtag('config', appId);

        // A running gtag script replaces the push method of the data layer with its own.
        this.isGtagScriptLoading =
            window.dataLayer.push === Array.prototype.push && !this.hasGtagScriptSettledWithoutRunning();
        this.watchGtagScript();
        this.sendStoredEvents();

        super.init();
    }

    override disconnectedCallback(): void {
        this.listenersController.abort();

        super.disconnectedCallback();
    }

    // Origin and path, and only the campaign query parameters; an empty or invalid URL, e.g. no referrer, stays empty.
    protected getUrlWithoutPersonalData(url: string): string {
        let parsedUrl: URL;

        try {
            parsedUrl = new URL(url);
        } catch {
            return '';
        }

        const campaignQueryParameters = this.getCampaignQueryParameters();
        const campaignQuery = new URLSearchParams();

        for (const [name, value] of parsedUrl.searchParams) {
            if (campaignQueryParameters.has(name)) {
                campaignQuery.append(name, value);
            }
        }

        const query = campaignQuery.toString();
        const path = this.getPathWithoutQuoteRequestReference(parsedUrl.pathname);

        return query ? `${parsedUrl.origin}${path}?${query}` : `${parsedUrl.origin}${path}`;
    }

    protected getPathWithoutQuoteRequestReference(path: string): string {
        return path.replace(this.getQuoteRequestReferencePathPattern(), '$1');
    }

    // The title of a quote request page shows its reference, which the path of the page names.
    protected getTitleWithoutPersonalData(title: string): string {
        const quoteRequestReferenceMatch = window.location.pathname.match(this.getQuoteRequestReferencePathPattern());

        if (!quoteRequestReferenceMatch) {
            return title;
        }

        const quoteRequestReference = decodeURIComponent(quoteRequestReferenceMatch[2]);

        return title.split(quoteRequestReference).join('').trim();
    }

    // A project adds its own GA4 event here and maps its handlers in getHandlersByGoogleAnalyticsEvent().
    protected getGoogleAnalyticsEventNames(): readonly string[] {
        return GOOGLE_ANALYTICS_EVENT_NAMES;
    }

    protected getCampaignQueryParameters(): ReadonlySet<string> {
        return CAMPAIGN_QUERY_PARAMETERS;
    }

    protected getQuoteRequestReferencePathPattern(): RegExp {
        return QUOTE_REQUEST_REFERENCE_PATH_PATTERN;
    }

    // Only the storefront events of the GA4 events switched on in the Back Office are listened to.
    override getHandlers(): Partial<TraceableEventHandlers> {
        const handlersByGoogleAnalyticsEvent = this.getHandlersByGoogleAnalyticsEvent();
        const handlers: Partial<TraceableEventHandlers> = {};

        for (const googleAnalyticsEventName of this.getGoogleAnalyticsEventNames()) {
            if (!this.isEventEnabled(googleAnalyticsEventName)) {
                continue;
            }

            this.addHandlers(handlers, handlersByGoogleAnalyticsEvent[googleAnalyticsEventName] ?? {});
        }

        return handlers;
    }

    // The storefront events each GA4 event listens to. The entries are plain method references, so a handler that several GA4 events need is recognised and registered once.
    protected getHandlersByGoogleAnalyticsEvent(): Record<string, Partial<TraceableEventHandlers>> {
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

    protected addToCartHandler(data: CartEventData): void {
        this.sendItemsEvent('add_to_cart', data.currency, data.products ?? []);
    }

    protected removeFromCartHandler(data: CartEventData): void {
        this.sendItemsEvent('remove_from_cart', data.currency, data.products ?? []);
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

        let eventName: ItemsEventName = 'remove_from_cart';

        if (quantityDifference > 0) {
            eventName = 'add_to_cart';
        }

        if (!this.isEventEnabled(eventName)) {
            return;
        }

        const differenceProduct = { ...changedProduct, quantity: Math.abs(quantityDifference) };

        this.sendItemsEvent(eventName, data.currency, [differenceProduct]);
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
    ): void {
        const items = this.getItems(products);

        if (!items.length) {
            return;
        }

        // The value is calculated from the exact quantities, e.g. 1.5 m; only the item quantities GA4 receives are whole pieces.
        const value = this.getItemsValue(items);
        const eventParams: Record<string, unknown> = { ...additionalParams, currency, items: this.getItemsInWholePieces(items) };

        // Without a price for every item (e.g. a guest who may not see prices) the value is left out, the event is still sent.
        if (value !== undefined) {
            eventParams.value = value;
        }

        this.sendEvent(eventName, eventParams);
    }

    // A running gtag script sends the event with a beacon or keepalive request, which outlives a navigation. An event raised
    // while the script is still loading is kept by this component instead of the data layer, which a navigation drops:
    // it is sent once the script runs, or passed on to the next page of the tab when the page is left first.
    protected sendEvent(eventName: string, eventParams: Record<string, unknown>): void {
        this.queueEvent({ name: eventName, params: eventParams, raisedAt: Date.now() });
    }

    // Sends the event, or keeps it while the gtag script is loading. An event taken back from the storage keeps the time it was
    // raised, so it expires however often it is passed on.
    protected queueEvent(pendingEvent: PendingEvent): void {
        if (!this.isGtagScriptLoading) {
            window.gtag('event', pendingEvent.name, pendingEvent.params);

            return;
        }

        this.pendingEvents.push(pendingEvent);
    }

    // The script-loader finds a gtag script that is already in the DOM, e.g. added by another component, and does not add it again.
    // When that script was fetched but never ran, e.g. it failed to load, no load or error event is left to wait for.
    protected hasGtagScriptSettledWithoutRunning(): boolean {
        const isGtagScriptInDom = Boolean(document.querySelector(`script[src="${this.gtagScriptSrc}"]`));
        const isGtagScriptFetched = performance
            .getEntriesByName(this.gtagScriptSrc)
            .some((entry) => (entry as PerformanceResourceTiming).responseEnd > 0);

        if (!isGtagScriptInDom || !isGtagScriptFetched) {
            return false;
        }

        debug(
            `${this.name}: the gtag script was fetched before this component started but does not run; events are not sent`,
        );

        return true;
    }

    // Load and error events do not bubble, so they are captured on the document. The script-loader next to this component
    // injects the script while the components mount, so neither event can fire before this listens.
    protected watchGtagScript(): void {
        const { signal } = this.listenersController;

        document.addEventListener('load', (event: Event) => this.onGtagScriptSettled(event, true), {
            capture: true,
            signal,
        });
        document.addEventListener('error', (event: Event) => this.onGtagScriptSettled(event, false), {
            capture: true,
            signal,
        });
        // A tab killed in the background, e.g. on a phone, may never fire pagehide, so the events are stored once the page is hidden.
        // A page shown again, by the tab or from the back-forward cache, takes them back.
        document.addEventListener('visibilitychange', () => this.onVisibilityChange(), { signal });
        window.addEventListener('pagehide', () => this.storePendingEvents(), { signal });
        window.addEventListener('pageshow', (event: PageTransitionEvent) => this.onPageShow(event), { signal });
    }

    protected onVisibilityChange(): void {
        if (document.visibilityState === 'hidden') {
            this.storePendingEvents();

            return;
        }

        this.sendStoredEvents();
    }

    // A page the browser restores from the back-forward cache does not start again, so it takes back what it stored when it was left.
    protected onPageShow(event: PageTransitionEvent): void {
        if (!event.persisted) {
            return;
        }

        this.sendStoredEvents();
    }

    protected onGtagScriptSettled(event: Event, isLoaded: boolean): void {
        const isGtagScript =
            event.target instanceof HTMLScriptElement && event.target.getAttribute('src') === this.gtagScriptSrc;

        if (!isGtagScript || !this.isGtagScriptLoading) {
            return;
        }

        const pendingEvents = this.pendingEvents;

        this.isGtagScriptLoading = false;
        this.pendingEvents = [];

        // A script that failed to load, e.g. one a content blocker stopped, can never send them.
        if (!isLoaded) {
            return;
        }

        for (const { name, params } of pendingEvents) {
            window.gtag('event', name, params);
        }
    }

    // The events go with the page they happened on, as the next page sends them under its own URL otherwise.
    protected storePendingEvents(): void {
        if (!this.pendingEvents.length) {
            return;
        }

        const pageParams = {
            page_location: this.getUrlWithoutPersonalData(window.location.href),
            page_title: this.getTitleWithoutPersonalData(document.title),
        };
        const pageEvents = this.pendingEvents.map(({ name, params, raisedAt }) => ({
            name,
            params: { ...pageParams, ...params },
            raisedAt,
        }));
        // Added to what is stored already, e.g. by the same page when it was hidden before.
        const storedEvents = [...this.readStoredEvents(), ...pageEvents].slice(-MAX_STORED_EVENTS);

        // Taken off the page, so a page restored from the back-forward cache does not send them as well as the next page.
        this.pendingEvents = [];

        try {
            window.sessionStorage.setItem(this.storedEventsKey, JSON.stringify(storedEvents));
        } catch (error) {
            // Storage that is switched off or full loses the events, as the navigation would; tracking never breaks the page.
            debug(
                `${this.name}: ${storedEvents.length} pending events are lost, the session storage refused them: ${error}`,
            );
        }
    }

    // Taken off the storage before they are sent, so every page sends them once at most.
    protected sendStoredEvents(): void {
        const storedEvents = this.readStoredEvents();

        try {
            window.sessionStorage.removeItem(this.storedEventsKey);
        } catch {
            // Storage that is switched off has nothing stored; readStoredEvents() already reported it.
        }

        const oldestRaisedAt = Date.now() - MAX_PENDING_EVENT_AGE_MILLISECONDS;
        const currentEvents = storedEvents.filter((storedEvent) => storedEvent.raisedAt >= oldestRaisedAt);

        if (currentEvents.length < storedEvents.length) {
            debug(
                `${this.name}: ${storedEvents.length - currentEvents.length} stored events are older than the maximum age and dropped`,
            );
        }

        for (const storedEvent of currentEvents) {
            this.queueEvent(storedEvent);
        }
    }

    protected readStoredEvents(): PendingEvent[] {
        let storedEvents: unknown;

        try {
            storedEvents = JSON.parse(window.sessionStorage.getItem(this.storedEventsKey));
        } catch (error) {
            // Storage that is switched off, or a value that is not JSON, has no events to send.
            debug(`${this.name}: the stored events cannot be read: ${error}`);

            return [];
        }

        if (!Array.isArray(storedEvents)) {
            return [];
        }

        return storedEvents.filter((storedEvent: unknown): storedEvent is PendingEvent =>
            this.isPendingEvent(storedEvent),
        );
    }

    protected isPendingEvent(value: unknown): value is PendingEvent {
        const pendingEvent = value as PendingEvent;

        return (
            typeof pendingEvent?.name === 'string' &&
            typeof pendingEvent.params === 'object' &&
            pendingEvent.params !== null &&
            typeof pendingEvent.raisedAt === 'number'
        );
    }

    // One entry per product and concrete product: lines of the same one are added up, so an item is never sent twice.
    protected getItems(products: ProductDetails[]): GtagItem[] {
        const itemsByKey = new Map<string, GtagItem>();

        for (const product of products) {
            const quantity = Number(product?.quantity ?? 1);
            const isTrackable = Boolean(product?.sku) && quantity > 0;

            if (!isTrackable) {
                continue;
            }

            const abstractSku = String(product.abstractSku || '');
            const concreteSku = this.getConcreteSku(product, abstractSku);
            // A trigger without the abstract product SKU falls back to the SKU it has.
            const itemId = abstractSku || String(product.sku);
            const itemKey = `${itemId}|${concreteSku}`;
            const sameItem = itemsByKey.get(itemKey);

            if (sameItem) {
                sameItem.quantity += quantity;

                continue;
            }

            const item: GtagItem = { item_id: itemId, item_name: this.getItemName(product, itemId), quantity };
            const price = this.getPrice(product.price);

            if (concreteSku) {
                item.concrete_sku = concreteSku;
            }

            if (price !== undefined) {
                item.price = price;
            }

            itemsByKey.set(itemKey, item);
        }

        return Array.from(itemsByKey.values());
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

    // GA4 counts whole pieces; a quantity in a measurement unit, e.g. 1.5 m, is rounded and stays at least 1.
    protected getItemsInWholePieces(items: GtagItem[]): GtagItem[] {
        return items.map((item) => ({ ...item, quantity: Math.max(1, Math.round(item.quantity)) }));
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
        const eventName = hasNoResults ? 'zero_search_results' : 'search_results';

        if (!searchTerm) {
            return;
        }

        this.sendEvent(eventName, {
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

    protected get pricePrecision(): number {
        return Number(this.getAttribute('price-precision'));
    }

    // The decimals a price in currency units has, e.g. 2 for a precision of 100.
    protected get priceDecimals(): number {
        return Math.round(Math.log10(this.pricePrecision));
    }

    // Per measurement ID, as another store of the same domain may report to another property.
    protected get storedEventsKey(): string {
        return `${STORED_EVENTS_KEY}:${this.initialData.appId}`;
    }

    protected get gtagScriptSrc(): string {
        return this.getAttribute('data-gtag-script-src');
    }

    protected get initialData(): InitialData {
        return JSON.parse(this.getAttribute('initial'));
    }
}
