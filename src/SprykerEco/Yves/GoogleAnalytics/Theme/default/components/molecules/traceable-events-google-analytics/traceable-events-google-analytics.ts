/* eslint-disable max-lines -- the adapter keeps its event handlers and the gtag script state as overridable methods; the items, page data and stored events live in their own modules */
/* eslint-disable camelcase -- GA4 defines its event and item parameters in snake_case, e.g. item_id, and gtag only accepts these names */
import {
    BaseTraceableEventAdapter,
    TraceableEventHandlers,
} from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/base-traceable-event-adapter';
import { TraceableEventHandler } from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/traceable-events-orchestrator';
import {
    CONSENT_PURPOSE_STATISTICS,
    ConsentPurpose,
} from 'TraceableEventWidget/components/molecules/traceable-events-consent/consent-purposes';
import { debug, warn } from 'ShopUi/app/logger';
import { CATEGORY_LEVEL_KEYS, CategoryLevelKey } from './category-levels';
import { buildGtagItems, roundQuantitiesToWholePieces, sumItemsValue, VARIANT_VALUE_SEPARATOR } from './gtag-items';
import {
    CAMPAIGN_QUERY_PARAMETERS,
    createPagePathPatterns,
    DEFAULT_PERSONAL_DATA_PAGE_PATH_PATTERNS,
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
    EventAwaitingGtagRequest,
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
        // Google Analytics' opt-out flag, `ga-disable-<Measurement ID>`: while true, gtag sends nothing for that Measurement ID.
        [gaDisableFlag: `ga-disable-${string}`]: boolean | undefined;
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
// The order references already reported in the tab, per Measurement ID, so reloading or returning to the confirmation page does not report
// an order again.
const REPORTED_TRANSACTIONS_STORAGE_KEY = 'traceable-events-google-analytics:reported-transactions';
const MAX_REPORTED_TRANSACTIONS = 20;

// The list events tell what was shown, not what the shopper wants to buy, so a value summed from their products would mislead reports.
const EVENTS_WITHOUT_VALUE: ReadonlySet<string> = new Set(['view_item_list', 'select_item']);

// Events raised by a click that usually opens another page in the same tab, e.g. a product card: gtag holds its hits for about
// five seconds, and the request of a page that is left before is never sent. These events wait for the page to be left and are
// sent by the next page, see holdEventForNavigation().
const EVENTS_RAISED_BY_NAVIGATION: ReadonlySet<string> = new Set(['select_item']);
// How long such an event waits for the page to be left; a click that keeps the page, e.g. Cmd+click to a new tab, then sends it here.
const NAVIGATION_WAIT_MILLISECONDS = 2000;

// Events raised when a page opens that the shopper may leave within seconds, e.g. a checkout step continued with the data it
// already holds, or the summary step left by placing the order. They are handed to gtag at once; a copy is kept until gtag
// reports the event sent, and a page left before passes the copy to the next page, see storeEventsAwaitingGtagRequest().
const EVENTS_KEPT_UNTIL_GTAG_REQUEST: ReadonlySet<string> = new Set([
    'begin_checkout',
    'add_shipping_info',
    'add_payment_info',
    'purchase',
]);
// gtag also calls the event callback when this time has passed without sending the event; far longer than the five seconds
// gtag holds the hits of a page, so the callback means the event was sent.
const GTAG_EVENT_CALLBACK_TIMEOUT_MILLISECONDS = 60000;

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
    // The page paths with personal data in a segment, set in GoogleAnalyticsConfig, see removePersonalDataFromUrl().
    protected personalDataPagePathPatterns: RegExp[] = [];
    // Voucher codes are sent as `coupon` only when the project turns it on in GoogleAnalyticsConfig: a code issued to one customer
    // identifies them.
    protected isCouponReported = false;
    // One beforeunload listener for all events held for navigation, see holdEventForNavigation().
    protected isPageLeaveListened = false;
    // Events raised while the gtag script is loading, in the order they were raised.
    protected pendingEvents: PendingEvent[] = [];
    // Events waiting for the page to be left, see holdEventForNavigation().
    protected eventsHeldForNavigation: PendingEvent[] = [];
    // Events handed to gtag whose request may not have been sent yet, see storeEventsAwaitingGtagRequest().
    protected eventsAwaitingGtagRequest: EventAwaitingGtagRequest[] = [];
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
        this.personalDataPagePathPatterns = createPagePathPatterns(
            this.readPersonalDataPagePathPatterns(),
            (patternSource: string, error: unknown) =>
                warn(
                    `${this.name}: the personal data page path pattern ${patternSource} is no valid regular expression and is left out, so the paths it should cover keep their personal data: ${error}`,
                ),
        );
        this.isCouponReported = this.getAttribute('coupon-reported') === 'true';
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
        return removePersonalDataFromUrl(url, this.getPageUrlQueryParameters(), this.personalDataPagePathPatterns);
    }

    // The title of a page with personal data in its path, e.g. a quote request reference, usually shows it; a project with other
    // personal data in its titles removes it here.
    protected getTitleWithoutPersonalData(title: string): string {
        return removePersonalDataFromTitle(title, window.location.pathname, this.personalDataPagePathPatterns);
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

    // A missing or malformed attribute, e.g. while GoogleAnalyticsWidget is not registered, keeps the module's patterns, so no personal
    // data segment is sent by mistake.
    protected readPersonalDataPagePathPatterns(): string[] {
        try {
            const patterns: unknown = JSON.parse(this.getAttribute('personal-data-page-path-patterns'));

            return Array.isArray(patterns) ? patterns.map(String) : [...DEFAULT_PERSONAL_DATA_PAGE_PATH_PATTERNS];
        } catch {
            return [...DEFAULT_PERSONAL_DATA_PAGE_PATH_PATTERNS];
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

        const isAddShippingInfoSent = this.sendItemsEvent('add_shipping_info', data.currency, data.checkoutProducts ?? [], {
            ...this.getCheckoutParams(data),
            shipping_tier: shippingTier,
        });

        if (isAddShippingInfoSent) {
            this.keepReportedCheckoutStepChoice(REPORTED_SHIPPING_TIER_STORAGE_KEY, shippingTier);
        }
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

        const isAddPaymentInfoSent = this.sendItemsEvent('add_payment_info', data.currency, data.checkoutProducts ?? [], {
            ...this.getCheckoutParams(data),
            payment_type: paymentType,
        });

        if (isAddPaymentInfoSent) {
            this.keepReportedCheckoutStepChoice(REPORTED_PAYMENT_TYPE_STORAGE_KEY, paymentType);
        }
    }

    // Takes the step's submit request. True when the shop accepted the step, i.e. another checkout page is shown, and the choice
    // differs from the one last reported in this checkout. The choice is kept only once its event was sent, see
    // keepReportedCheckoutStepChoice(): an event the consent dropped is reported on the next submit of the same choice.
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

        return isChoiceChanged;
    }

    protected keepReportedCheckoutStepChoice(reportedChoiceStorageKey: string, choice: string): void {
        this.createTabStorage().set(reportedChoiceStorageKey, choice);
    }

    protected getCheckoutParams(data: PageLoadData): Record<string, unknown> {
        const checkoutParams: Record<string, unknown> = {};

        if (this.isCouponReported && data.checkoutCoupon) {
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

        if (this.isCouponReported && purchase.coupon) {
            purchaseParams.coupon = purchase.coupon;
        }

        // An order whose purchase is dropped, e.g. as its consent purpose is not granted yet, is not kept as reported, so a consent
        // given later on the page still reports it.
        const isPurchaseSent = this.sendItemsEvent('purchase', data.currency, purchaseProducts, purchaseParams);

        if (!isPurchaseSent) {
            return;
        }

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
    ): boolean {
        const items = this.getItems(products);

        if (!items.length) {
            return false;
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

        return this.sendEvent(eventName, eventParams);
    }

    // An event raised while the gtag script loads waits, see queueEvent(); one raised by a click that leaves the page waits for the
    // next page, see holdEventForNavigation(). False when the consent does not allow the event, so it is dropped.
    protected sendEvent(eventName: string, eventParams: Record<string, unknown>): boolean {
        if (!this.isGtagEventAllowed(eventName)) {
            return false;
        }

        const event = { name: eventName, params: eventParams, raisedAt: Date.now() };

        if (EVENTS_RAISED_BY_NAVIGATION.has(eventName)) {
            this.holdEventForNavigation(event);

            return true;
        }

        this.queueEvent(event);

        return true;
    }

    // The page usually starts to leave right after the click: the event is then stored in the tab, with this page's URL and title,
    // and the next page sends it. A page still shown after the wait, e.g. after Cmd+click to a new tab, sends it itself.
    // The listener is added only while an event waits, as a beforeunload listener keeps some browsers from caching the page.
    protected holdEventForNavigation(event: PendingEvent): void {
        this.eventsHeldForNavigation.push(event);
        this.listenForPageLeave();
        window.setTimeout(() => this.sendEventHeldForNavigation(event), NAVIGATION_WAIT_MILLISECONDS);
    }

    protected listenForPageLeave(): void {
        if (this.isPageLeaveListened) {
            return;
        }

        this.isPageLeaveListened = true;
        window.addEventListener(
            'beforeunload',
            () => {
                this.isPageLeaveListened = false;
                this.storePendingEvents();
            },
            { once: true, signal: this.listenersController.signal },
        );
    }

    // An event already stored for the next page is no longer held, so none is sent twice.
    protected sendEventHeldForNavigation(event: PendingEvent): void {
        const isEventHeld = this.eventsHeldForNavigation.includes(event);

        if (!isEventHeld) {
            return;
        }

        this.eventsHeldForNavigation = this.eventsHeldForNavigation.filter((heldEvent) => heldEvent !== event);
        this.queueEvent(event);
    }

    // Sends the event, or keeps it while the gtag script loads; a stored event keeps the time it was raised, so it still expires.
    protected queueEvent(pendingEvent: PendingEvent): void {
        if (!this.isGtagScriptLoading) {
            this.handOverToGtag(pendingEvent);

            return;
        }

        this.pendingEvents.push(pendingEvent);
    }

    // A request of the page does not tell which events it carries: gtag sends the page_view at once and holds the other events,
    // so only the event callback tells that this event was sent.
    protected handOverToGtag(event: PendingEvent): void {
        if (!EVENTS_KEPT_UNTIL_GTAG_REQUEST.has(event.name)) {
            window.gtag('event', event.name, event.params);

            return;
        }

        const eventAwaitingGtagRequest: EventAwaitingGtagRequest = { event, isSent: false };

        this.eventsAwaitingGtagRequest.push(eventAwaitingGtagRequest);
        window.gtag('event', event.name, {
            ...event.params,
            event_callback: () => {
                eventAwaitingGtagRequest.isSent = true;
            },
            event_timeout: GTAG_EVENT_CALLBACK_TIMEOUT_MILLISECONDS,
        });
    }

    // Only when the page is left: a hidden page that is shown again still sends its hits, so storing them then would count them twice.
    protected storeEventsAwaitingGtagRequest(): void {
        const eventsToStore = this.eventsAwaitingGtagRequest
            .filter(({ isSent }) => !isSent)
            .map(({ event }) => event);

        this.eventsAwaitingGtagRequest = [];
        this.storeEvents(eventsToStore);
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
        window.addEventListener('pagehide', () => this.storeEventsAwaitingGtagRequest(), { signal });
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

        for (const pendingEvent of pendingEvents) {
            this.handOverToGtag(pendingEvent);
        }
    }

    protected storePendingEvents(): void {
        const eventsToStore = [...this.pendingEvents, ...this.eventsHeldForNavigation];

        // Taken off the page, so a page restored from the back-forward cache does not send them as well as the next page.
        this.pendingEvents = [];
        this.eventsHeldForNavigation = [];
        this.storeEvents(eventsToStore);
    }

    // The events go with the page they happened on, its URL, referrer and title, as the next page sends them under its own otherwise.
    protected storeEvents(eventsToStore: PendingEvent[]): void {
        if (!eventsToStore.length) {
            return;
        }

        const pageParams = {
            page_location: this.getUrlWithoutPersonalData(window.location.href),
            page_referrer: this.getUrlWithoutPersonalData(document.referrer),
            page_title: this.getTitleWithoutPersonalData(document.title),
        };
        const pageEvents = eventsToStore.map(({ name, params, raisedAt }) => ({
            name,
            params: { ...pageParams, ...params },
            raisedAt,
        }));

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
