/* eslint-disable max-lines -- an adapter keeps all handlers of its provider as overridable methods, like the Algolia adapter */
/* eslint-disable camelcase -- GA4 defines its event and item parameters in snake_case, e.g. item_id, and gtag only accepts these names */
import {
    BaseTraceableEventAdapter,
    TraceableEventHandlers,
} from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/base-traceable-event-adapter';
import { debug } from 'ShopUi/app/logger';
import { CATEGORY_LEVEL_KEYS, CategoryLevelKey, getCategoryLevels, ProductCategory } from './category-levels';
import {
    buildGtagItems,
    convertPrice,
    getItemsInWholePieces,
    getItemsValue,
    getProductConcreteSku,
    getProductItemName,
    joinVariantValues,
    VARIANT_VALUE_SEPARATOR,
} from './gtag-items';
import {
    CAMPAIGN_QUERY_PARAMETERS,
    getPathWithoutQuoteRequestReference,
    getTitleWithoutQuoteRequestReference,
    getUrlWithoutPersonalData,
    QUOTE_REQUEST_REFERENCE_PATH_PATTERN,
} from './page-data-sanitizer';
import {
    getCurrentEvents,
    isPendingEventValue,
    MAX_PENDING_EVENT_AGE_MILLISECONDS,
    MAX_STORED_EVENTS,
    parseStoredEvents,
    readStoredEventsJson,
    removeStoredEvents,
    STORED_EVENTS_KEY,
    writeStoredEvents,
} from './pending-events-storage';
import {
    CartEventData,
    CartItemsChangeData,
    EnabledEvents,
    GtagFunction,
    GtagItem,
    InitialData,
    PendingEvent,
    ProductDetails,
    SearchEventData,
} from './types';

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

// Used when a project template renders the component without the price-precision attribute: Money stores prices in cents.
const DEFAULT_PRICE_PRECISION = 100;

// The Measurement IDs gtag is configured for on this page: a component mounted again, e.g. by a re-render, does not configure
// gtag again, which would send a second page_view.
const configuredMeasurementIds = new Set<string>();

export default class TraceableEventsGoogleAnalytics extends BaseTraceableEventAdapter {
    protected currentStore = '';
    protected currentLocale = '';
    // The attributes are read once in init(), as the handlers need them for every event and every item.
    protected appId = '';
    protected enabledEvents: EnabledEvents = {};
    // The parts per currency unit of a price in cents, e.g. 100, and the decimals a price in currency units has, e.g. 2.
    protected pricePrecision = 1;
    protected priceDecimals = 0;
    // The query parameters a project keeps in the page URLs besides the campaign ones, set in GoogleAnalyticsConfig.
    protected additionalPageUrlQueryParameters: string[] = [];
    // Events raised while the gtag script is loading, in the order they were raised.
    protected pendingEvents: PendingEvent[] = [];
    protected isGtagScriptLoading = true;
    protected listenersController = new AbortController();
    // Stops the load and error listeners once the gtag script has settled, so the page's other resources do not go through them.
    protected gtagScriptListenersController = new AbortController();

    override init(): void {
        const { appId, store, locale, events } = this.initialData;

        this.appId = appId;
        this.currentStore = store;
        this.currentLocale = locale;
        // A project template that renders no `events` switches every event off, like a setting that was never saved.
        this.enabledEvents = events ?? {};
        this.pricePrecision = this.readPricePrecision();
        this.priceDecimals = Math.round(Math.log10(this.pricePrecision));
        this.additionalPageUrlQueryParameters = this.readAdditionalPageUrlQueryParameters();

        this.configureGtag();

        this.isGtagScriptLoading = !this.isGtagScriptRunning() && !this.hasGtagScriptSettledWithoutRunning();
        this.watchPage();

        if (this.isGtagScriptLoading) {
            this.watchGtagScript();
        }

        this.sendStoredEvents();

        super.init();
    }

    protected configureGtag(): void {
        window.dataLayer = window.dataLayer || [];

        if (configuredMeasurementIds.has(this.appId)) {
            return;
        }

        configuredMeasurementIds.add(this.appId);
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
        window.gtag('config', this.appId);
    }

    // A missing or invalid attribute, e.g. from a project template, falls back to cents instead of breaking every price.
    protected readPricePrecision(): number {
        const pricePrecision = Number(this.getAttribute('price-precision'));
        const isValidPricePrecision = Number.isFinite(pricePrecision) && pricePrecision > 0;

        return isValidPricePrecision ? pricePrecision : DEFAULT_PRICE_PRECISION;
    }

