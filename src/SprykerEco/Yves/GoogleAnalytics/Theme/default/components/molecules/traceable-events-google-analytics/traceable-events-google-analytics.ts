/* eslint-disable max-lines -- the adapter keeps its event handlers and the gtag script state as overridable methods; the items, page data and stored events live in their own modules */
/* eslint-disable camelcase -- GA4 defines its event and item parameters in snake_case, e.g. item_id, and gtag only accepts these names */
import {
    BaseTraceableEventAdapter,
    TraceableEventHandlers,
} from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/base-traceable-event-adapter';
import {
    CONSENT_PURPOSE_STATISTICS,
    ConsentPurpose,
} from 'TraceableEventWidget/components/molecules/traceable-events-consent/consent-purposes';
import { debug } from 'ShopUi/app/logger';
import { CATEGORY_LEVEL_KEYS, CategoryLevelKey } from './category-levels';
import { buildGtagItems, roundQuantitiesToWholePieces, sumItemsValue, VARIANT_VALUE_SEPARATOR } from './gtag-items';
import {
    CAMPAIGN_QUERY_PARAMETERS,
    removePersonalDataFromTitle,
    removePersonalDataFromUrl,
} from './page-data-sanitizer';
import { PendingEventsStorage } from './pending-events-storage';
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
        // Google Analytics' opt-out flag, `ga-disable-<Measurement ID>`: while true, gtag sends nothing for that Measurement ID.
        [gaDisableFlag: `ga-disable-${string}`]: boolean | undefined;
    }
}

// Used when a project template renders the component without the price-precision attribute: Money stores prices in cents.
const DEFAULT_PRICE_PRECISION = 100;

// The events a page could not send before it was left are kept under this key, per Measurement ID.
const STORED_EVENTS_KEY = 'traceable-events-google-analytics:pending-events';

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
    protected isGtagSetUp = false;

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
        this.watchPage();

        super.init();
    }

    // GA4 measures how the shop is used; a project that links it to advertising, e.g. Google Ads remarketing, declares marketing as well.
    override get consentPurposes(): ConsentPurpose[] {
        return [CONSENT_PURPOSE_STATISTICS];
    }

    // The purposes a GA4 event serves, by its GA4 name, e.g. add_to_cart or a project's begin_checkout; a project groups single
    // events differently in its consent component.
    protected getGtagEventConsentPurposes(_gtagEventName: string): ConsentPurpose[] {
        return this.consentPurposes;
    }

    protected isGtagEventAllowed(gtagEventName: string): boolean {
        return this.isProviderEventAllowed(gtagEventName, this.getGtagEventConsentPurposes(gtagEventName));
    }

    // Started once the orchestrator allows the adapter, e.g. after the shopper's consent: before, gtag.js is not requested, no Google
    // Analytics cookie is written, no page view is sent and the events a previous page stored stay stored.
    override activate(): void {
        window[`ga-disable-${this.appId}`] = false;

        // Consent given again after a withdrawal on the same page: gtag is set up and its script loaded already.
        if (this.isGtagSetUp) {
            return;
        }

        this.isGtagSetUp = true;
        this.configureGtag();

        // A gtag script already in the DOM, e.g. added by another component, is not added again; its state decides.
        const isGtagScriptToLoad = !this.isGtagScriptInDom();

        this.isGtagScriptLoading =
            isGtagScriptToLoad || (!this.isGtagScriptRunning() && !this.hasGtagScriptSettledWithoutRunning());

        if (this.isGtagScriptLoading) {
            this.watchGtagScript();
        }

        if (isGtagScriptToLoad) {
            this.loadGtagScript();
        }

        this.sendStoredEvents();
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

    // Consent withdrawn on the page: gtag sends nothing more, its automatic events included, e.g. a page_view on a history change.
    // The cookies it already wrote are left to the consent management platform, which removes them on withdrawal.
    override deactivate(): void {
        window[`ga-disable-${this.appId}`] = true;
    }

    // Its load or error event settles the events raised while it loads, see watchGtagScript().
    protected loadGtagScript(): void {
        const gtagScript = document.createElement('script');

        gtagScript.async = true;
        gtagScript.src = this.gtagScriptSrc;

        document.head.appendChild(gtagScript);
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

    // Origin and path, and only the query parameters of getPageUrlQueryParameters(); an empty or invalid URL, e.g. no referrer,
    // stays empty. A project with other personal data in its URLs, e.g. in a path of its own, removes it here.
    protected getUrlWithoutPersonalData(url: string): string {
        return removePersonalDataFromUrl(url, this.getPageUrlQueryParameters());
    }

    // The title of a quote request page shows its reference; a project with other personal data in its titles removes it here.
    protected getTitleWithoutPersonalData(title: string): string {
        return removePersonalDataFromTitle(title, window.location.pathname);
    }

    // The campaign parameters and the ones the project keeps besides them, see GoogleAnalyticsConfig::getAdditionalPageUrlQueryParameters().
    protected getPageUrlQueryParameters(): ReadonlySet<string> {
        return new Set([...CAMPAIGN_QUERY_PARAMETERS, ...this.additionalPageUrlQueryParameters]);
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
        const value = sumItemsValue(items, this.priceDecimals);
        const eventParams: Record<string, unknown> = { currency, items: roundQuantitiesToWholePieces(items) };

        // Without a price for every item (e.g. a guest who may not see prices) the value is left out, the event is still sent.
        if (value !== undefined) {
            eventParams.value = value;
        }

        this.sendEvent(eventName, eventParams);
    }

    // A running gtag script sends with a request that outlives a navigation; an event raised while it loads waits, see queueEvent().
    protected sendEvent(eventName: string, eventParams: Record<string, unknown>): void {
        if (!this.isGtagEventAllowed(eventName)) {
            return;
        }

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

    // A gtag script already in the DOM when the adapter starts, e.g. added by another component, is not added again.
    // When that script was fetched but never ran, e.g. it failed to load, no load or error event is left to wait for. A script a
    // content blocker stopped may leave no resource timing entry, but the page load waits for every script in the DOM, so a
    // script that does not run once the page has loaded never will.
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

    // Load and error events do not bubble, so they are captured on the document. activate() listens before it adds the script,
    // so neither event can fire before this listens. A script that was already in the DOM may have failed before; the page load,
    // which waits for it, tells.
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

        // Taken off the page, so a page restored from the back-forward cache does not send them as well as the next page.
        this.pendingEvents = [];
        this.createPendingEventsStorage().add(pageEvents);
    }

    // Taken off the storage before they are sent, so every page sends them once at most.
    protected sendStoredEvents(): void {
        for (const storedEvent of this.createPendingEventsStorage().take()) {
            this.queueEvent(storedEvent);
        }
    }

    // Per Measurement ID, as another store of the same domain may report to another property.
    protected createPendingEventsStorage(): PendingEventsStorage {
        return new PendingEventsStorage(`${STORED_EVENTS_KEY}:${this.appId}`, (message: string) =>
            debug(`${this.name}: ${message}`),
        );
    }

    // One entry per product, concrete product and variant: lines of the same one are added up, so an item is never sent twice.
    protected getItems(products: ProductDetails[]): GtagItem[] {
        return buildGtagItems(products, {
            pricePrecision: this.pricePrecision,
            priceDecimals: this.priceDecimals,
            variantValueSeparator: this.getVariantValueSeparator(),
            categoryLevelKeys: this.getCategoryLevelKeys(),
        });
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

    protected get gtagScriptSrc(): string {
        return this.getAttribute('data-gtag-script-src');
    }

    protected get initialData(): InitialData {
        return JSON.parse(this.getAttribute('initial'));
    }
}
