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

// The categories arrive top level first, e.g. Computer > Pc's/Workstations; one level per key, so deeper ones are left out.
// A category without a name is left out, so the next one takes its level and no level is sent empty.
// A project that reports fewer levels passes fewer keys, e.g. the first three.
export const getCategoryLevels = (
    categories: unknown,
    categoryLevelKeys: readonly CategoryLevelKey[] = CATEGORY_LEVEL_KEYS,
): Partial<Record<CategoryLevelKey, string>> => {
    if (!Array.isArray(categories)) {
        return {};
    }

    const categoryNames = categories
        .map((category: Partial<ProductCategory> | null | undefined) => String(category?.name ?? ''))
        .filter((categoryName) => categoryName !== '');
    const levelCount = Math.min(categoryNames.length, categoryLevelKeys.length);
    const categoryLevels: Partial<Record<CategoryLevelKey, string>> = {};

    for (let level = 0; level < levelCount; level++) {
        categoryLevels[categoryLevelKeys[level]] = categoryNames[level];
    }

    return categoryLevels;
};
