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
        // Set by the gtag-script head tag's onerror, which fires before this component mounts and can listen.
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
    name?: string;
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
    // On the order success page: the placed order.
    purchase?: Purchase;
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
    | 'purchase';

const PAGE_PRODUCT_DETAIL = 'PDP';
const PAGE_CHECKOUT_SUCCESS = 'CHECKOUT_SUCCESS';

// GA4 reports a variant as one string, e.g. "Red / 64 GB".
const VARIANT_VALUE_SEPARATOR = ' / ';
// Order references already reported, so reloading or returning to the success page does not report an order again.
const REPORTED_TRANSACTIONS_STORAGE_KEY = 'ga4-reported-transaction-ids';
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

    // The product page holds the viewed product in its page data; the wishlist adds one piece of it.
    protected addToWishlistHandler(data: PageLoadData): Promise<void> | void {
        const wishedProduct = data.products?.[0];

        if (data.page !== PAGE_PRODUCT_DETAIL || !wishedProduct) {
            return;
        }

        return this.sendItemsEvent('add_to_wishlist', data.currency, [{ ...wishedProduct, quantity: 1 }]);
    }

    protected purchaseHandler(data: PageLoadData): void {
        const purchase = data.purchase;

        if (data.page !== PAGE_CHECKOUT_SUCCESS || !purchase?.transactionId || !purchase.products?.length) {
            return;
        }

        if (this.isTransactionReported(purchase.transactionId)) {
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
        this.rememberReportedTransaction(purchase.transactionId);
    }

    protected isTransactionReported(transactionId: string): boolean {
        return this.getReportedTransactionIds().includes(transactionId);
    }

    protected rememberReportedTransaction(transactionId: string): void {
        const reportedTransactionIds = [...this.getReportedTransactionIds(), transactionId].slice(
            -this.reportedTransactionsLimit,
        );

        try {
            window.localStorage.setItem(REPORTED_TRANSACTIONS_STORAGE_KEY, JSON.stringify(reportedTransactionIds));
        } catch {
            // Without storage (e.g. a private window) a reload can report the order again; the purchase itself is not affected.
        }
    }

    protected getReportedTransactionIds(): string[] {
        try {
            const reportedTransactionIds = JSON.parse(
                window.localStorage.getItem(REPORTED_TRANSACTIONS_STORAGE_KEY) ?? '[]',
            );

            return Array.isArray(reportedTransactionIds) ? reportedTransactionIds : [];
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

        // Resolves once Google Analytics has handled the event, so a page that is about to navigate can wait for it.
        // The deadline is long enough for a cold load of the Google Analytics script, which must arrive before it can
        // confirm anything; a script that failed to load (e.g. a content blocker) can never confirm, so those events
        // settle immediately and no navigation waits out the deadline for nothing.
        return new Promise((resolve) => {
            this.watchGtagScriptFailure();

            if (this.isGtagScriptFailed) {
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
    protected watchGtagScriptFailure(): void {
        // A script rendered in the page head fails before this component mounts; its onerror leaves the global flag.
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

            // A trigger without the abstract product SKU, e.g. the quick-add form, falls back to the SKU it has.
            const itemId = String(product.abstractSku || product.sku);
            const variant = this.getVariant(product.variant);
            const itemKey = `${itemId}|${variant}`;
            const sameItem = itemsByKey.get(itemKey);

            if (sameItem) {
                sameItem.quantity += quantity;

                continue;
            }

            // item_name is never empty: a trigger without the product name (e.g. the quick-add form) sends the SKU instead.
            const item: GtagItem = { item_id: itemId, item_name: itemId, quantity };
            const price = this.getPrice(product.price);

            const index = this.getIndex(product.index);

            if (index !== undefined) {
                item.index = index;
            }

            if (product.name) {
                item.item_name = String(product.name);
            }

            if (product.brand) {
                item.item_brand = String(product.brand);
            }

            if (variant) {
                item.item_variant = variant;
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
