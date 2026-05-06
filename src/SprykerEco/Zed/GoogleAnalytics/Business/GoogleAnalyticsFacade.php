<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Business;

use Generated\Shared\Transfer\GoogleAnalyticsEventCollectionTransfer;
use Generated\Shared\Transfer\GoogleAnalyticsEventCriteriaTransfer;
use Spryker\Zed\Kernel\Business\AbstractFacade;

/**
 * {@inheritDoc}
 *
 * @api
 *
 * @method \SprykerEco\Zed\GoogleAnalytics\Business\GoogleAnalyticsBusinessFactory getFactory()
 */
class GoogleAnalyticsFacade extends AbstractFacade implements GoogleAnalyticsFacadeInterface
{
    public function getEventCollection(
        GoogleAnalyticsEventCriteriaTransfer $googleAnalyticsEventCriteriaTransfer,
    ): GoogleAnalyticsEventCollectionTransfer {
        return $this->getFactory()
            ->createGoogleAnalyticsReader()
            ->getEventCollection($googleAnalyticsEventCriteriaTransfer);
    }
}
