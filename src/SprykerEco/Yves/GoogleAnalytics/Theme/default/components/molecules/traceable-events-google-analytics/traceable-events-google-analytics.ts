/* eslint-disable max-lines -- an adapter keeps all handlers of its provider as overridable methods, like the Algolia adapter */
/* eslint-disable camelcase -- GA4 defines its event and item parameters in snake_case, e.g. item_id, and gtag only accepts these names */
import {
    BaseTraceableEventAdapter,
    TraceableEventHandlers,
} from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/base-traceable-event-adapter';
import {
    EventsHandlerData,
    EventName,
    TraceableEventHandler,
} from 'TraceableEventWidget/components/molecules/traceable-events-orchestrator/traceable-events-orchestrator';

declare global {
    interface SPRYKER_EVENTS {
        SEARCH_EVENT: undefined;
        ITEM_LIST_VIEW: undefined;
        ADD_TO_CART: undefined;
        ADD_TO_WISHLIST: undefined;
        REMOVE_FROM_CART: undefined;
        CHANGE_CART_QUANTITY: undefined;
        CART_ITEMS_CHANGE: undefined;
    }

    interface Window {
        dataLayer: unknown[];
        gtag: GtagFunction;
        // Set by the gtag-script head tag's onload and onerror, which fire before this component mounts and can listen.
        isGtagScriptLoaded?: boolean;
        isGtagScriptFailed?: boolean;
    }
}

interface GtagFunction {
    (command: 'js', date: Date): void;
    (command: 'config', targetId: string, config?: Record<string, unknown>): void;
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
    // The position in a product list, from 0; a clicked card sends it as the attribute text.
    index?: number | string;
    // Product cards: the product list the card belongs to, e.g. similar_products.
    itemListId?: string;
    itemListName?: string;
}

interface ProductCategory {
    name: string;
}

interface CartEventData extends EventsHandlerData<EventName> {
    currency: string;
    products?: ProductDetails[];
}

interface PageLoadData extends EventsHandlerData<EventName> {
    currency: string;
    products?: ProductDetails[];
    // On the cart page: the products of the cart shown.
    cartProducts?: ProductDetails[];
    // On a checkout step: the products of the cart being checked out, and its voucher codes, comma separated.
    checkoutProducts?: ProductDetails[];
    checkoutCoupon?: string;
    // The checkout step shown, set for a step that reports its own accepted submit: SHIPMENT or PAYMENT.
    checkoutStep?: string;
    // The shipment methods chosen for the cart, as the shopper sees them; a split delivery joins them, e.g. "Standard, Express".
    checkoutShippingTier?: string;
    // The payment methods chosen for the cart, as the shopper sees them; a split payment joins them.
    checkoutPaymentType?: string;
    // On the order success page: the placed order.
    purchase?: Purchase;
    // On a quote request details page: the quote request shown.
    quoteRequest?: QuoteRequest;
}

// Identified by UUIDs only: the quote request reference contains the customer reference, and company and business unit names
// may be a person's name.
interface QuoteRequest {
    uuid: string;
    version?: number;
    // False once the customer has sent it to the agent.
    isEditable?: boolean;
    currency?: string;
    companyId?: string;
    businessUnitId?: string;
    products?: ProductDetails[];
}

// Amounts in cents; product prices are the net price paid per unit, so the value excludes shipping and tax, which are sent separately.
interface Purchase {
    transactionId: string;
    currency?: string;
    shipping?: number;
    tax?: number;
    // The voucher codes of the order, comma separated.
    coupon?: string;
    products: ProductDetails[];
}

// A clicked product card; a card in a tracked list carries the list and its position.
interface ProductClickData extends EventsHandlerData<EventName> {
    currency: string;
    products?: ProductDetails[];
}

interface ItemList {
    id: string;
    name: string;
    products: ProductDetails[];
}

// Product cards the customer saw, per list, as the traceable-item-list-view-tracker reports them.
interface ItemListViewData extends EventsHandlerData<EventName> {
    currency: string;
    eventDetail: {
        itemLists: ItemList[];
    };
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
    index?: number;
}

