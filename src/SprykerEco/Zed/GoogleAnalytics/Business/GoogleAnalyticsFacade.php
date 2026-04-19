<?php

/**
 * This file is part of the Spryker Suite.
 * For full license information, please view the LICENSE file that was distributed with this source code.
 */

declare(strict_types=1);

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
        GoogleAnalyticsEventCriteriaTransfer $criteriaTransfer,
    ): GoogleAnalyticsEventCollectionTransfer {
        return $this->getFactory()
            ->createGoogleAnalyticsReader()
            ->getEventCollection($criteriaTransfer);
    }
}
