/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

'use strict';

const init = () => {
    const dateRangeSelect = document.querySelector('.js-date-range-control');
    const dateRangeInputs = document.querySelectorAll('.js-google-analytics-date');

    if (!dateRangeSelect || dateRangeInputs.length === 0) {
        return;
    }

    const toggleCustomDateRange = () => {
        const shouldEnable = dateRangeSelect.value === '';

        dateRangeInputs.forEach((input) => {
            input.disabled = !shouldEnable;

            if (!shouldEnable) {
                if (input.flatpickrInstance) {
                    input.flatpickrInstance.clear();

                    return;
                }

                input.value = '';
            }
        });
    };

    $(dateRangeSelect).on('select2:select', toggleCustomDateRange);

    toggleCustomDateRange();
};

document.addEventListener('DOMContentLoaded', init);
