<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Business\Client;

use Google\Analytics\Data\V1beta\Client\BetaAnalyticsDataClient;
use Google\Analytics\Data\V1beta\RunReportRequest;
use Google\Analytics\Data\V1beta\RunReportResponse;
use SprykerEco\Zed\GoogleAnalytics\GoogleAnalyticsConfig;

class GoogleAnalyticsDataClient implements GoogleAnalyticsDataClientInterface
{
    protected static ?BetaAnalyticsDataClient $client = null;

    public function __construct(protected GoogleAnalyticsConfig $googleAnalyticsConfig)
    {
    }

    public function runReport(RunReportRequest $request): RunReportResponse
    {
        if (!static::$client) {
            static::$client = new BetaAnalyticsDataClient([
                'credentials' => $this->googleAnalyticsConfig->getServiceAccountCredentialsJson(),
                'transport' => 'rest',
            ]);
        }

        return static::$client->runReport($request);
    }
}
