<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Communication\Resolver;

interface EventCriteriaResolverInterface
{
    /**
     * @param array<string, mixed> $formData
     *
     * @return array{startDate: string, endDate: string}|null
     */
    public function resolveDateRange(array $formData): ?array;
}
