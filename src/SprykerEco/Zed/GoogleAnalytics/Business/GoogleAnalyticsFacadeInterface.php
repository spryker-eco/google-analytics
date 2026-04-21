<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Business;

use Generated\Shared\Transfer\GoogleAnalyticsEventCollectionTransfer;
use Generated\Shared\Transfer\GoogleAnalyticsEventCriteriaTransfer;

interface GoogleAnalyticsFacadeInterface
{
    /**
     * Specification:
     * - Returns a paginated collection of Google Analytics events matching the given criteria.
     * - Requires criteria.conditions.eventName to be set.
     * - Resolves date range to the configured default when criteria.conditions.startDate or endDate is missing.
     * - Applies a CONTAINS dimension filter on the search term when criteria.conditions.searchTerm is set.
     * - Applies a minimum count metric filter when criteria.conditions.minimumCount > 0.
     * - Fetches last occurred dates per unique term when criteria.conditions.withLastOccurred is true.
     * - Sorts results by criteria.sortCollection; defaults to descending event count when empty.
     * - Populates criteria.pagination.nbResults with the total unfiltered row count from GA4.
     *
     * @api
     *
     * @param \Generated\Shared\Transfer\GoogleAnalyticsEventCriteriaTransfer $googleAnalyticsEventCriteriaTransfer
     */
    public function getEventCollection(
        GoogleAnalyticsEventCriteriaTransfer $googleAnalyticsEventCriteriaTransfer,
    ): GoogleAnalyticsEventCollectionTransfer;
}
