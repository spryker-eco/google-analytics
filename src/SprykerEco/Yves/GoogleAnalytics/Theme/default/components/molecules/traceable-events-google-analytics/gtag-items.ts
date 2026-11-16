/* eslint-disable camelcase -- GA4 defines its item parameters in snake_case, e.g. item_id, and gtag only accepts these names */
import { CategoryLevelKey, getCategoryLevels } from './category-levels';
import { GtagItem, ProductDetails } from './types';

// GA4 reports a variant as one string, e.g. "Red / 64 GB".
export const VARIANT_VALUE_SEPARATOR = ' / ';

// A template may send the variant as one string, e.g. "Red / 64 GB", instead of its values; it is reported as it is.
const joinVariantValues = (variant: unknown, variantValueSeparator: string): string => {
    if (Array.isArray(variant)) {
        return variant.map(String).join(variantValueSeparator);
    }

    return String(variant ?? '');
};

const findConcreteSku = (product: ProductDetails, abstractSku: string): string => {
    if (product.concreteSku !== undefined) {
        return String(product.concreteSku ?? '');
    }

    const sku = String(product.sku);

    // Without the abstract product SKU, e.g. from a custom trigger, it is unknown which kind the SKU is.
    if (!abstractSku) {
        return '';
    }

    return sku === abstractSku ? '' : sku;
};

// Storefront emitters send prices in cents; without a usable precision the price cannot be converted, and the event is then
// sent without a price, not broken.
const convertPrice = (price: unknown, pricePrecision: number, priceDecimals: number): number | undefined => {
    const isPriceKnown = typeof price === 'number' && Number.isFinite(price);
    const isPricePrecisionUsable = Number.isFinite(pricePrecision) && pricePrecision > 0;

    if (!isPriceKnown || !isPricePrecisionUsable) {
        return undefined;
    }

    return Number((price / pricePrecision).toFixed(priceDecimals));
};

export interface GtagItemSettings {
    // The parts per currency unit of a price in cents, e.g. 100, and the decimals a price in currency units has, e.g. 2.
    pricePrecision: number;
    priceDecimals: number;
    variantValueSeparator: string;
    categoryLevelKeys: readonly CategoryLevelKey[];
}

// One entry per product, concrete product and variant: lines of the same one are added up, so an item is never sent twice.
export const buildGtagItems = (products: ProductDetails[], settings: GtagItemSettings): GtagItem[] => {
    const itemsByKey = new Map<string, GtagItem>();

    for (const product of products) {
        if (!product?.sku) {
            continue;
        }

        const quantity = Number(product.quantity ?? 1);
        // False for a zero, negative or non-numeric quantity.
        const isQuantityPositive = quantity > 0;

        if (!isQuantityPositive) {
            continue;
        }

        const abstractSku = String(product.abstractSku || '');
        const concreteSku = findConcreteSku(product, abstractSku);
        // A trigger without the abstract product SKU falls back to the SKU it has.
        const itemId = abstractSku || String(product.sku);
        const variant = joinVariantValues(product.variant, settings.variantValueSeparator);
        const itemKey = `${itemId}|${concreteSku}|${variant}`;
        const sameItem = itemsByKey.get(itemKey);

        if (sameItem) {
            sameItem.quantity += quantity;

            continue;
        }

        // The abstract product name, like the item ID, so a product keeps one name across the funnel whichever variant is
        // shown; item_name is never empty: a trigger without a name sends the ID instead.
        const itemName = String(product.abstractName || product.name || itemId);
        const item: GtagItem = { item_id: itemId, item_name: itemName, quantity };
        const price = convertPrice(product.price, settings.pricePrecision, settings.priceDecimals);

        if (product.brand) {
            item.item_brand = String(product.brand);
        }

        if (variant) {
            item.item_variant = variant;
        }

        if (concreteSku) {
            item.concrete_sku = concreteSku;
        }

        Object.assign(item, getCategoryLevels(product.categories ?? [], settings.categoryLevelKeys));

        if (price !== undefined) {
            item.price = price;
        }

        itemsByKey.set(itemKey, item);
    }

    return Array.from(itemsByKey.values());
};

// GA4 counts whole pieces; a quantity in a measurement unit, e.g. 1.5 m, is rounded and stays at least 1.
export const roundQuantitiesToWholePieces = (items: GtagItem[]): GtagItem[] =>
    items.map((item) => ({ ...item, quantity: Math.max(1, Math.round(item.quantity)) }));

// Undefined when an item has no price, as the value of the event is then unknown.
export const sumItemsValue = (items: GtagItem[], priceDecimals: number): number | undefined => {
    let value = 0;

    for (const item of items) {
        if (item.price === undefined) {
            return undefined;
        }

        value += item.price * item.quantity;
    }

    return Number(value.toFixed(priceDecimals));
};
