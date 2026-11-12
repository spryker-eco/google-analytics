// The GA4 item parameters of the category path, top level first: `item_category` is the first level, `item_category2` to
// `item_category5` the deeper ones.
export const CATEGORY_LEVEL_KEYS = [
    'item_category',
    'item_category2',
    'item_category3',
    'item_category4',
    'item_category5',
] as const;

export type CategoryLevelKey = (typeof CATEGORY_LEVEL_KEYS)[number];

export interface ProductCategory {
    name: string;
}

// The categories arrive top level first, e.g. Computer > Pc's/Workstations; GA4 has at most five levels, so deeper ones are left out.
// A category without a name is left out, so the next one takes its level and no level is sent empty.
export const getCategoryLevels = (categories: ProductCategory[]): Partial<Record<CategoryLevelKey, string>> => {
    const categoryNames = categories
        .map((category) => String(category?.name ?? ''))
        .filter((categoryName) => categoryName !== '');
    const levelCount = Math.min(categoryNames.length, CATEGORY_LEVEL_KEYS.length);
    const categoryLevels: Partial<Record<CategoryLevelKey, string>> = {};

    for (let level = 0; level < levelCount; level++) {
        categoryLevels[CATEGORY_LEVEL_KEYS[level]] = categoryNames[level];
    }

    return categoryLevels;
};