    override disconnectedCallback(): void {
        this.listenersController.abort();
        this.gtagScriptListenersController.abort();

        super.disconnectedCallback();
    }

    // Origin and path, and only the campaign query parameters; an empty or invalid URL, e.g. no referrer, stays empty.
    protected getUrlWithoutPersonalData(url: string): string {
        return getUrlWithoutPersonalData(url, this.getPageUrlQueryParameters(), (path: string) =>
            this.getPathWithoutQuoteRequestReference(path),
        );
    }

    protected getPathWithoutQuoteRequestReference(path: string): string {
        return getPathWithoutQuoteRequestReference(path, this.getQuoteRequestReferencePathPattern());
    }

    // The title of a quote request page shows its reference, which the path of the page names.
    protected getTitleWithoutPersonalData(title: string): string {
        return getTitleWithoutQuoteRequestReference(
            title,
            window.location.pathname,
            this.getQuoteRequestReferencePathPattern(),
        );
    }

    protected getCampaignQueryParameters(): ReadonlySet<string> {
        return CAMPAIGN_QUERY_PARAMETERS;
    }

    // The campaign parameters and the ones the project keeps besides them, see GoogleAnalyticsConfig::getAdditionalPageUrlQueryParameters().
    protected getPageUrlQueryParameters(): ReadonlySet<string> {
        return new Set([...this.getCampaignQueryParameters(), ...this.additionalPageUrlQueryParameters]);
    }

    // A malformed or missing attribute keeps only the campaign parameters, so no other parameter is sent by mistake.
    protected readAdditionalPageUrlQueryParameters(): string[] {
        try {
            const parameters: unknown = JSON.parse(this.getAttribute('page-url-query-parameters') ?? '[]');

            return Array.isArray(parameters) ? parameters.map(String) : [];
        } catch {
            return [];
        }
    }

    protected getQuoteRequestReferencePathPattern(): RegExp {
        return QUOTE_REQUEST_REFERENCE_PATH_PATTERN;
    }

    protected getMaxStoredEvents(): number {
        return MAX_STORED_EVENTS;
    }

    protected getMaxPendingEventAgeMilliseconds(): number {
        return MAX_PENDING_EVENT_AGE_MILLISECONDS;
    }

    // A project may join the variant values differently, e.g. with ', '.
    protected getVariantValueSeparator(): string {
        return VARIANT_VALUE_SEPARATOR;
    }

    // A project may report fewer category levels, e.g. the first three keys.
    protected getCategoryLevelKeys(): readonly CategoryLevelKey[] {
        return CATEGORY_LEVEL_KEYS;
    }

    // Only the storefront events of the GA4 events switched on in the Back Office are listened to. A quantity change can be
    // either cart event, so its handlers check each setting themselves.
    override getHandlers(): Partial<TraceableEventHandlers> {
        const handlers: Partial<TraceableEventHandlers> = {};
        const isAddToCartEnabled = this.isEventEnabled('add_to_cart');
        const isRemoveFromCartEnabled = this.isEventEnabled('remove_from_cart');

        if (this.isEventEnabled('search')) {
            handlers.SEARCH_EVENT = [this.searchEventHandler];
        }

        if (isAddToCartEnabled) {
            handlers.ADD_TO_CART = [this.addToCartHandler];
        }

        if (isRemoveFromCartEnabled) {
            handlers.REMOVE_FROM_CART = [this.removeFromCartHandler];
        }

        if (isAddToCartEnabled || isRemoveFromCartEnabled) {
            handlers.CHANGE_CART_QUANTITY = [this.cartQuantityChangeHandler];
            handlers.CART_ITEMS_CHANGE = [this.cartItemsChangeHandler];
        }

        return handlers;
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

        let eventName = 'remove_from_cart';

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
        // The CartPage cart-items-change component sends both arrays; a custom dispatcher may send only one, which must not break the other.
        const increased = data.eventDetail?.increased ?? [];
        const decreased = data.eventDetail?.decreased ?? [];

        if (this.isEventEnabled('add_to_cart')) {
            this.sendItemsEvent('add_to_cart', data.currency, increased);
        }

        if (this.isEventEnabled('remove_from_cart')) {
            this.sendItemsEvent('remove_from_cart', data.currency, decreased);
        }
    }

    // Builds the items, value and currency of a GA4 ecommerce event.
    protected sendItemsEvent(eventName: string, currency: string, products: ProductDetails[]): void {
        const items = this.getItems(products);

        if (!items.length) {
            return;
        }

        // The value is calculated from the exact quantities, e.g. 1.5 m; only the item quantities GA4 receives are whole pieces.
        const value = this.getItemsValue(items);
        const eventParams: Record<string, unknown> = { currency, items: this.getItemsInWholePieces(items) };

        // Without a price for every item (e.g. a guest who may not see prices) the value is left out, the event is still sent.
        if (value !== undefined) {
            eventParams.value = value;
        }

        this.sendEvent(eventName, eventParams);
    }

