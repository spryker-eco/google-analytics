/* eslint-disable max-lines -- the adapter keeps its event handlers and the gtag script state as overridable methods; the items, page data and stored events live in their own modules */
/* eslint-disable camelcase -- GA4 defines its event and item parameters in snake_case, e.g. item_id, and gtag only accepts these names */
import {
    BaseTraceableEventAdapter,
    TraceableEventHandlers,
} from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/base-traceable-event-adapter';
import { TraceableEventHandler } from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/traceable-events-orchestrator';
import { debug } from 'ShopUi/app/logger';
import { CATEGORY_LEVEL_KEYS, CategoryLevelKey } from './category-levels';
import { buildGtagItems, roundQuantitiesToWholePieces, sumItemsValue, VARIANT_VALUE_SEPARATOR } from './gtag-items';
import {
    CAMPAIGN_QUERY_PARAMETERS,
    removePersonalDataFromTitle,
    removePersonalDataFromUrl,
} from './page-data-sanitizer';
import { PendingEventsStorage } from './pending-events-storage';
import { ReportedIdsStorage } from './reported-ids-storage';
import { TabStorage } from './tab-storage';
import {
    CartEventData,
    CartItemsChangeData,
    EnabledEvents,
    GtagFunction,
    GtagItem,
    InitialData,
    ItemList,
    ItemListViewData,
    PageLoadData,
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
        ITEM_LIST_VIEW: undefined;
        PRODUCT_CLICK: undefined;
        ADD_TO_WISHLIST: undefined;
        CHECKOUT_START: undefined;
        SHIPMENT_SUBMIT: undefined;
        PAYMENT_SUBMIT: undefined;
    }

    interface Window {
        dataLayer: unknown[];
        gtag: GtagFunction;
    }
}

// Used when a project template renders the component without the price-precision attribute: Money stores prices in cents.
const DEFAULT_PRICE_PRECISION = 100;

// The events a page could not send before it was left are kept under this key, per Measurement ID.
const STORED_EVENTS_KEY = 'traceable-events-google-analytics:pending-events';

const PAGE_PRODUCT_DETAIL = 'PDP';
const PAGE_CART = 'CART';
const PAGE_CHECKOUT = 'CHECKOUT';
const PAGE_CHECKOUT_SUCCESS = 'CHECKOUT_SUCCESS';
const CHECKOUT_STEP_SHIPMENT = 'SHIPMENT';
const CHECKOUT_STEP_PAYMENT = 'PAYMENT';

// Set in the tab when the shopper clicks to start the checkout, taken by the next page load: a checkout step reports begin_checkout,
// any other page, e.g. the cart a blocked checkout returns to, only discards it. Reloads and moves between steps find none.
const CHECKOUT_START_REQUEST_STORAGE_KEY = 'traceable-events-google-analytics:checkout-start-requested';
// Set in the tab when the shopper submits the shipment or payment step, taken by the next page load: the step after it reports
// add_shipping_info or add_payment_info, the same step shown again, e.g. with errors, only discards it.
const SHIPMENT_SUBMIT_STORAGE_KEY = 'traceable-events-google-analytics:shipment-submitted';
const PAYMENT_SUBMIT_STORAGE_KEY = 'traceable-events-google-analytics:payment-submitted';
// The shipping tier and payment type last reported in this checkout: continuing with the same methods is no new choice.
// A new checkout start forgets them.
const REPORTED_SHIPPING_TIER_STORAGE_KEY = 'traceable-events-google-analytics:reported-shipping-tier';
const REPORTED_PAYMENT_TYPE_STORAGE_KEY = 'traceable-events-google-analytics:reported-payment-type';
// The order references already reported, per Measurement ID, so reloading or returning to the confirmation page does not report an order again.
const REPORTED_TRANSACTIONS_STORAGE_KEY = 'traceable-events-google-analytics:reported-transactions';
const MAX_REPORTED_TRANSACTIONS = 20;

