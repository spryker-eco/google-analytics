<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Yves\GoogleAnalytics\Widget;

use Spryker\Yves\Kernel\Widget\AbstractWidget;

/**
 * Hands the module configuration to the Google Analytics component, which reads it with `findWidget()`; it renders nothing.
 *
 * @method \SprykerEco\Yves\GoogleAnalytics\GoogleAnalyticsConfig getConfig()
 */
class GoogleAnalyticsWidget extends AbstractWidget
{
    protected const string PARAMETER_ADDITIONAL_PAGE_URL_QUERY_PARAMETERS = 'additionalPageUrlQueryParameters';

    protected const string PARAMETER_PRICE_PRECISION = 'pricePrecision';

    protected const string PARAMETER_PERSONAL_DATA_PAGE_PATH_PATTERNS = 'personalDataPagePathPatterns';

    protected const string PARAMETER_IS_COUPON_REPORTED = 'isCouponReported';

    public function __construct()
    {
        $this->addParameter(
            static::PARAMETER_ADDITIONAL_PAGE_URL_QUERY_PARAMETERS,
            $this->getConfig()->getAdditionalPageUrlQueryParameters(),
        );
        $this->addParameter(static::PARAMETER_PRICE_PRECISION, $this->getConfig()->getPricePrecision());
        $this->addParameter(
            static::PARAMETER_PERSONAL_DATA_PAGE_PATH_PATTERNS,
            $this->getConfig()->getPersonalDataPagePathPatterns(),
        );
        $this->addParameter(static::PARAMETER_IS_COUPON_REPORTED, $this->getConfig()->isCouponReported());
    }

    public static function getName(): string
    {
        return 'GoogleAnalyticsWidget';
    }

    public static function getTemplate(): string
    {
        return '@GoogleAnalytics/views/google-analytics/google-analytics.twig';
    }
}
