<?php

/**
 * This file is part of the Spryker Suite.
 * For full license information, please view the LICENSE file that was distributed with this source code.
 */

declare(strict_types=1);

namespace SprykerEco\Zed\GoogleAnalytics\Business\Reader;

use Generated\Shared\Transfer\GoogleAnalyticsEventCollectionTransfer;
use Generated\Shared\Transfer\GoogleAnalyticsEventCriteriaTransfer;

interface GoogleAnalyticsReaderInterface
{
    /**
     * Specification:
     * - Returns a paginated collection of Google Analytics events matching the given criteria.
     */
    public function getEventCollection(
        GoogleAnalyticsEventCriteriaTransfer $googleAnalyticsEventCriteriaTransfer,
    ): GoogleAnalyticsEventCollectionTransfer;
}