type ItemsEventName =
    | 'add_to_cart'
    | 'remove_from_cart'
    | 'view_item'
    | 'view_item_list'
    | 'select_item'
    | 'add_to_wishlist'
    | 'view_cart'
    | 'begin_checkout'
    | 'add_shipping_info'
    | 'add_payment_info'
    | 'purchase';

// GA4 sends items only with its ecommerce events and leaves them out of every other event, so these events carry the value of the
// products, not the products.
type ValueEventName = 'request_quote' | 'quote_submitted';

const PAGE_PRODUCT_DETAIL = 'PDP';
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
const PAGE_CHECKOUT_SUCCESS = 'CHECKOUT_SUCCESS';
const PAGE_CART = 'CART';
const PAGE_CHECKOUT = 'CHECKOUT';
// Set in the tab when the customer clicks to start checkout, taken by the next page load: a checkout step reports begin_checkout,
// any other page, e.g. the cart a blocked checkout returns to, only discards it. Reloads and moves between steps find none.
const CHECKOUT_START_REQUEST_STORAGE_KEY = 'ga4-checkout-start-requested';
const CHECKOUT_STEP_SHIPMENT = 'SHIPMENT';
const CHECKOUT_STEP_PAYMENT = 'PAYMENT';
// Set in the tab when the customer submits the shipment or payment step, taken by the next page load: the step after it reports
// add_shipping_info or add_payment_info, the same step shown again with errors only discards it.
const SHIPMENT_SUBMIT_STORAGE_KEY = 'ga4-shipment-submitted';
const PAYMENT_SUBMIT_STORAGE_KEY = 'ga4-payment-submitted';
// The shipping tier and payment type last reported in this checkout: continuing with the same methods is not a new choice.
// A new checkout start forgets them.
const REPORTED_SHIPPING_TIER_STORAGE_KEY = 'ga4-reported-shipping-tier';
const REPORTED_PAYMENT_TYPE_STORAGE_KEY = 'ga4-reported-payment-type';
// Set in the tab when the customer submits the quote request form, taken by the next page load: the details page of the new quote
// request reports request_quote, the form shown again with errors only discards it.
const QUOTE_REQUEST_CREATE_STORAGE_KEY = 'ga4-quote-request-create-submitted';
// Set in the tab when the customer sends the quote request to the agent, taken by the next page load: the details page it returns to
// reports quote_submitted once the quote request is no longer editable; a send the shop refused leaves it editable.
const QUOTE_REQUEST_SEND_STORAGE_KEY = 'ga4-quote-request-send-requested';

