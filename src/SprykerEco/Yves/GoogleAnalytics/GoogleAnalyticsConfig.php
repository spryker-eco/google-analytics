<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Yves\GoogleAnalytics;

use Spryker\Yves\Kernel\AbstractBundleConfig;

class GoogleAnalyticsConfig extends AbstractBundleConfig
{
    /**
     * @var list<string>
     */
    protected const array ADDITIONAL_PAGE_URL_QUERY_PARAMETERS = [];

    /**
     * Specification:
     * - Returns the names of the query parameters kept in the page URL and the referrer URL sent with every Google Analytics hit, in addition to the campaign parameters (`utm_*`, `gclid`, `gbraid`, `wbraid`, `dclid`, `_gl`).
     * - Every other query parameter is left out, as it may carry personal data; return only parameters that never do, e.g. `sort`.
     * - Returns an empty list by default.
     *
     * @api
     *
     * @return list<string>
     */
    public function getAdditionalPageUrlQueryParameters(): array
    {
        return static::ADDITIONAL_PAGE_URL_QUERY_PARAMETERS;
    }
}
