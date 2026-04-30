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

class GoogleAnalyticsDataClient implements GoogleAnalyticsDataClientInterface
{
    public function __construct(protected BetaAnalyticsDataClient $client)
    {
    }

    public function runReport(RunReportRequest $request): RunReportResponse
    {
        return $this->client->runReport($request);
    }
}