// GA4 reports a variant as one string, e.g. "Red / 64 GB".
const VARIANT_VALUE_SEPARATOR = ' / ';
// Order references already reported, so reloading or returning to the success page does not report an order again.
const REPORTED_TRANSACTIONS_STORAGE_KEY = 'ga4-reported-transaction-ids';
// Quote request versions already reported as sent, as `<uuid>:<version>`, so a send refused for an already sent quote request,
// e.g. from a second tab, does not report it again; a revised quote request sent again is a new version.
const REPORTED_QUOTE_SUBMISSIONS_STORAGE_KEY = 'ga4-reported-quote-submissions';
// List events describe what was shown, not a purchase intent, so a summed value of their products would mislead reports.
const EVENTS_WITHOUT_VALUE: ReadonlySet<ItemsEventName> = new Set(['view_item_list', 'select_item']);
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
    protected isGtagScriptWatched = false;

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

        super.init();
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

        const pageLoadHandlers: TraceableEventHandler[] = [];

        if (this.isEventEnabled('view_item')) {
            pageLoadHandlers.push(this.viewItemHandler);
        }

        if (this.isEventEnabled('view_item_list')) {
            handlers.ITEM_LIST_VIEW = [this.viewItemListsHandler];
        }

        if (this.isEventEnabled('purchase')) {
            pageLoadHandlers.push(this.purchaseHandler);
        }

        if (this.isEventEnabled('view_cart')) {
            pageLoadHandlers.push(this.viewCartHandler);
        }

        const isBeginCheckoutEnabled = this.isEventEnabled('begin_checkout');
        const isAddShippingInfoEnabled = this.isEventEnabled('add_shipping_info');
        const isAddPaymentInfoEnabled = this.isEventEnabled('add_payment_info');

        // A checkout start is reported by begin_checkout and opens a new checkout, in which the shipment and payment choices are reported anew.
        if (isBeginCheckoutEnabled || isAddShippingInfoEnabled || isAddPaymentInfoEnabled) {
            handlers.CHECKOUT_START = [this.checkoutStartHandler];
            pageLoadHandlers.push(this.checkoutStartPageLoadHandler);
        }

        if (isAddShippingInfoEnabled) {
            handlers.SHIPMENT_SUBMIT = [this.shipmentSubmitHandler];
            pageLoadHandlers.push(this.addShippingInfoHandler);
        }

        if (isAddPaymentInfoEnabled) {
            handlers.PAYMENT_SUBMIT = [this.paymentSubmitHandler];
            pageLoadHandlers.push(this.addPaymentInfoHandler);
        }

        if (this.isEventEnabled('request_quote')) {
            handlers.QUOTE_REQUEST_CREATE = [this.quoteRequestCreateHandler];
            pageLoadHandlers.push(this.requestQuoteHandler);
        }

        if (this.isEventEnabled('quote_submitted')) {
            handlers.QUOTE_REQUEST_SEND = [this.quoteRequestSendHandler];
            pageLoadHandlers.push(this.quoteSubmittedHandler);
        }

        handlers.PAGE_LOAD = pageLoadHandlers;

        if (this.isEventEnabled('select_item')) {
            handlers.PRODUCT_CLICK = [this.selectItemHandler];
        }

        if (this.isEventEnabled('add_to_wishlist')) {
            handlers.ADD_TO_WISHLIST = [this.addToWishlistHandler];
        }

        return handlers;
    }

    protected viewItemHandler(data: PageLoadData): void {
        const viewedProduct = data.products?.[0];

        if (data.page !== PAGE_PRODUCT_DETAIL || !viewedProduct) {
            return;
        }

        this.sendItemsEvent('view_item', data.currency, [{ ...viewedProduct, quantity: 1 }]);
    }

    // Only the cards the customer saw: the tracker reports each product once per list and page.
    protected viewItemListsHandler(data: ItemListViewData): void {
        for (const itemList of data.eventDetail?.itemLists ?? []) {
            this.sendItemListEvent('view_item_list', data.currency, itemList, itemList.products);
        }
    }

    // Reported only for clicks in a tracked list, so list and index match view_item_list; other product cards are not a list.
    protected selectItemHandler(data: ProductClickData): Promise<void> | void {
        const clickedProduct = data.products?.[0];

        if (!clickedProduct?.sku || !clickedProduct.itemListId) {
            return;
        }

        const itemList = {
            id: clickedProduct.itemListId,
            name: clickedProduct.itemListName ?? clickedProduct.itemListId,
        };

        return this.sendItemListEvent('select_item', data.currency, itemList, [{ ...clickedProduct, quantity: 1 }]);
    }

    protected sendItemListEvent(
        eventName: ItemsEventName,
        currency: string,
        itemList: Pick<ItemList, 'id' | 'name'>,
        products: ProductDetails[],
    ): Promise<void> {
        return this.sendItemsEvent(eventName, currency, products, {
            item_list_id: itemList.id,
            item_list_name: itemList.name,
        });
    }

    // The wishlist adds one piece of the product: on the product page the viewed product from its page data,
    // elsewhere, e.g. a discontinued wishlist item's alternative, the product the clicked button sends.
    protected addToWishlistHandler(data: PageLoadData): Promise<void> | void {
        const wishedProduct = data.products?.[0];

        if (!wishedProduct?.sku) {
            return;
        }

        return this.sendItemsEvent('add_to_wishlist', data.currency, [{ ...wishedProduct, quantity: 1 }]);
    }

    // A cart review the customer chose: the cart page opened from a link or the address bar, with at least one product.
    protected viewCartHandler(data: PageLoadData): void {
        const cartProducts = data.cartProducts ?? [];

        if (data.page !== PAGE_CART || !cartProducts.length || !this.isPageOpenedByNavigation()) {
            return;
        }

        this.sendItemsEvent('view_cart', data.currency, cartProducts);
    }

    // A reload, the Back or Forward button, or the end of a redirect, e.g. after a form adding to the cart, is not a new visit of the page.
    protected isPageOpenedByNavigation(): boolean {
        const navigationTiming = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;

        if (!navigationTiming) {
            return false;
        }

        return navigationTiming.type === 'navigate' && navigationTiming.redirectCount === 0;
    }

    // The checkout button only requests checkout: the shop may still send the customer back to the cart, e.g. for an unavailable product.
    protected checkoutStartHandler(): void {
        this.setSessionStorageItem(CHECKOUT_START_REQUEST_STORAGE_KEY, '1');
    }

    // Read and removed on every page load, so only the page the checkout button opened can start a checkout.
    protected checkoutStartPageLoadHandler(data: PageLoadData): void {
        const isCheckoutStartRequested = this.takeSessionStorageItem(CHECKOUT_START_REQUEST_STORAGE_KEY) !== null;
        const isCheckoutStarted = isCheckoutStartRequested && data.page === PAGE_CHECKOUT;

        if (!isCheckoutStarted) {
            return;
        }

        this.removeSessionStorageItem(REPORTED_SHIPPING_TIER_STORAGE_KEY);
        this.removeSessionStorageItem(REPORTED_PAYMENT_TYPE_STORAGE_KEY);

        if (this.isEventEnabled('begin_checkout')) {
            this.beginCheckoutHandler(data);
        }
    }

    // Reported on the first checkout step the requested checkout opens, once per click on the checkout button.
    protected beginCheckoutHandler(data: PageLoadData): void {
        const checkoutProducts = data.checkoutProducts ?? [];

        if (!checkoutProducts.length) {
            return;
        }

        this.sendItemsEvent('begin_checkout', data.currency, checkoutProducts, this.getCheckoutParams(data));
    }

    // The submit only requests the shipment methods: the shop may still show the step again, e.g. when a method is no longer available.
    protected shipmentSubmitHandler(): void {
        this.setSessionStorageItem(SHIPMENT_SUBMIT_STORAGE_KEY, '1');
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
        this.setSessionStorageItem(PAYMENT_SUBMIT_STORAGE_KEY, '1');
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

    // Takes the step's submit request; true when the shop accepted the step, i.e. the page shown is another one, and the choice differs
    // from the one last reported in this checkout, which it then remembers.
    protected takeNewCheckoutStepChoice(
        data: PageLoadData,
        step: string,
        submitStorageKey: string,
        reportedChoiceStorageKey: string,
        choice: string,
    ): boolean {
        const isStepSubmitted = this.takeSessionStorageItem(submitStorageKey) !== null;
        const isStepAccepted = isStepSubmitted && data.page === PAGE_CHECKOUT && data.checkoutStep !== step;
        const hasCheckoutProducts = Boolean(data.checkoutProducts?.length);

        if (!isStepAccepted || !choice || !hasCheckoutProducts) {
            return false;
        }

        const isChoiceChanged = choice !== this.getSessionStorageItem(reportedChoiceStorageKey);

        if (!isChoiceChanged) {
            return false;
        }

        this.setSessionStorageItem(reportedChoiceStorageKey, choice);

        return true;
    }

    // The submit only requests the quote request: the shop may still show the form again, e.g. for an invalid delivery date.
    protected quoteRequestCreateHandler(): void {
        this.setSessionStorageItem(QUOTE_REQUEST_CREATE_STORAGE_KEY, '1');
    }

    // Reported on the details page the created quote request opens, once per submitted quote request form.
    protected requestQuoteHandler(data: PageLoadData): void {
        const isQuoteRequestCreateSubmitted = this.takeSessionStorageItem(QUOTE_REQUEST_CREATE_STORAGE_KEY) !== null;
        const quoteRequest = data.quoteRequest;
        const quoteRequestProducts = quoteRequest?.products ?? [];

        if (!isQuoteRequestCreateSubmitted || !quoteRequest?.uuid || !quoteRequestProducts.length) {
            return;
        }

        this.sendValueEvent(
            'request_quote',
            quoteRequest.currency || data.currency,
            quoteRequestProducts,
            this.getQuoteRequestParams(quoteRequest),
        );
    }

    protected quoteRequestSendHandler(): void {
        this.setSessionStorageItem(QUOTE_REQUEST_SEND_STORAGE_KEY, '1');
    }

    // Reported on the details page the send returns to, once per send the shop accepted.
    protected quoteSubmittedHandler(data: PageLoadData): void {
        const isQuoteRequestSendRequested = this.takeSessionStorageItem(QUOTE_REQUEST_SEND_STORAGE_KEY) !== null;
        const quoteRequest = data.quoteRequest;
        const isQuoteRequestSent = isQuoteRequestSendRequested && quoteRequest?.isEditable === false;
        const quoteRequestProducts = quoteRequest?.products ?? [];

        if (!isQuoteRequestSent || !quoteRequest?.uuid || !quoteRequestProducts.length) {
            return;
        }

        const quoteSubmissionId = `${quoteRequest.uuid}:${quoteRequest.version ?? ''}`;

        if (this.isIdReported(REPORTED_QUOTE_SUBMISSIONS_STORAGE_KEY, quoteSubmissionId)) {
            return;
        }

        this.rememberReportedId(REPORTED_QUOTE_SUBMISSIONS_STORAGE_KEY, quoteSubmissionId);

        const quoteSubmittedParams = this.getQuoteRequestParams(quoteRequest);

        if (quoteRequest.version) {
            quoteSubmittedParams.quote_version = quoteRequest.version;
        }

        this.sendValueEvent(
            'quote_submitted',
            quoteRequest.currency || data.currency,
            quoteRequestProducts,
            quoteSubmittedParams,
        );
    }

    protected getQuoteRequestParams(quoteRequest: QuoteRequest): Record<string, unknown> {
        const quoteRequestParams: Record<string, unknown> = { quote_id: quoteRequest.uuid };

        if (quoteRequest.companyId) {
            quoteRequestParams.company_id = quoteRequest.companyId;
        }

        if (quoteRequest.businessUnitId) {
            quoteRequestParams.business_unit_id = quoteRequest.businessUnitId;
        }

        return quoteRequestParams;
    }

    protected getCheckoutParams(data: PageLoadData): Record<string, unknown> {
        const checkoutParams: Record<string, unknown> = {};

        if (data.checkoutCoupon) {
            checkoutParams.coupon = data.checkoutCoupon;
        }

        return checkoutParams;
    }

    // Session storage may be unavailable, e.g. in a private window that blocks it; the checkout events are then not reported.
    protected getSessionStorageItem(key: string): string | null {
        try {
            return window.sessionStorage.getItem(key);
        } catch {
            return null;
        }
    }

    protected setSessionStorageItem(key: string, value: string): void {
        try {
            window.sessionStorage.setItem(key, value);
        } catch {
            // Not reported, see getSessionStorageItem.
        }
    }

    protected removeSessionStorageItem(key: string): void {
        try {
            window.sessionStorage.removeItem(key);
        } catch {
            // Not reported, see getSessionStorageItem.
        }
    }

    protected takeSessionStorageItem(key: string): string | null {
        const value = this.getSessionStorageItem(key);
        this.removeSessionStorageItem(key);

        return value;
    }

    protected purchaseHandler(data: PageLoadData): void {
        const purchase = data.purchase;

        if (data.page !== PAGE_CHECKOUT_SUCCESS || !purchase?.transactionId || !purchase.products?.length) {
            return;
        }

        if (this.isIdReported(REPORTED_TRANSACTIONS_STORAGE_KEY, purchase.transactionId)) {
            return;
        }

        const purchaseParams: Record<string, unknown> = { transaction_id: purchase.transactionId };
        const shipping = this.getPrice(purchase.shipping);
        const tax = this.getPrice(purchase.tax);

        if (shipping !== undefined) {
            purchaseParams.shipping = shipping;
        }

        if (tax !== undefined) {
            purchaseParams.tax = tax;
        }

        if (purchase.coupon) {
            purchaseParams.coupon = purchase.coupon;
        }

        this.sendItemsEvent('purchase', purchase.currency || data.currency, purchase.products, purchaseParams);
        this.rememberReportedId(REPORTED_TRANSACTIONS_STORAGE_KEY, purchase.transactionId);
    }

    protected isIdReported(storageKey: string, id: string): boolean {
        return this.getReportedIds(storageKey).includes(id);
    }

    // Keeps the latest ids only, as many as reportedTransactionsLimit.
    protected rememberReportedId(storageKey: string, id: string): void {
        const reportedIds = [...this.getReportedIds(storageKey), id].slice(-this.reportedTransactionsLimit);

        try {
            window.localStorage.setItem(storageKey, JSON.stringify(reportedIds));
        } catch {
            // Without storage (e.g. a private window) a reload can report the same id again; the shop itself is not affected.
        }
    }

    protected getReportedIds(storageKey: string): string[] {
        try {
            const reportedIds = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');

            return Array.isArray(reportedIds) ? reportedIds : [];
        } catch {
            return [];
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
        const hasValue = value !== undefined && !EVENTS_WITHOUT_VALUE.has(eventName);

        if (hasValue) {
            eventParams.value = value;
        }

        return this.sendEvent(eventName, eventParams);
    }

    // Like sendItemsEvent, with the value of the products instead of the products, which GA4 would leave out of this event.
    protected sendValueEvent(
        eventName: ValueEventName,
        currency: string,
        products: ProductDetails[],
        additionalParams: Record<string, unknown> = {},
    ): Promise<void> {
        const items = this.getItems(products);

        if (!items.length) {
            return Promise.resolve();
        }

        const eventParams: Record<string, unknown> = { ...additionalParams, currency };
        const value = this.getItemsValue(items);

        if (value !== undefined) {
            eventParams.value = value;
        }

        return this.sendEvent(eventName, eventParams);
    }

    protected sendEvent(eventName: ItemsEventName | ValueEventName, eventParams: Record<string, unknown>): Promise<void> {
        // Settles at once when nothing is gained by waiting: a loaded script sends the event with a keepalive request,
        // which outlives a navigation, and a script that failed to load (e.g. a content blocker) can never send it.
        // Only an event raised while the script is still loading sits in the data layer, which a navigation drops, so
        // that one resolves once Google Analytics has handled it, so a page that is about to navigate can wait for it.
        return new Promise((resolve) => {
            this.watchGtagScriptState();

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

    // The script-loader next to this component injects the gtag script after the components mount, so the element is looked up when the first event needs it.
    protected watchGtagScriptState(): void {
        // A script rendered in the page head loads or fails before this component mounts; its onload or onerror leaves the global flag.
        if (window.isGtagScriptLoaded) {
            this.isGtagScriptLoaded = true;
        }

        if (window.isGtagScriptFailed) {
            this.isGtagScriptFailed = true;
        }

        if (this.isGtagScriptWatched) {
            return;
        }

        const script = document.querySelector<HTMLScriptElement>(`script[src="${this.gtagScriptSrc}"]`);

        if (!script) {
            return;
        }

        this.isGtagScriptWatched = true;

        script.addEventListener(
            'load',
            () => {
                this.isGtagScriptLoaded = true;
            },
            { once: true },
        );

        script.addEventListener(
            'error',
            () => {
                this.isGtagScriptFailed = true;

                for (const settle of this.pendingEventSettlers) {
                    settle();
                }
            },
            { once: true },
        );
    }

    // One entry per product and variant: lines of the same product and variant are added up, so an item is never sent twice.
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

            const index = this.getIndex(product.index);

            if (index !== undefined) {
                item.index = index;
            }

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

    // The categories arrive top level first, e.g. Computer > Pc's/Workstations; GA4 has at most five levels.
    protected getVariant(variantValues: string[] | undefined): string {
        return (variantValues ?? []).map(String).join(VARIANT_VALUE_SEPARATOR);
    }

    protected addCategoryLevels(item: GtagItem, categories: ProductCategory[]): void {
        const levelCount = Math.min(categories.length, CATEGORY_LEVEL_KEYS.length);

        for (let level = 0; level < levelCount; level++) {
            item[CATEGORY_LEVEL_KEYS[level]] = categories[level].name;
        }
    }

    protected getIndex(index: unknown): number | undefined {
        const isIndexGiven = index !== null && index !== undefined && index !== '';
        const position = Number(index);

        if (!isIndexGiven || !Number.isInteger(position)) {
            return undefined;
        }

        return position;
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

    protected get reportedTransactionsLimit(): number {
        return Number(this.getAttribute('reported-transactions-limit'));
    }

    protected get initialData(): InitialData {
        return JSON.parse(this.getAttribute('initial'));
    }
}
