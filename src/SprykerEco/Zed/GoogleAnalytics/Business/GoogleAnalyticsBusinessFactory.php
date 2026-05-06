<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Business;

use Google\Analytics\Data\V1beta\Client\BetaAnalyticsDataClient;
use Spryker\Zed\Kernel\Business\AbstractBusinessFactory;
use SprykerEco\Zed\GoogleAnalytics\Business\Client\GoogleAnalyticsDataClient;
use SprykerEco\Zed\GoogleAnalytics\Business\Client\GoogleAnalyticsDataClientInterface;
use SprykerEco\Zed\GoogleAnalytics\Business\Reader\GoogleAnalyticsReader;
use SprykerEco\Zed\GoogleAnalytics\Business\Reader\GoogleAnalyticsReaderInterface;

/**
 * @method \SprykerEco\Zed\GoogleAnalytics\GoogleAnalyticsConfig getConfig()
 */
class GoogleAnalyticsBusinessFactory extends AbstractBusinessFactory
{
    public function createGoogleAnalyticsReader(): GoogleAnalyticsReaderInterface
    {
        return new GoogleAnalyticsReader($this->getConfig(), $this->createGoogleAnalyticsDataClient());
    }

    public function createGoogleAnalyticsDataClient(): GoogleAnalyticsDataClientInterface
    {
        return new GoogleAnalyticsDataClient($this->createBetaAnalyticsDataClient());
    }

    public function createBetaAnalyticsDataClient(): BetaAnalyticsDataClient
    {
        return new BetaAnalyticsDataClient([
            'credentials' => $this->getConfig()->getServiceAccountCredentialsJson(),
            'transport' => 'rest',
        ]);
    }
}
