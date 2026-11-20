<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Yves\GoogleAnalytics;

use Spryker\Shared\Money\Converter\IntegerToDecimalConverter;
use Spryker\Yves\Kernel\AbstractBundleConfig;

class GoogleAnalyticsConfig extends AbstractBundleConfig
{
    /**
     * @var list<string>
     */
    protected const array ADDITIONAL_PAGE_URL_QUERY_PARAMETERS = [];

    /**
     * @var list<string>
     */
    protected const array PERSONAL_DATA_PAGE_PATH_PATTERNS = [
        '(/quote-request/[\\w-]+/)([^/]+)',
        '(/wishlist/[\\w-]+/)([^/]+)',
    ];

    protected const bool IS_COUPON_REPORTED = false;

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

    /**
     * Specification:
     * - Returns the page paths that carry personal data in one segment, as JavaScript regular expression sources with two capture groups.
     * - The first capture group is the part of the path that is kept, the second one the segment that is left out of the page URL and the referrer URL sent with every Google Analytics hit; its decoded value is also left out of the page title.
     * - Returns the quote request pages, whose reference contains the customer reference, and the wishlist pages, whose name the customer chooses, by default.
     *
     * @api
     *
     * @return list<string>
     */
    public function getPersonalDataPagePathPatterns(): array
    {
        return static::PERSONAL_DATA_PAGE_PATH_PATTERNS;
    }

    /**
     * Specification:
     * - Returns true when the voucher codes of the cart or the order are sent as `coupon` with `begin_checkout`, `add_shipping_info`, `add_payment_info` and `purchase`.
     * - A voucher code issued to one customer identifies them, so it is not sent by default.
     *
     * @api
     */
    public function isCouponReported(): bool
    {
        return static::IS_COUPON_REPORTED;
    }

    /**
     * Specification:
     * - Returns the parts per currency unit of the integer storefront prices, e.g. 100 for prices in cents, as Money stores them.
     * - The reported prices and values are the integer prices divided by it.
     *
     * @api
     */
    public function getPricePrecision(): int
    {
        return IntegerToDecimalConverter::PRICE_PRECISION;
    }
}