    // A running gtag script sends with a request that outlives a navigation; an event raised while it loads waits, see queueEvent().
    protected sendEvent(eventName: string, eventParams: Record<string, unknown>): void {
        this.queueEvent({ name: eventName, params: eventParams, raisedAt: Date.now() });
    }

    // Sends the event, or keeps it while the gtag script loads; a stored event keeps the time it was raised, so it still expires.
    protected queueEvent(pendingEvent: PendingEvent): void {
        if (!this.isGtagScriptLoading) {
            window.gtag('event', pendingEvent.name, pendingEvent.params);

            return;
        }

        this.pendingEvents.push(pendingEvent);
    }

    // A running gtag script replaces the push method of the data layer with its own.
    protected isGtagScriptRunning(): boolean {
        return window.dataLayer.push !== Array.prototype.push;
    }

    protected isGtagScriptInDom(): boolean {
        return Boolean(document.querySelector(`script[src="${this.gtagScriptSrc}"]`));
    }

    // A gtag script already in the DOM, e.g. added by another component, that was fetched or outlived the page load without
    // running never will, e.g. one a content blocker stopped; no load or error event is left to wait for.
    protected hasGtagScriptSettledWithoutRunning(): boolean {
        const isGtagScriptFetched = performance
            .getEntriesByName(this.gtagScriptSrc)
            .some((entry) => (entry as PerformanceResourceTiming).responseEnd > 0);
        const hasGtagScriptSettled = isGtagScriptFetched || document.readyState === 'complete';

        if (!this.isGtagScriptInDom() || !hasGtagScriptSettled) {
            return false;
        }

        debug(
            `${this.name}: the gtag script was fetched before this component started but does not run; events are not sent`,
        );

        return true;
    }

    // Load and error events do not bubble, so they are captured on the document until the script settles; for a script that
    // was in the DOM before, the page load tells whether it ran.
    protected watchGtagScript(): void {
        const { signal } = this.gtagScriptListenersController;

        document.addEventListener('load', (event: Event) => this.onGtagScriptSettled(event, true), {
            capture: true,
            signal,
        });
        document.addEventListener('error', (event: Event) => this.onGtagScriptSettled(event, false), {
            capture: true,
            signal,
        });
        window.addEventListener('load', () => this.onPageLoaded(), { signal });
    }

    protected watchPage(): void {
        const { signal } = this.listenersController;

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

        if (!isGtagScript) {
            return;
        }

        this.settleGtagScript(isLoaded);
    }

    protected onPageLoaded(): void {
        if (!this.isGtagScriptInDom() || this.isGtagScriptRunning()) {
            return;
        }

        debug(`${this.name}: the gtag script does not run after the page has loaded; events are not sent`);

        this.settleGtagScript(false);
    }

    protected settleGtagScript(isLoaded: boolean): void {
        if (!this.isGtagScriptLoading) {
            return;
        }

        const pendingEvents = this.pendingEvents;

        this.isGtagScriptLoading = false;
        this.pendingEvents = [];
        this.gtagScriptListenersController.abort();

        // A script that failed to load, e.g. one a content blocker stopped, can never send them.
        if (!isLoaded) {
            return;
        }

        for (const { name, params } of pendingEvents) {
            window.gtag('event', name, params);
        }
    }

    // The events go with the page they happened on, its URL, referrer and title, as the next page sends them under its own otherwise.
    protected storePendingEvents(): void {
        if (!this.pendingEvents.length) {
            return;
        }

        const pageParams = {
            page_location: this.getUrlWithoutPersonalData(window.location.href),
            page_referrer: this.getUrlWithoutPersonalData(document.referrer),
            page_title: this.getTitleWithoutPersonalData(document.title),
        };
        const pageEvents = this.pendingEvents.map(({ name, params, raisedAt }) => ({
            name,
            params: { ...pageParams, ...params },
            raisedAt,
        }));
        // Added to what is stored already, e.g. by the same page when it was hidden before.
        const storedEvents = [...this.readStoredEvents(), ...pageEvents].slice(-this.getMaxStoredEvents());

        // Taken off the page, so a page restored from the back-forward cache does not send them as well as the next page.
        this.pendingEvents = [];

        writeStoredEvents(this.storedEventsKey, storedEvents, this.name);
    }

