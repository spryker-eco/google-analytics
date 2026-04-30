<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Business\Reader;

use Generated\Shared\Transfer\GoogleAnalyticsEventCollectionTransfer;
use Generated\Shared\Transfer\GoogleAnalyticsEventCriteriaTransfer;

interface GoogleAnalyticsReaderInterface
{
    public function getEventCollection(
        GoogleAnalyticsEventCriteriaTransfer $googleAnalyticsEventCriteriaTransfer,
    ): GoogleAnalyticsEventCollectionTransfer;
}
