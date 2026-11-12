// Unit test of the category levels the Google Analytics adapter sends with an item.
// The module has no frontend test lane in CI yet; run it with Node 22.18 or later, which runs TypeScript without a build:
//   node --test tests/SprykerEcoTest/Yves/GoogleAnalytics/Theme/category-levels.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getCategoryLevels } from '../../../../../src/SprykerEco/Yves/GoogleAnalytics/Theme/default/components/molecules/traceable-events-google-analytics/category-levels.ts';

const toCategories = (names: unknown[]): { name: string }[] => names.map((name) => ({ name: name as string }));

describe('getCategoryLevels', () => {
    it('sends the category path top level first', () => {
        // Act
        const categoryLevels = getCategoryLevels(toCategories(['Computer', "Pc's/Workstations"]));

        // Assert
        assert.deepEqual(categoryLevels, { item_category: 'Computer', item_category2: "Pc's/Workstations" });
    });

    it('keeps the top five levels of a deeper path', () => {
        // Act
        const categoryLevels = getCategoryLevels(toCategories(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']));

        // Assert
        assert.deepEqual(categoryLevels, {
            item_category: 'L1',
            item_category2: 'L2',
            item_category3: 'L3',
            item_category4: 'L4',
            item_category5: 'L5',
        });
    });

    it('leaves out a category without a name, so the next one takes its level', () => {
        // Act
        const categoryLevels = getCategoryLevels(toCategories(['Computer', '', null, undefined, 'Notebooks']));

        // Assert
        assert.deepEqual(categoryLevels, { item_category: 'Computer', item_category2: 'Notebooks' });
    });

    it('counts the five levels after leaving out the categories without a name', () => {
        // Act
        const categoryLevels = getCategoryLevels(toCategories(['', 'L1', 'L2', '', 'L3', 'L4', 'L5', 'L6']));

        // Assert
        assert.deepEqual(categoryLevels, {
            item_category: 'L1',
            item_category2: 'L2',
            item_category3: 'L3',
            item_category4: 'L4',
            item_category5: 'L5',
        });
    });

    it('sends no level for a product without categories', () => {
        // Act
        const categoryLevels = getCategoryLevels([]);

        // Assert
        assert.deepEqual(categoryLevels, {});
    });
});