    // Taken off the storage before they are sent, so every page sends them once at most.
    // Runs on every page load and tab focus; with nothing stored, the usual case, it only reads the storage once.
    protected sendStoredEvents(): void {
        const storedEventsJson = this.readStoredEventsJson();

        if (storedEventsJson === null) {
            return;
        }

        const storedEvents = this.parseStoredEvents(storedEventsJson);

        removeStoredEvents(this.storedEventsKey);

        for (const storedEvent of getCurrentEvents(storedEvents, this.getMaxPendingEventAgeMilliseconds(), this.name)) {
            this.queueEvent(storedEvent);
        }
    }

    protected readStoredEvents(): PendingEvent[] {
        const storedEventsJson = this.readStoredEventsJson();

        return storedEventsJson === null ? [] : this.parseStoredEvents(storedEventsJson);
    }

    // Null when nothing is stored, or when the storage is switched off.
    protected readStoredEventsJson(): string | null {
        return readStoredEventsJson(this.storedEventsKey, this.name);
    }

    protected parseStoredEvents(storedEventsJson: string): PendingEvent[] {
        return parseStoredEvents(storedEventsJson, this.name, (value: unknown) => this.isPendingEvent(value));
    }

    protected isPendingEvent(value: unknown): value is PendingEvent {
        return isPendingEventValue(value);
    }

    // One entry per product, concrete product and variant: lines of the same one are added up, so an item is never sent twice.
    protected getItems(products: ProductDetails[]): GtagItem[] {
        return buildGtagItems(products, {
            getConcreteSku: (product: ProductDetails, abstractSku: string) => this.getConcreteSku(product, abstractSku),
            getVariant: (variant: unknown) => this.getVariant(variant),
            getItemName: (product: ProductDetails, itemId: string) => this.getItemName(product, itemId),
            getPrice: (price: unknown) => this.getPrice(price),
            addCategoryLevels: (item: GtagItem, categories: ProductCategory[]) =>
                this.addCategoryLevels(item, categories),
        });
    }

    // A template may send the variant as one string, e.g. "Red / 64 GB", instead of its values; it is reported as it is.
    protected getVariant(variant: unknown): string {
        return joinVariantValues(variant, this.getVariantValueSeparator());
    }

    // One level per key of getCategoryLevelKeys(), top level first; see getCategoryLevels().
    protected addCategoryLevels(item: GtagItem, categories: ProductCategory[]): void {
        Object.assign(item, getCategoryLevels(categories, this.getCategoryLevelKeys()));
    }

    protected getConcreteSku(product: ProductDetails, abstractSku: string): string {
        return getProductConcreteSku(product, abstractSku);
    }

    // The abstract product name, so a product keeps one name across the funnel; never empty, see getProductItemName().
    protected getItemName(product: ProductDetails, itemId: string): string {
        return getProductItemName(product, itemId);
    }

    // GA4 counts whole pieces; a quantity in a measurement unit, e.g. 1.5 m, is rounded and stays at least 1.
    protected getItemsInWholePieces(items: GtagItem[]): GtagItem[] {
        return getItemsInWholePieces(items);
    }

    protected getItemsValue(items: GtagItem[]): number | undefined {
        return getItemsValue(items, this.priceDecimals);
    }

    // Storefront emitters send prices in cents; the price-precision attribute holds the parts per currency unit.
    protected getPrice(price: unknown): number | undefined {
        return convertPrice(price, this.pricePrecision, this.priceDecimals);
    }

    protected searchEventHandler(data: SearchEventData): void {
        const { searchTerm, resultsCount } = data.eventDetail;

        if (!searchTerm) {
            return;
        }

        const hasNoResults = resultsCount === 0;
        const eventName = hasNoResults ? 'zero_search_results' : 'search_results';

        this.sendEvent(eventName, {
            search_term: searchTerm,
            event_category: 'Search results',
            event_label: hasNoResults ? 'No results' : 'Search results',
            results_count: resultsCount,
            store: this.currentStore,
            locale: this.currentLocale,
        });
    }

    // An event missing from the map, e.g. before `configuration:sync` adds its setting, is off, like the setting's Back Office default.
    protected isEventEnabled(eventName: string): boolean {
        return this.enabledEvents[eventName] === true;
    }

    // Per measurement ID, as another store of the same domain may report to another property.
    protected get storedEventsKey(): string {
        return `${STORED_EVENTS_KEY}:${this.appId}`;
    }

    protected get gtagScriptSrc(): string {
        return this.getAttribute('data-gtag-script-src');
    }

    protected get initialData(): InitialData {
        return JSON.parse(this.getAttribute('initial'));
    }
}