// The list events tell what was shown, not what the shopper wants to buy, so a value summed from their products would mislead reports.
const EVENTS_WITHOUT_VALUE: ReadonlySet<string> = new Set(['view_item_list', 'select_item']);

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

        if (this.isEventEnabled('view_item_list')) {
            handlers.ITEM_LIST_VIEW = [this.viewItemListHandler];
        }

        if (this.isEventEnabled('select_item')) {
            handlers.PRODUCT_CLICK = [this.selectItemHandler];
        }

        if (this.isEventEnabled('add_to_wishlist')) {
            handlers.ADD_TO_WISHLIST = [this.addToWishlistHandler];
        }

        Object.assign(handlers, this.getCheckoutHandlers());

        const pageLoadHandlers = this.getPageLoadHandlers();

        if (pageLoadHandlers.length) {
            handlers.PAGE_LOAD = pageLoadHandlers;
        }

        return handlers;
    }

    // A checkout start opens a new checkout, in which the shipment and payment choices are reported anew, so it is listened to
    // for any of the checkout events.
    protected getCheckoutHandlers(): Partial<TraceableEventHandlers> {
        const handlers: Partial<TraceableEventHandlers> = {};
        const isBeginCheckoutEnabled = this.isEventEnabled('begin_checkout');
        const isAddShippingInfoEnabled = this.isEventEnabled('add_shipping_info');
        const isAddPaymentInfoEnabled = this.isEventEnabled('add_payment_info');

        if (isBeginCheckoutEnabled || isAddShippingInfoEnabled || isAddPaymentInfoEnabled) {
            handlers.CHECKOUT_START = [this.checkoutStartHandler];
        }

        if (isAddShippingInfoEnabled) {
            handlers.SHIPMENT_SUBMIT = [this.shipmentSubmitHandler];
        }

        if (isAddPaymentInfoEnabled) {
            handlers.PAYMENT_SUBMIT = [this.paymentSubmitHandler];
        }

        return handlers;
    }

    // The events a page load reports, in this order: the checkout start goes first, as it forgets the choices reported in an
    // earlier checkout.
    protected getPageLoadHandlers(): TraceableEventHandler[] {
        const pageLoadHandlers: TraceableEventHandler[] = [];
        const isBeginCheckoutEnabled = this.isEventEnabled('begin_checkout');
        const isAddShippingInfoEnabled = this.isEventEnabled('add_shipping_info');
        const isAddPaymentInfoEnabled = this.isEventEnabled('add_payment_info');

        if (this.isEventEnabled('view_item')) {
            pageLoadHandlers.push(this.viewItemHandler);
        }

        if (this.isEventEnabled('view_cart')) {
            pageLoadHandlers.push(this.viewCartHandler);
        }

        if (isBeginCheckoutEnabled || isAddShippingInfoEnabled || isAddPaymentInfoEnabled) {
            pageLoadHandlers.push(this.checkoutStartPageLoadHandler);
        }

        if (isAddShippingInfoEnabled) {
            pageLoadHandlers.push(this.addShippingInfoHandler);
        }

        if (isAddPaymentInfoEnabled) {
            pageLoadHandlers.push(this.addPaymentInfoHandler);
        }

        if (this.isEventEnabled('purchase')) {
            pageLoadHandlers.push(this.purchaseHandler);
        }

        return pageLoadHandlers;
    }

    protected viewItemHandler(data: PageLoadData): void {
        const viewedProduct = data.products?.[0];

        if (data.page !== PAGE_PRODUCT_DETAIL || !viewedProduct) {
            return;
        }

        this.sendItemsEvent('view_item', data.currency, [{ ...viewedProduct, quantity: 1 }]);
    }

    // Only the cards the shopper saw: the tracker reports each product once per list and page.
    protected viewItemListHandler(data: ItemListViewData): void {
        for (const itemList of data.eventDetail?.itemLists ?? []) {
            this.sendItemListEvent('view_item_list', data.currency, itemList, itemList.products ?? []);
        }
    }

    // Only a click in a tracked list is reported, so its list and position match view_item_list; other product cards are no list.
    protected selectItemHandler(data: CartEventData): void {
        const clickedProduct = data.products?.[0];

        if (!clickedProduct?.sku || !clickedProduct.itemListId) {
            return;
        }

        const itemList = {
            id: clickedProduct.itemListId,
            name: clickedProduct.itemListName || clickedProduct.itemListId,
        };

        this.sendItemListEvent('select_item', data.currency, itemList, [{ ...clickedProduct, quantity: 1 }]);
    }

    protected sendItemListEvent(
        eventName: string,
        currency: string,
        itemList: Pick<ItemList, 'id' | 'name'>,
        products: ProductDetails[],
    ): void {
        this.sendItemsEvent(eventName, currency, products, {
            item_list_id: itemList.id,
            item_list_name: itemList.name,
        });
    }

    // One piece of the product: on the product detail page the product shown, from the page data; on the wishlist page the
    // alternative whose button was clicked.
    protected addToWishlistHandler(data: CartEventData): void {
        const wishedProduct = data.products?.[0];

        if (!wishedProduct?.sku) {
            return;
        }

        this.sendItemsEvent('add_to_wishlist', data.currency, [{ ...wishedProduct, quantity: 1 }]);
    }

    // A cart the shopper chose to look at: the cart page opened from a link or the address bar, with at least one product.
    protected viewCartHandler(data: PageLoadData): void {
        const cartProducts = data.cartProducts ?? [];

        if (data.page !== PAGE_CART || !cartProducts.length || !this.isPageOpenedByNavigation()) {
            return;
        }

        this.sendItemsEvent('view_cart', data.currency, cartProducts);
    }

    // A reload, the Back or Forward button, or the end of a redirect, e.g. after a form that changed the cart, is no new visit of the page.
    protected isPageOpenedByNavigation(): boolean {
        const navigationTiming = performance.getEntriesByType('navigation')[0] as
            PerformanceNavigationTiming | undefined;

        if (!navigationTiming) {
            return false;
        }

        return navigationTiming.type === 'navigate' && navigationTiming.redirectCount === 0;
    }

    // The checkout button only requests the checkout: the shop may still send the shopper back to the cart, e.g. for an unavailable product.
    protected checkoutStartHandler(): void {
        this.createTabStorage().set(CHECKOUT_START_REQUEST_STORAGE_KEY, '1');
    }

    // Taken on every page load, so only the page the checkout button opened starts a checkout.
    protected checkoutStartPageLoadHandler(data: PageLoadData): void {
        const tabStorage = this.createTabStorage();
        const isCheckoutStartRequested = tabStorage.take(CHECKOUT_START_REQUEST_STORAGE_KEY) !== null;
        const isCheckoutStarted = isCheckoutStartRequested && data.page === PAGE_CHECKOUT;

        if (!isCheckoutStarted) {
            return;
        }

        tabStorage.remove(REPORTED_SHIPPING_TIER_STORAGE_KEY);
        tabStorage.remove(REPORTED_PAYMENT_TYPE_STORAGE_KEY);

        const checkoutProducts = data.checkoutProducts ?? [];

        if (!this.isEventEnabled('begin_checkout') || !checkoutProducts.length) {
            return;
        }

        this.sendItemsEvent('begin_checkout', data.currency, checkoutProducts, this.getCheckoutParams(data));
    }

    // The submit only requests the shipment methods: the shop may still show the step again, e.g. when a method is no longer available.
    protected shipmentSubmitHandler(): void {
        this.createTabStorage().set(SHIPMENT_SUBMIT_STORAGE_KEY, '1');
    }

    // Reported on the page the accepted shipment step leads to, once per chosen set of shipment methods in a checkout.
    protected addShippingInfoHandler(data: PageLoadData): void {
        const shippingTier = data.checkoutShippingTier ?? '';
        const isNewShippingTier = this.takeNewCheckoutStepChoice(
            data,
            CHECKOUT_STEP_SHIPMENT,
            SHIPMENT_SUBMIT_STORAGE_KEY,
            REPORTED_SHIPPING_TIER_STORAGE_KEY,
            shippingTier,
        );

        if (!isNewShippingTier) {
            return;
        }

        this.sendItemsEvent('add_shipping_info', data.currency, data.checkoutProducts ?? [], {
            ...this.getCheckoutParams(data),
            shipping_tier: shippingTier,
        });
    }

    // The submit only requests the payment method: the shop may still show the step again, e.g. when required details are missing.
    protected paymentSubmitHandler(): void {
        this.createTabStorage().set(PAYMENT_SUBMIT_STORAGE_KEY, '1');
    }

    // Reported on the page the accepted payment step leads to, once per chosen payment method in a checkout.
    // Only the method name is sent, never the payment details the step asks for.
    protected addPaymentInfoHandler(data: PageLoadData): void {
        const paymentType = data.checkoutPaymentType ?? '';
        const isNewPaymentType = this.takeNewCheckoutStepChoice(
            data,
            CHECKOUT_STEP_PAYMENT,
            PAYMENT_SUBMIT_STORAGE_KEY,
            REPORTED_PAYMENT_TYPE_STORAGE_KEY,
            paymentType,
        );

        if (!isNewPaymentType) {
            return;
        }

        this.sendItemsEvent('add_payment_info', data.currency, data.checkoutProducts ?? [], {
            ...this.getCheckoutParams(data),
            payment_type: paymentType,
        });
    }

    // Takes the step's submit request. True when the shop accepted the step, i.e. another checkout page is shown, and the choice
    // differs from the one last reported in this checkout, which it then keeps.
    protected takeNewCheckoutStepChoice(
        data: PageLoadData,
        step: string,
        submitStorageKey: string,
        reportedChoiceStorageKey: string,
        choice: string,
    ): boolean {
        const tabStorage = this.createTabStorage();
        const isStepSubmitted = tabStorage.take(submitStorageKey) !== null;
        const isStepAccepted = isStepSubmitted && data.page === PAGE_CHECKOUT && data.checkoutStep !== step;
        const hasCheckoutProducts = Boolean(data.checkoutProducts?.length);

        if (!isStepAccepted || !choice || !hasCheckoutProducts) {
            return false;
        }

        const isChoiceChanged = choice !== tabStorage.get(reportedChoiceStorageKey);

        if (!isChoiceChanged) {
            return false;
        }

        tabStorage.set(reportedChoiceStorageKey, choice);

        return true;
    }

    protected getCheckoutParams(data: PageLoadData): Record<string, unknown> {
        const checkoutParams: Record<string, unknown> = {};

        if (data.checkoutCoupon) {
            checkoutParams.coupon = data.checkoutCoupon;
        }

        return checkoutParams;
    }

    // Reported once per order: the order reference is kept, so a reload of the confirmation page or the Back button does not report it again.
    protected purchaseHandler(data: PageLoadData): void {
        const purchase = data.purchase;
        const purchaseProducts = data.purchaseProducts ?? [];

        if (data.page !== PAGE_CHECKOUT_SUCCESS || !purchase?.transactionId || !purchaseProducts.length) {
            return;
        }

        const reportedTransactions = this.createReportedTransactionsStorage();

        if (reportedTransactions.has(purchase.transactionId)) {
            return;
        }

        const purchaseParams: Record<string, unknown> = { transaction_id: purchase.transactionId };
        const shipping = this.convertAmount(purchase.shipping);
        const tax = this.convertAmount(purchase.tax);

        if (shipping !== undefined) {
            purchaseParams.shipping = shipping;
        }

        if (tax !== undefined) {
            purchaseParams.tax = tax;
        }

        if (purchase.coupon) {
            purchaseParams.coupon = purchase.coupon;
        }

        this.sendItemsEvent('purchase', data.currency, purchaseProducts, purchaseParams);
        reportedTransactions.add(purchase.transactionId);
    }

    // An amount in cents in currency units; an amount the visitor may not see arrives as null and is left out.
    protected convertAmount(amount: unknown): number | undefined {
        const isAmountKnown = typeof amount === 'number' && Number.isFinite(amount);

        if (!isAmountKnown) {
            return undefined;
        }

        return Number((amount / this.pricePrecision).toFixed(this.priceDecimals));
    }

    protected createTabStorage(): TabStorage {
        return new TabStorage((message: string) => debug(`${this.name}: ${message}`));
    }

    // Per Measurement ID, as another store of the same domain may report to another property.
    protected createReportedTransactionsStorage(): ReportedIdsStorage {
        return new ReportedIdsStorage(
            `${REPORTED_TRANSACTIONS_STORAGE_KEY}:${this.appId}`,
            this.getMaxReportedTransactions(),
            (message: string) => debug(`${this.name}: ${message}`),
        );
    }

    // A project with many orders per visitor and device may keep more.
    protected getMaxReportedTransactions(): number {
        return MAX_REPORTED_TRANSACTIONS;
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

    // Builds the items, value and currency of a GA4 ecommerce event; `params` are the event's own parameters, e.g. transaction_id.
    protected sendItemsEvent(
        eventName: string,
        currency: string,
        products: ProductDetails[],
        params: Record<string, unknown> = {},
    ): void {
        const items = this.getItems(products);

        if (!items.length) {
            return;
        }

        // The value is calculated from the exact quantities, e.g. 1.5 m; only the item quantities GA4 receives are whole pieces.
        const value = sumItemsValue(items, this.priceDecimals);
        const eventParams: Record<string, unknown> = {
            ...params,
            currency,
            items: roundQuantitiesToWholePieces(items),
        };
        const hasEventValue = !EVENTS_WITHOUT_VALUE.has(eventName);

        // Without a price for every item (e.g. a guest who may not see prices) the value is left out, the event is still sent.
        if (hasEventValue && value !== undefined) {
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
